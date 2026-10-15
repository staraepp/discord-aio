import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ req, guildId }) => {
  const q = req.nextUrl.searchParams;
  const module = q.get('module') || undefined;
  const actorId = q.get('actor') || undefined;
  const cursor = q.get('cursor') || undefined;
  const rows = await db().auditLog.findMany({
    where: { guildId, ...(module ? { module } : {}), ...(actorId ? { actorId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
});
