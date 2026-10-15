import { savedEmbedInputSchema } from '@aio/core/embeds';
import { adminRoute, audit, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { validateActionRefs } from '@/lib/validate';

export const GET = adminRoute(async ({ guildId }) => {
  return db().savedEmbed.findMany({ where: { guildId }, orderBy: { updatedAt: 'desc' } });
});

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, savedEmbedInputSchema);
  await validateActionRefs(Object.values(input.componentActions).flat());
  const exists = await db().savedEmbed.findUnique({ where: { guildId_name: { guildId, name: input.name } } });
  if (exists) throw new HttpError(409, 'A saved embed with that name already exists.');
  const row = await db().savedEmbed.create({ data: { guildId, name: input.name, template: input.template as object, componentActions: input.componentActions as object, createdBy: session.userId } });
  await audit(session, { module: 'embeds', action: 'embed.create', targetId: row.id, after: { name: row.name } });
  return row;
});
