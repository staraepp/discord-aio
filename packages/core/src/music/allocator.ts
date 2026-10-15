/**
 * Central music-player allocation. Main bot is slot 1; optional music-only
 * identities are slots 2 and 3. Sessions are keyed by voice channel. A busy
 * player is never moved away from its room.
 */

export interface IdentityStatus {
  slot: number;
  online: boolean;
  /** Voice channel this identity is currently serving, if any. */
  voiceChannelId?: string;
}

export type AllocationResult =
  | { ok: true; slot: number; reused: boolean }
  | { ok: false; reason: 'no_players_online' | 'capacity'; message: string };

export function allocatePlayer(identities: IdentityStatus[], voiceChannelId: string): AllocationResult {
  const online = identities.filter((i) => i.online).sort((a, b) => a.slot - b.slot);
  if (online.length === 0) {
    return { ok: false, reason: 'no_players_online', message: 'No music player is online right now. Staff can check the Music page in the dashboard.' };
  }
  const existing = online.find((i) => i.voiceChannelId === voiceChannelId);
  if (existing) return { ok: true, slot: existing.slot, reused: true };
  const idle = online.find((i) => !i.voiceChannelId);
  if (idle) return { ok: true, slot: idle.slot, reused: false };
  return {
    ok: false,
    reason: 'capacity',
    message: `All ${online.length} music player${online.length === 1 ? ' is' : 's are'} busy in other rooms. Try again when one frees up.`,
  };
}

/** Serialises allocation decisions inside the single bot process. */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Per-key mutexes (e.g. one per music session). */
export class KeyedMutex {
  private readonly locks = new Map<string, AsyncMutex>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let m = this.locks.get(key);
    if (!m) {
      m = new AsyncMutex();
      this.locks.set(key, m);
    }
    return m.run(fn);
  }
}
