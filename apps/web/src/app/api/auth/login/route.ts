import { NextResponse, type NextRequest } from 'next/server';
import { generateToken } from '@aio/core';
import { env } from '@/lib/server';
import { oauthAuthorizeUrl } from '@/lib/discord';
import { STATE_COOKIE, clientIp, cookieOptions } from '@/lib/session';
import { limit } from '@/lib/ratelimit';

export async function GET(req: NextRequest) {
  const base = env().PUBLIC_BASE_URL;
  try {
    limit('login', await clientIp());
  } catch {
    return NextResponse.redirect(new URL('/login?error=rate_limited', base));
  }
  if (!env().DISCORD_CLIENT_ID || !env().DISCORD_CLIENT_SECRET) return NextResponse.redirect(new URL('/login?error=oauth_not_configured', base));
  const state = generateToken(24);
  const next = req.nextUrl.searchParams.get('next');
  const res = NextResponse.redirect(oauthAuthorizeUrl(state));
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, next: next && next.startsWith('/dashboard') ? next : '/dashboard' }), cookieOptions(600));
  return res;
}
