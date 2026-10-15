import 'server-only';
import { RateLimiter } from '@aio/core';
import { HttpError } from './api';

/** Process-local limiters (single web instance by design). */
const g = globalThis as unknown as { __aioLimiters?: Record<string, RateLimiter> };
g.__aioLimiters ??= {
  login: new RateLimiter(20, 10 * 60_000),
  formView: new RateLimiter(120, 60_000),
  formSubmit: new RateLimiter(10, 10 * 60_000),
  formEdit: new RateLimiter(20, 10 * 60_000),
  verify: new RateLimiter(15, 10 * 60_000),
  aiTest: new RateLimiter(10, 60_000),
  verifyChallenge: new RateLimiter(30, 10 * 60_000),
  memberSearch: new RateLimiter(60, 60_000),
};
g.__aioLimiters.memberSearch ??= new RateLimiter(60, 60_000);
g.__aioLimiters.verifyChallenge ??= new RateLimiter(30, 10 * 60_000);

export function limit(name: keyof NonNullable<typeof g.__aioLimiters>, key: string): void {
  const r = g.__aioLimiters![name]!.consume(key);
  if (!r.allowed) throw new HttpError(429, `Too many requests. Try again in ${Math.ceil(r.retryAfterMs / 1000)} seconds.`);
}
