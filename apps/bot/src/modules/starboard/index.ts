import { PermissionFlagsBits, type BaseMessageOptions, type GuildTextBasedChannel, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction } from 'discord.js';
import { emojiMatches, starboardAction } from '@aio/core/community';
import type { StarboardSettings } from '@aio/core/settings';
import type { BotContext } from '../../runtime/context.js';
import { BRAND } from '../../runtime/cards.js';
import { botCanSend, jumpUrl, textChannel } from '../../runtime/discord.js';

/**
 * A copy of the message is posted to the starboard channel once it has enough stars, updated as
 * stars change and removed when it drops below the threshold or the original is deleted.
 */

const IMAGE = /\.(png|jpe?g|gif|webp)(\?|$)/i;

/** Never lift a message out of a channel some starboard readers can't see (like a staff channel). */
export function sameAudience(source: GuildTextBasedChannel, board: GuildTextBasedChannel): boolean {
  return source.guild.roles.cache.every((role) => !board.permissionsFor(role).has(PermissionFlagsBits.ViewChannel) || source.permissionsFor(role).has(PermissionFlagsBits.ViewChannel));
}

function isNsfw(channel: GuildTextBasedChannel): boolean {
  if ('nsfw' in channel && channel.nsfw) return true;
  const parent = channel.isThread() ? channel.parent : null;
  return Boolean(parent && 'nsfw' in parent && parent.nsfw);
}

async function countStars(message: Message<true>, settings: StarboardSettings): Promise<number> {
  const reaction = message.reactions.cache.find((r) => emojiMatches(settings.emoji, { id: r.emoji.id, name: r.emoji.name }));
  if (!reaction) return 0;
  const users = await reaction.users.fetch({ limit: 100 });
  const excluded = users.filter((u) => u.bot || (!settings.allowSelfStar && u.id === message.author.id)).size;
  // Past 100 reactions we only look at the first page; the handful of skipped bots won't matter.
  return Math.max(0, reaction.count - excluded);
}

function starboardMessage(message: Message<true>, stars: number, settings: StarboardSettings, color: number): BaseMessageOptions {
  const image = message.attachments.find((a) => a.contentType?.startsWith('image/') || IMAGE.test(a.url))?.url ?? message.embeds.find((e) => e.image)?.image?.url;
  const emoji = /^\d+$/.test(settings.emoji) ? '⭐' : settings.emoji;
  return {
    content: `${emoji} **${stars}** · <#${message.channelId}>`,
    embeds: [
      {
        color,
        author: { name: message.member?.displayName ?? message.author.username, icon_url: message.author.displayAvatarURL({ size: 64 }) },
        description: (message.content || (image ? '' : '*No text*')).slice(0, 4096) || undefined,
        image: image ? { url: image } : undefined,
        timestamp: message.createdAt.toISOString(),
      },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Jump to message', url: jumpUrl(message.guildId, message.channelId, message.id) }] }],
    allowedMentions: { parse: [] },
  };
}

async function evaluate(ctx: BotContext, channelId: string, messageId: string): Promise<void> {
  const { enabled, settings } = await ctx.module('starboard');
  if (!enabled || !settings.channelId) return;
  const guild = ctx.requireGuild();
  const board = textChannel(guild, settings.channelId);
  const source = textChannel(guild, channelId);
  if (!board || !source || !botCanSend(guild, board)) return;
  const post = await ctx.db.starboardPost.findUnique({ where: { messageId } });

  const skip =
    source.id === board.id ||
    settings.ignoredChannelIds.includes(source.id) ||
    (source.isThread() && source.parentId !== null && settings.ignoredChannelIds.includes(source.parentId)) ||
    (isNsfw(source) && !settings.includeNsfw) ||
    !sameAudience(source, board);
  const message = skip ? null : await source.messages.fetch(messageId).catch(() => null);
  const stars = message && !message.author.bot && !message.system ? await countStars(message, settings) : 0;
  const action = starboardAction({ stars, threshold: settings.threshold, hasCopy: Boolean(post?.starboardMessageId) });

  if (action === 'none') return;
  if (action === 'delete') {
    await board.messages.delete(post!.starboardMessageId!).catch(() => undefined);
    await ctx.db.starboardPost.delete({ where: { messageId } }).catch(() => undefined);
    return;
  }
  const payload = starboardMessage(message!, stars, settings, await ctx.replyColor(BRAND));
  if (action === 'update') {
    const edited = await board.messages.edit(post!.starboardMessageId!, payload).catch(() => null);
    if (edited) {
      await ctx.db.starboardPost.update({ where: { messageId }, data: { stars } });
      return;
    }
    // Someone deleted the starboard copy: post it again.
  }
  const sent = await board.send(payload);
  await ctx.db.starboardPost.upsert({
    where: { messageId },
    create: { messageId, guildId: ctx.guildId, channelId, authorId: message!.author.id, starboardMessageId: sent.id, stars },
    update: { starboardMessageId: sent.id, stars },
  });
}

// Reactions arrive in bursts; look at each message once things settle, and never twice at the same time.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();
function schedule(ctx: BotContext, channelId: string, messageId: string): void {
  clearTimeout(pending.get(messageId));
  const t = setTimeout(() => {
    pending.delete(messageId);
    if (running.has(messageId)) return schedule(ctx, channelId, messageId);
    running.add(messageId);
    void evaluate(ctx, channelId, messageId)
      .catch((err) => ctx.reportError(err, 'starboard'))
      .finally(() => running.delete(messageId));
  }, 2_000);
  t.unref();
  pending.set(messageId, t);
}

export async function handleStarReaction(ctx: BotContext, reaction: MessageReaction | PartialMessageReaction | null, message: Message | PartialMessage): Promise<void> {
  if (!message.guildId || message.guildId !== ctx.guildId) return;
  const { enabled, settings } = await ctx.module('starboard');
  if (!enabled || !settings.channelId) return;
  // Removing every reaction (or all of one emoji) passes no single reaction: re-check the message.
  if (reaction && !emojiMatches(settings.emoji, { id: reaction.emoji.id, name: reaction.emoji.name })) return;
  schedule(ctx, message.channelId, message.id);
}

/** The original was deleted: remove its copy. A deleted copy just forgets the post. */
export async function handleStarboardDelete(ctx: BotContext, messageIds: string[]): Promise<void> {
  const posts = await ctx.db.starboardPost.findMany({ where: { guildId: ctx.guildId, OR: [{ messageId: { in: messageIds } }, { starboardMessageId: { in: messageIds } }] } });
  if (posts.length === 0) return;
  const { settings } = await ctx.module('starboard');
  const board = textChannel(ctx.requireGuild(), settings.channelId);
  for (const p of posts) {
    if (messageIds.includes(p.messageId) && p.starboardMessageId) await board?.messages.delete(p.starboardMessageId).catch(() => undefined);
  }
  await ctx.db.starboardPost.deleteMany({ where: { messageId: { in: posts.map((p) => p.messageId) } } });
}
