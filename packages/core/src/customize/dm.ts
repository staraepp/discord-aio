import { z } from 'zod';
import type { RenderedRow } from '@aio/discord-ui';

/**
 * Staff DMs sent through the main bot. The recipient must be a member of the server: Discord only
 * lets bots DM people they share a server with, and it keeps this from reaching strangers.
 */

export const directMessageInputSchema = z
  .object({
    userId: z.string().regex(/^\d{17,20}$/, 'Choose a member'),
    embedId: z.string().max(40).nullable().default(null),
    content: z.string().max(2000).nullable().default(null),
  })
  .refine((v) => Boolean(v.embedId) !== Boolean(v.content?.trim()), { message: 'Choose a saved embed or write a message (one of the two).', path: ['content'] });
export type DirectMessageInput = z.infer<typeof directMessageInputSchema>;

/** Each staff member can send this many DMs per window, so a slip can't spam the whole server. */
export const DM_LIMIT = { count: 10, windowMs: 60_000 } as const;

/** A friendly reason for a failed DM, from Discord's error code. */
export function dmFailureMessage(code: unknown): string {
  if (code === 50007) return "That member doesn't accept DMs from this server (their DMs are closed, or they blocked the bot).";
  if (code === 10013 || code === 10007) return "That member isn't in the server anymore.";
  if (code === 50006) return "That message is empty. Write something or pick an embed that has content.";
  return 'Discord refused the DM. Try again in a moment.';
}

/**
 * Buttons and menus that run bot actions only work inside the server, so a DM keeps just the
 * link buttons (they open a URL and need no bot).
 */
export function linkButtonsOnly(rows: RenderedRow[]): RenderedRow[] {
  return rows
    .map((r) => ({ ...r, components: r.components.filter((c) => c.type === 2 && c.style === 5) }))
    .filter((r) => r.components.length > 0);
}
