import { autoresponderInputSchema } from '@aio/core/autoresponder';
import { adminRoute, audit, command, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { saveAutoresponder, validateAutoresponder } from '@/lib/autoresponders';

export const GET = adminRoute(async ({ guildId }) => {
  return db().autoresponder.findMany({ where: { guildId }, include: { actions: { orderBy: { position: 'asc' } } }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
});

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, autoresponderInputSchema);
  await validateAutoresponder(input, guildId);
  const row = await saveAutoresponder(guildId, input);
  await audit(session, { module: 'autoresponders', action: 'autoresponder.create', targetId: row.id, after: { name: row.name, trigger: row.trigger, matchMode: row.matchMode } });
  await command(session, 'settings.changed', { module: 'autoresponders' });
  return row;
});
