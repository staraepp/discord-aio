import { PermissionFlagsBits, type Guild, type GuildBasedChannel } from 'discord.js';
import type { VisibilityPort } from '@aio/core/ai';

/**
 * Channel visibility checks for AI retrieval.
 * `audienceCanView(source, output)` is conservative: for every role (and member
 * overwrite) that can read the output channel, that role/member must also be
 * able to read the source channel. Anything uncertain is treated as NOT visible.
 */
export function createVisibilityPort(guild: Guild): VisibilityPort {
  const channel = (id: string): GuildBasedChannel | undefined => guild.channels.cache.get(id);
  const canView = (ch: GuildBasedChannel, target: Parameters<GuildBasedChannel['permissionsFor']>[0]) => Boolean(ch.permissionsFor(target)?.has(PermissionFlagsBits.ViewChannel));

  return {
    memberCanView(userId, channelId) {
      const ch = channel(channelId);
      const member = guild.members.cache.get(userId);
      return Boolean(ch && member && canView(ch, member));
    },
    audienceCanView(sourceId, outputId) {
      const source = channel(sourceId);
      const output = channel(outputId);
      if (!source || !output) return false;
      for (const role of guild.roles.cache.values()) {
        if (canView(output, role) && !canView(source, role)) return false;
      }
      if ('permissionOverwrites' in output) {
        for (const ow of output.permissionOverwrites.cache.values()) {
          if (ow.type !== 1 || !ow.allow.has(PermissionFlagsBits.ViewChannel)) continue;
          const member = guild.members.cache.get(ow.id);
          if (!member || !canView(source, member)) return false;
        }
      }
      return true;
    },
  };
}

/** Whether @everyone can view the channel (used to flag private channels). */
export function isPrivateChannel(guild: Guild, channelId: string): boolean {
  const ch = guild.channels.cache.get(channelId);
  return !ch || !ch.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
}
