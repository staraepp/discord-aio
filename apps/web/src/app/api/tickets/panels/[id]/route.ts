import { ticketPanelInputSchema } from '@aio/core/tickets';
import { adminRoute, audit, command, HttpError, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { CHANNEL_TYPES } from '@/lib/discord';
import { saveTicketPanel } from '@/lib/panels';
import { validateRefs } from '@/lib/validate';

async function find(id: string, guildId: string) {
  const row = await db().ticketPanel.findFirst({ where: { id, guildId } });
  if (!row) throw new HttpError(404, 'Panel not found');
  return row;
}

export const PUT = adminRoute<{ id: string }>(async ({ req, params, session, guildId }) => {
  const before = await find(params.id, guildId);
  const input = await readJson(req, ticketPanelInputSchema);
  await validateRefs({ channels: input.types.map((t) => t.categoryId), roles: input.types.flatMap((t) => t.staffRoleIds), channelTypes: [CHANNEL_TYPES.category] });
  const clash = await db().ticketPanel.findFirst({ where: { guildId, name: input.name, NOT: { id: before.id } } });
  if (clash) throw new HttpError(409, 'A panel with that name already exists.');
  const panel = await saveTicketPanel(guildId, input, before.id);
  await audit(session, { module: 'tickets', action: 'panel.update', targetId: panel.id, before: { name: before.name }, after: { name: panel.name, types: panel.types.length } });
  await command(session, 'settings.changed', { module: 'tickets' });
  return panel;
});

export const DELETE = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await find(params.id, guildId);
  await command(session, 'panel.delete', { kind: 'ticket', refId: row.id });
  await db().ticketPanel.delete({ where: { id: row.id } });
  await audit(session, { module: 'tickets', action: 'panel.delete', targetId: row.id, before: { name: row.name } });
  return { ok: true };
});
