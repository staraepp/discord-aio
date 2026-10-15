import { savedEmbedInputSchema } from '@aio/core/embeds';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { validateActionRefs } from '@/lib/validate';

async function find(id: string, guildId: string) {
  const row = await db().savedEmbed.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Saved embed not found');
  return row;
}

export const GET = adminRoute<{ id: string }>(async ({ params, guildId }) => find(params.id, guildId));

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, savedEmbedInputSchema);
  await validateActionRefs(Object.values(input.componentActions).flat());
  const clash = await db().savedEmbed.findFirst({ where: { guildId, name: input.name, NOT: { id: before.id } } });
  if (clash) throw new HttpError(409, 'A saved embed with that name already exists.');
  const row = await db().savedEmbed.update({ where: { id: before.id }, data: { name: input.name, template: input.template as object, componentActions: input.componentActions as object } });
  await audit(session, { module: 'embeds', action: 'embed.update', targetId: row.id, before: { name: before.name }, after: { name: row.name } });
  await command(session, 'settings.changed', { module: 'embeds' });
  return row;
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  const usedBy = await db().autoresponder.count({ where: { guildId, embedId: row.id } });
  if (usedBy > 0) throw new HttpError(409, `This embed is used by ${usedBy} autoresponder(s). Change them first.`);
  await db().savedEmbed.delete({ where: { id: row.id } });
  await audit(session, { module: 'embeds', action: 'embed.delete', targetId: row.id, before: { name: row.name } });
  return { ok: true };
});
