/**
 * Pure queue rules for Music V2. The session timeline is a single ordered list:
 * entries before the cursor are history, the cursor entry is "now playing",
 * entries after it are pending. `/previous` just moves the cursor back, so it
 * always reaches the prior track instead of restarting the current one.
 */

export type LoopMode = 'off' | 'track' | 'queue';

export interface TimelineEntry {
  id: string;
  position: number;
  requesterId: string;
}

export interface Timeline<E extends TimelineEntry = TimelineEntry> {
  /** Active entries sorted by position ascending. */
  entries: E[];
  /** Position of the current entry, or -1 if nothing has started. */
  cursor: number;
}

export function currentEntry<E extends TimelineEntry>(t: Timeline<E>): E | undefined {
  return t.entries.find((e) => e.position === t.cursor);
}

export function pendingEntries<E extends TimelineEntry>(t: Timeline<E>): E[] {
  return t.entries.filter((e) => e.position > t.cursor);
}

export function historyEntries<E extends TimelineEntry>(t: Timeline<E>): E[] {
  return t.entries.filter((e) => e.position < t.cursor);
}

/** Length of the run of `requesterId` tracks at the tail of the pending queue. */
export function trailingRunLength(pending: { requesterId: string }[], requesterId: string): number {
  let run = 0;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]!.requesterId !== requesterId) break;
    run++;
  }
  return run;
}

export interface EnqueuePlan {
  accepted: number;
  rejected: number;
  reason?: 'consecutive_limit';
}

/**
 * Public-room rule: an ordinary member may have at most `limit` CONSECUTIVE
 * queued tracks. A different requester's entry breaks the run. Staff and
 * temporary rooms bypass. Playlists queue only the fitting subset.
 */
export function planEnqueue(params: {
  pending: { requesterId: string }[];
  requesterId: string;
  count: number;
  limit: number;
  bypass: boolean;
}): EnqueuePlan {
  if (params.bypass) return { accepted: params.count, rejected: 0 };
  const room = Math.max(0, params.limit - trailingRunLength(params.pending, params.requesterId));
  const accepted = Math.min(room, params.count);
  const rejected = params.count - accepted;
  return rejected > 0 ? { accepted, rejected, reason: 'consecutive_limit' } : { accepted, rejected };
}

/** Longest consecutive run for a requester anywhere in the list. */
export function longestRun(list: { requesterId: string }[], requesterId: string): number {
  let best = 0;
  let run = 0;
  for (const e of list) {
    run = e.requesterId === requesterId ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Reorder helper: move item at `from` index to `to` index (0-based within pending). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) throw new RangeError('Position out of range');
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

/**
 * A member moving their own track must not create a run longer than the limit
 * (for them) in a public room. Staff bypass.
 */
export function canMemberMove(params: {
  pending: { id: string; requesterId: string }[];
  from: number;
  to: number;
  actorId: string;
  limit: number;
  bypass: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const item = params.pending[params.from];
  if (!item) return { ok: false, reason: 'That queue position does not exist.' };
  if (params.to < 0 || params.to >= params.pending.length) return { ok: false, reason: 'Target position is out of range.' };
  if (params.bypass) return { ok: true };
  if (item.requesterId !== params.actorId) return { ok: false, reason: 'You can only move tracks you requested.' };
  const moved = moveItem(params.pending, params.from, params.to);
  if (longestRun(moved, params.actorId) > params.limit)
    return { ok: false, reason: `That move would give you more than ${params.limit} tracks in a row.` };
  return { ok: true };
}

/** Fisher–Yates shuffle of pending entries only. Metadata (requester, flags) moves with each entry. */
export function shuffleEntries<T>(pending: T[], random: () => number = Math.random): T[] {
  const copy = [...pending];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export type AdvanceReason = 'finished' | 'skip';

/**
 * Next cursor position after the current track ends or is skipped.
 * - loop track: a naturally finished track repeats; an explicit skip moves on.
 * - loop queue: after the last entry, wrap to the first active entry.
 * - off: stop at the end (no autoplay).
 */
export function nextPosition(t: Timeline, loop: LoopMode, reason: AdvanceReason): number | null {
  const cur = currentEntry(t);
  if (loop === 'track' && reason === 'finished' && cur) return cur.position;
  const next = pendingEntries(t)[0];
  if (next) return next.position;
  if (loop === 'queue' && t.entries.length > 0) return t.entries[0]!.position;
  return null;
}

/** Previous always targets the prior track in the play timeline. */
export function previousPosition(t: Timeline): number | null {
  const hist = historyEntries(t);
  const prev = hist[hist.length - 1];
  return prev ? prev.position : null;
}

/** Resolve a 1-based pending index (as shown in /queue) to an entry. */
export function pendingAt<E extends TimelineEntry>(t: Timeline<E>, index1: number): E | undefined {
  return pendingEntries(t)[index1 - 1];
}
