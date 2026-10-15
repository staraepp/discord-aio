/** Formatting helpers for durations and the "cute" Now Playing timeline. */

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return 'LIVE';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Parse `1:32`, `01:02:03`, `92`, `1m32s` into milliseconds. */
export function parseTimestamp(input: string): number | undefined {
  const s = input.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const colon = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    const [, h, m, sec] = colon;
    if (Number(sec) >= 60 || (h !== undefined && Number(m) >= 60)) return undefined;
    return ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(sec)) * 1000;
  }
  const units = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(s);
  if (units && (units[1] || units[2] || units[3])) {
    return ((Number(units[1] ?? 0) * 60 + Number(units[2] ?? 0)) * 60 + Number(units[3] ?? 0)) * 1000;
  }
  return undefined;
}

export interface TimelineStyle {
  width: number;
  filled: string;
  empty: string;
  head: string;
}

export const DEFAULT_TIMELINE: TimelineStyle = { width: 16, filled: '━', empty: '┄', head: '●' };

/** `0:42 ━━━━━🎀┄┄┄┄┄┄┄┄┄┄ 3:15` */
export function renderTimeline(positionMs: number, durationMs: number | null, style: TimelineStyle = DEFAULT_TIMELINE): string {
  if (!durationMs || durationMs <= 0) return `${formatDuration(positionMs)} ${style.filled.repeat(style.width)} LIVE`;
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  const headIndex = Math.min(style.width - 1, Math.round(ratio * (style.width - 1)));
  const bar = style.filled.repeat(headIndex) + style.head + style.empty.repeat(style.width - headIndex - 1);
  return `${formatDuration(positionMs)} ${bar} ${formatDuration(durationMs)}`;
}

export function volumeLabel(volume: number): string {
  const icon = volume === 0 ? 'Muted' : 'Volume';
  return `${icon} ${volume}%`;
}
