/**
 * Visitor IP for rate limiting, taken only from headers the deployment's proxy controls.
 * - cloudflare: Cloudflare sets CF-Connecting-IP itself and overwrites any client-sent value.
 * - none: X-Real-IP, else the LAST X-Forwarded-For entry (the one added by the nearest proxy);
 *   the first entry is whatever the client claimed, so it is never used.
 */
export function pickClientIp(get: (name: string) => string | null, trust: 'none' | 'cloudflare'): string {
  if (trust === 'cloudflare') return get('cf-connecting-ip')?.trim() || 'unknown';
  const real = get('x-real-ip')?.trim();
  if (real) return real;
  const chain = get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];
  return chain.at(-1) ?? 'unknown';
}
