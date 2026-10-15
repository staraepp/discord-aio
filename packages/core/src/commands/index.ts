import type { Db } from '@aio/db';
import { notifyDashboardCommand } from '@aio/db';

/**
 * Web → bot work queue. All Discord mutations stay in the bot process; the
 * dashboard records intent here and the bot executes it (LISTEN/NOTIFY + polling).
 */
export type DashboardCommandType =
  | 'settings.changed'
  | 'panel.publish'
  | 'panel.delete'
  | 'embed.send'
  | 'music.action'
  | 'commands.sync'
  | 'verification.sync_roles'
  | 'verification.reset'
  | 'verification.failed'
  | 'verification.audit'
  | 'ai.reclassify'
  | 'ai.reindex_channel'
  | 'ai.test_query'
  | 'ai.learn_now'
  | 'honeypot.publish_warning'
  | 'ticket.transcript'
  | 'profile.apply'
  | 'schedule.send_now'
  | 'sticky.post'
  | 'sticky.remove'
  | 'giveaway.start'
  | 'giveaway.end'
  | 'giveaway.reroll'
  | 'dm.send';

export async function enqueueDashboardCommand(db: Db, params: { guildId: string; type: DashboardCommandType; payload: Record<string, unknown>; createdBy: string | null }): Promise<string> {
  const row = await db.dashboardCommand.create({ data: { guildId: params.guildId, type: params.type, payload: params.payload as object, createdBy: params.createdBy } });
  await notifyDashboardCommand(db, row.id).catch(() => undefined);
  return row.id;
}

/** Claim the next pending command atomically (SKIP LOCKED so a restart never double-processes). */
export async function claimNextCommand(db: Db) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "DashboardCommand" SET status = 'processing', attempts = attempts + 1
    WHERE id = (SELECT id FROM "DashboardCommand" WHERE status = 'pending' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id`;
  if (!rows[0]) return null;
  return db.dashboardCommand.findUnique({ where: { id: rows[0].id } });
}

export async function completeCommand(db: Db, id: string, ok: boolean, result: unknown, error?: string): Promise<void> {
  await db.dashboardCommand.update({ where: { id }, data: { status: ok ? 'done' : 'failed', result: (result ?? undefined) as object | undefined, error: error ?? null, processedAt: new Date() } });
}

/** Commands stuck in `processing` from a crashed run are retried (bounded). */
export async function requeueStale(db: Db, olderThanMs = 5 * 60_000): Promise<number> {
  const res = await db.dashboardCommand.updateMany({
    where: { status: 'processing', createdAt: { lt: new Date(Date.now() - olderThanMs) }, attempts: { lt: 3 } },
    data: { status: 'pending' },
  });
  return res.count;
}
