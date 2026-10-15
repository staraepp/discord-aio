import { stickyMessageInputSchema } from '@aio/core/customize';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { checkEmbed } from '@/lib/schedules';

export const GET = adminRoute(async ({ guildId }) => db().stickyMessage.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } }));

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, stickyMessageInputSchema);
  await checkEmbed(guildId, input.embedId);
  if (await db().stickyMessage.findUnique({ where: { channelId: input.channelId } })) throw new HttpError(409, 'That channel already has a sticky message. Edit it instead.');
  if ((await db().stickyMessage.count({ where: { guildId } })) >= 25) throw new HttpError(400, 'You can have up to 25 sticky messages.');
  const row = await db().stickyMessage.create({ data: { guildId, ...input, createdBy: session.userId } });
  await audit(session, { module: 'core', action: 'sticky.create', targetId: row.id, after: input });
  if (row.enabled) await command(session, 'sticky.post', { channelId: row.channelId });
  return row;
});
