import { LavalinkManager, type Player } from 'lavalink-client';
import type { Client } from 'discord.js';
import type { Logger } from '@aio/logging';
import type { AudioSearchPort, PlayableCandidate, PlaybackPort } from '@aio/core/music';

/**
 * Lavalink-backed playback. Each music identity (main bot = slot 1, optional
 * music-only bots = slots 2/3) has its own discord.js client and its own
 * LavalinkManager connected to the SAME Lavalink nodes. Queue logic lives in
 * our MusicService; lavalink-client is used only as a transport (autoSkip off).
 *
 * Nodes are listed best first. An optional home node (on a home internet connection,
 * which YouTube doesn't block) comes before the server's own node; when it is offline,
 * players move to the next node and searches go there too.
 */

export interface LavalinkNodeConfig {
  id: string;
  url: string;
  password: string;
  secure: boolean;
}

export interface LavalinkConfig {
  nodes: LavalinkNodeConfig[];
}

export const HOME_NODE_ID = 'home';

interface LavalinkEnv {
  LAVALINK_URL?: string;
  LAVALINK_PASSWORD?: string;
  LAVALINK_SECURE: boolean;
  LAVALINK_HOME_URL?: string;
  LAVALINK_HOME_PASSWORD?: string;
}

/** Lavalink nodes, best first: the optional home node, then the server's own node. */
export function lavalinkNodes(env: LavalinkEnv): LavalinkConfig | null {
  const nodes: LavalinkNodeConfig[] = [];
  if (env.LAVALINK_HOME_URL && env.LAVALINK_HOME_PASSWORD) nodes.push({ id: HOME_NODE_ID, url: env.LAVALINK_HOME_URL, password: env.LAVALINK_HOME_PASSWORD, secure: false });
  if (env.LAVALINK_URL && env.LAVALINK_PASSWORD) nodes.push({ id: 'server', url: env.LAVALINK_URL, password: env.LAVALINK_PASSWORD, secure: env.LAVALINK_SECURE });
  return nodes.length ? { nodes } : null;
}

export function parseLavalinkUrl(raw: string, secureFlag: boolean): { host: string; port: number; secure: boolean } {
  const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `${secureFlag ? 'https' : 'http'}://${raw}`;
  const u = new URL(withProto);
  const secure = u.protocol === 'https:' || u.protocol === 'wss:' || secureFlag;
  return { host: u.hostname, port: Number(u.port || (secure ? 443 : 2333)), secure };
}

interface Identity {
  slot: number;
  client: Client;
  manager: LavalinkManager;
  guildId: string;
}

type TrackEndHandler = (slot: number, reason: 'finished' | 'loadFailed' | 'stopped' | 'replaced' | 'cleanup', detail?: string) => void;

/** Turn a Lavalink track exception into a short, user-safe reason. */
export function describeTrackFailure(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (/sign in|requires login|not a bot|login required/i.test(message)) return 'YouTube is blocking this server and SoundCloud only has a preview or a remix of it here.';
  if (/age.?restrict|inappropriate/i.test(message)) return 'that video is age restricted.';
  if (/unavailable|private|removed|copyright|not available in your country/i.test(message)) return 'that video is unavailable.';
  return undefined;
}

/**
 * Notices when YouTube playback is failing across the board (not one odd video), so it shows
 * up on the dashboard instead of only as log warnings. Raises at most one alarm per hour.
 */
export class FailureAlarm {
  private hits: number[] = [];
  private lastAlarm = -Infinity;

  constructor(
    private readonly threshold = 5,
    private readonly windowMs = 10 * 60_000,
    private readonly quietMs = 60 * 60_000,
  ) {}

  /** Record one failure; true when this one should raise the alarm. */
  record(now: number): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    this.hits.push(now);
    if (this.hits.length < this.threshold || now - this.lastAlarm < this.quietMs) return false;
    this.lastAlarm = now;
    return true;
  }
}

export const YOUTUBE_ALARM =
  'YouTube playback is failing for most tracks. Usually YouTube changed something: pull the newest ghcr.io/kikkia/yt-cipher image and a newer youtube-plugin snapshot or release (see docker/lavalink/application.yml), then restart lavalink.';

export class LavalinkPlayback implements PlaybackPort {
  private readonly identities = new Map<number, Identity>();
  /** Connected node ids per identity slot. */
  private readonly connectedNodes = new Map<number, Set<string>>();
  private filtersSupported: string[] = [];
  private readonly lastFailure = new Map<number, string>();
  private readonly youtubeAlarm = new FailureAlarm();

  constructor(
    private readonly cfg: LavalinkConfig,
    private readonly guildId: string,
    private readonly log: Logger,
    private readonly onTrackEnd: TrackEndHandler,
    private readonly onAlarm: (message: string) => void = () => undefined,
  ) {}

  /** Attach an identity once its discord.js client is ready. */
  async attach(slot: number, client: Client): Promise<void> {
    const nodes = this.cfg.nodes.map((n) => ({ id: n.id, ...parseLavalinkUrl(n.url, n.secure), authorization: n.password, retryAmount: Infinity, retryDelay: 10_000 }));
    const connected = new Set<string>();
    this.connectedNodes.set(slot, connected);
    const manager = new LavalinkManager({
      nodes,
      sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
      client: { id: client.user!.id, username: client.user!.username },
      autoSkip: false,
      // When a node drops, keep the player going on another one instead of freezing.
      autoMove: this.cfg.nodes.length > 1,
      playerOptions: {
        onDisconnect: { autoReconnect: false, destroyPlayer: false },
        clientBasedPositionUpdateInterval: 250,
        defaultSearchPlatform: 'ytsearch',
        // Off: by default lavalink-client destroys the player after 3 errors in 35s, which
        // silently kills the session. Our service decides what happens after failures.
        maxErrorsPerTime: { threshold: 0, maxAmount: -1 },
      },
      queueOptions: { maxPreviousTracks: 0 },
    });
    manager.nodeManager.on('connect', (node) => {
      connected.add(node.id);
      this.log.info({ slot, node: node.id }, 'lavalink node connected');
      void node
        .fetchInfo()
        .then((info) => {
          this.filtersSupported = info.filters ?? [];
        })
        .catch(() => undefined);
    });
    manager.nodeManager.on('disconnect', (node, reason) => {
      connected.delete(node.id);
      this.log.warn({ slot, node: node.id, reason }, 'lavalink node disconnected');
    });
    manager.nodeManager.on('error', (node, err) => {
      connected.delete(node.id);
      this.log.warn({ slot, node: node.id, err }, 'lavalink node error');
    });
    // Lavalink follows every TrackExceptionEvent with a TrackEndEvent(loadFailed), so the
    // exception only records why; advancing here too would skip two entries per failure.
    manager.on('trackError', (_player, _track, payload) => {
      const message = payload.exception?.message;
      this.log.warn({ slot, reason: message?.slice(0, 200) }, 'track failed');
      const detail = describeTrackFailure(message);
      if (message && /all clients failed|requires login|not a bot/i.test(message) && this.youtubeAlarm.record(Date.now())) this.onAlarm(YOUTUBE_ALARM);
      if (detail) this.lastFailure.set(slot, detail);
      else this.lastFailure.delete(slot);
    });
    // We drive playback with our own queue, so lavalink-client's queue is always empty and it
    // reports most track ends as 'queueEnd' instead of 'trackEnd'. Each Lavalink TrackEndEvent
    // reaches exactly one of the two, so listen to both.
    const onEnd = (payload: { type: string; reason?: string }) => {
      if (payload.type !== 'TrackEndEvent' || !payload.reason) return;
      const reason = payload.reason as Parameters<TrackEndHandler>[1];
      const detail = reason === 'loadFailed' ? this.lastFailure.get(slot) : undefined;
      this.lastFailure.delete(slot);
      this.onTrackEnd(slot, reason, detail);
    };
    manager.on('trackEnd', (_player, _track, payload) => onEnd(payload));
    manager.on('queueEnd', (_player, _track, payload) => onEnd(payload));
    // lavalink-client clears a stuck track (end reason 'stopped', which we ignore), so advance here.
    manager.on('trackStuck', () => this.onTrackEnd(slot, 'loadFailed'));
    client.on('raw', (d) => void manager.sendRawData(d));
    await manager.init({ id: client.user!.id, username: client.user!.username });
    this.identities.set(slot, { slot, client, manager, guildId: this.guildId });
  }

  isNodeConnected(): boolean {
    return [...this.connectedNodes.values()].some((c) => c.size > 0);
  }

  /** Which configured nodes are connected (for any identity), for health reporting. */
  connectedNodeIds(): string[] {
    const all = new Set([...this.connectedNodes.values()].flatMap((c) => [...c]));
    return this.cfg.nodes.map((n) => n.id).filter((id) => all.has(id));
  }

  /** The best connected node for a slot, in configured order. */
  private preferredNode(slot: number): string | undefined {
    const connected = this.connectedNodes.get(slot);
    return this.cfg.nodes.find((n) => connected?.has(n.id))?.id;
  }

  onlineSlots(): number[] {
    return [...this.identities.values()]
      .filter((i) => i.client.isReady() && (this.connectedNodes.get(i.slot)?.size ?? 0) > 0 && i.client.guilds.cache.has(this.guildId))
      .map((i) => i.slot)
      .sort();
  }

  label(slot: number): string {
    const i = this.identities.get(slot);
    return i?.client.user ? `${i.client.user.username} (#${slot})` : `Player #${slot}`;
  }

  private player(slot: number): Player | undefined {
    return this.identities.get(slot)?.manager.getPlayer(this.guildId);
  }

  async connect(slot: number, voiceChannelId: string): Promise<void> {
    const id = this.identities.get(slot);
    if (!id) throw new Error(`Player #${slot} is not available`);
    let player = id.manager.getPlayer(this.guildId);
    if (player && player.voiceChannelId !== voiceChannelId) {
      await player.destroy('moved', true).catch(() => undefined);
      player = undefined;
    }
    if (!player) player = id.manager.createPlayer({ guildId: this.guildId, voiceChannelId, selfDeaf: true, volume: 100, node: this.preferredNode(slot) });
    if (!player.connected) await player.connect();
  }

  async disconnect(slot: number): Promise<void> {
    const p = this.player(slot);
    if (p) await p.destroy('disconnect', true).catch(() => undefined);
  }

  async play(slot: number, encoded: string, opts: { startMs: number; volume: number; paused: boolean; filters?: object | null }): Promise<void> {
    const p = this.player(slot);
    if (!p) throw new Error('Player is not connected');
    // Between tracks, move back to a better node that came online (e.g. the home node after a restart).
    const best = this.preferredNode(slot);
    if (best && p.node.id !== best) {
      await p.changeNode(best).catch((err) => this.log.warn({ slot, node: best, err }, 'could not move player to preferred node'));
    }
    await p.play({ track: { encoded }, position: opts.startMs > 0 ? opts.startMs : undefined, paused: opts.paused, volume: opts.volume, filters: (opts.filters ?? {}) as never });
  }

  async stop(slot: number): Promise<void> {
    const p = this.player(slot);
    if (p) await p.stopPlaying(false, false).catch(() => undefined);
  }

  async setPaused(slot: number, paused: boolean): Promise<void> {
    const p = this.player(slot);
    if (!p) return;
    if (paused && !p.paused) await p.pause();
    if (!paused && p.paused) await p.resume();
  }

  async seek(slot: number, ms: number): Promise<void> {
    await this.player(slot)?.seek(ms);
  }

  async setVolume(slot: number, volume: number): Promise<void> {
    await this.player(slot)?.setVolume(volume, true);
  }

  async setFilters(slot: number, filters: object | null): Promise<void> {
    const p = this.player(slot);
    if (!p) return;
    const reset = { equalizer: [], timescale: null, karaoke: null, rotation: null, tremolo: null, vibrato: null, distortion: null, channelMix: null, lowPass: null };
    await p.node.updatePlayer({ guildId: this.guildId, playerOptions: { filters: { ...reset, ...(filters ?? {}) } as never } });
  }

  position(slot: number): number | null {
    const p = this.player(slot);
    return p ? p.position : null;
  }

  supportedFilters(): string[] {
    return this.filtersSupported;
  }
}

/**
 * Search/load via Lavalink's REST API (v4 /loadtracks). Uses the first reachable node in
 * configured order, so searches run where the audio will play. An unreachable node is
 * skipped for a short while instead of slowing every search down.
 */
export class LavalinkSearch implements AudioSearchPort {
  private readonly downUntil = new Map<string, number>();

  constructor(
    private readonly cfg: LavalinkConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** The node searches currently go to, or null when none has answered recently. */
  activeNodeId(): string | null {
    return this.cfg.nodes.find((n) => (this.downUntil.get(n.id) ?? 0) <= this.now())?.id ?? null;
  }

  async load(identifier: string): ReturnType<AudioSearchPort['load']> {
    const candidates = this.cfg.nodes.filter((n) => (this.downUntil.get(n.id) ?? 0) <= this.now());
    // Everything marked down: try them all anyway rather than failing without asking.
    for (const node of candidates.length ? candidates : this.cfg.nodes) {
      const { host, port, secure } = parseLavalinkUrl(node.url, node.secure);
      const url = `${secure ? 'https' : 'http'}://${host}:${port}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`;
      let res: Response;
      try {
        res = await fetch(url, { headers: { Authorization: node.password }, signal: AbortSignal.timeout(node === this.cfg.nodes.at(-1) ? 15_000 : 8_000) });
      } catch {
        this.downUntil.set(node.id, this.now() + 30_000);
        continue;
      }
      this.downUntil.delete(node.id);
      return this.parse(res);
    }
    return { type: 'error', message: 'The audio backend is unreachable.' };
  }

  private async parse(res: Response): ReturnType<AudioSearchPort['load']> {
    if (!res.ok) return { type: 'error', message: `Audio backend returned HTTP ${res.status}.` };
    const body = (await res.json()) as { loadType: string; data: unknown };
    const map = (t: LavalinkTrackJson): PlayableCandidate => ({
      encoded: t.encoded,
      title: t.info.title,
      author: t.info.author,
      durationMs: t.info.isStream ? null : t.info.length,
      uri: t.info.uri ?? null,
      sourceName: t.info.sourceName,
      artworkUrl: t.info.artworkUrl ?? null,
      isStream: t.info.isStream,
      isSeekable: t.info.isSeekable,
      isrc: t.info.isrc ?? null,
    });
    switch (body.loadType) {
      case 'track':
        return { type: 'track', tracks: [map(body.data as LavalinkTrackJson)] };
      case 'playlist': {
        const pl = body.data as { info: { name: string }; tracks: LavalinkTrackJson[] };
        return { type: 'playlist', name: pl.info.name, tracks: pl.tracks.map(map) };
      }
      case 'search':
        return { type: 'search', tracks: (body.data as LavalinkTrackJson[]).map(map) };
      case 'empty':
        return { type: 'empty' };
      default:
        return { type: 'error', message: ((body.data as { message?: string }) ?? {}).message ?? 'Unknown error' };
    }
  }
}

interface LavalinkTrackJson {
  encoded: string;
  info: { title: string; author: string; length: number; uri?: string; sourceName: string; artworkUrl?: string | null; isStream: boolean; isSeekable: boolean; isrc?: string | null };
}
