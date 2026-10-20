import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type APIEmbed,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type Webhook,
} from 'discord.js';
import { CooldownMap } from '@aio/core';
import type { SuggestionSettings } from '@aio/core/settings';
import type { BotContext } from '../../runtime/context.js';
import { BRAND } from '../../runtime/cards.js';
import { botCanSend, ephemeral, textChannel } from '../../runtime/discord.js';
import type { BotModule, SlashCommand } from '../../commands/types.js';

/**
 * `/suggest` and `+suggest`: the idea is posted in the suggestions channel under the member's
 * name and avatar (through a channel webhook) and the vote reactions are added below it.
 */

const MAX_LENGTH = 2000;
const WEBHOOK_NAME = 'Suggestions';

const cooldowns = new CooldownMap();
const webhooks = new Map<string, Webhook>();

export function suggestionEmbed(
  member: GuildMember,
  text: string,
  color: number,
  withAuthor: boolean,
): APIEmbed {
  return {
    ...(withAuthor
      ? { author: { name: member.displayName, icon_url: member.displayAvatarURL({ size: 128 }) } }
      : {}),
    description: text,
    color,
    footer: { text: `User ID: ${member.id}` },
  };
}

/** The bot's own webhook in the channel, created on first use. Null when the channel can't have one. */
async function channelWebhook(channel: GuildTextBasedChannel): Promise<Webhook | null> {
  const cached = webhooks.get(channel.id);
  if (cached) return cached;

  const me = channel.guild.members.me;
  const supportsWebhooks = !channel.isThread() && 'fetchWebhooks' in channel;
  const canManage = Boolean(me && channel.permissionsFor(me).has(PermissionFlagsBits.ManageWebhooks));
  if (!supportsWebhooks || !canManage || !me) return null;

  const existing = await channel.fetchWebhooks().catch(() => null);
  const own = existing?.find((w) => w.applicationId === me.id && w.token);
  const webhook =
    own ??
    (await channel
      .createWebhook({ name: WEBHOOK_NAME, reason: "Suggestions posted with the member's name" })
      .catch(() => null));
  if (webhook) webhooks.set(channel.id, webhook);
  return webhook;
}

async function postAsMember(
  channel: GuildTextBasedChannel,
  member: GuildMember,
  embed: APIEmbed,
): Promise<Message | null> {
  const webhook = await channelWebhook(channel);
  if (!webhook) return null;

  try {
    return await webhook.send({
      username: member.displayName.slice(0, 80),
      avatarURL: member.displayAvatarURL({ size: 128 }),
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch {
    // A deleted webhook, or a display name Discord refuses for webhooks: post as the bot instead.
    webhooks.delete(channel.id);
    return null;
  }
}

export async function postSuggestion(
  ctx: BotContext,
  channel: GuildTextBasedChannel,
  member: GuildMember,
  text: string,
  settings: SuggestionSettings,
): Promise<Message> {
  const color = await ctx.replyColor(BRAND);
  const viaWebhook = settings.postAsMember
    ? await postAsMember(channel, member, suggestionEmbed(member, text, color, false))
    : null;
  const message =
    viaWebhook ??
    (await channel.send({
      embeds: [suggestionEmbed(member, text, color, true)],
      allowedMentions: { parse: [] },
    }));

  for (const emoji of settings.reactions) await message.react(emoji).catch(() => undefined);

  return message;
}

const suggest: SlashCommand = {
  module: 'suggestions',
  deletePrefixTrigger: true,
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Share an idea for the server to vote on')
    .addStringOption((o) =>
      o.setName('suggestion').setDescription('Your idea').setRequired(true).setMaxLength(MAX_LENGTH),
    )
    .toJSON(),
  async execute(i, ctx) {
    const { settings } = await ctx.module('suggestions');
    const channel = textChannel(i.guild, settings.channelId);
    const isReady = Boolean(channel && botCanSend(i.guild, channel));
    if (!channel || !isReady)
      return i.reply(ephemeral("Suggestions aren't set up yet. Staff can pick a channel in the dashboard."));

    const waitMs = cooldowns.remainingMs(i.user.id);
    if (waitMs > 0)
      return i.reply(
        ephemeral(`You just sent a suggestion. You can send another in ${Math.ceil(waitMs / 1000)}s.`),
      );

    const text = i.options.getString('suggestion', true).trim();
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const posted = await postSuggestion(ctx, channel, i.member, text, settings);
    cooldowns.set(i.user.id, settings.cooldownSeconds * 1000);
    await ctx.audit({
      actorId: i.user.id,
      module: 'suggestions',
      action: 'suggestion.post',
      meta: { channelId: channel.id, messageId: posted.id, preview: text.slice(0, 200) },
    });

    return i.editReply({ content: `Thanks! Your suggestion is up in <#${channel.id}>.` });
  },
};

export const suggestionsModule: BotModule = { commands: [suggest] };
