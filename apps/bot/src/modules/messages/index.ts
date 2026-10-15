import type { Message, MessageCreateOptions } from 'discord.js';
import { nextRunAt, scheduleSchema } from '@aio/core/customize';
import { renderTemplate } from '@aio/variables';
import type { BotContext } from '../../runtime/context.js';
import { botCanSend, textChannel, toMessageOptions } from '../../runtime/discord.js';
import { renderSavedEmbed, variableContext } from '../../runtime/actions.js';

/**
 * Dashboard-made messages: scheduled posts and sticky messages. Both are either a saved embed
 * or plain text with variables, and never ping anyone.
 */

/** A daily/weekly/one-time post more than this late (bot was offline) is skipped, not sent at a weird hour. */
const MAX_LATENESS_MS = 60 * 60_000;

async function buildMessage(ctx: BotContext, channelId: string, body: { embedId: string | null; content: string | null }): Promise<MessageCreateOptions | null> {
  const guild = ctx.requireGuild();
  const channel = textChannel(guild, channelId);
  const me = guild.members.me;
  if (!channel || !me) return null;
  const vars = variableContext(me, channel);
  if (body.embedId) {
    const rendered = await renderSavedEmbed(ctx, body.embedId, vars);
    if (!rendered) throw new Error('The saved embed was deleted. Pick another one in the dashboard.');
    return { ...toMessageOptions(rendered), allowedMentions: { parse: [] } };
  }
  return { content: renderTemplate(body.content ?? '', vars).text.slice(0, 2000), allowedMentions: { parse: [] } };
}

async function sendTo(ctx: BotContext, channelId: string, body: { embedId: string | null; content: string | null }): Promise<Message> {
  const guild = ctx.requireGuild();
  const channel = textChannel(guild, channelId);
  if (!channel) throw new Error('The channel no longer exists.');
  if (!botCanSend(guild, channel)) throw new Error(`The bot can't send messages in #${channel.name}.`);
  const options = await buildMessage(ctx, channelId, body);
  if (!options) throw new Error('The channel no longer exists.');
  return channel.send(options);
}

// ── Scheduled messages ──

/** Sends every due scheduled message once and books its next run. Safe to run concurrently. */
export async function tickScheduledMessages(ctx: BotContext, now = new Date()): Promise<void> {
  const due = await ctx.db.scheduledMessage.findMany({ where: { guildId: ctx.guildId, enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 20 });
  for (const s of due) {
    const schedule = scheduleSchema.safeParse(s.schedule);
    const next = schedule.success ? nextRunAt(schedule.data, s.timezone, now, s.nextRunAt ?? now) : null;
    // Claim the run first so two ticks (or a restart) never double-post.
    const claimed = await ctx.db.scheduledMessage.updateMany({
      where: { id: s.id, nextRunAt: s.nextRunAt },
      data: { nextRunAt: next, enabled: next ? s.enabled : false, lastRunAt: now },
    });
    if (claimed.count === 0) continue;
    const late = now.getTime() - (s.nextRunAt?.getTime() ?? now.getTime());
    if (schedule.success && schedule.data.kind !== 'interval' && late > MAX_LATENESS_MS) {
      await ctx.db.scheduledMessage.update({ where: { id: s.id }, data: { lastError: `Skipped the ${s.nextRunAt?.toISOString()} run because the bot was offline.` } });
      continue;
    }
    try {
      await sendTo(ctx, s.channelId, s);
      await ctx.db.scheduledMessage.update({ where: { id: s.id }, data: { lastError: null, runCount: { increment: 1 } } });
    } catch (err) {
      await ctx.db.scheduledMessage.update({ where: { id: s.id }, data: { lastError: (err as Error).message.slice(0, 300) } });
      ctx.log.warn({ id: s.id, err: (err as Error).message }, 'scheduled message failed');
    }
  }
}

/** "Send now" from the dashboard; doesn't change the schedule. */
export async function sendScheduledNow(ctx: BotContext, id: string): Promise<{ messageId: string }> {
  const s = await ctx.db.scheduledMessage.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!s) throw new Error('Scheduled message not found');
  const msg = await sendTo(ctx, s.channelId, s);
  await ctx.db.scheduledMessage.update({ where: { id }, data: { lastError: null, runCount: { increment: 1 } } });
  return { messageId: msg.id };
}

// ── Sticky messages ──

interface StickyRow {
  id: string;
  channelId: string;
  embedId: string | null;
  content: string | null;
  enabled: boolean;
  delaySeconds: number;
  lastMessageId: string | null;
}

let stickyCache: { at: number; byChannel: Map<string, StickyRow> } | null = null;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const reposting = new Set<string>();

async function stickies(ctx: BotContext): Promise<Map<string, StickyRow>> {
  if (stickyCache && Date.now() - stickyCache.at < 15_000) return stickyCache.byChannel;
  const rows = await ctx.db.stickyMessage.findMany({ where: { guildId: ctx.guildId, enabled: true } });
  stickyCache = { at: Date.now(), byChannel: new Map(rows.map((r) => [r.channelId, r])) };
  return stickyCache.byChannel;
}

export function invalidateStickies(): void {
  stickyCache = null;
}

/** Deletes the previous sticky copy and posts a fresh one at the bottom. */
export async function repostSticky(ctx: BotContext, channelId: string): Promise<string | null> {
  if (reposting.has(channelId)) return null;
  reposting.add(channelId);
  try {
    const row = await ctx.db.stickyMessage.findUnique({ where: { channelId } });
    const channel = textChannel(ctx.requireGuild(), channelId);
    if (row?.lastMessageId && channel) await channel.messages.delete(row.lastMessageId).catch(() => undefined);
    if (!row?.enabled) return null;
    const msg = await sendTo(ctx, channelId, row);
    await ctx.db.stickyMessage.update({ where: { id: row.id }, data: { lastMessageId: msg.id } });
    invalidateStickies();
    return msg.id;
  } finally {
    reposting.delete(channelId);
  }
}

/** Removes the posted copy when a sticky is deleted or turned off. */
export async function removeStickyCopy(ctx: BotContext, channelId: string, messageId: string | null): Promise<void> {
  const channel = textChannel(ctx.requireGuild(), channelId);
  if (channel && messageId) await channel.messages.delete(messageId).catch(() => undefined);
  invalidateStickies();
}

/** New message in a sticky channel: re-post once things go quiet for `delaySeconds`. */
export async function handleStickyMessage(ctx: BotContext, message: Message<true>): Promise<void> {
  if (message.author.id === ctx.client.user?.id) return;
  const sticky = (await stickies(ctx)).get(message.channelId);
  if (!sticky) return;
  clearTimeout(pending.get(sticky.channelId));
  const t = setTimeout(() => {
    pending.delete(sticky.channelId);
    void repostSticky(ctx, sticky.channelId).catch((err) => ctx.reportError(err, 'sticky.repost'));
  }, sticky.delaySeconds * 1000);
  t.unref();
  pending.set(sticky.channelId, t);
}
