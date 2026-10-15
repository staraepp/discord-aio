import { claimNextCommand, completeCommand, requeueStale } from '@aio/core';
import { DASHBOARD_COMMAND_CHANNEL, listen } from '@aio/db';
import type { BotContext } from './context.js';
import { syncCommands } from '../commands/registry.js';
import { publishTempVcPanel } from '../modules/tempvc/index.js';
import { publishTicketPanel, createTranscript } from '../modules/tickets/index.js';
import { publishVerificationPanel, applyVerificationSuccess, staffReset, logVerificationFailure, auditVerificationGate } from '../modules/verification/index.js';
import { publishRolePanel } from '../modules/rolepanels/index.js';
import { publishHoneypotWarning } from '../modules/honeypot/index.js';
import { aiTestQuery, backfillChannel, reclassifyAiChannels, runLearningCycle } from '../modules/ai/index.js';
import { invalidateAutoresponders } from '../modules/autoresponders/index.js';
import { invalidateStickies, removeStickyCopy, repostSticky, sendScheduledNow } from '../modules/messages/index.js';
import { applyBotProfile } from './profile.js';
import { endGiveaway, rerollGiveaway, startGiveaway } from '../modules/giveaways/index.js';
import { giveawayInputSchema } from '@aio/core/community';
import { directMessageInputSchema } from '@aio/core/customize';
import { sendDirectMessage } from '../modules/dm/index.js';
import { deletePanelMessage } from './panels.js';
import { renderSavedEmbed } from './actions.js';
import { sendRendered } from './discord.js';
import type { TextChannel } from 'discord.js';

type Payload = Record<string, unknown>;

/** Executes dashboard intents inside the bot (the only process that mutates Discord). */
async function execute(ctx: BotContext, type: string, p: Payload, createdBy: string | null): Promise<unknown> {
  ctx.invalidateSettings();
  switch (type) {
    case 'settings.changed':
      invalidateAutoresponders();
      invalidateStickies();
      return { ok: true };
    case 'profile.apply':
      return applyBotProfile(ctx, { avatar: p.avatar as string | null | undefined, banner: p.banner as string | null | undefined, bio: p.bio as string | null | undefined });
    case 'schedule.send_now':
      return sendScheduledNow(ctx, String(p.id));
    case 'sticky.post':
      invalidateStickies();
      return { messageId: await repostSticky(ctx, String(p.channelId)) };
    case 'sticky.remove':
      await removeStickyCopy(ctx, String(p.channelId), (p.messageId as string | null) ?? null);
      return { ok: true };
    case 'giveaway.start': {
      if (!createdBy) throw new Error('Giveaways need a host');
      const g = await startGiveaway(ctx, giveawayInputSchema.parse(p), createdBy);
      return { id: g.id, messageId: g.messageId };
    }
    case 'giveaway.end': {
      const winners = await endGiveaway(ctx, String(p.id), createdBy);
      if (!winners) throw new Error('That giveaway already ended.');
      return { winners };
    }
    case 'giveaway.reroll':
      return { winners: await rerollGiveaway(ctx, String(p.id), Math.min(20, Math.max(1, Number(p.count) || 1)), createdBy) };
    case 'dm.send':
      if (!createdBy) throw new Error('DMs need a sender');
      // Picked up long after it was asked for (the bot was offline): the sender already gave up on it.
      if (Date.now() - Number(p.requestedAt ?? 0) > 60_000) throw new Error('This DM waited too long while the bot was offline, so it was not sent.');
      return sendDirectMessage(ctx, directMessageInputSchema.parse(p), createdBy);
    case 'commands.sync':
      return syncCommands(ctx);
    case 'panel.publish': {
      const kind = p.kind as string;
      if (kind === 'tempvc') return { messageId: await publishTempVcPanel(ctx) };
      if (kind === 'verification') return { messageId: await publishVerificationPanel(ctx) };
      if (kind === 'ticket') return { messageId: await publishTicketPanel(ctx, String(p.refId), String(p.channelId)) };
      if (kind === 'rolepanel') return { messageId: await publishRolePanel(ctx, String(p.refId), String(p.channelId)) };
      if (kind === 'honeypot') return { messageId: await publishHoneypotWarning(ctx) };
      throw new Error(`Unknown panel kind ${kind}`);
    }
    case 'panel.delete':
      await deletePanelMessage(ctx, p.kind as never, String(p.refId));
      return { ok: true };
    case 'embed.send': {
      const guild = ctx.requireGuild();
      const rendered = await renderSavedEmbed(ctx, String(p.embedId), { server: { id: guild.id, name: guild.name, memberCount: guild.memberCount } });
      if (!rendered) throw new Error('Saved embed not found');
      const msg = await sendRendered(guild, String(p.channelId), rendered);
      if (!msg) throw new Error('The bot cannot send messages in that channel');
      await ctx.audit({ actorId: createdBy, module: 'embeds', action: 'embed.send', targetId: String(p.embedId), meta: { channelId: p.channelId } });
      return { messageId: msg.id };
    }
    case 'music.action': {
      if (!ctx.music) throw new Error('Music is not running');
      return ctx.music.service.dashboardAction(String(p.sessionId), String(p.action), p.arg);
    }
    case 'verification.sync_roles':
      return applyVerificationSuccess(ctx, String(p.userId));
    case 'verification.failed':
      await logVerificationFailure(ctx, String(p.userId), p.cooldownUntil ? new Date(String(p.cooldownUntil)) : undefined);
      return { ok: true };
    case 'verification.reset':
      return { message: await staffReset(ctx, createdBy ?? 'dashboard', String(p.userId)) };
    case 'verification.audit':
      return auditVerificationGate(ctx);
    case 'ai.reindex_channel':
      return backfillChannel(ctx, String(p.channelId));
    case 'ai.reclassify':
      await reclassifyAiChannels(ctx);
      return { ok: true };
    case 'ai.learn_now':
      await runLearningCycle(ctx);
      return { ok: true };
    case 'ai.test_query':
      return aiTestQuery(ctx, createdBy ?? '', String(p.question ?? ''));
    case 'ticket.transcript': {
      const ticket = await ctx.db.ticket.findUnique({ where: { id: String(p.ticketId) } });
      const ch = ticket ? (ctx.requireGuild().channels.cache.get(ticket.channelId) as TextChannel | undefined) : undefined;
      if (!ticket || !ch) throw new Error('Ticket channel not found');
      return createTranscript(ctx, ticket, ch, createdBy ?? 'dashboard');
    }
    default:
      throw new Error(`Unknown dashboard command ${type}`);
  }
}

export async function drainCommands(ctx: BotContext): Promise<void> {
  for (let n = 0; n < 50; n++) {
    const cmd = await claimNextCommand(ctx.db);
    if (!cmd) return;
    try {
      const result = await execute(ctx, cmd.type, (cmd.payload ?? {}) as Payload, cmd.createdBy);
      await completeCommand(ctx.db, cmd.id, true, result ?? null);
    } catch (err) {
      const id = ctx.reportError(err, `dashboard.${cmd.type}`);
      await completeCommand(ctx.db, cmd.id, false, null, `${err instanceof Error ? err.message : 'Failed'} (${id})`);
    }
  }
}

/** LISTEN for instant wake-ups, plus a polling fallback. */
export async function startDashboardCommandLoop(ctx: BotContext): Promise<() => Promise<void>> {
  let running = false;
  const kick = () => {
    if (running) return;
    running = true;
    void drainCommands(ctx).finally(() => (running = false));
  };
  await requeueStale(ctx.db).catch(() => undefined);
  let stop: () => Promise<void> = async () => undefined;
  if (ctx.env.DATABASE_URL) {
    stop = await listen(ctx.env.DATABASE_URL, DASHBOARD_COMMAND_CHANNEL, kick, (err) => ctx.log.warn({ err }, 'dashboard LISTEN error')).catch((err) => {
      ctx.log.warn({ err }, 'LISTEN unavailable, polling only');
      return async () => undefined;
    });
  }
  const timer = setInterval(kick, 5_000);
  timer.unref();
  kick();
  return async () => {
    clearInterval(timer);
    await stop();
  };
}
