import { Client, GatewayIntentBits, type Message, type VoiceBasedChannel } from 'discord.js';
import { musicIdentities } from '@aio/config';
import type { MusicQueueEntry, MusicSession } from '@aio/db';
import {
  AppleMusicMetadataClient,
  appleMusicTokenProvider,
  SoundCloudCatalog,
  LrclibProvider,
  LyricsCache,
  MusicService,
  PanelScheduler,
  renderLyricWindow,
  renderNowPlayingPanel,
  SpotifyMetadataClient,
  TrackResolver,
  escapeMd,
  type LyricsResult,
  type MusicNotifier,
  type PresencePort,
} from '@aio/core/music';
import { formatDuration } from '@aio/discord-ui';
import type { BotContext } from '../../runtime/context.js';
import { MUSIC_STATUSES, startStatusRotation, statusLines } from '../../runtime/status.js';
import { textChannel, toEditOptions, toMessageOptions } from '../../runtime/discord.js';
import { HOME_NODE_ID, LavalinkPlayback, LavalinkSearch, lavalinkNodes } from './lavalink.js';
import { PlaySuggester } from './suggest.js';

/**
 * Music runtime: identities, Lavalink transport, persistent Now Playing panels,
 * lyrics follow-along, and voice-presence integration.
 */
export class MusicRuntime implements MusicNotifier, PresencePort {
  readonly service: MusicService;
  readonly playback: LavalinkPlayback | null;
  readonly resolver: TrackResolver;
  readonly suggester: PlaySuggester;
  private readonly scheduler: PanelScheduler;
  private readonly notices = new Map<string, { text: string; until: number }>();
  private readonly lyricsFollow = new Set<string>();
  private readonly lyricsCache = new LyricsCache();
  private readonly extraClients: Client[] = [];
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  readonly identityErrors = new Map<number, string>();

  constructor(private readonly ctx: BotContext) {
    const env = ctx.env;
    const lavalinkCfg = lavalinkNodes(env);
    this.playback = lavalinkCfg ? new LavalinkPlayback(lavalinkCfg, ctx.guildId, ctx.log.child({ mod: 'lavalink' }), (slot, reason, detail) => void this.service.handleTrackEnd(slot, reason, detail).catch((err) => ctx.reportError(err, 'music.trackEnd')), (message) => ctx.reportError(new Error(message), 'music.youtube')) : null;
    const search = lavalinkCfg ? new LavalinkSearch(lavalinkCfg) : null;
    this.suggester = new PlaySuggester(search);
    const catalog = new SoundCloudCatalog();
    this.resolver = new TrackResolver(
      search,
      new SpotifyMetadataClient(env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET),
      new AppleMusicMetadataClient(appleToken(ctx)),
      // SoundCloud decides full song vs preview by country, and the catalog is asked from this
      // server. When audio comes from the home node, its own search results are the ones that count.
      { search: (q, limit) => (search?.activeNodeId() === HOME_NODE_ID ? Promise.resolve(null) : catalog.search(q, limit)) },
    );
    const port = this.playback ?? nullPlayback;
    this.service = new MusicService(ctx.db, port, this, this.resolver, this, async () => (await ctx.module('music')).settings);
    this.scheduler = new PanelScheduler((id) => this.editPanel(id), undefined, (id, err) => ctx.reportError(err, 'music.panel', { sessionId: id }));
  }

  get configured(): boolean {
    return this.playback !== null;
  }

  /** Attach the main client (slot 1) and log in optional music-only identities (slots 2/3). */
  async start(): Promise<void> {
    await this.ctx.db.musicPlayerIdentity.upsert({ where: { slot: 1 }, create: { slot: 1, label: 'Main bot', botUserId: this.ctx.client.user?.id, online: true }, update: { botUserId: this.ctx.client.user?.id, online: true, lastError: null } });
    if (!this.playback) {
      this.ctx.log.warn('Music: LAVALINK_URL/LAVALINK_PASSWORD not configured; music playback reports Not Configured.');
      return;
    }
    await this.playback.attach(1, this.ctx.client);
    for (const identity of musicIdentities(this.ctx.env).filter((i) => !i.isMain)) {
      const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
      this.extraClients.push(client);
      client.once('clientReady', async () => {
        try {
          if (!client.guilds.cache.has(this.ctx.guildId)) throw new Error('This music bot is not in the configured guild. Invite it first.');
          await this.playback!.attach(identity.slot, client);
          startStatusRotation(client, async () => {
            const { statuses } = await this.ctx.profile();
            return { lines: statusLines(MUSIC_STATUSES, statuses.music, statuses.useBuiltIn), intervalMinutes: statuses.intervalMinutes };
          });
          await this.ctx.db.musicPlayerIdentity.upsert({ where: { slot: identity.slot }, create: { slot: identity.slot, label: `Music bot #${identity.slot}`, botUserId: client.user!.id, online: true }, update: { botUserId: client.user!.id, online: true, lastError: null } });
        } catch (err) {
          this.identityErrors.set(identity.slot, (err as Error).message);
          await this.ctx.db.musicPlayerIdentity.upsert({ where: { slot: identity.slot }, create: { slot: identity.slot, label: `Music bot #${identity.slot}`, online: false, lastError: (err as Error).message }, update: { online: false, lastError: (err as Error).message } });
        }
      });
      client.on('error', (err) => this.ctx.reportError(err, `music.identity.${identity.slot}`));
      await client.login(identity.token).catch(async (err: Error) => {
        this.identityErrors.set(identity.slot, 'Login failed (check the token)');
        this.ctx.log.warn({ slot: identity.slot, err: err.name }, 'music identity login failed');
        await this.ctx.db.musicPlayerIdentity.upsert({ where: { slot: identity.slot }, create: { slot: identity.slot, label: `Music bot #${identity.slot}`, online: false, lastError: 'Login failed' }, update: { online: false, lastError: 'Login failed' } });
      });
    }
    // Give Lavalink nodes a moment to connect, then recover persisted sessions.
    setTimeout(() => void this.recover(), 8_000).unref();
    this.positionTimer = setInterval(() => void this.persistPositions(), 10_000);
    this.positionTimer.unref();
  }

  private async recover(): Promise<void> {
    try {
      const r = await this.service.recoverOnStartup();
      this.ctx.log.info(r, 'music sessions recovered');
    } catch (err) {
      this.ctx.reportError(err, 'music.recover');
    }
  }

  private async persistPositions(): Promise<void> {
    const sessions = await this.ctx.db.musicSession.findMany({ where: { state: 'playing', identitySlot: { not: null } }, select: { id: true } });
    for (const s of sessions) await this.service.persistPosition(s.id).catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.positionTimer) clearInterval(this.positionTimer);
    await this.persistPositions().catch(() => undefined);
    await Promise.all(this.extraClients.map((c) => c.destroy()));
  }

  // ── PresencePort ──

  humansIn(voiceChannelId: string): number {
    const ch = this.ctx.guild()?.channels.cache.get(voiceChannelId);
    if (!ch || !ch.isVoiceBased()) return 0;
    return (ch as VoiceBasedChannel).members.filter((m) => !m.user.bot).size;
  }

  channelExists(voiceChannelId: string): boolean {
    return Boolean(this.ctx.guild()?.channels.cache.has(voiceChannelId));
  }

  // ── MusicNotifier ──

  panel(sessionId: string, urgent = true): void {
    this.scheduler.request(sessionId, urgent);
  }

  panelStop(sessionId: string): void {
    this.scheduler.stop(sessionId);
    this.lyricsFollow.delete(sessionId);
  }

  panelTicking(sessionId: string, ticking: boolean): void {
    if (ticking) void this.ctx.module('music').then((m) => this.scheduler.start(sessionId, m.settings.panelIntervalSec));
    else this.scheduler.pause(sessionId);
  }

  /** Shows the notice on the panel and as a short-lived message, so failures are never silent. */
  notice(sessionId: string, text: string): void {
    this.notices.set(sessionId, { text, until: Date.now() + 90_000 });
    this.scheduler.request(sessionId, true);
    void (async () => {
      const session = await this.ctx.db.musicSession.findUnique({ where: { id: sessionId } });
      const guild = this.ctx.guild();
      if (!session || !guild) return;
      const ch = textChannel(guild, await this.panelChannelId(session));
      const msg = await ch?.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
      if (msg) setTimeout(() => void msg.delete().catch(() => undefined), 60_000).unref();
    })().catch((err) => this.ctx.reportError(err, 'music.notice'));
  }

  trackStarted(session: MusicSession, entry: MusicQueueEntry): void {
    void (async () => {
      const m = await this.ctx.module('music');
      const guild = this.ctx.guild();
      if (!guild || !m.settings.historyLogChannelId) return;
      const ch = textChannel(guild, m.settings.historyLogChannelId);
      await ch?.send({
        content: `**${escapeMd(entry.title)}** by ${escapeMd(entry.author)} · requested by <@${entry.requesterId}> in <#${session.voiceChannelId}> (${entry.isStream ? 'LIVE' : formatDuration(entry.durationMs)})`,
        allowedMentions: { parse: [] },
      });
    })().catch((err) => this.ctx.reportError(err, 'music.historyLog'));
  }

  // ── Panel rendering ──

  private async panelChannelId(session: MusicSession): Promise<string> {
    if (session.kind === 'temp') return session.voiceChannelId; // text-in-voice chat of the temp room
    const m = await this.ctx.module('music');
    return m.settings.musicTextChannelId ?? session.textChannelId ?? session.voiceChannelId;
  }

  private async editPanel(sessionId: string): Promise<void> {
    const guild = this.ctx.guild();
    if (!guild) return;
    const state = await this.service.panelState(sessionId);
    if (!state) {
      this.scheduler.stop(sessionId);
      return;
    }
    const notice = this.notices.get(sessionId);
    if (notice && notice.until > Date.now()) state.notice = notice.text;
    else this.notices.delete(sessionId);
    const settings = (await this.ctx.module('music')).settings;
    const rendered = renderNowPlayingPanel(state, settings.panel);
    const session = await this.ctx.db.musicSession.findUnique({ where: { id: sessionId }, include: { panel: true } });
    if (!session) return;
    const channelId = session.panel?.channelId ?? (await this.panelChannelId(session));
    const channel = textChannel(guild, channelId);
    if (!channel) return;

    let message: Message | null = null;
    if (session.panel?.messageId) message = await channel.messages.fetch(session.panel.messageId).catch(() => null);
    if (message) await message.edit(toEditOptions(rendered));
    else {
      // Missing/deleted panel: repair by posting a fresh one (the ONLY time we post a new panel).
      message = await channel.send(toMessageOptions(rendered));
      await this.ctx.db.musicNowPlayingPanel.upsert({ where: { sessionId }, create: { sessionId, channelId: channel.id, messageId: message.id, lastEditedAt: new Date() }, update: { channelId: channel.id, messageId: message.id, lastEditedAt: new Date() } });
    }
    await this.ctx.db.musicNowPlayingPanel.updateMany({ where: { sessionId }, data: { lastEditedAt: new Date() } });
    if (this.lyricsFollow.has(sessionId)) await this.editLyrics(sessionId, state.positionMs).catch(() => undefined);
  }

  // ── Lyrics ──

  async lyricsFor(entry: { title: string; author: string; durationMs: number | null }): Promise<LyricsResult | null | 'disabled'> {
    const m = await this.ctx.module('music');
    if (!m.settings.lyrics.enabled || !m.settings.lyrics.termsAcknowledged) return 'disabled';
    const key = LyricsCache.key({ title: entry.title, artist: entry.author, durationMs: entry.durationMs });
    const cached = this.lyricsCache.get(key);
    if (cached !== undefined) return cached;
    const provider = new LrclibProvider();
    const result = await provider.fetch({ title: entry.title, artist: entry.author, durationMs: entry.durationMs }).catch(() => null);
    this.lyricsCache.set(key, result);
    await this.ctx.db.musicLyricsCacheMetadata
      .upsert({ where: { trackKey: key }, create: { trackKey: key, provider: provider.id, found: Boolean(result), synced: Boolean(result?.synced), attribution: result?.attribution }, update: { found: Boolean(result), synced: Boolean(result?.synced), fetchedAt: new Date() } })
      .catch(() => undefined);
    return result;
  }

  async lyricsText(sessionId: string): Promise<string> {
    const s = await this.ctx.db.musicSession.findUnique({ where: { id: sessionId }, include: { entries: true } });
    const cur = s?.entries.find((e) => e.position === s.cursor);
    if (!s || !cur || s.state === 'idle' || s.state === 'stopped') return 'Nothing is playing.';
    const lyrics = await this.lyricsFor(cur);
    if (lyrics === 'disabled') return 'Lyrics are turned off for this server.';
    if (!lyrics) return `No lyrics were found for **${escapeMd(cur.title)}**.`;
    const pos = (await this.service.panelState(sessionId))?.positionMs ?? 0;
    const body = lyrics.synced ? renderLyricWindow(lyrics.synced, pos) : (lyrics.plain ?? '').split('\n').slice(0, 25).join('\n');
    return `Lyrics for **${escapeMd(cur.title)}**\n${body}\n-# ${lyrics.attribution}${lyrics.synced ? ' · synced' : ' · not time-synced'}`.slice(0, 2000);
  }

  toggleLyricsFollow(sessionId: string): boolean {
    if (this.lyricsFollow.has(sessionId)) {
      this.lyricsFollow.delete(sessionId);
      return false;
    }
    this.lyricsFollow.add(sessionId);
    this.scheduler.request(sessionId, true);
    return true;
  }

  private async editLyrics(sessionId: string, _positionMs: number): Promise<void> {
    const guild = this.ctx.guild();
    const panel = await this.ctx.db.musicNowPlayingPanel.findUnique({ where: { sessionId } });
    if (!guild || !panel) return;
    const ch = textChannel(guild, panel.channelId);
    if (!ch) return;
    const text = await this.lyricsText(sessionId);
    const existing = panel.lyricsMessageId ? await ch.messages.fetch(panel.lyricsMessageId).catch(() => null) : null;
    if (existing) await existing.edit({ content: text, allowedMentions: { parse: [] } });
    else {
      const msg = await ch.send({ content: text, allowedMentions: { parse: [] } });
      await this.ctx.db.musicNowPlayingPanel.update({ where: { sessionId }, data: { lyricsMessageId: msg.id } });
    }
  }
}

/** Used when Lavalink is not configured: nothing is ever "online", so play() reports clearly. */
const nullPlayback = {
  onlineSlots: () => [] as number[],
  label: (slot: number) => `Player #${slot}`,
  connect: async () => {
    throw new Error('Audio backend not configured');
  },
  disconnect: async () => undefined,
  play: async () => {
    throw new Error('Audio backend not configured');
  },
  stop: async () => undefined,
  setPaused: async () => undefined,
  seek: async () => undefined,
  setVolume: async () => undefined,
  setFilters: async () => undefined,
  position: () => null,
  supportedFilters: () => [] as string[],
};

/** MusicKit key → auto-refreshing token; falls back to a fixed APPLE_MUSIC_DEVELOPER_TOKEN. */
function appleToken(ctx: BotContext): string | (() => string) | undefined {
  const { APPLE_MUSIC_TEAM_ID: teamId, APPLE_MUSIC_KEY_ID: keyId, APPLE_MUSIC_PRIVATE_KEY: privateKey } = ctx.env;
  if (teamId && keyId && privateKey) {
    try {
      return appleMusicTokenProvider({ teamId, keyId, privateKey });
    } catch (err) {
      ctx.log.warn({ err: (err as Error).message }, 'Apple Music key unusable; playlists disabled');
      return undefined;
    }
  }
  return ctx.env.APPLE_MUSIC_DEVELOPER_TOKEN;
}
