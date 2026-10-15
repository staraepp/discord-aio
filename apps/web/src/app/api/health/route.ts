import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { checkDbHealth } from '@aio/db';
import { db } from '@/lib/server';

export async function GET() {
  const health = await checkDbHealth(db()).catch(() => ({ ok: false }));
  return NextResponse.json({ ok: health.ok, service: 'web' }, { status: health.ok ? 200 : 503 });
}
