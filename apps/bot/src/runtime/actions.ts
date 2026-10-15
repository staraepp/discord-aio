import { PermissionFlagsBits, type GuildMember, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { ActionExecutor } from '@aio/core';
import { loadSavedEmbed, savedEmbedCustomId } from '@aio/core/embeds';
import { checkRoleAssignable } from '@aio/permissions';
import { renderMessageTemplate, type RenderedMessage } from '@aio/discord-ui';
import type { VariableContext } from '@aio/variables';
import type { BotContext } from './context.js';
import { botCanSend, textChannel, toMessageOptions } from './discord.js';

export function variableContext(member: GuildMember, channel?: GuildTextBasedChannel | null, message?: Message | null): VariableContext {
  const g = member.guild;
  return {
    user: { id: member.id, name: member.user.username, displayName: member.displayName, avatarUrl: member.displayAvatarURL({ size: 256 }) },
    server: { id: g.id, name: g.name, memberCount: g.memberCount, iconUrl: g.iconURL({ size: 256 }) ?? undefined },
    channel: channel ? { id: channel.id, name: channel.name } : undefined,
    message: message ? { content: message.content, link: message.url } : undefined,
  };
}

export async function renderSavedEmbed(ctx: BotContext, embedIdOrName: string, vctx: VariableContext): Promise<RenderedMessage | null> {
  const saved = await loadSavedEmbed(ctx.db, ctx.guildId, embedIdOrName);
  if (!saved) return null;
  return renderMessageTemplate(saved.template, vctx, { customIdFor: (c) => savedEmbedCustomId(saved.id, c.key) });
}

/** Action engine executor bound to a member/channel (autoresponders, saved-embed buttons). */
export function createActionExecutor(ctx: BotContext, p: { member: GuildMember; channel: GuildTextBasedChannel | null; trigger?: Message | null; logChannelId?: string }): ActionExecutor {
  const guild = p.member.guild;
  const vctx = variableContext(p.member, p.channel, p.trigger);
  return {
    userId: p.member.id,
    memberHasRole: (roleId) => p.member.roles.cache.has(roleId),
    async checkRole(roleId) {
      const role = guild.roles.cache.get(roleId);
      const me = guild.members.me;
      if (!role || !me) return { ok: false, reason: 'Role not found' };
      return checkRoleAssignable({ role: { id: role.id, position: role.position, managed: role.managed }, botHighestPosition: me.roles.highest.position, botPermissions: me.permissions.bitfield, isEveryoneRole: role.id === guild.id });
    },
    addRole: async (roleId, reason) => void (await p.member.roles.add(roleId, reason)),
    removeRole: async (roleId, reason) => void (await p.member.roles.remove(roleId, reason)),
    async send(message, channelId) {
      const ch = channelId ? textChannel(guild, channelId) : p.channel;
      if (!ch || !botCanSend(guild, ch)) return undefined;
      return (await ch.send(toMessageOptions(message))).id;
    },
    async sendSavedEmbed(embedId, channelId) {
      const rendered = await renderSavedEmbed(ctx, embedId, vctx);
      if (!rendered) return undefined;
      const ch = channelId ? textChannel(guild, channelId) : p.channel;
      if (!ch || !botCanSend(guild, ch)) return undefined;
      return (await ch.send(toMessageOptions(rendered))).id;
    },
    async dm(message) {
      try {
        await p.member.send(toMessageOptions(message));
        return true;
      } catch {
        return false;
      }
    },
    async deleteTrigger() {
      if (p.trigger?.deletable) await p.trigger.delete();
    },
    deleteMessageLater(messageId, seconds) {
      const ch = p.channel;
      setTimeout(() => void ch?.messages.delete(messageId).catch(() => undefined), seconds * 1000).unref();
    },
    async react(emoji) {
      await p.trigger?.react(emoji);
    },
    async log(text, channelId) {
      const ch = textChannel(guild, channelId ?? p.logChannelId);
      if (ch && botCanSend(guild, ch)) await ch.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
      await ctx.audit({ actorId: p.member.id, actorType: 'bot', module: 'actions', action: 'log', meta: { text: text.slice(0, 500) } });
    },
    canSendTo(channelId) {
      const ch = textChannel(guild, channelId);
      return Boolean(ch && botCanSend(guild, ch) && ch.permissionsFor(p.member)?.has(PermissionFlagsBits.ViewChannel) !== undefined);
    },
  };
}
