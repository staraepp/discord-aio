import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin, HttpError } from '@/lib/api';
import { SESSION_COOKIE, getSession, revokeSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof HttpError ? err.message : 'Blocked' }, { status: 403 });
  }
  const session = await getSession();
  if (session) await revokeSession(session.sessionId);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
