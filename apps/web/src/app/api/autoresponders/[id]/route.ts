import { z } from 'zod';
import { autoresponderInputSchema } from '@aio/core/autoresponder';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { saveAutoresponder, validateAutoresponder } from '@/lib/autoresponders';

async function find(id: string, guildId: string) {
  const row = await db().autoresponder.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Autoresponder not found');
  return row;
}

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, autoresponderInputSchema);
  await validateAutoresponder(input, guildId);
  const row = await saveAutoresponder(guildId, input, before.id);
  await audit(session, { module: 'autoresponders', action: 'autoresponder.update', targetId: row.id, before: { name: before.name, trigger: before.trigger }, after: { name: row.name, trigger: row.trigger } });
  await command(session, 'settings.changed', { module: 'autoresponders' });
  return row;
});

/** Quick enable/disable toggle. */
export const PATCH = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const row = await find(params.id, guildId);
  const { enabled } = await readJson(req, z.object({ enabled: z.boolean() }));
  await db().autoresponder.update({ where: { id: row.id }, data: { enabled } });
  await audit(session, { module: 'autoresponders', action: enabled ? 'autoresponder.enable' : 'autoresponder.disable', targetId: row.id });
  await command(session, 'settings.changed', { module: 'autoresponders' });
  return { ok: true };
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await db().autoresponder.delete({ where: { id: row.id } });
  await audit(session, { module: 'autoresponders', action: 'autoresponder.delete', targetId: row.id, before: { name: row.name, trigger: row.trigger } });
  await command(session, 'settings.changed', { module: 'autoresponders' });
  return { ok: true };
});
