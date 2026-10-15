import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

/**
 * Apple Music API developer tokens are ES256 JWTs signed with a MusicKit private key (.p8).
 * Apple caps them at six months, so instead of pasting a token that silently expires we sign
 * short-lived ones ourselves and refresh them before they run out.
 */

export interface AppleMusicKey {
  teamId: string;
  keyId: string;
  /** The .p8 file contents: PEM with real or `\n`-escaped newlines, or the whole file base64-encoded. */
  privateKey: string;
}

const TOKEN_TTL_SEC = 12 * 60 * 60;
const REFRESH_MARGIN_SEC = 60 * 60;

/** Accepts the .p8 in the forms that survive a one-line .env value. */
export function parseApplePrivateKey(raw: string): KeyObject {
  let pem = raw.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec') throw new Error('not an EC key');
    return key;
  } catch {
    throw new Error('APPLE_MUSIC_PRIVATE_KEY is not a valid MusicKit .p8 key.');
  }
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

export function signAppleMusicToken(key: { teamId: string; keyId: string; privateKey: KeyObject }, nowSec: number, ttlSec = TOKEN_TTL_SEC): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: key.keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: key.teamId, iat: nowSec, exp: nowSec + ttlSec }));
  // JWS wants the raw r||s signature, not DER.
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Returns a valid developer token, re-signing an hour before the current one expires. */
export function appleMusicTokenProvider(creds: AppleMusicKey, now: () => number = () => Math.floor(Date.now() / 1000)): () => string {
  const privateKey = parseApplePrivateKey(creds.privateKey);
  let cached: { token: string; exp: number } | null = null;
  return () => {
    const t = now();
    if (!cached || cached.exp - t < REFRESH_MARGIN_SEC) cached = { token: signAppleMusicToken({ teamId: creds.teamId, keyId: creds.keyId, privateKey }, t), exp: t + TOKEN_TTL_SEC };
    return cached.token;
  };
}
