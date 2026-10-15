import { z } from 'zod';
import type { Db, Ticket } from '@aio/db';
import { Perm } from '@aio/permissions';
import { renderTemplate } from '@aio/variables';
import { messageTemplateSchema } from '@aio/discord-ui';
import { nextCounter } from '../settings/index';
import { writeAudit } from '../audit/index';

/**
 * Tickets: staff-only close/reopen, no inactivity auto-close, and a one-time
 * rename to the FIRST staff responder that takeovers never rewrite.
 */

/** Discord text channel names: lowercase, no spaces, 1–100 chars. */
export function toChannelName(input: string): string {
  const name = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return name || 'ticket';
}

export function ticketChannelName(template: string, params: { userName: string; staffName?: string; number: number; type?: string }): string {
  const r = renderTemplate(template.replace(/\{number\}/g, String(params.number)).replace(/\{type\}/g, params.type ?? 'ticket'), {
    user: { id: '0', name: params.userName },
    staff: params.staffName ? { id: '0', name: params.staffName } : undefined,
  }, { preview: true, unknown: 'blank' }).text;
  return toChannelName(r.replace(/^@/, ''));
}

export type FirstResponderDecision = { rename: false } | { rename: true; name: string };

/**
 * Called on every message in an open ticket channel.
 * Only the first message by a staff member (who is not the opener) sets the
 * handler and triggers the single rename. Later staff never rename it.
 */
export function decideFirstResponder(params: {
  ticket: Pick<Ticket, 'firstResponderId' | 'nameLocked' | 'openerId' | 'number' | 'status'>;
  authorId: string;
  authorIsStaff: boolean;
  authorIsBot: boolean;
  authorName: string;
  openerName: string;
  handledNameTemplate: string;
  typeLabel?: string;
}): FirstResponderDecision {
  const t = params.ticket;
  if (t.status !== 'open' || params.authorIsBot || !params.authorIsStaff) return { rename: false };
  if (params.authorId === t.openerId) return { rename: false };
  if (t.firstResponderId || t.nameLocked) return { rename: false };
  return {
    rename: true,
    name: ticketChannelName(params.handledNameTemplate, { userName: params.openerName, staffName: params.authorName, number: t.number, type: params.typeLabel }),
  };
}

/**
 * Atomically claim first-responder status. Returns true only for the single
 * message that wins the race, so concurrent staff replies rename at most once.
 */
export async function claimFirstResponder(db: Db, ticketId: string, staffId: string): Promise<boolean> {
  const res = await db.ticket.updateMany({
    where: { id: ticketId, firstResponderId: null, nameLocked: false, status: 'open' },
    data: { firstResponderId: staffId, handlerId: staffId, nameLocked: true },
  });
  return res.count === 1;
}

/** Takeover only updates handler metadata; the channel name is never touched. */
export async function takeOver(db: Db, ticket: Ticket, staffId: string): Promise<Ticket> {
  const updated = await db.ticket.update({ where: { id: ticket.id }, data: { handlerId: staffId } });
  await writeAudit(db, { guildId: ticket.guildId, actorId: staffId, module: 'tickets', action: 'ticket.takeover', targetId: ticket.openerId, before: { handlerId: ticket.handlerId }, after: { handlerId: staffId }, meta: { number: ticket.number } });
  return updated;
}

export type TicketAction = 'close' | 'reopen' | 'add_user' | 'remove_user' | 'rename' | 'takeover' | 'transcript';

/** Users can never close or reopen (including their own). Only ticket staff can use controls. */
export function authorizeTicketAction(params: { action: TicketAction; actorIsStaff: boolean; ticketStatus: 'open' | 'closed' }): { ok: true } | { ok: false; reason: string } {
  if (!params.actorIsStaff) {
    if (params.action === 'close') return { ok: false, reason: 'Only staff can close tickets.' };
    if (params.action === 'reopen') return { ok: false, reason: 'Only staff can reopen tickets.' };
    return { ok: false, reason: 'Only staff can use ticket controls.' };
  }
  if (params.action === 'close' && params.ticketStatus === 'closed') return { ok: false, reason: 'This ticket is already closed.' };
  if (params.action === 'reopen' && params.ticketStatus === 'open') return { ok: false, reason: 'This ticket is already open.' };
  return { ok: true };
}

export interface TicketOverwrite {
  id: string;
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

const MEMBER_ACCESS = Perm.ViewChannel | Perm.SendMessages | Perm.ReadMessageHistory | Perm.AttachFiles | Perm.EmbedLinks;

/**
 * Permission overwrites for a ticket channel in a given state.
 * Closing revokes the opener's (and added users') access; reopening restores it.
 */
export function planTicketOverwrites(params: {
  guildId: string;
  botId: string;
  openerId: string;
  staffRoleIds: string[];
  participantIds: string[];
  status: 'open' | 'closed';
}): TicketOverwrite[] {
  const out: TicketOverwrite[] = [
    { id: params.guildId, type: 0, allow: 0n, deny: Perm.ViewChannel },
    { id: params.botId, type: 1, allow: MEMBER_ACCESS | Perm.ManageChannels | Perm.ManageMessages, deny: 0n },
  ];
  for (const role of new Set(params.staffRoleIds)) out.push({ id: role, type: 0, allow: MEMBER_ACCESS | Perm.ManageMessages, deny: 0n });
  for (const user of new Set([params.openerId, ...params.participantIds])) {
    if (user === params.botId) continue;
    out.push(params.status === 'open' ? { id: user, type: 1, allow: MEMBER_ACCESS, deny: 0n } : { id: user, type: 1, allow: 0n, deny: Perm.ViewChannel | Perm.SendMessages });
  }
  return out;
}

export async function createTicketRecord(db: Db, params: { guildId: string; number?: number; typeId: string | null; openerId: string; channelId: string; answers: { question: string; answer: string }[] }): Promise<Ticket> {
  return db.$transaction(async (tx) => {
    const number = params.number ?? (await nextCounter(tx, params.guildId, 'ticket'));
    const t = await tx.ticket.create({ data: { guildId: params.guildId, number, typeId: params.typeId, openerId: params.openerId, channelId: params.channelId, answers: params.answers } });
    await writeAudit(tx, { guildId: params.guildId, actorId: params.openerId, module: 'tickets', action: 'ticket.open', targetId: params.openerId, meta: { number, channelId: params.channelId } });
    return t;
  });
}

/** Reserve a ticket number before creating the channel (needed for `{number}` in names). */
export async function reserveTicketNumber(db: Db, guildId: string): Promise<number> {
  return nextCounter(db, guildId, 'ticket');
}

export async function setTicketStatus(db: Db, ticket: Ticket, status: 'open' | 'closed', actorId: string): Promise<Ticket | null> {
  return db.$transaction(async (tx) => {
    const res = await tx.ticket.updateMany({
      where: { id: ticket.id, status: status === 'closed' ? 'open' : 'closed' },
      data: status === 'closed' ? { status, closedAt: new Date(), closedById: actorId } : { status, reopenedAt: new Date() },
    });
    if (res.count !== 1) return null;
    await writeAudit(tx, { guildId: ticket.guildId, actorId, module: 'tickets', action: status === 'closed' ? 'ticket.close' : 'ticket.reopen', targetId: ticket.openerId, meta: { number: ticket.number } });
    return tx.ticket.findUnique({ where: { id: ticket.id } });
  });
}

export const ticketQuestionSchema = z.object({
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).optional(),
  style: z.enum(['short', 'paragraph']).default('short'),
  required: z.boolean().default(true),
  maxLength: z.number().int().min(1).max(4000).default(1000),
});

export const ticketTypeInputSchema = z.object({
  id: z.string().max(40).optional(),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).optional().nullable(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  categoryId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
  staffRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).max(20).default([]),
  questions: z.array(ticketQuestionSchema).max(5).default([]),
  waitingNameTemplate: z.string().min(1).max(100).default('waiting-{user.name}'),
  handledNameTemplate: z.string().min(1).max(100).default('{staff.name}-{user.name}'),
  openingMessage: z.string().min(1).max(2000).default('Hi {user}, thanks for reaching out. A staff member will be with you soon.'),
});

export const ticketPanelInputSchema = z.object({
  name: z.string().min(1).max(80),
  template: messageTemplateSchema,
  types: z.array(ticketTypeInputSchema).min(1).max(5),
});

export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;
export type TicketQuestion = z.infer<typeof ticketQuestionSchema>;

export interface TranscriptMessage {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  attachments: string[];
}
