import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ req, guildId }) => {
  const requester = req.nextUrl.searchParams.get('requester');
  const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0);
  const where = { guildId, ...(requester && /^\d{17,20}$/.test(requester) ? { requesterId: requester } : {}) };
  const [items, total] = await Promise.all([db().musicHistory.findMany({ where, orderBy: { playedAt: 'desc' }, skip: page * 50, take: 50 }), db().musicHistory.count({ where })]);
  return { items, total };
});
