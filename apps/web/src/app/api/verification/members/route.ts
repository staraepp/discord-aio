import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

/** Members with verification state: failures, cooldowns and recent attempts (no answers or tokens). */
export const GET = adminRoute(async ({ req, guildId }) => {
  const user = req.nextUrl.searchParams.get('user');
  const filter = req.nextUrl.searchParams.get('filter');
  const now = new Date();
  const where = {
    guildId,
    ...(user && /^\d{17,20}$/.test(user) ? { userId: user } : {}),
    ...(filter === 'cooldown' ? { cooldownUntil: { gt: now } } : filter === 'verified' ? { verifiedAt: { not: null } } : filter === 'pending_sync' ? { pendingRoleSync: true } : {}),
  };
  const rows = await db().verificationCooldown.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 });
  const attempts = user
    ? await db().verificationAttempt.findMany({
        where: { guildId, userId: user },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, createdAt: true, expiresAt: true, consumedAt: true, result: true, failureCount: true },
      })
    : [];
  const stats = {
    inCooldown: await db().verificationCooldown.count({ where: { guildId, cooldownUntil: { gt: now } } }),
    verified7d: await db().verificationCooldown.count({ where: { guildId, verifiedAt: { gt: new Date(Date.now() - 7 * 86400_000) } } }),
    pendingRoleSync: await db().verificationCooldown.count({ where: { guildId, pendingRoleSync: true } }),
  };
  return { items: rows, attempts, stats };
});
