import { rolePanelInputSchema } from '@aio/core/rolepanels';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { saveRolePanel } from '@/lib/panels';
import { validateRefs } from '@/lib/validate';

async function find(id: string, guildId: string) {
  const row = await db().rolePanel.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Panel not found');
  return row;
}

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, rolePanelInputSchema);
  await validateRefs({ roles: [...input.requiredRoleIds, ...input.blockedRoleIds], channels: [input.logChannelId] }, input.options.map((o) => o.roleId));
  const clash = await db().rolePanel.findFirst({ where: { guildId, name: input.name, NOT: { id: before.id } } });
  if (clash) throw new HttpError(409, 'A panel with that name already exists.');
  const panel = await saveRolePanel(guildId, input, before.id);
  await audit(session, { module: 'rolepanels', action: 'panel.update', targetId: panel.id, before: { name: before.name }, after: { name: panel.name, options: panel.options.length } });
  await command(session, 'settings.changed', { module: 'rolepanels' });
  return panel;
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await command(session, 'panel.delete', { kind: 'rolepanel', refId: row.id });
  await db().rolePanel.delete({ where: { id: row.id } });
  await audit(session, { module: 'rolepanels', action: 'panel.delete', targetId: row.id, before: { name: row.name } });
  return { ok: true };
});
