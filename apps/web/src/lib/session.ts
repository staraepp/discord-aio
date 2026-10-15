import 'server-only';
import { pickClientIp } from './client-ip';
import { cookies, headers } from 'next/headers';
import { signPayload, verifyPayload } from '@aio/core';
import { db, env } from './server';
import { isGuildAdmin } from './discord';

export const SESSION_COOKIE = 'aio_session';
export const STATE_COOKIE = 'aio_oauth_state';
export const DEV_USER_ID = '0';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface Session {
  sessionId: string;
  userId: string;
  username: string;
  avatar: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  devPreview: boolean;
}

export function authSecret(): string {
  const s = env().AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set to at least 32 random characters');
  return s;
}

export function devLoginAllowed(): boolean {
  const e = env();
  return e.NODE_ENV !== 'production' && e.DASHBOARD_DEV_LOGIN === true;
}

export function cookieOptions(maxAgeSec: number) {
  return { httpOnly: true, secure: env().PUBLIC_BASE_URL.startsWith('https://'), sameSite: 'lax' as const, path: '/', maxAge: maxAgeSec };
}

export async function createSession(user: { id: string; username: string; avatar: string | null }): Promise<string> {
  const row = await db().dashboardSession.create({ data: { userId: user.id, username: user.username, avatar: user.avatar, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  return signPayload(authSecret(), { sid: row.id, uid: user.id }, SESSION_TTL_MS);
}

/** Reads and verifies the session; admin status is re-checked server-side against Discord (cached ~60 s). */
export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  let payload: { sid: string; uid: string } | null;
  try {
    payload = verifyPayload<{ sid: string; uid: string }>(authSecret(), raw);
  } catch {
    return null;
  }
  if (!payload) return null;
  const row = await db().dashboardSession.findUnique({ where: { id: payload.sid } });
  if (!row || row.revokedAt || row.expiresAt < new Date() || row.userId !== payload.uid) return null;
  const devPreview = row.userId === DEV_USER_ID && devLoginAllowed();
  const isOwner = row.userId === env().OWNER_DISCORD_USER_ID;
  let isAdmin = devPreview;
  if (!devPreview) {
    try {
      isAdmin = await isGuildAdmin(row.userId);
    } catch {
      isAdmin = false;
    }
  }
  return { sessionId: row.id, userId: row.userId, username: row.username, avatar: row.avatar, isOwner, isAdmin, devPreview };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db().dashboardSession.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return pickClientIp((name) => h.get(name), env().TRUST_PROXY);
}
