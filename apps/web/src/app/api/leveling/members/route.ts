import { levelFromXp } from '@aio/core/leveling';
import { getModuleState } from '@aio/core';
import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ req, guildId }) => {
  const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0);
  const { settings } = await getModuleState(db(), guildId, 'leveling');
  const [rows, total] = await Promise.all([
    db().levelProfile.findMany({ where: { guildId }, orderBy: { xp: 'desc' }, skip: page * 50, take: 50 }),
    db().levelProfile.count({ where: { guildId } }),
  ]);
  return {
    total,
    items: rows.map((r, i) => ({ rank: page * 50 + i + 1, ...r, progress: levelFromXp(r.xp, settings.formula, settings.difficulty) })),
  };
});
