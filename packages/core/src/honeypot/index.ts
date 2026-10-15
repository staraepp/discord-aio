import { z } from 'zod';

/**
 * Honeypot (independent reimplementation of the trap-channel concept).
 * Opt-in only; the admin deliberately chooses the action.
 */

export type HoneypotAction = 'delete_alert' | 'kick' | 'softban' | 'ban';

export function isExempt(params: { userId: string; roleIds: string[]; isBot: boolean; isAdmin: boolean; exemptRoleIds: string[]; exemptUserIds: string[] }): boolean {
  if (params.isBot || params.isAdmin) return true;
  if (params.exemptUserIds.includes(params.userId)) return true;
  return params.exemptRoleIds.some((r) => params.roleIds.includes(r));
}

export function shouldTrigger(params: { enabled: boolean; trapChannelId: string | null; messageChannelId: string; exempt: boolean }): boolean {
  return params.enabled && params.trapChannelId !== null && params.trapChannelId === params.messageChannelId && !params.exempt;
}

export const DESTRUCTIVE_ACTIONS: ReadonlySet<HoneypotAction> = new Set<HoneypotAction>(['kick', 'softban', 'ban']);

export const honeypotConfigSchema = z
  .object({
    channelId: z.string().regex(/^\d{17,20}$/).nullable(),
    action: z.enum(['delete_alert', 'kick', 'softban', 'ban']),
    /** Must be true when choosing a destructive action (explicit confirmation in the dashboard). */
    confirmDestructive: z.boolean().default(false),
    exemptRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).max(50).default([]),
    exemptUserIds: z.array(z.string().regex(/^\d{17,20}$/)).max(100).default([]),
    logChannelId: z.string().regex(/^\d{17,20}$/).nullable().default(null),
    warningEmbedId: z.string().max(40).nullable().default(null),
    deleteMessage: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (DESTRUCTIVE_ACTIONS.has(c.action) && !c.confirmDestructive)
      ctx.addIssue({ code: 'custom', path: ['confirmDestructive'], message: 'Confirm that you want members who post in the trap channel to be removed automatically.' });
  });


/** Destructive actions only take effect once an admin confirmed them; until then the trap only deletes and alerts. */
export function effectiveHoneypotAction(action: HoneypotAction, confirmedBy: string | null | undefined): HoneypotAction {
  return DESTRUCTIVE_ACTIONS.has(action) && !confirmedBy ? 'delete_alert' : action;
}

/** Copy for the default trap-channel warning card, matched to what actually happens. */
export function honeypotWarningCopy(action: HoneypotAction): { title: string; body: string; counterLabel: string } {
  const title = 'DO NOT SEND MESSAGES IN THIS CHANNEL';
  const lead = 'This channel is used to catch spam bots.';
  switch (action) {
    case 'kick':
      return { title, body: `${lead} Any messages sent here will result in **a kick**.`, counterLabel: 'Kicks' };
    case 'softban':
      return { title, body: `${lead} Any messages sent here will result in **a softban**.`, counterLabel: 'Softbans' };
    case 'ban':
      return { title, body: `${lead} Any messages sent here will result in **a ban**.`, counterLabel: 'Bans' };
    default:
      return { title, body: `${lead} Anything sent here is **deleted and reported to staff**.`, counterLabel: 'Caught' };
  }
}
