import type { APIEmbed, InteractionReplyOptions } from 'discord.js';
import type { BotContext } from './context.js';

/**
 * One look for the bot's own replies: a slim embed in the dashboard's reply color, with a short
 * title, the message, and small print underneath. Errors and warnings get their own colors so
 * people can tell at a glance whether something worked.
 */
export type CardTone = 'info' | 'good' | 'warn' | 'bad';

export const BRAND = 0x5865f2;
const TONE_COLOR: Record<Exclude<CardTone, 'info'>, number> = { good: 0x4fcb8c, warn: 0xf0b44c, bad: 0xf47272 };

export interface CardInput {
  tone?: CardTone;
  /** Small line above the title, e.g. "Added to the queue". */
  eyebrow?: string;
  title?: string;
  url?: string | null;
  body?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: string | null;
  /** Small print, one `-#` line each. */
  notes?: string[];
  footer?: string;
}

export function buildCard(input: CardInput, color: number): APIEmbed {
  const notes = (input.notes ?? []).filter(Boolean).map((n) => `-# ${n}`);
  const description = [input.body, notes.length ? notes.join('\n') : undefined].filter(Boolean).join('\n\n');
  return {
    color: input.tone && input.tone !== 'info' ? TONE_COLOR[input.tone] : color,
    author: input.eyebrow ? { name: input.eyebrow } : undefined,
    title: input.title?.slice(0, 256),
    url: input.url ?? undefined,
    description: description ? description.slice(0, 4096) : undefined,
    fields: input.fields?.slice(0, 25).map((f) => ({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: f.inline })),
    thumbnail: input.thumbnail ? { url: input.thumbnail } : undefined,
    footer: input.footer ? { text: input.footer.slice(0, 2048) } : undefined,
  };
}

export async function card(ctx: BotContext, input: CardInput): Promise<APIEmbed> {
  return buildCard(input, await ctx.replyColor(BRAND));
}

/** A card as a reply. Private (only the user sees it) unless `visible` is set. */
export async function cardReply(ctx: BotContext, input: CardInput, visible = false): Promise<InteractionReplyOptions> {
  return { embeds: [await card(ctx, input)], flags: visible ? undefined : 64, allowedMentions: { parse: [] } };
}
