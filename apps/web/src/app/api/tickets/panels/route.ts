import { ticketPanelInputSchema } from '@aio/core/tickets';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { CHANNEL_TYPES } from '@/lib/discord';
import { saveTicketPanel } from '@/lib/panels';
import { validateRefs } from '@/lib/validate';

export const GET = adminRoute(async ({ guildId }) => {
  const panels = await db().ticketPanel.findMany({ where: { guildId }, include: { types: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  const published = await db().persistentPanel.findMany({ where: { guildId, kind: 'ticket' } });
  return panels.map((p) => ({ ...p, published: published.find((x) => x.refId === p.id) ?? null }));
});

export const POST = adminRoute(async ({ req, session, guildId }) => {
  const input = await readJson(req, ticketPanelInputSchema);
  await validateRefs({ channels: input.types.map((t) => t.categoryId), roles: input.types.flatMap((t) => t.staffRoleIds), channelTypes: [CHANNEL_TYPES.category] });
  if (await db().ticketPanel.findUnique({ where: { guildId_name: { guildId, name: input.name } } })) throw new HttpError(409, 'A panel with that name already exists.');
  const panel = await saveTicketPanel(guildId, input);
  await audit(session, { module: 'tickets', action: 'panel.create', targetId: panel.id, after: { name: panel.name, types: panel.types.length } });
  await command(session, 'settings.changed', { module: 'tickets' });
  return panel;
});
