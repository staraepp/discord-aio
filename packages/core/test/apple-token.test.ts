import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appleMusicTokenProvider, parseApplePrivateKey } from '../src/music/apple-token';
import { AppleMusicMetadataClient } from '../src/music/sources';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('Apple Music developer token', () => {
  it('accepts the .p8 as PEM, \\n-escaped PEM or base64', () => {
    expect(parseApplePrivateKey(pem).asymmetricKeyType).toBe('ec');
    expect(parseApplePrivateKey(pem.replace(/\n/g, '\\n')).asymmetricKeyType).toBe('ec');
    expect(parseApplePrivateKey(Buffer.from(pem).toString('base64')).asymmetricKeyType).toBe('ec');
    expect(() => parseApplePrivateKey('nope')).toThrow(/not a valid MusicKit/);
  });

  it('signs a verifiable ES256 JWT and refreshes before expiry', () => {
    let now = 1_800_000_000;
    const token = appleMusicTokenProvider({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem }, () => now);
    const t1 = token();
    const [h, p, sig] = t1.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'TEAM123456', iat: now, exp: now + 12 * 3600 });
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'));
    expect(ok).toBe(true);
    now += 3600;
    expect(token()).toBe(t1);
    now += 10.5 * 3600;
    expect(token()).not.toBe(t1);
  });

  it('pages through long playlists up to the cap', async () => {
    const song = (n: number) => ({ attributes: { name: `Song ${n}`, artistName: 'A' } });
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      const body = url.includes('include=tracks')
        ? { data: [{ attributes: { name: 'Mix' }, relationships: { tracks: { data: Array.from({ length: 100 }, (_, i) => song(i)), next: '/v1/catalog/us/playlists/pl.x/tracks?offset=100' } } }] }
        : { data: Array.from({ length: 100 }, (_, i) => song(100 + i)), next: '/v1/catalog/us/playlists/pl.x/tracks?offset=200' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as never;
    const client = new AppleMusicMetadataClient(() => 'tok', fetchImpl);
    const r = await client.resolve('playlist', 'pl.x', 'us', 150);
    expect(r.tracks).toHaveLength(150);
    expect(r.truncated).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
