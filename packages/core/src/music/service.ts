import type { Db, MusicQueueEntry, MusicSession } from '@aio/db';
import { formatDuration } from '@aio/discord-ui';
import { allocatePlayer, AsyncMutex, KeyedMutex } from './allocator';
import { authorizeMusicAction, type MusicAction, type MusicActor } from './permissions';
import { canMemberMove, currentEntry, moveItem, pendingEntries, type LoopMode } from './queue';
import { queueSpot, type QueueSpot } from './eta';
import {
  advance,
  bringToFront,
  clearPending,
  deleteSession,
  enqueueTracks,
  findSessionByVoice,
  getOrCreateSession,
  goPrevious,
  loadSession,
  recordHistory,
  removePending,
  reorderPending,
  setEntryPlayable,
  shufflePending,
  startIfIdle,
  toTimeline,
  updateSession,
  type SessionWithEntries,
} from './repository';
import type { TrackResolver } from './resolver';
import type { PanelState } from './panel';
import type { MusicSettings } from '../settings/schemas';

/** Audio backend, one voice connection per identity slot (single guild). */
export interface PlaybackPort {
  onlineSlots(): number[];
  label(slot: number): string;
  connect(slot: number, voiceChannelId: string): Promise<void>;
  disconnect(slot: number): Promise<void>;
  play(slot: number, encoded: string, opts: { startMs: number; volume: number; paused: boolean; filters?: object | null }): Promise<void>;
  stop(slot: number): Promise<void>;
  setPaused(slot: number, paused: boolean): Promise<void>;
  seek(slot: number, ms: number): Promise<void>;
  setVolume(slot: number, volume: number): Promise<void>;
  setFilters(slot: number, filters: object | null): Promise<void>;
  position(slot: number): number | null;
  supportedFilters(): string[];
}

export interface PresencePort {
  /** Non-bot members currently in the voice channel. */
  humansIn(voiceChannelId: string): number;
  channelExists(voiceChannelId: string): boolean;
}

export interface MusicNotifier {
  panel(sessionId: string, urgent?: boolean): void;
  panelStop(sessionId: string): void;
  panelTicking(sessionId: string, ticking: boolean): void;
  notice(sessionId: string, text: string): void;
  trackStarted(session: MusicSession, entry: MusicQueueEntry): void;
}

export interface MusicResult {
  ok: boolean;
  message: string;
  sessionId?: string;
  /** Set by play(): what was added, for a richer reply than `message`. */
  added?: AddedSummary;
}

export interface AddedSummary {
  title: string;
  author: string;
  uri: string | null;
  artworkUrl: string | null;
  sourceName: string;
  durationMs: number | null;
  isStream: boolean;
  /** Tracks added (more than one for playlists and albums). */
  count: number;
  collectionName: string | null;
  spot: QueueSpot | null;
  /** Extra lines: limit rejections, import caps, substitutions. */
  notes: string[];
}

export interface PlayRequest {
  guildId: string;
  voiceChannelId: string;
  textChannelId?: string | null;
  kind: 'public' | 'temp';
  actor: MusicActor;
  query: string;
  force?: boolean;
}

const IDLE_DISCONNECT_MS = 3 * 60_000;

export const FILTER_PRESETS: Record<string, { label: string; filters: object | null }> = {
  off: { label: 'Off', filters: null },
  bassboost: { label: 'Bass boost', filters: { equalizer: [0, 1, 2].map((band) => ({ band, gain: 0.2 })) } },
  nightcore: { label: 'Nightcore', filters: { timescale: { speed: 1.2, pitch: 1.2, rate: 1 } } },
  vaporwave: { label: 'Vaporwave', filters: { timescale: { speed: 0.85, pitch: 0.85, rate: 1 } } },
  karaoke: { label: 'Karaoke', filters: { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } } },
  '8d': { label: '8D', filters: { rotation: { rotationHz: 0.2 } } },
  slow: { label: 'Slowed', filters: { timescale: { speed: 0.8, pitch: 1, rate: 1 } } },
};

function filterKeys(filters: object | null): string[] {
  return filters ? Object.keys(filters) : [];
}

const MAX_FAILURE_STREAK = 3;

export class MusicService {
  private readonly allocation = new AsyncMutex();
  private readonly sessionLocks = new KeyedMutex();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Consecutive load failures per session; a run of them usually means the source is blocked. */
  private readonly failureStreak = new Map<string, number>();
  /** When the current track started, to spot SoundCloud previews that end after ~30 s. */
  private readonly playStarted = new Map<string, { entryId: string; at: number; fromMs: number }>();

  constructor(
    private readonly db: Db,
    private readonly playback: PlaybackPort,
    private readonly presence: PresencePort,
    private readonly resolver: TrackResolver,
    private readonly notifier: MusicNotifier,
    private readonly settings: () => Promise<MusicSettings>,
    private readonly now: () => number = Date.now,
  ) {}

  // ── Allocation ──

  private async identityStatuses(): Promise<{ slot: number; online: boolean; voiceChannelId?: string }[]> {
    const busy = await this.db.musicSession.findMany({ where: { identitySlot: { not: null } }, select: { identitySlot: true, voiceChannelId: true } });
    return this.playback.onlineSlots().map((slot) => ({
      slot,
      online: true,
      voiceChannelId: busy.find((b) => b.identitySlot === slot)?.voiceChannelId,
    }));
  }

  /** Ensure the session has a connected identity. Never steals a player from another room. */
  private async ensurePlayer(session: MusicSession): Promise<{ ok: true; slot: number } | { ok: false; message: string }> {
    return this.allocation.run(async () => {
      const fresh = await this.db.musicSession.findUniqueOrThrow({ where: { id: session.id } });
      if (fresh.identitySlot !== null && this.playback.onlineSlots().includes(fresh.identitySlot)) return { ok: true, slot: fresh.identitySlot };
      const result = allocatePlayer(await this.identityStatuses(), session.voiceChannelId);
      if (!result.ok) return { ok: false, message: result.message };
      await updateSession(this.db, session.id, { identitySlot: result.slot });
      try {
        await this.playback.connect(result.slot, session.voiceChannelId);
      } catch (err) {
        await updateSession(this.db, session.id, { identitySlot: null });
        return { ok: false, message: `Couldn't join the voice channel: ${err instanceof Error ? err.message : 'unknown error'}` };
      }
      return { ok: true, slot: result.slot };
    });
  }

  private async releasePlayer(session: MusicSession): Promise<void> {
    if (session.identitySlot === null) return;
    const slot = session.identitySlot;
    await updateSession(this.db, session.id, { identitySlot: null });
    await this.playback.disconnect(slot).catch(() => undefined);
  }

  private clearIdleTimer(sessionId: string): void {
    const t = this.idleTimers.get(sessionId);
    if (t) clearTimeout(t);
    this.idleTimers.delete(sessionId);
  }

  private scheduleIdleDisconnect(session: MusicSession): void {
    this.clearIdleTimer(session.id);
    if (session.is247) return;
    const timer = setTimeout(() => {
      void this.sessionLocks.run(session.id, async () => {
        const s = await this.db.musicSession.findUnique({ where: { id: session.id } });
        if (s && s.state === 'idle' && !s.is247) {
          await this.releasePlayer(s);
          this.notifier.panel(s.id, true);
        }
      });
    }, IDLE_DISCONNECT_MS);
    timer.unref?.();
    this.idleTimers.set(session.id, timer);
  }

  // ── Playback core ──

  private async playEntry(session: MusicSession, entry: MusicQueueEntry, startMs = 0, attempts = 0): Promise<MusicResult> {
    if (session.identitySlot === null) return { ok: false, message: 'No player is connected to this room.' };
    this.clearIdleTimer(session.id);
    let playable = entry;
    if (!playable.encoded) {
      const match = await this.resolver.resolveLazy(playable).catch(() => null);
      if (!match) {
        this.notifier.notice(session.id, `Skipped “${entry.title}”: no playable match was found.`);
        if (attempts > 25) return { ok: false, message: 'Too many unplayable tracks in a row.' };
        const next = await advance(this.db, session.id, 'skip');
        if (!next.entry) return this.finishQueue(next.session);
        return this.playEntry(next.session, next.entry, 0, attempts + 1);
      }
      playable = await setEntryPlayable(this.db, entry.id, {
        encoded: match.encoded,
        uri: match.uri ?? entry.uri,
        sourceName: match.sourceName,
        durationMs: match.durationMs ?? entry.durationMs,
        isSeekable: match.isSeekable,
        isStream: match.isStream,
        substitutionNote: match.substitutionNote ?? null,
        artworkUrl: entry.artworkUrl ?? match.artworkUrl,
      });
    }
    const canSeek = playable.isSeekable && !playable.isStream;
    this.playStarted.set(session.id, { entryId: playable.id, at: this.now(), fromMs: canSeek ? startMs : 0 });
    await this.playback.play(session.identitySlot, playable.encoded, {
      startMs: canSeek ? startMs : 0,
      volume: session.volume,
      paused: false,
      filters: session.filters as object | null,
    });
    await updateSession(this.db, session.id, { state: 'playing', positionMs: canSeek ? startMs : 0 });
    if (startMs === 0) {
      await recordHistory(this.db, session, playable);
      this.notifier.trackStarted(session, playable);
    }
    this.notifier.panelTicking(session.id, true);
    this.notifier.panel(session.id, true);
    return { ok: true, message: `Now playing **${playable.title}**.`, sessionId: session.id };
  }

  private async finishQueue(session: MusicSession): Promise<MusicResult> {
    if (session.identitySlot !== null) await this.playback.stop(session.identitySlot).catch(() => undefined);
    this.notifier.panelTicking(session.id, false);
    this.notifier.panel(session.id, true);
    this.scheduleIdleDisconnect(session);
    return { ok: true, message: 'The queue has finished.', sessionId: session.id };
  }

  private async resumeSuspended(session: SessionWithEntries): Promise<MusicResult> {
    const player = await this.ensurePlayer(session);
    if (!player.ok) return { ok: false, message: player.message };
    const fresh = (await loadSession(this.db, session.id))!;
    const cur = currentEntry(toTimeline(fresh, fresh.entries));
    if (!cur) {
      const started = await startIfIdle(this.db, session.id);
      if (!started) {
        await updateSession(this.db, session.id, { state: 'idle' });
        return { ok: true, message: 'Reconnected. The queue is empty though, use `/play` to add something.', sessionId: session.id };
      }
      return this.playEntry(started.session, started.entry!);
    }
    await updateSession(this.db, session.id, { state: 'playing' });
    const res = await this.playEntry({ ...fresh, identitySlot: player.slot, state: 'playing' }, cur, fresh.positionMs);
    if (res.ok && fresh.positionMs > 0) {
      const restored = cur.isSeekable && !cur.isStream;
      res.message = restored
        ? `Resumed **${cur.title}** at ${formatDuration(fresh.positionMs)}.`
        : `Resumed **${cur.title}** from the start (this source can't seek to the saved position).`;
      if (!restored) this.notifier.notice(session.id, 'Playback restarted from the beginning because the saved position could not be restored.');
    }
    return res;
  }

  // ── Commands ──

  async play(req: PlayRequest): Promise<MusicResult> {
    const decision = authorizeMusicAction({ action: req.force ? 'forceplay' : 'play', actor: req.actor });
    if (!decision.ok) return { ok: false, message: decision.reason };
    const settings = await this.settings();
    const resolved = await this.resolver.resolve(req.query, { cap: settings.playlistImportCap, sources: settings.sources });
    if (!resolved.ok) return { ok: false, message: resolved.message };

    const session = await getOrCreateSession(this.db, {
      guildId: req.guildId,
      voiceChannelId: req.voiceChannelId,
      textChannelId: req.textChannelId,
      kind: req.kind,
      volume: settings.defaultVolume,
    });

    return this.sessionLocks.run(session.id, async () => {
      const player = await this.ensurePlayer(session);
      if (!player.ok) return { ok: false, message: player.message };

      const bypass = req.actor.isStaff || req.kind === 'temp';
      const enq = await enqueueTracks(this.db, {
        sessionId: session.id,
        requesterId: req.actor.userId,
        tracks: resolved.tracks,
        bypass,
        limit: settings.consecutiveLimit,
        staffAdded: req.actor.isStaff,
        playNext: req.force,
      });

      const parts: string[] = [];
      // Everything after the headline, shown as small print under the reply card.
      const notes: string[] = [];
      if (enq.accepted === 0) {
        parts.push(`You already have ${settings.consecutiveLimit} songs in a row in the queue. Wait for someone else's song or for yours to play, then try again.`);
      } else if (resolved.collectionName) {
        parts.push(`Queued **${enq.accepted}** track${enq.accepted === 1 ? '' : 's'} from **${resolved.collectionName}**.`);
      } else {
        const e = enq.entries[0]!;
        parts.push(`Queued **${e.title}** by ${e.author} (${e.isStream ? 'LIVE' : formatDuration(e.durationMs)}).`);
      }
      if (enq.rejected > 0 && enq.accepted > 0) notes.push(`${enq.rejected} track${enq.rejected === 1 ? ' was' : 's were'} not added because of the ${settings.consecutiveLimit}-songs-in-a-row limit.`);
      if (resolved.truncated) notes.push(`Only the first ${settings.playlistImportCap} tracks were imported (safety limit).`);
      notes.push(...resolved.notes.filter(Boolean));

      const fresh = (await loadSession(this.db, session.id))!;
      if (fresh.state === 'suspended') {
        const r = await this.resumeSuspended(fresh);
        if (!r.ok) notes.push(r.message);
      } else if (req.force && enq.accepted > 0 && (fresh.state === 'playing' || fresh.state === 'paused')) {
        const next = await advance(this.db, session.id, 'skip');
        if (next.entry) await this.playEntry(next.session, next.entry);
      } else if (fresh.state !== 'playing' && fresh.state !== 'paused') {
        const started = await startIfIdle(this.db, session.id);
        if (started?.entry) {
          const r = await this.playEntry(started.session, started.entry);
          if (!r.ok) notes.push(r.message);
        }
      } else {
        this.notifier.panel(session.id, true);
      }
      const first = enq.entries[0];
      let added: AddedSummary | undefined;
      if (first) {
        const now = (await loadSession(this.db, session.id))!;
        const positionMs = now.identitySlot !== null ? (this.playback.position(now.identitySlot) ?? now.positionMs) : now.positionMs;
        added = {
          title: first.title,
          author: first.author,
          uri: first.uri,
          artworkUrl: first.artworkUrl,
          sourceName: first.sourceName,
          durationMs: first.durationMs,
          isStream: first.isStream,
          count: enq.accepted,
          collectionName: resolved.collectionName ?? null,
          spot: queueSpot(toTimeline(now, now.entries), first.id, { positionMs, loopMode: now.loopMode as LoopMode }),
          notes,
        };
      }
      return { ok: enq.accepted > 0, message: [...parts, ...notes].join('\n'), sessionId: session.id, added };
    });
  }

  private async withSession(
    guildId: string,
    voiceChannelId: string,
    action: MusicAction,
    actor: MusicActor,
    fn: (s: SessionWithEntries, cur: MusicQueueEntry | undefined) => Promise<MusicResult>,
    targetRequesterId?: (s: SessionWithEntries) => string | undefined,
  ): Promise<MusicResult> {
    const found = await findSessionByVoice(this.db, guildId, voiceChannelId);
    if (!found) return { ok: false, message: 'There is no music session in this voice channel.' };
    return this.sessionLocks.run(found.id, async () => {
      const s = (await loadSession(this.db, found.id))!;
      const cur = s.state === 'idle' ? undefined : currentEntry(toTimeline(s, s.entries));
      const decision = authorizeMusicAction({ action, actor, currentRequesterId: cur?.requesterId, targetRequesterId: targetRequesterId?.(s) });
      if (!decision.ok) return { ok: false, message: decision.reason };
      return fn(s, cur);
    });
  }

  skip(guildId: string, voiceChannelId: string, actor: MusicActor, force = false): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, force ? 'forceskip' : 'skip', actor, async (s, cur) => {
      if (!cur) return { ok: false, message: 'Nothing is playing.' };
      const next = await advance(this.db, s.id, 'skip');
      if (!next.entry) {
        await this.finishQueue(next.session);
        return { ok: true, message: `Skipped **${cur.title}**. The queue is now empty.` };
      }
      await this.playEntry(next.session, next.entry);
      return { ok: true, message: `Skipped **${cur.title}**.` };
    });
  }

  previous(guildId: string, voiceChannelId: string, actor: MusicActor): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'previous', actor, async (s) => {
      if (s.state === 'suspended') return { ok: false, message: 'Use `/resume` first.' };
      const prev = await goPrevious(this.db, s.id);
      if (!prev?.entry) return { ok: false, message: 'There is no previous track in this session.' };
      if (prev.session.identitySlot === null) {
        const player = await this.ensurePlayer(prev.session);
        if (!player.ok) return { ok: false, message: player.message };
        prev.session.identitySlot = player.slot;
      }
      await this.playEntry(prev.session, prev.entry);
      return { ok: true, message: `Going back to **${prev.entry.title}**.` };
    });
  }

  pause(guildId: string, voiceChannelId: string, actor: MusicActor): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'pause', actor, async (s) => {
      if (s.state !== 'playing' || s.identitySlot === null) return { ok: false, message: 'Nothing is playing.' };
      await this.playback.setPaused(s.identitySlot, true);
      await updateSession(this.db, s.id, { state: 'paused', positionMs: this.playback.position(s.identitySlot) ?? s.positionMs });
      this.notifier.panelTicking(s.id, false);
      this.notifier.panel(s.id, true);
      return { ok: true, message: 'Paused.' };
    });
  }

  /** Resume a paused player, or reattach a suspended (emptied/crashed) session. */
  async resume(guildId: string, voiceChannelId: string, actor: MusicActor): Promise<MusicResult> {
    const found = await findSessionByVoice(this.db, guildId, voiceChannelId);
    if (found?.state === 'suspended') {
      const decision = authorizeMusicAction({ action: 'play', actor });
      if (!decision.ok) return { ok: false, message: decision.reason };
      return this.sessionLocks.run(found.id, async () => this.resumeSuspended((await loadSession(this.db, found.id))!));
    }
    return this.withSession(guildId, voiceChannelId, 'resume', actor, async (s) => {
      if (s.state !== 'paused' || s.identitySlot === null) return { ok: false, message: 'The player is not paused.' };
      await this.playback.setPaused(s.identitySlot, false);
      await updateSession(this.db, s.id, { state: 'playing' });
      this.notifier.panelTicking(s.id, true);
      this.notifier.panel(s.id, true);
      return { ok: true, message: 'Resumed.' };
    });
  }

  seek(guildId: string, voiceChannelId: string, actor: MusicActor, ms: number): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'seek', actor, async (s, cur) => {
      if (!cur || s.identitySlot === null) return { ok: false, message: 'Nothing is playing.' };
      if (!cur.isSeekable || cur.isStream) return { ok: false, message: 'This track does not support seeking.' };
      if (cur.durationMs !== null && ms >= cur.durationMs) return { ok: false, message: `That's past the end of the track (${formatDuration(cur.durationMs)}).` };
      await this.playback.seek(s.identitySlot, ms);
      await updateSession(this.db, s.id, { positionMs: ms });
      this.notifier.panel(s.id, true);
      return { ok: true, message: `Seeked to ${formatDuration(ms)}.` };
    });
  }

  stop(guildId: string, voiceChannelId: string, actor: MusicActor): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'stop', actor, async (s) => {
      if (s.identitySlot !== null) await this.playback.stop(s.identitySlot).catch(() => undefined);
      const cleared = await clearPending(this.db, s.id);
      await updateSession(this.db, s.id, { state: 'stopped', positionMs: 0 });
      await this.releasePlayer(s);
      this.notifier.panelTicking(s.id, false);
      this.notifier.panel(s.id, true);
      return { ok: true, message: `Stopped playback, cleared ${cleared} queued track${cleared === 1 ? '' : 's'} and left the channel.` };
    });
  }

  disconnect(guildId: string, voiceChannelId: string, actor: MusicActor): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'disconnect', actor, async (s) => {
      await this.suspendSession(s, 'Staff disconnected me. The queue is saved, so `/resume` picks it back up.');
      return { ok: true, message: 'Disconnected. The queue and current track are saved.' };
    });
  }

  setLoop(guildId: string, voiceChannelId: string, actor: MusicActor, mode: LoopMode): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'loop', actor, async (s) => {
      await updateSession(this.db, s.id, { loopMode: mode });
      this.notifier.panel(s.id, true);
      return { ok: true, message: mode === 'off' ? 'Loop turned off.' : mode === 'track' ? 'Looping the current track.' : 'Looping the whole queue.' };
    });
  }

  setVolume(guildId: string, voiceChannelId: string, actor: MusicActor, volume: number): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'volume', actor, async (s) => {
      const v = Math.round(Math.min(200, Math.max(0, volume)) / 10) * 10;
      if (s.identitySlot !== null) await this.playback.setVolume(s.identitySlot, v);
      await updateSession(this.db, s.id, { volume: v });
      this.notifier.panel(s.id, true);
      return { ok: true, message: `Volume set to ${v}%.` };
    });
  }

  setFilter(guildId: string, voiceChannelId: string, actor: MusicActor, preset: string): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'filter', actor, async (s) => {
      const p = FILTER_PRESETS[preset];
      if (!p) return { ok: false, message: 'Unknown filter preset.' };
      const unsupported = filterKeys(p.filters).filter((k) => !this.playback.supportedFilters().includes(k));
      if (unsupported.length) return { ok: false, message: `The audio backend does not support: ${unsupported.join(', ')}.` };
      if (s.identitySlot !== null) await this.playback.setFilters(s.identitySlot, p.filters);
      await updateSession(this.db, s.id, { filters: p.filters });
      return { ok: true, message: `Filter: ${p.label}.` };
    });
  }

  shuffle(guildId: string, voiceChannelId: string, actor: MusicActor): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'shuffle', actor, async (s) => {
      const n = await shufflePending(this.db, s.id);
      this.notifier.panel(s.id, true);
      return n < 2 ? { ok: false, message: 'Need at least two queued tracks to shuffle.' } : { ok: true, message: `Shuffled ${n} queued tracks.` };
    });
  }

  remove(guildId: string, voiceChannelId: string, actor: MusicActor, index1: number): Promise<MusicResult> {
    return this.withSession(
      guildId,
      voiceChannelId,
      'remove',
      actor,
      async (s) => {
        const target = pendingEntries(toTimeline(s, s.entries))[index1 - 1];
        if (!target) return { ok: false, message: `There is no track at position ${index1}.` };
        await removePending(this.db, s.id, [target.id]);
        this.notifier.panel(s.id, true);
        return { ok: true, message: `Removed **${target.title}**.` };
      },
      (s) => pendingEntries(toTimeline(s, s.entries))[index1 - 1]?.requesterId,
    );
  }

  move(guildId: string, voiceChannelId: string, actor: MusicActor, from1: number, to1: number): Promise<MusicResult> {
    return this.withSession(
      guildId,
      voiceChannelId,
      'move',
      actor,
      async (s) => {
        const pending = pendingEntries(toTimeline(s, s.entries));
        const settings = await this.settings();
        const check = canMemberMove({
          pending,
          from: from1 - 1,
          to: to1 - 1,
          actorId: actor.userId,
          limit: settings.consecutiveLimit,
          bypass: actor.isStaff || actor.isRoomOwner === true || s.kind === 'temp',
        });
        if (!check.ok) return { ok: false, message: check.reason };
        await reorderPending(this.db, s.id, moveItem(pending, from1 - 1, to1 - 1).map((p) => p.id));
        this.notifier.panel(s.id, true);
        return { ok: true, message: `Moved **${pending[from1 - 1]!.title}** to position ${to1}.` };
      },
      (s) => pendingEntries(toTimeline(s, s.entries))[from1 - 1]?.requesterId,
    );
  }

  clear(guildId: string, voiceChannelId: string, actor: MusicActor, mine: boolean): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, mine ? 'clear_mine' : 'clear_all', actor, async (s) => {
      const n = await clearPending(this.db, s.id, mine ? actor.userId : undefined);
      this.notifier.panel(s.id, true);
      return { ok: true, message: `Removed ${n} track${n === 1 ? '' : 's'} from the queue.` };
    });
  }

  jump(guildId: string, voiceChannelId: string, actor: MusicActor, index1: number): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'jump', actor, async (s) => {
      const target = pendingEntries(toTimeline(s, s.entries))[index1 - 1];
      if (!target) return { ok: false, message: `There is no track at position ${index1}.` };
      await bringToFront(this.db, s.id, target.id);
      const next = await advance(this.db, s.id, 'skip');
      if (next.entry) await this.playEntry(next.session, next.entry);
      return { ok: true, message: `Jumped to **${target.title}**.` };
    });
  }

  toggle247(guildId: string, voiceChannelId: string, actor: MusicActor, enabled: boolean): Promise<MusicResult> {
    return this.withSession(guildId, voiceChannelId, 'toggle_247', actor, async (s) => {
      const settings = await this.settings();
      if (enabled && !settings.allow247) return { ok: false, message: '24/7 mode is disabled in the dashboard.' };
      await updateSession(this.db, s.id, { is247: enabled });
      if (enabled) this.clearIdleTimer(s.id);
      this.notifier.panel(s.id, true);
      return { ok: true, message: enabled ? '24/7 mode on: the player stays connected.' : '24/7 mode off.' };
    });
  }

  // ── Dashboard (staff, already authorised by the web layer) ──

  async dashboardAction(sessionId: string, action: string, arg?: unknown): Promise<MusicResult> {
    const s = await this.db.musicSession.findUnique({ where: { id: sessionId } });
    if (!s) return { ok: false, message: 'Session not found.' };
    const staff: MusicActor = { userId: 'dashboard', isStaff: true, inVoiceChannel: true, viaDashboard: true };
    switch (action) {
      case 'skip':
        return this.skip(s.guildId, s.voiceChannelId, staff, true);
      case 'previous':
        return this.previous(s.guildId, s.voiceChannelId, staff);
      case 'pause':
        return this.pause(s.guildId, s.voiceChannelId, staff);
      case 'resume':
        return this.resume(s.guildId, s.voiceChannelId, staff);
      case 'stop':
        return this.stop(s.guildId, s.voiceChannelId, staff);
      case 'disconnect':
        return this.disconnect(s.guildId, s.voiceChannelId, staff);
      case 'shuffle':
        return this.shuffle(s.guildId, s.voiceChannelId, staff);
      case 'loop':
        return this.setLoop(s.guildId, s.voiceChannelId, staff, arg as LoopMode);
      case 'volume':
        return this.setVolume(s.guildId, s.voiceChannelId, staff, Number(arg));
      case 'toggle_247':
        return this.toggle247(s.guildId, s.voiceChannelId, staff, Boolean(arg));
      case 'filter':
        return this.setFilter(s.guildId, s.voiceChannelId, staff, String(arg));
      case 'clear':
        return this.clear(s.guildId, s.voiceChannelId, staff, false);
      case 'remove_entry': {
        const n = await removePending(this.db, s.id, [String(arg)]);
        this.notifier.panel(s.id, true);
        return n ? { ok: true, message: 'Removed from the queue.' } : { ok: false, message: 'That track is no longer queued.' };
      }
      case 'reorder': {
        const ids = Array.isArray(arg) ? arg.map(String) : [];
        await reorderPending(this.db, s.id, ids);
        this.notifier.panel(s.id, true);
        return { ok: true, message: 'Queue order saved.' };
      }
      case 'jump_entry': {
        const pending = pendingEntries(toTimeline(s, await this.db.musicQueueEntry.findMany({ where: { sessionId: s.id }, orderBy: { position: 'asc' } })));
        const index = pending.findIndex((p) => p.id === String(arg));
        if (index < 0) return { ok: false, message: 'That track is no longer queued.' };
        return this.jump(s.guildId, s.voiceChannelId, staff, index + 1);
      }
      case 'refresh':
        this.notifier.panel(s.id, true);
        return { ok: true, message: 'Panel refreshed.' };
      default:
        return { ok: false, message: 'Unknown action.' };
    }
  }

  // ── Lifecycle events ──

  /** Called by the audio adapter when a track stops on a slot. */
  async handleTrackEnd(slot: number, reason: 'finished' | 'loadFailed' | 'stopped' | 'replaced' | 'cleanup', detail?: string): Promise<void> {
    if (reason === 'stopped' || reason === 'replaced' || reason === 'cleanup') return;
    const s = await this.db.musicSession.findFirst({ where: { identitySlot: slot } });
    if (!s) return;
    await this.sessionLocks.run(s.id, async () => {
      if (reason === 'finished' && (await this.endedAsPreview(s.id))) {
        reason = 'loadFailed';
        detail = 'SoundCloud only has a 30-second preview of it.';
      }
      if (reason === 'loadFailed' && (await this.tryAlternateSource(s.id))) return;
      if (reason === 'loadFailed') {
        const streak = (this.failureStreak.get(s.id) ?? 0) + 1;
        this.failureStreak.set(s.id, streak);
        if (streak >= MAX_FAILURE_STREAK) {
          // Stop instead of burning through the whole queue; everything stays saved for /resume.
          this.failureStreak.delete(s.id);
          const fresh = await this.db.musicSession.findUnique({ where: { id: s.id } });
          if (fresh) await this.suspendSession(fresh, `${MAX_FAILURE_STREAK} tracks in a row failed to load, so I stopped 😣 ${detail ? `Reason: ${detail} ` : ''}The queue is saved, use \`/resume\` to try again.`);
          return;
        }
        this.notifier.notice(s.id, detail ? `Couldn't play that track, ${detail} Skipped it.` : 'A track failed to load and was skipped.');
      } else {
        this.failureStreak.delete(s.id);
      }
      const next = await advance(this.db, s.id, reason === 'finished' ? 'finished' : 'skip');
      if (!next.entry) {
        await this.finishQueue(next.session);
        return;
      }
      await this.playEntry(next.session, next.entry);
    });
  }

  /** A SoundCloud track that "finished" far before its length was a preview, not the song. */
  private async endedAsPreview(sessionId: string): Promise<boolean> {
    const started = this.playStarted.get(sessionId);
    if (!started) return false;
    const entry = await this.db.musicQueueEntry.findUnique({ where: { id: started.entryId } });
    if (!entry || entry.sourceName !== 'soundcloud' || !entry.durationMs || entry.durationMs < 45_000) return false;
    const played = this.now() - started.at;
    return played < 40_000 && started.fromMs + played < entry.durationMs - 15_000;
  }

  /**
   * YouTube often refuses to stream to servers. Before skipping, look for the same song on
   * SoundCloud and play that instead. Each entry gets one try, so a failing fallback skips normally.
   */
  private async tryAlternateSource(sessionId: string): Promise<boolean> {
    const fresh = await loadSession(this.db, sessionId);
    if (!fresh || fresh.identitySlot === null) return false;
    const cur = currentEntry(toTimeline(fresh, fresh.entries));
    if (!cur || cur.sourceName !== 'youtube' || cur.isStream) return false;
    const alt = await this.resolver.findAlternate(cur).catch(() => null);
    if (!alt) return false;
    const updated = await setEntryPlayable(this.db, cur.id, {
      encoded: alt.encoded,
      uri: alt.uri ?? cur.uri,
      sourceName: alt.sourceName,
      durationMs: alt.durationMs ?? cur.durationMs,
      isSeekable: alt.isSeekable,
      isStream: alt.isStream,
      substitutionNote: alt.substitutionNote ?? null,
      artworkUrl: cur.artworkUrl ?? alt.artworkUrl,
    });
    await this.playEntry(fresh, updated);
    return true;
  }

  private async suspendSession(s: MusicSession, notice: string): Promise<void> {
    const pos = s.identitySlot !== null ? (this.playback.position(s.identitySlot) ?? s.positionMs) : s.positionMs;
    const hadPlayback = s.state === 'playing' || s.state === 'paused';
    if (s.identitySlot !== null) await this.playback.stop(s.identitySlot).catch(() => undefined);
    await updateSession(this.db, s.id, { state: hadPlayback || s.state === 'suspended' ? 'suspended' : s.state, positionMs: pos });
    await this.releasePlayer(s);
    this.clearIdleTimer(s.id);
    this.notifier.panelTicking(s.id, false);
    this.notifier.notice(s.id, notice);
    this.notifier.panel(s.id, true);
  }

  /** Voice-state change: if the last human left, save everything and disconnect (unless 24/7). */
  async handleRoomMaybeEmpty(guildId: string, voiceChannelId: string): Promise<void> {
    const s = await this.db.musicSession.findUnique({ where: { guildId_voiceChannelId: { guildId, voiceChannelId } } });
    if (!s || s.identitySlot === null || s.is247) return;
    if (this.presence.humansIn(voiceChannelId) > 0) return;
    await this.sessionLocks.run(s.id, async () => {
      const fresh = await this.db.musicSession.findUnique({ where: { id: s.id } });
      if (!fresh || fresh.identitySlot === null || this.presence.humansIn(voiceChannelId) > 0) return;
      await this.suspendSession(fresh, 'Everyone left so I disconnected 😔 The queue and current track are saved, use `/resume` or `/play` when you are back.');
    });
  }

  /** Temp VC deleted: its own queue and panel state are removed. */
  async handleTempRoomDeleted(guildId: string, voiceChannelId: string): Promise<void> {
    const s = await this.db.musicSession.findUnique({ where: { guildId_voiceChannelId: { guildId, voiceChannelId } } });
    if (!s) return;
    await this.sessionLocks.run(s.id, async () => {
      this.clearIdleTimer(s.id);
      if (s.identitySlot !== null) {
        await this.playback.stop(s.identitySlot).catch(() => undefined);
        await this.playback.disconnect(s.identitySlot).catch(() => undefined);
      }
      this.notifier.panelStop(s.id);
      await deleteSession(this.db, s.id);
    });
  }

  /** Persist the live position periodically so crashes lose at most one tick. */
  async persistPosition(sessionId: string): Promise<void> {
    const s = await this.db.musicSession.findUnique({ where: { id: sessionId } });
    if (!s || s.identitySlot === null || s.state !== 'playing') return;
    const pos = this.playback.position(s.identitySlot);
    if (pos !== null) await this.db.musicSession.update({ where: { id: s.id }, data: { positionMs: Math.round(pos), positionUpdatedAt: new Date() } });
  }

  /**
   * Startup recovery. Player connections do not survive a restart, so every
   * session is detached from its identity. Sessions that were playing in a room
   * that still has listeners are resumed; empty rooms are never auto-joined
   * (their queues stay saved as suspended). Deleted rooms are cleaned up.
   */
  async recoverOnStartup(): Promise<{ resumed: number; suspended: number; removed: number }> {
    const sessions = await this.db.musicSession.findMany({ where: { state: { in: ['playing', 'paused', 'suspended', 'idle'] } } });
    let resumed = 0;
    let suspended = 0;
    let removed = 0;
    await this.db.musicSession.updateMany({ where: { identitySlot: { not: null } }, data: { identitySlot: null } });
    for (const s of sessions) {
      if (!this.presence.channelExists(s.voiceChannelId)) {
        if (s.kind === 'temp') {
          this.notifier.panelStop(s.id);
          await deleteSession(this.db, s.id);
          removed++;
        }
        continue;
      }
      const wasActive = s.state === 'playing' || s.state === 'paused';
      if (!wasActive) continue;
      const listeners = this.presence.humansIn(s.voiceChannelId) > 0;
      if (s.state === 'playing' && listeners) {
        const res = await this.sessionLocks.run(s.id, async () => this.resumeSuspended((await loadSession(this.db, s.id))!));
        if (res.ok) {
          resumed++;
          continue;
        }
      }
      await updateSession(this.db, s.id, { state: 'suspended', identitySlot: null });
      this.notifier.notice(s.id, 'I restarted 🫩 Your queue was saved though, `/resume` to continue.');
      this.notifier.panel(s.id, true);
      suspended++;
    }
    return { resumed, suspended, removed };
  }

  // ── Read models ──

  async panelState(sessionId: string): Promise<PanelState | null> {
    const s = await loadSession(this.db, sessionId);
    if (!s) return null;
    const timeline = toTimeline(s, s.entries);
    const cur = currentEntry(timeline);
    const pending = pendingEntries(timeline);
    const live = s.identitySlot !== null && s.state === 'playing' ? this.playback.position(s.identitySlot) : null;
    const showTrack = cur && s.state !== 'stopped' && !(s.state === 'idle');
    return {
      sessionId: s.id,
      state: s.state,
      track: showTrack
        ? {
            title: cur.title,
            author: cur.author,
            uri: cur.uri,
            sourceName: cur.sourceName,
            durationMs: cur.durationMs,
            artworkUrl: cur.artworkUrl,
            requesterId: cur.requesterId,
            isStream: cur.isStream,
            substitutionNote: cur.substitutionNote,
          }
        : null,
      positionMs: Math.round(live ?? s.positionMs),
      volume: s.volume,
      loopMode: s.loopMode,
      queueLength: pending.length,
      queuePosition: cur ? timeline.entries.indexOf(cur) + 1 : 0,
      is247: s.is247,
      nextUp: pending[0] ? { title: pending[0].title, requesterId: pending[0].requesterId } : null,
      playerLabel: s.identitySlot !== null ? this.playback.label(s.identitySlot) : 'Not connected',
    };
  }
}
