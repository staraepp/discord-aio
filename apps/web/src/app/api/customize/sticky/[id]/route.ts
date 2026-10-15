import { stickyMessageInputSchema } from '@aio/core/customize';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { checkEmbed } from '@/lib/schedules';

async function find(id: string, guildId: string) {
  const row = await db().stickyMessage.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Sticky message not found');
  return row;
}

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, stickyMessageInputSchema);
  await checkEmbed(guildId, input.embedId);
  if (input.channelId !== before.channelId && (await db().stickyMessage.findUnique({ where: { channelId: input.channelId } }))) throw new HttpError(409, 'That channel already has a sticky message.');
  const row = await db().stickyMessage.update({ where: { id: before.id }, data: { ...input, lastMessageId: input.channelId === before.channelId ? before.lastMessageId : null } });
  await audit(session, { module: 'core', action: 'sticky.update', targetId: row.id, after: input });
  // Moving channels or turning it off removes the old copy; otherwise re-post with the new content.
  if (input.channelId !== before.channelId || !row.enabled) await command(session, 'sticky.remove', { channelId: before.channelId, messageId: before.lastMessageId });
  if (row.enabled) await command(session, 'sticky.post', { channelId: row.channelId });
  return row;
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await db().stickyMessage.delete({ where: { id: row.id } });
  await audit(session, { module: 'core', action: 'sticky.delete', targetId: row.id });
  await command(session, 'sticky.remove', { channelId: row.channelId, messageId: row.lastMessageId });
  return { ok: true };
});
