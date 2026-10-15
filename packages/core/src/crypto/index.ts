import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** High-entropy URL-safe token (default 32 bytes = 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hash for storing tokens. Tokens are high-entropy so no salt/KDF is needed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
}

/**
 * Compact signed payload `base64url(json).signature` with expiry.
 * Used for OAuth state and short-lived verification sessions.
 */
export function signPayload(secret: string, payload: Record<string, unknown>, ttlMs: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs }), 'utf8').toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifyPayload<T extends Record<string, unknown>>(
  secret: string,
  signed: string,
  now = Date.now(),
): (T & { exp: number }) | null {
  const [body, sig] = signed.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, body))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof data.exp !== 'number' || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}

// ── AES-256-GCM secret encryption for BYOK provider keys ──

export interface EncryptionKeyring {
  /** Current key version used for new encryptions. */
  current: number;
  keys: Map<number, Buffer>;
}

export function parseEncryptionKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error('AI_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('AI_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

/**
 * Keyring from env: `AI_ENCRYPTION_KEY` is the current key (version from
 * `AI_ENCRYPTION_KEY_VERSION`, default 1) and `AI_ENCRYPTION_KEY_PREVIOUS`
 * (optional, `version:base64`) allows decrypt-during-rotation.
 */
export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): EncryptionKeyring {
  const version = Number(env.AI_ENCRYPTION_KEY_VERSION ?? '1');
  const keys = new Map<number, Buffer>([[version, parseEncryptionKey(env.AI_ENCRYPTION_KEY)]]);
  const prev = env.AI_ENCRYPTION_KEY_PREVIOUS;
  if (prev) {
    const [v, k] = prev.split(':');
    if (v && k) keys.set(Number(v), parseEncryptionKey(k));
  }
  return { current: version, keys };
}

/** Output format: `v{version}:{iv}:{tag}:{ciphertext}` (base64url parts). */
export function encryptSecret(plaintext: string, keyring: EncryptionKeyring, aad = 'aio-ai-credential'): string {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new Error('Current encryption key missing from keyring');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyring.current}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

export function decryptSecret(payload: string, keyring: EncryptionKeyring, aad = 'aio-ai-credential'): string {
  const [v, ivB, tagB, ctB] = payload.split(':');
  if (!v || !ivB || !tagB || !ctB || !v.startsWith('v')) throw new Error('Malformed encrypted secret');
  const key = keyring.keys.get(Number(v.slice(1)));
  if (!key) throw new Error(`No key available for version ${v}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}

export function keyVersionOf(payload: string): number {
  return Number(payload.split(':')[0]?.slice(1) ?? '0');
}

export function last4(secret: string): string {
  return secret.length <= 4 ? '****' : secret.slice(-4);
}
