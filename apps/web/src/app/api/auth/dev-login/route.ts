import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin, HttpError } from '@/lib/api';
import { DEV_USER_ID, SESSION_COOKIE, cookieOptions, createSession, devLoginAllowed } from '@/lib/session';

/** Development-only preview login (DASHBOARD_DEV_LOGIN=true and NODE_ENV!=production). Never grants owner diagnostics. */
export async function POST(req: NextRequest) {
  if (!devLoginAllowed()) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  try {
    assertSameOrigin(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof HttpError ? err.message : 'Blocked' }, { status: 403 });
  }
  const token = await createSession({ id: DEV_USER_ID, username: 'dev-preview', avatar: null });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(12 * 60 * 60));
  return res;
}
