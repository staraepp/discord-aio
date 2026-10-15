import { presetInputSchema } from '@aio/core/tempvc';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ guildId }) => db().tempVoicePreset.findMany({ where: { guildId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }));

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, presetInputSchema);
  if ((await db().tempVoicePreset.count({ where: { guildId } })) >= 20) throw new HttpError(422, 'You can have at most 20 presets.');
  if (await db().tempVoicePreset.findUnique({ where: { guildId_name: { guildId, name: input.name } } })) throw new HttpError(409, 'A preset with that name already exists.');
  const row = await db().tempVoicePreset.create({ data: { ...input, emoji: input.emoji ?? null, bitrate: input.bitrate ?? null, guildId } });
  await audit(session, { module: 'tempvc', action: 'preset.create', targetId: row.id, after: input });
  await command(session, 'settings.changed', { module: 'tempvc' });
  return row;
});
