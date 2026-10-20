/**
 * In-memory sliding-window rate limiter. Sufficient for this single-guild,
 * single-process-per-app deployment (no Redis by design).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns whether the call is allowed, and records it if so. */
  consume(key: string): { allowed: boolean; retryAfterMs: number; remaining: number } {
    const t = this.now();
    this.sweep(t);
    const arr = (this.hits.get(key) ?? []).filter((ts) => ts > t - this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return { allowed: false, retryAfterMs: arr[0]! + this.windowMs - t, remaining: 0 };
    }
    arr.push(t);
    this.hits.set(key, arr);
    return { allowed: true, retryAfterMs: 0, remaining: this.limit - arr.length };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(t: number): void {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [key, arr] of this.hits) {
      if (!arr.some((ts) => ts > t - this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Simple per-key concurrency gate (e.g. one in-flight AI request per user). */
export class ConcurrencyGate {
  private readonly active = new Map<string, number>();
  constructor(private readonly max: number) {}

  tryEnter(key: string): boolean {
    const n = this.active.get(key) ?? 0;
    if (n >= this.max) return false;
    this.active.set(key, n + 1);
    return true;
  }

  leave(key: string): void {
    const n = (this.active.get(key) ?? 1) - 1;
    if (n <= 0) this.active.delete(key);
    else this.active.set(key, n);
  }
}

/** Per-key cooldown tracker (autoresponders, leveling). */
export class CooldownMap {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  isCooling(key: string): boolean {
    const u = this.until.get(key);
    if (u === undefined) return false;
    if (u <= this.now()) {
      this.until.delete(key);
      return false;
    }
    return true;
  }

  set(key: string, ms: number): void {
    if (ms > 0) this.until.set(key, this.now() + ms);
  }

  /** Milliseconds until the key is free again; 0 when it is not cooling. */
  remainingMs(key: string): number {
    return this.isCooling(key) ? this.until.get(key)! - this.now() : 0;
  }
}
