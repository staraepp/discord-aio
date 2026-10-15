import {
  ChannelType,
  PermissionFlagsBits,
  type BaseMessageOptions,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type InteractionReplyOptions,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
} from 'discord.js';
import type { RenderedMessage } from '@aio/discord-ui';
import type { Actor } from '@aio/permissions';

/** Convert the shared RenderedMessage JSON into discord.js options. */
export function toMessageOptions(m: RenderedMessage): BaseMessageOptions & MessageCreateOptions {
  return {
    content: m.content ?? undefined,
    embeds: m.embeds as never,
    components: m.components as never,
    allowedMentions: { parse: [], users: m.allowed_mentions.users, roles: m.allowed_mentions.roles },
  };
}

export function toEditOptions(m: RenderedMessage): MessageEditOptions {
  return {
    content: m.content ?? null,
    embeds: m.embeds as never,
    components: m.components as never,
    allowedMentions: { parse: [], users: m.allowed_mentions.users, roles: m.allowed_mentions.roles },
  };
}

export function toReply(m: RenderedMessage, ephemeral = true): InteractionReplyOptions {
  return { ...toMessageOptions(m), flags: ephemeral ? 64 : undefined } as InteractionReplyOptions;
}

/** Plain-text ephemeral reply that never pings. */
export function ephemeral(content: string): InteractionReplyOptions {
  return { content: content.slice(0, 2000), flags: 64, allowedMentions: { parse: [] } };
}

export function actorFromMember(member: GuildMember): Actor {
  return {
    userId: member.id,
    roleIds: [...member.roles.cache.keys()],
    permissions: member.permissions.bitfield,
    isGuildOwner: member.guild.ownerId === member.id,
  };
}

export function textChannel(guild: Guild, channelId: string | undefined | null): GuildTextBasedChannel | null {
  if (!channelId) return null;
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.isTextBased() || ch.isDMBased()) return null;
  return ch as GuildTextBasedChannel;
}

export function botCanSend(guild: Guild, channel: GuildTextBasedChannel): boolean {
  const me = guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages));
}

export async function sendRendered(guild: Guild, channelId: string | null | undefined, m: RenderedMessage): Promise<Message | null> {
  const ch = textChannel(guild, channelId);
  if (!ch || !botCanSend(guild, ch)) return null;
  return ch.send(toMessageOptions(m));
}

export function jumpUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function isVoiceLike(type: ChannelType): boolean {
  return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
}

export function highestRolePosition(member: GuildMember): number {
  return member.roles.highest?.position ?? 0;
}

/** Discord relative/absolute timestamp markup. */
export function ts(date: Date, style: 'R' | 'f' | 'F' | 't' | 'd' = 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}
