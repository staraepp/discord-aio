import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';
import { botStatus, integrations } from '@/lib/status';
import { checkDbHealth } from '@aio/db';

/** Owner-only diagnostics. Never includes secret values, only configuration state. */
export const GET = adminRoute(
  async () => {
    const d = db();
    const [dbHealth, bots, errors, commands, identities] = await Promise.all([
      checkDbHealth(d),
      botStatus(),
      d.appErrorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      d.dashboardCommand.groupBy({ by: ['status'], _count: true }),
      d.musicPlayerIdentity.findMany({ orderBy: { slot: 'asc' } }),
    ]);
    const failedCommands = await d.dashboardCommand.findMany({ where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, type: true, error: true, createdAt: true } });
    return { db: dbHealth, bots, integrations: integrations(), errors, commands, failedCommands, identities, node: process.version };
  },
  { ownerOnly: true },
);
