import { scheduledMessageInputSchema } from '@aio/core/customize';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { checkEmbed, firstRun } from '@/lib/schedules';

const MAX_SCHEDULES = 50;

export const GET = adminRoute(async ({ guildId }) => db().scheduledMessage.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } }));

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, scheduledMessageInputSchema);
  await checkEmbed(guildId, input.embedId);
  if ((await db().scheduledMessage.count({ where: { guildId } })) >= MAX_SCHEDULES) throw new HttpError(400, `You can have up to ${MAX_SCHEDULES} scheduled messages.`);
  const next = firstRun(input);
  if (input.enabled && !next) throw new HttpError(400, 'That time is already in the past.');
  const row = await db().scheduledMessage.create({ data: { guildId, name: input.name, channelId: input.channelId, embedId: input.embedId, content: input.content, schedule: input.schedule, timezone: input.timezone, enabled: input.enabled, nextRunAt: next, createdBy: session.userId } });
  await audit(session, { module: 'core', action: 'schedule.create', targetId: row.id, after: input });
  return row;
});
