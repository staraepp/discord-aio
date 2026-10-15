import { currentEntry, pendingEntries, type LoopMode, type Timeline, type TimelineEntry } from './queue';

export interface EtaEntry extends TimelineEntry {
  durationMs: number | null;
  isStream: boolean;
}

export interface QueueSpot {
  /** True when the entry is the one playing right now. */
  playingNow: boolean;
  /** 1-based place among the songs waiting to play (0 when playing now). */
  place: number;
  /** Time until it starts, or null when it can't be known (streams, unknown lengths, loop one track). */
  etaMs: number | null;
}

/** Where an entry sits in the queue and roughly when it will start playing. */
export function queueSpot<E extends EtaEntry>(t: Timeline<E>, entryId: string, opts: { positionMs: number; loopMode: LoopMode }): QueueSpot | null {
  const cur = currentEntry(t);
  if (cur?.id === entryId) return { playingNow: true, place: 0, etaMs: 0 };
  const pending = pendingEntries(t);
  const idx = pending.findIndex((e) => e.id === entryId);
  if (idx < 0) return null;
  // Looping one track means the current song never ends on its own.
  if (opts.loopMode === 'track' && cur) return { playingNow: false, place: idx + 1, etaMs: null };
  let eta: number | null = 0;
  const add = (e: E) => {
    if (eta === null) return;
    eta = e.isStream || !e.durationMs ? null : eta + e.durationMs;
  };
  if (cur) {
    eta = cur.isStream || !cur.durationMs ? null : Math.max(0, cur.durationMs - opts.positionMs);
  }
  pending.slice(0, idx).forEach(add);
  return { playingNow: false, place: idx + 1, etaMs: eta };
}
