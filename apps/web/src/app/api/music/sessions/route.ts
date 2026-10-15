import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ guildId }) => {
  const [sessions, identities] = await Promise.all([
    db().musicSession.findMany({
      where: { guildId, state: { not: 'stopped' } },
      include: { entries: { orderBy: { position: 'asc' } } },
      orderBy: { lastActiveAt: 'desc' },
    }),
    db().musicPlayerIdentity.findMany({ orderBy: { slot: 'asc' } }),
  ]);
  return {
    identities,
    sessions: sessions.map((s) => {
      const current = s.entries.find((e) => e.position === s.cursor) ?? null;
      const pending = s.entries.filter((e) => e.position > s.cursor);
      const history = s.entries.filter((e) => e.position < s.cursor).slice(-10).reverse();
      const { entries: _entries, ...rest } = s;
      return { ...rest, current, pending, history };
    }),
  };
});
