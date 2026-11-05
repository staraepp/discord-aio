/**
 * Visitor IP for rate limiting, taken only from headers the deployment's proxy controls.
 * - cloudflare: Cloudflare sets CF-Connecting-IP itself and overwrites any client-sent value.
 * - proxy: your own reverse proxy (nginx, Caddy, ...) is the only way in and sets X-Real-IP or
 *   appends to X-Forwarded-For. Uses X-Real-IP, else the LAST X-Forwarded-For entry; the first
 *   entry is whatever the client claimed, so it is never used.
 * - none (default): no proxy is trusted, so every forwarding header is ignored. A direct client
 *   could otherwise send a fresh fake IP per request and dodge every rate limit. All visitors then
 *   share one bucket, which is safe but coarse: set `proxy` or `cloudflare` for per-visitor limits.
 */
export type TrustProxy = 'none' | 'proxy' | 'cloudflare';

export function pickClientIp(get: (name: string) => string | null, trust: TrustProxy): string {
  if (trust === 'cloudflare') return get('cf-connecting-ip')?.trim() || 'unknown';
  if (trust === 'none') return 'unknown';
  const real = get('x-real-ip')?.trim();
  if (real) return real;
  const chain = get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];
  return chain.at(-1) ?? 'unknown';
}
