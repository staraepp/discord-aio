import { formatDuration, renderTimeline, volumeLabel, type RenderedMessage, type RenderedRow } from '@aio/discord-ui';
import type { LoopMode } from './queue';

/**
 * Now Playing panel: one message per session, edited in place.
 * The scheduler coalesces update requests and never edits faster than the
 * configured interval (5–15 s) except for urgent state changes, which still
 * respect a minimum gap to stay well within Discord's edit rate limits.
 */

export const PANEL_MIN_GAP_MS = 2_000;

export function clampInterval(sec: number): number {
  return Math.min(15, Math.max(5, Math.round(sec))) * 1000;
}

/** Milliseconds to wait before the next edit. */
export function nextEditDelay(params: { lastEditAt: number | null; now: number; intervalMs: number; urgent: boolean; minGapMs?: number }): number {
  const gap = params.minGapMs ?? PANEL_MIN_GAP_MS;
  if (params.lastEditAt === null) return 0;
  const since = params.now - params.lastEditAt;
  const target = params.urgent ? gap : params.intervalMs;
  return Math.max(0, target - since);
}

type Timer = ReturnType<typeof setTimeout>;

export interface SchedulerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(t: Timer): void;
}

export const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

interface SessionTimer {
  timer: Timer | null;
  dueAt: number | null;
  lastEditAt: number | null;
  inFlight: boolean;
  pendingUrgent: boolean;
  ticking: boolean;
  intervalMs: number;
}

/**
 * Coalescing, rate-limited panel editor.
 * - `start(id)` begins periodic ticks during playback.
 * - `request(id, urgent)` asks for an edit soon; multiple requests merge into one.
 * - Only one edit per session is ever in flight.
 */
export class PanelScheduler {
  private readonly sessions = new Map<string, SessionTimer>();

  constructor(
    private readonly edit: (sessionId: string) => Promise<void>,
    private readonly clock: SchedulerClock = realClock,
    private readonly onError: (sessionId: string, err: unknown) => void = () => undefined,
  ) {}

  private state(id: string, intervalMs = 10_000): SessionTimer {
    let s = this.sessions.get(id);
    if (!s) {
      s = { timer: null, dueAt: null, lastEditAt: null, inFlight: false, pendingUrgent: false, ticking: false, intervalMs };
      this.sessions.set(id, s);
    }
    return s;
  }

  start(id: string, intervalSec: number): void {
    const s = this.state(id);
    s.intervalMs = clampInterval(intervalSec);
    s.ticking = true;
    this.schedule(id, false);
  }

  /** Stop periodic ticks (paused/idle); explicit requests still work. */
  pause(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.ticking = false;
  }

  stop(id: string): void {
    const s = this.sessions.get(id);
    if (s?.timer) this.clock.clearTimeout(s.timer);
    this.sessions.delete(id);
  }

  request(id: string, urgent = true): void {
    const s = this.state(id);
    if (s.inFlight) {
      s.pendingUrgent = s.pendingUrgent || urgent;
      return;
    }
    this.schedule(id, urgent);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  private schedule(id: string, urgent: boolean): void {
    const s = this.state(id);
    const delay = nextEditDelay({ lastEditAt: s.lastEditAt, now: this.clock.now(), intervalMs: s.intervalMs, urgent });
    const dueAt = this.clock.now() + delay;
    if (s.timer && s.dueAt !== null && s.dueAt <= dueAt) return; // an earlier edit is already scheduled
    if (s.timer) this.clock.clearTimeout(s.timer);
    s.dueAt = dueAt;
    s.timer = this.clock.setTimeout(() => void this.fire(id), delay);
  }

  private async fire(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    s.timer = null;
    s.dueAt = null;
    s.inFlight = true;
    try {
      await this.edit(id);
    } catch (err) {
      this.onError(id, err);
    } finally {
      s.inFlight = false;
      s.lastEditAt = this.clock.now();
    }
    if (!this.sessions.has(id)) return;
    if (s.pendingUrgent) {
      s.pendingUrgent = false;
      this.schedule(id, true);
    } else if (s.ticking) {
      this.schedule(id, false);
    }
  }
}

// ── Panel rendering ──

export interface PanelTrack {
  title: string;
  author: string;
  uri?: string | null;
  sourceName: string;
  durationMs: number | null;
  artworkUrl?: string | null;
  requesterId: string;
  isStream: boolean;
  substitutionNote?: string | null;
}

export interface PanelState {
  sessionId: string;
  state: 'idle' | 'playing' | 'paused' | 'suspended' | 'stopped';
  track: PanelTrack | null;
  positionMs: number;
  volume: number;
  loopMode: LoopMode;
  queueLength: number;
  queuePosition: number;
  is247: boolean;
  nextUp?: { title: string; requesterId: string } | null;
  playerLabel: string;
  notice?: string | null;
}

export interface PanelStyle {
  color: number;
  showArtwork: boolean;
  timelineHead: string;
  timelineFilled: string;
  timelineEmpty: string;
  footerText: string;
}

const SOURCE_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  youtubemusic: 'YouTube Music',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  applemusic: 'Apple Music',
  http: 'Direct link',
};

export function sourceLabel(name: string): string {
  return SOURCE_LABEL[name.toLowerCase()] ?? name;
}

const STATE_LABEL: Record<PanelState['state'], string> = {
  playing: 'Playing',
  paused: 'Paused',
  idle: 'Idle',
  suspended: 'Everyone left, queue saved 😔',
  stopped: 'Stopped',
};

const LOOP_LABEL: Record<LoopMode, string> = { off: 'Loop off', track: 'Looping this track', queue: 'Looping the queue' };

/** Custom-ID prefix for music panel components: `mp:<action>:<sessionId>`. */
export function musicCustomId(action: string, sessionId: string): string {
  return `mp:${action}:${sessionId}`;
}

export function renderNowPlayingPanel(p: PanelState, style: PanelStyle): RenderedMessage {
  const t = p.track;
  const timeline = t
    ? renderTimeline(p.positionMs, t.isStream ? null : t.durationMs, { width: 16, filled: style.timelineFilled, empty: style.timelineEmpty, head: style.timelineHead })
    : '';
  const remaining = t && t.durationMs && !t.isStream ? Math.max(0, t.durationMs - p.positionMs) : null;
  const lines: string[] = [];
  if (t) {
    lines.push(`### ${t.uri ? `[${escapeMd(t.title)}](${t.uri})` : escapeMd(t.title)}`);
    lines.push(`by **${escapeMd(t.author)}** · ${sourceLabel(t.sourceName)}`);
    if (t.substitutionNote) lines.push(`-# ${escapeMd(t.substitutionNote)}`);
    lines.push('', `\`${timeline}\``);
    if (remaining !== null) lines.push(`-# ${formatDuration(remaining)} remaining`);
  } else {
    lines.push('### Nothing playing', 'Use `/play` to start the music.');
  }
  if (p.notice) lines.push('', `> ${escapeMd(p.notice)}`);

  const fields = [
    { name: 'Requested by', value: t ? `<@${t.requesterId}>` : 'nobody', inline: true },
    { name: 'Status', value: STATE_LABEL[p.state], inline: true },
    { name: 'Volume', value: volumeLabel(p.volume), inline: true },
    { name: 'Loop', value: LOOP_LABEL[p.loopMode], inline: true },
    { name: 'Queue', value: p.queueLength === 0 ? 'Empty' : `${p.queueLength} up next`, inline: true },
    { name: 'Player', value: `${p.playerLabel}${p.is247 ? ' · 24/7' : ''}`, inline: true },
  ];
  if (p.nextUp) fields.push({ name: 'Up next', value: `${escapeMd(truncate(p.nextUp.title, 80))} · <@${p.nextUp.requesterId}>`, inline: false });

  const id = p.sessionId;
  const playing = p.state === 'playing';
  const rows: RenderedRow[] = [
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: 'Back', custom_id: musicCustomId('prev', id) },
        { type: 2, style: playing ? 2 : 3, label: playing ? 'Pause' : 'Play', custom_id: musicCustomId(playing ? 'pause' : 'resume', id) },
        { type: 2, style: 2, label: 'Skip', custom_id: musicCustomId('skip', id) },
        { type: 2, style: 2, label: 'Shuffle', custom_id: musicCustomId('shuffle', id) },
        { type: 2, style: 2, label: 'Stop', custom_id: musicCustomId('stop', id) },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: musicCustomId('loop', id),
          placeholder: LOOP_LABEL[p.loopMode],
          min_values: 1,
          max_values: 1,
          options: (['off', 'track', 'queue'] as LoopMode[]).map((m) => ({ label: LOOP_LABEL[m].replace(/^\S+ /, ''), value: m, default: m === p.loopMode })),
        },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: musicCustomId('volume', id),
          placeholder: `Volume ${p.volume}%`,
          min_values: 1,
          max_values: 1,
          // 0,10,...,200 = 21 options (Discord allows 25)
          options: Array.from({ length: 21 }, (_, i) => i * 10).map((v) => ({ label: `${v}%`, value: String(v), default: v === p.volume })),
        },
      ],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: 'Queue', custom_id: musicCustomId('queue', id) },
        { type: 2, style: 2, label: 'Lyrics', custom_id: musicCustomId('lyrics', id) },
      ],
    },
  ];

  return {
    embeds: [
      {
        color: style.color,
        author: { name: 'Now Playing' },
        description: lines.join('\n').slice(0, 4096),
        thumbnail: style.showArtwork && t?.artworkUrl ? { url: t.artworkUrl } : undefined,
        fields,
        footer: { text: style.footerText || 'Music' },
      },
    ],
    components: rows,
    allowed_mentions: { parse: [], users: [], roles: [] },
  };
}

export function escapeMd(text: string): string {
  return text.replace(/([\\*_`~|[\]()>#])/g, '\\$1').replace(/@(everyone|here)/g, '@\u200b$1');
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
