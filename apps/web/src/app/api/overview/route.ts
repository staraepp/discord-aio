import { MODULES, getEnabledModules } from '@aio/core';
import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';
import { botStatus, integrations } from '@/lib/status';

export const GET = adminRoute(async ({ guildId }) => {
  const d = db();
  const [enabled, bots, openTickets, newResponses, activeMusic, recentAudit, errors] = await Promise.all([
    getEnabledModules(d, guildId),
    botStatus(),
    d.ticket.count({ where: { guildId, status: 'open' } }),
    d.formSubmission.count({ where: { status: 'new', form: { guildId } } }),
    d.musicSession.count({ where: { guildId, state: { in: ['playing', 'paused'] } } }),
    d.auditLog.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    d.appErrorLog.count({ where: { createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } } }),
  ]);
  return {
    modules: MODULES.map((m) => ({ id: m.id, name: m.name, description: m.description, route: m.route, enabled: enabled.has(m.id), integrations: m.integrations })),
    bots,
    integrations: integrations(),
    counts: { openTickets, newResponses, activeMusic, errors24h: errors },
    recentAudit,
  };
});
