import { z } from 'zod';
import { adminRoute, audit, readJson } from '@/lib/api';
import { db } from '@/lib/server';

const STATUSES = ['proposed', 'learned', 'pinned', 'archived', 'superseded'] as const;

export const GET = adminRoute(async ({ req, guildId }) => {
  const status = req.nextUrl.searchParams.get('status');
  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 200);
  return db().aIMemory.findMany({
    where: {
      guildId,
      ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as (typeof STATUSES)[number] } : { status: { not: 'superseded' } }),
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    include: { sources: true },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: 200,
  });
});

/** Admin-authored memory (pinned, no Discord source). */
export const POST = adminRoute(async ({ req, session, guildId }) => {
  const body = await readJson(req, z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(2000), kind: z.enum(['vocabulary', 'project', 'decision', 'term', 'inside_joke', 'fact']).default('fact') }));
  const row = await db().aIMemory.create({ data: { guildId, ...body, status: 'pinned', confidence: 1, createdBy: session.userId, provenance: 'Written by an admin in the dashboard' } });
  await audit(session, { module: 'ai', action: 'memory.create', targetId: row.id, after: { title: row.title } });
  return row;
});
