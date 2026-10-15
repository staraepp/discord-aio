import { scheduledMessageInputSchema } from '@aio/core/customize';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { checkEmbed, firstRun } from '@/lib/schedules';

async function find(id: string, guildId: string) {
  const row = await db().scheduledMessage.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Scheduled message not found');
  return row;
}

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, scheduledMessageInputSchema);
  await checkEmbed(guildId, input.embedId);
  const next = firstRun(input);
  if (input.enabled && !next) throw new HttpError(400, 'That time is already in the past.');
  const row = await db().scheduledMessage.update({ where: { id: before.id }, data: { name: input.name, channelId: input.channelId, embedId: input.embedId, content: input.content, schedule: input.schedule, timezone: input.timezone, enabled: input.enabled, nextRunAt: next, lastError: null } });
  await audit(session, { module: 'core', action: 'schedule.update', targetId: row.id, before: { name: before.name, schedule: before.schedule }, after: input });
  return row;
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await db().scheduledMessage.delete({ where: { id: row.id } });
  await audit(session, { module: 'core', action: 'schedule.delete', targetId: row.id, before: { name: row.name } });
  return { ok: true };
});
