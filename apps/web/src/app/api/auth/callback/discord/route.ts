import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual, writeAudit } from '@aio/core';
import { db, env, guildId, log } from '@/lib/server';
import { exchangeOAuthCode, isGuildAdmin } from '@/lib/discord';
import { SESSION_COOKIE, STATE_COOKIE, cookieOptions, createSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const base = env().PUBLIC_BASE_URL;
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, base));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const raw = req.cookies.get(STATE_COOKIE)?.value;
  let stored: { state: string; next: string } | null;
  try {
    stored = raw ? (JSON.parse(raw) as { state: string; next: string }) : null;
  } catch {
    stored = null;
  }
  if (!code || !state || !stored || !safeEqual(state, stored.state)) return fail('invalid_state');
  try {
    const user = await exchangeOAuthCode(code);
    const admin = await isGuildAdmin(user.id).catch(() => false);
    const owner = user.id === env().OWNER_DISCORD_USER_ID;
    if (!admin && !owner) {
      await writeAudit(db(), { guildId: guildId(), actorId: user.id, module: 'dashboard', action: 'login.denied' });
      return fail('not_admin');
    }
    const token = await createSession(user);
    await writeAudit(db(), { guildId: guildId(), actorId: user.id, module: 'dashboard', action: 'login' });
    const res = NextResponse.redirect(new URL(admin ? stored.next : '/dashboard/diagnostics', base));
    res.cookies.delete(STATE_COOKIE);
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(12 * 60 * 60));
    return res;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : 'error' }, 'oauth callback failed');
    return fail('oauth_failed');
  }
}
