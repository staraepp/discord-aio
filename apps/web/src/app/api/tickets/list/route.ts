import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ req, guildId }) => {
  const status = req.nextUrl.searchParams.get('status') === 'closed' ? 'closed' : 'open';
  const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0);
  const [items, total] = await Promise.all([
    db().ticket.findMany({
      where: { guildId, status },
      orderBy: { createdAt: 'desc' },
      skip: page * 50,
      take: 50,
      include: { type: { select: { label: true } }, _count: { select: { transcripts: true } } },
    }),
    db().ticket.count({ where: { guildId, status } }),
  ]);
  return { items, total };
});
