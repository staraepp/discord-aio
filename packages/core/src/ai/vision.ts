import type { ImagePart } from './providers';

/** Bounded, authorised attachment handling for optional vision input. */

export const VISION_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const DISCORD_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
export const MAX_IMAGES_PER_QUESTION = 3;

export type AttachmentCheck = { ok: true } | { ok: false; reason: string };

export function checkAttachment(a: { url: string; contentType: string | null; size: number }, maxBytes: number): AttachmentCheck {
  let host: string;
  try {
    const u = new URL(a.url);
    if (u.protocol !== 'https:') return { ok: false, reason: 'insecure URL' };
    host = u.hostname;
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (!DISCORD_CDN_HOSTS.has(host)) return { ok: false, reason: 'not a Discord attachment' };
  const type = (a.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!VISION_MIME.has(type)) return { ok: false, reason: 'unsupported file type' };
  if (a.size <= 0 || a.size > maxBytes) return { ok: false, reason: `larger than ${Math.round(maxBytes / 1_000_000)} MB` };
  return { ok: true };
}

export async function fetchImage(
  a: { url: string; contentType: string | null; size: number },
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ImagePart> {
  const check = checkAttachment(a, maxBytes);
  if (!check.ok) throw new Error(`Attachment rejected: ${check.reason}`);
  const res = await fetchImpl(a.url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Attachment download failed (HTTP ${res.status})`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error('Attachment too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('Attachment too large');
  return { mimeType: (a.contentType ?? 'image/png').split(';')[0]!.trim(), base64: buf.toString('base64') };
}
