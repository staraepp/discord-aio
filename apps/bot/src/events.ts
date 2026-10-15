import { Events, type Client, type Message } from 'discord.js';
import type { BotContext } from './runtime/context.js';
import { routeInteraction, routePrefixMessage } from './commands/registry.js';
import { handleStickyMessage } from './modules/messages/index.js';
import { handleAutoresponders } from './modules/autoresponders/index.js';
import { handleLevelingMessage } from './modules/leveling/index.js';
import { handleAutomod } from './modules/moderation/index.js';
import { handleTicketMessage } from './modules/tickets/index.js';
import { handleHoneypot } from './modules/honeypot/index.js';
import { handleAiMessage, handleAiMessageDelete, handleAiMessageUpdate, reclassifyAiChannels } from './modules/ai/index.js';
import { sendGreeting } from './modules/welcome/index.js';
import { onMemberJoinVerification } from './modules/verification/index.js';
import { handleRoleReaction } from './modules/rolepanels/index.js';
import { onTempVoiceState, deleteRoomIfEmpty } from './modules/tempvc/index.js';
import { forgetChannel } from '@aio/core/ai';
import { handleStarReaction, handleStarboardDelete } from './modules/starboard/index.js';

/** Wire Discord gateway events to modules. Each handler is isolated so one failure never blocks another. */
export function registerEvents(client: Client, ctx: BotContext): void {
  const guard =
    <A extends unknown[]>(source: string, fn: (...args: A) => Promise<unknown>) =>
    (...args: A) => {
      fn(...args).catch((err) => ctx.reportError(err, source));
    };

  client.on(Events.InteractionCreate, guard('interaction', (i) => routeInteraction(ctx, i)));

  client.on(
    Events.MessageCreate,
    guard('messageCreate', async (message: Message) => {
      if (!message.inGuild() || message.guildId !== ctx.guildId) return;
      // Trap first: a honeypot hit stops further processing of that message.
      if (await handleHoneypot(ctx, message).catch((err) => (ctx.reportError(err, 'honeypot'), false))) return;
      if (await handleAutomod(ctx, message).catch((err) => (ctx.reportError(err, 'automod'), false))) return;
      void handleStickyMessage(ctx, message).catch((err) => ctx.reportError(err, 'sticky'));
      // `+command` messages are commands, not chat: skip autoresponders, XP and the AI.
      if (await routePrefixMessage(ctx, message).catch((err) => (ctx.reportError(err, 'prefix'), false))) return;
      await Promise.allSettled([
        handleTicketMessage(ctx, message).catch((err) => ctx.reportError(err, 'tickets.message')),
        handleAutoresponders(ctx, message).catch((err) => ctx.reportError(err, 'autoresponders')),
        handleLevelingMessage(ctx, message).catch((err) => ctx.reportError(err, 'leveling')),
        handleAiMessage(ctx, message).catch((err) => ctx.reportError(err, 'ai.message')),
      ]);
    }),
  );

  client.on(Events.MessageUpdate, guard('messageUpdate', async (_old, message) => handleAiMessageUpdate(ctx, message)));
  client.on(
    Events.MessageDelete,
    guard('messageDelete', async (message) => {
      await handleStarboardDelete(ctx, [message.id]).catch((err) => ctx.reportError(err, 'starboard.delete'));
      await handleAiMessageDelete(ctx, [message.id]);
    }),
  );
  client.on(
    Events.MessageBulkDelete,
    guard('messageBulkDelete', async (messages) => {
      await handleStarboardDelete(ctx, [...messages.keys()]).catch((err) => ctx.reportError(err, 'starboard.delete'));
      await handleAiMessageDelete(ctx, [...messages.keys()]);
    }),
  );

  client.on(
    Events.GuildMemberAdd,
    guard('memberAdd', async (member) => {
      if (member.guild.id !== ctx.guildId) return;
      await onMemberJoinVerification(ctx, member);
      await sendGreeting(ctx, member, 'welcome');
    }),
  );
  client.on(
    Events.GuildMemberRemove,
    guard('memberRemove', async (member) => {
      if (member.guild.id !== ctx.guildId) return;
      await sendGreeting(ctx, member, 'goodbye');
    }),
  );

  client.on(
    Events.VoiceStateUpdate,
    guard('voiceState', async (oldState, newState) => {
      if (newState.guild.id !== ctx.guildId) return;
      await onTempVoiceState(ctx, oldState, newState);
      if (oldState.channelId && oldState.channelId !== newState.channelId) await ctx.music?.service.handleRoomMaybeEmpty(ctx.guildId, oldState.channelId);
    }),
  );

  client.on(
    Events.MessageReactionAdd,
    guard('reactionAdd', async (reaction, user) => {
      void handleStarReaction(ctx, reaction, reaction.message).catch((err) => ctx.reportError(err, 'starboard'));
      await handleRoleReaction(ctx, reaction, user, false);
    }),
  );
  client.on(
    Events.MessageReactionRemove,
    guard('reactionRemove', async (reaction, user) => {
      void handleStarReaction(ctx, reaction, reaction.message).catch((err) => ctx.reportError(err, 'starboard'));
      await handleRoleReaction(ctx, reaction, user, true);
    }),
  );
  client.on(Events.MessageReactionRemoveAll, guard('reactionRemoveAll', async (message) => handleStarReaction(ctx, null, message)));
  client.on(Events.MessageReactionRemoveEmoji, guard('reactionRemoveEmoji', async (reaction) => handleStarReaction(ctx, reaction, reaction.message)));

  client.on(
    Events.ChannelDelete,
    guard('channelDelete', async (channel) => {
      if (channel.isDMBased()) return;
      await forgetChannel(ctx.db, ctx.guildId, channel.id, null).catch(() => undefined);
      await deleteRoomIfEmpty(ctx, channel.id);
      await ctx.db.ticket.updateMany({ where: { channelId: channel.id, status: 'open' }, data: { status: 'closed', closedAt: new Date() } });
    }),
  );
  client.on(Events.ChannelUpdate, guard('channelUpdate', async () => reclassifyAiChannels(ctx)));
  client.on(Events.GuildRoleUpdate, guard('roleUpdate', async () => reclassifyAiChannels(ctx)));

}
