import { rolePanelInputSchema } from '@aio/core/rolepanels';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { saveRolePanel } from '@/lib/panels';
import { validateRefs } from '@/lib/validate';

export const GET = adminRoute(async ({ guildId }) => {
  const panels = await db().rolePanel.findMany({ where: { guildId }, include: { options: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  const published = await db().persistentPanel.findMany({ where: { guildId, kind: 'rolepanel' } });
  return panels.map((p) => ({ ...p, published: published.find((x) => x.refId === p.id) ?? null }));
});

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, rolePanelInputSchema);
  await validateRefs({ roles: [...input.requiredRoleIds, ...input.blockedRoleIds], channels: [input.logChannelId] }, input.options.map((o) => o.roleId));
  if (await db().rolePanel.findUnique({ where: { guildId_name: { guildId, name: input.name } } })) throw new HttpError(409, 'A panel with that name already exists.');
  const panel = await saveRolePanel(guildId, input);
  await audit(session, { module: 'rolepanels', action: 'panel.create', targetId: panel.id, after: { name: panel.name, options: panel.options.length } });
  await command(session, 'settings.changed', { module: 'rolepanels' });
  return panel;
});
