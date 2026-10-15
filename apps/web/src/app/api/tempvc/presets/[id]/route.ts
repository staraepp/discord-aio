import { presetInputSchema } from '@aio/core/tempvc';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';

async function find(id: string, guildId: string) {
  const row = await db().tempVoicePreset.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Preset not found');
  return row;
}

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, presetInputSchema);
  const clash = await db().tempVoicePreset.findFirst({ where: { guildId, name: input.name, NOT: { id: before.id } } });
  if (clash) throw new HttpError(409, 'A preset with that name already exists.');
  const row = await db().tempVoicePreset.update({ where: { id: before.id }, data: { ...input, emoji: input.emoji ?? null, bitrate: input.bitrate ?? null } });
  await audit(session, { module: 'tempvc', action: 'preset.update', targetId: row.id, before, after: input });
  await command(session, 'settings.changed', { module: 'tempvc' });
  return row;
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await db().tempVoicePreset.delete({ where: { id: row.id } });
  await audit(session, { module: 'tempvc', action: 'preset.delete', targetId: row.id, before: row });
  await command(session, 'settings.changed', { module: 'tempvc' });
  return { ok: true };
});
