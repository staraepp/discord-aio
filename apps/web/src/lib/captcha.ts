import 'server-only';
import { TurnstileVerifier } from '@aio/core/verification';
import { env } from './server';

export function turnstileSiteKey(): string | null {
  const e = env();
  return e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY ? e.TURNSTILE_SITE_KEY : null;
}

export type TurnstileOutcome = 'passed' | 'failed' | 'unavailable';

/** Server-side Turnstile check bound to `cdata` (the widget is rendered with the same data-cdata). */
export async function verifyTurnstile(response: string | undefined, ip: string, cdata: string): Promise<TurnstileOutcome> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret || !turnstileSiteKey()) return 'unavailable';
  if (!response) return 'failed';
  const res = await new TurnstileVerifier(secret).verify({ response, remoteIp: ip === 'unknown' ? undefined : ip, expectedCdata: cdata });
  if (res.success) return 'passed';
  return res.error === 'siteverify-unreachable' || res.error?.startsWith('siteverify HTTP') || res.error === 'internal-error' ? 'unavailable' : 'failed';
}
