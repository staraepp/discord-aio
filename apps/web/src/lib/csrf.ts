/**
 * CSRF decision for state-changing requests (pure, unit-tested):
 * same-origin Origin header plus a custom header that cross-site HTML forms
 * cannot send. Safe methods are always allowed.
 */
export function csrfProblem(p: { method: string; origin: string | null; host: string | null; expectedOrigin: string; csrfHeader: string | null }): string | null {
  if (p.method === 'GET' || p.method === 'HEAD' || p.method === 'OPTIONS') return null;
  if (!p.origin) return 'Cross-site request blocked';
  let originHost: string;
  try {
    originHost = new URL(p.origin).host;
  } catch {
    return 'Cross-site request blocked';
  }
  const sameAsConfigured = p.origin === new URL(p.expectedOrigin).origin;
  const sameAsHost = p.host !== null && originHost === p.host;
  if (!sameAsConfigured && !sameAsHost) return 'Cross-site request blocked';
  if (p.csrfHeader !== '1') return 'Missing CSRF header';
  return null;
}
