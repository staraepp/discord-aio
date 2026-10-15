import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

const TYPES = ['warn', 'timeout', 'untimeout', 'kick', 'voicekick', 'ban', 'tempban', 'softban', 'unban', 'purge', 'slowmode', 'lock', 'unlock', 'lockdown', 'honeypot', 'automod'] as const;
type T = (typeof TYPES)[number];

export const GET = adminRoute(async ({ req, guildId }) => {
  const q = req.nextUrl.searchParams;
  const type = q.get('type');
  const target = q.get('target');
  const moderator = q.get('moderator');
  const page = Math.max(0, Number(q.get('page') ?? 0) || 0);
  const where = {
    guildId,
    deletedAt: null,
    ...(type && (TYPES as readonly string[]).includes(type) ? { type: type as T } : {}),
    ...(target && /^\d{17,20}$/.test(target) ? { targetId: target } : {}),
    ...(moderator && /^\d{17,20}$/.test(moderator) ? { moderatorId: moderator } : {}),
  };
  const [items, total] = await Promise.all([
    db().moderationCase.findMany({ where, orderBy: { caseNumber: 'desc' }, skip: page * 50, take: 50, include: { edits: { orderBy: { createdAt: 'desc' }, take: 10 } } }),
    db().moderationCase.count({ where }),
  ]);
  const warnCounts = target && /^\d{17,20}$/.test(target) ? await db().moderationCase.count({ where: { guildId, targetId: target, type: 'warn', active: true, deletedAt: null } }) : null;
  return { items, total, warnCount: warnCounts };
});
