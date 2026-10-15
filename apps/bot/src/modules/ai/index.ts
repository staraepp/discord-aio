import { SlashCommandBuilder, type Message, type PartialMessage, type TextBasedChannel } from 'discord.js';
import { keyringFromEnv } from '@aio/core';
import {
  AiService,
  assertAiOutputChannel,
  checkAttachment,
  extractQuestion,
  fetchImage,
  forgetChannel,
  handleSourceEdited,
  indexMessage,
  invalidateMessages,
  MAX_IMAGES_PER_QUESTION,
  shouldIndex,
  shouldRespond,
  formatAiReply,
  type AskResult,
  type ImagePart,
  type IncomingMessage,
} from '@aio/core/ai';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, textChannel } from '../../runtime/discord.js';
import { createVisibilityPort, isPrivateChannel } from '../../runtime/visibility.js';
import type { BotModule } from '../../commands/types.js';

let service: AiService | null = null;

export function aiService(ctx: BotContext): AiService {
  if (!service) {
    let keyring: ReturnType<typeof keyringFromEnv> | null;
    try {
      keyring = keyringFromEnv(process.env);
    } catch {
      keyring = null; // AI_ENCRYPTION_KEY not configured: only the GOOGLE_API_KEY bootstrap (if any) can be used
    }
    service = new AiService(ctx.db, { GOOGLE_API_KEY: ctx.env.GOOGLE_API_KEY, AI_DEFAULT_MODEL: ctx.env.AI_DEFAULT_MODEL, AI_ESCALATION_MODEL: ctx.env.AI_ESCALATION_MODEL }, keyring);
  }
  return service;
}

function sourceChannelId(message: Message<true>): string {
  return message.channel.isThread() ? (message.channel.parentId ?? message.channelId) : message.channelId;
}

function toIncoming(message: Message<true>, configChannelId: string): IncomingMessage {
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: configChannelId,
    parentChannelId: message.channel.isThread() ? message.channel.parentId : null,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.username,
    authorIsBot: message.author.bot,
    isWebhook: Boolean(message.webhookId),
    content: message.content,
    createdAt: message.createdAt,
    jumpUrl: message.url,
    attachments: [...message.attachments.values()].map((a) => ({ url: a.url, filename: a.name, contentType: a.contentType, size: a.size })),
  };
}

async function answerInOutputChannel(ctx: BotContext, params: { requesterId: string; requesterName: string; question: string; images: ImagePart[]; replyTo?: Message<true>; sourceMessageId?: string }): Promise<{ ok: boolean; message: string }> {
  const mod = await ctx.module('ai');
  const guild = ctx.requireGuild();
  const outputId = mod.settings.outputChannelId;
  const out = textChannel(guild, outputId);
  if (!outputId || !out) return { ok: false, message: 'The AI channel is not configured.' };
  if (!guild.members.cache.has(params.requesterId)) await guild.members.fetch(params.requesterId).catch(() => undefined);
  const channelNames = (id: string) => guild.channels.cache.get(id)?.name ?? 'unknown';
  if ('sendTyping' in out) await out.sendTyping().catch(() => undefined);
  const r = await aiService(ctx).ask(
    { guildId: ctx.guildId, outputChannelId: outputId, requesterId: params.requesterId, requesterName: params.requesterName, question: params.question, images: params.images, visibility: createVisibilityPort(guild), channelName: channelNames, sourceMessageId: params.sourceMessageId },
    mod.settings,
  );
  const content = r.ok ? formatAiReply({ requesterId: params.requesterId, text: r.text, citations: r.citations, budgetWarning: r.budgetWarning }) : `<@${params.requesterId}> ${r.message}`;
  // Hard guard: AI output only ever goes to the one configured channel.
  assertAiOutputChannel(out.id, outputId);
  const options = { content, allowedMentions: { parse: [] as never[], users: [params.requesterId], repliedUser: false } };
  if (params.replyTo && params.replyTo.channelId === out.id) await params.replyTo.reply(options);
  else await out.send(options);
  return { ok: r.ok, message: r.ok ? 'Answered.' : r.message };
}

export async function handleAiMessage(ctx: BotContext, message: Message<true>): Promise<void> {
  const mod = await ctx.module('ai');
  if (!mod.enabled) return;
  // 1) Ingest only from allowlisted context channels.
  const cfgChannel = sourceChannelId(message);
  const cfg = await ctx.db.aIChannelConfig.findUnique({ where: { guildId_channelId: { guildId: ctx.guildId, channelId: cfgChannel } } });
  const incoming = toIncoming(message, cfgChannel);
  if (message.author.id !== ctx.client.user?.id && shouldIndex(incoming, cfg)) {
    await indexMessage(ctx.db, incoming, Boolean(cfg?.attachments)).catch((err) => ctx.reportError(err, 'ai.index'));
  }
  // 2) Respond only in the single output channel.
  const botId = ctx.client.user!.id;
  const decision = shouldRespond(
    { content: message.content, channelId: message.channelId, authorId: message.author.id, authorIsBot: message.author.bot, isWebhook: Boolean(message.webhookId), isSystem: message.system, mentionedUserIds: [...message.mentions.users.keys()], mentionedRoleIds: [...message.mentions.roles.keys()] },
    mod.settings.triggers,
    botId,
    mod.settings.outputChannelId,
  );
  if (!decision.respond) return;
  const question = extractQuestion(message.content, botId, mod.settings.triggers.roleIds) || 'help';
  const images: ImagePart[] = [];
  if (mod.settings.vision.enabled) {
    for (const a of [...message.attachments.values()].slice(0, MAX_IMAGES_PER_QUESTION)) {
      if (!checkAttachment({ url: a.url, contentType: a.contentType, size: a.size }, mod.settings.vision.maxBytes).ok) continue;
      const img = await fetchImage({ url: a.url, contentType: a.contentType, size: a.size }, mod.settings.vision.maxBytes).catch(() => null);
      if (img) images.push(img);
    }
  }
  await answerInOutputChannel(ctx, { requesterId: message.author.id, requesterName: message.member?.displayName ?? message.author.username, question, images, replyTo: message, sourceMessageId: message.id }).catch((err) => {
    const id = ctx.reportError(err, 'ai.answer');
    void message.reply({ content: `Sorry, something went wrong (${id}).`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => undefined);
  });
}

export async function handleAiMessageUpdate(ctx: BotContext, message: Message | PartialMessage): Promise<void> {
  if (!message.inGuild() || message.partial) return;
  const indexed = await ctx.db.aIIndexedMessage.findUnique({ where: { id: message.id }, select: { id: true } });
  if (indexed) await handleSourceEdited(ctx.db, message.id, message.content ?? '');
}

export async function handleAiMessageDelete(ctx: BotContext, ids: string[]): Promise<void> {
  await invalidateMessages(ctx.db, ids).catch((err) => ctx.reportError(err, 'ai.invalidate'));
}

/** React to permission changes: forget channels the bot lost, pause newly-private unconfirmed channels. */
export async function reclassifyAiChannels(ctx: BotContext): Promise<void> {
  const guild = ctx.guild();
  if (!guild) return;
  const configs = await ctx.db.aIChannelConfig.findMany({ where: { guildId: ctx.guildId } });
  for (const c of configs) {
    const ch = guild.channels.cache.get(c.channelId);
    const botCanView = ch && guild.members.me && ch.permissionsFor(guild.members.me)?.has('ViewChannel');
    if (!ch || !botCanView) {
      await forgetChannel(ctx.db, ctx.guildId, c.channelId, null);
      continue;
    }
    const priv = isPrivateChannel(guild, c.channelId);
    if (priv && !c.isPrivate) {
      // Became private without explicit confirmation: stop using it until an admin confirms.
      await ctx.db.aIChannelConfig.update({ where: { guildId_channelId: { guildId: ctx.guildId, channelId: c.channelId } }, data: { isPrivate: true, privateConfirmedAt: null, privateConfirmedBy: null } });
      await ctx.audit({ actorType: 'bot', module: 'ai', action: 'context.channel_became_private', targetId: c.channelId });
    } else if (!priv && c.isPrivate) {
      await ctx.db.aIChannelConfig.update({ where: { guildId_channelId: { guildId: ctx.guildId, channelId: c.channelId } }, data: { isPrivate: false } });
    }
    if (c.channelName !== ch.name) await ctx.db.aIChannelConfig.update({ where: { guildId_channelId: { guildId: ctx.guildId, channelId: c.channelId } }, data: { channelName: ch.name } });
  }
}

/** Backfill approved history for one channel (bounded by the channel's history depth). */
export async function backfillChannel(ctx: BotContext, channelId: string): Promise<{ indexed: number }> {
  const guild = ctx.requireGuild();
  const cfg = await ctx.db.aIChannelConfig.findUnique({ where: { guildId_channelId: { guildId: ctx.guildId, channelId } } });
  const ch = guild.channels.cache.get(channelId);
  if (!cfg || !ch || !ch.isTextBased()) throw new Error('Channel is not configured for AI context');
  let remaining = Math.min(cfg.historyDepth, 5000);
  let before: string | undefined;
  let indexed = 0;
  while (remaining > 0) {
    const batch = await (ch as TextBasedChannel).messages.fetch({ limit: Math.min(100, remaining), before });
    if (!batch.size) break;
    for (const m of batch.values()) {
      if (!m.inGuild()) continue;
      const inc = toIncoming(m, channelId);
      if (shouldIndex(inc, cfg)) {
        await indexMessage(ctx.db, inc, cfg.attachments);
        indexed++;
      }
    }
    remaining -= batch.size;
    before = batch.last()?.id;
  }
  await ctx.db.aIChannelConfig.update({ where: { guildId_channelId: { guildId: ctx.guildId, channelId } }, data: { lastBackfillAt: new Date() } });
  return { indexed };
}

export async function runLearningCycle(ctx: BotContext): Promise<void> {
  const mod = await ctx.module('ai');
  if (!mod.enabled) return;
  const channels = await ctx.db.aIChannelConfig.findMany({ where: { guildId: ctx.guildId, learnMemory: true, collect: true } });
  for (const c of channels) {
    await aiService(ctx).learnFromChannel(ctx.guildId, c.channelId, mod.settings).catch((err) => ctx.reportError(err, 'ai.learn'));
    await aiService(ctx).summarizeChannel(ctx.guildId, c.channelId, mod.settings).catch((err) => ctx.reportError(err, 'ai.summarize'));
  }
}

export async function aiTestQuery(ctx: BotContext, requesterId: string, question: string): Promise<AskResult> {
  const mod = await ctx.module('ai');
  const guild = ctx.requireGuild();
  const outputId = mod.settings.outputChannelId;
  if (!outputId) return { ok: false, reason: 'not_configured', message: 'Choose an AI output channel first.' };
  await guild.members.fetch(requesterId).catch(() => undefined);
  return aiService(ctx).ask({ guildId: ctx.guildId, outputChannelId: outputId, requesterId, requesterName: 'Dashboard test', question, images: [], visibility: createVisibilityPort(guild), channelName: (id) => guild.channels.cache.get(id)?.name ?? 'unknown' }, mod.settings);
}

export const aiModule: BotModule = {
  commands: [
    {
      module: 'ai',
      data: new SlashCommandBuilder()
        .setName('ai')
        .setDescription('Ask the AI helper (the answer is posted in the AI channel)')
        .addSubcommand((s) => s.setName('ask').setDescription('Ask a question').addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(1500)))
        .toJSON(),
      async execute(i, ctx) {
        const mod = await ctx.module('ai');
        if (!mod.settings.outputChannelId) return i.reply(ephemeral('The AI helper channel has not been set up yet.'));
        await i.deferReply({ flags: 64 });
        const r = await answerInOutputChannel(ctx, { requesterId: i.user.id, requesterName: i.member.displayName, question: i.options.getString('question', true), images: [] });
        // Never answer in the invoking channel: only point to the AI channel.
        return i.editReply(r.ok ? `Answered in <#${mod.settings.outputChannelId}>.` : `${r.message} (see <#${mod.settings.outputChannelId}>)`);
      },
    },
  ],
};

