import 'server-only';
import type { z } from 'zod';
import type { ticketPanelInputSchema } from '@aio/core/tickets';
import type { RolePanelInput } from '@aio/core/rolepanels';
import { db } from './server';

type TicketPanelInput = z.infer<typeof ticketPanelInputSchema>;

/** Saves a ticket panel; type IDs stay stable so existing tickets keep their type. */
export async function saveTicketPanel(guildId: string, input: TicketPanelInput, id?: string) {
  return db().$transaction(async (tx) => {
    const panel = id
      ? await tx.ticketPanel.update({ where: { id }, data: { name: input.name, template: input.template as object } })
      : await tx.ticketPanel.create({ data: { guildId, name: input.name, template: input.template as object } });
    const existing = new Set((await tx.ticketType.findMany({ where: { panelId: panel.id }, select: { id: true } })).map((t) => t.id));
    const keep = input.types.map((t) => t.id).filter((tid): tid is string => Boolean(tid && existing.has(tid)));
    await tx.ticketType.deleteMany({ where: { panelId: panel.id, id: { notIn: keep } } });
    for (const [position, t] of input.types.entries()) {
      const { id: typeId, ...rest } = t;
      const data = { ...rest, position, emoji: rest.emoji ?? null, categoryId: rest.categoryId ?? null, questions: rest.questions as object };
      if (typeId && keep.includes(typeId)) await tx.ticketType.update({ where: { id: typeId }, data });
      else await tx.ticketType.create({ data: { ...data, panelId: panel.id } });
    }
    return tx.ticketPanel.findUniqueOrThrow({ where: { id: panel.id }, include: { types: { orderBy: { position: 'asc' } } } });
  });
}

export async function saveRolePanel(guildId: string, input: RolePanelInput, id?: string) {
  const { options, ...fields } = input;
  const data = { ...fields, template: fields.template as object, maxRoles: fields.maxRoles ?? null, logChannelId: fields.logChannelId ?? null, placeholder: fields.placeholder ?? null };
  return db().$transaction(async (tx) => {
    const panel = id ? await tx.rolePanel.update({ where: { id }, data }) : await tx.rolePanel.create({ data: { ...data, guildId } });
    await tx.rolePanelOption.deleteMany({ where: { panelId: panel.id } });
    await tx.rolePanelOption.createMany({
      data: options.map((o, position) => ({ ...o, panelId: panel.id, position, emoji: o.emoji ?? null, description: o.description ?? null })),
    });
    return tx.rolePanel.findUniqueOrThrow({ where: { id: panel.id }, include: { options: { orderBy: { position: 'asc' } } } });
  });
}
