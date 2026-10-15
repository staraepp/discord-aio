import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { getEnv, integrationStatuses, looksLikeDiscordToken } from '@aio/config';
import { createDb, type Db } from '@aio/db';
import { createLogger } from '@aio/logging';
import { BotContext } from './runtime/context.js';
import { registerEvents } from './events.js';
import { syncCommands, validateCommandOwnership } from './commands/registry.js';
import { startDashboardCommandLoop, drainCommands } from './runtime/dashboardCommands.js';
import { startHealthServer } from './runtime/health.js';
import { auditPanels } from './runtime/panels.js';
import { MusicRuntime } from './modules/music/runtime.js';
import { sweepTempRooms, publishTempVcPanel } from './modules/tempvc/index.js';
import { tickTempbans } from './modules/moderation/index.js';
import { tickVoiceXp } from './modules/leveling/index.js';
import { reclassifyAiChannels, runLearningCycle } from './modules/ai/index.js';
import { publishVerificationPanel, applyVerificationSuccess } from './modules/verification/index.js';
import { publishTicketPanel } from './modules/tickets/index.js';
import { publishRolePanel } from './modules/rolepanels/index.js';
import { publishHoneypotWarning } from './modules/honeypot/index.js';
import { MAIN_STATUSES, startStatusRotation, statusLines } from './runtime/status.js';
import { tickScheduledMessages } from './modules/messages/index.js';
import { applyBotProfile } from './runtime/profile.js';
import { pruneEmbedDrafts } from '@aio/core/embeds';
import { tickGiveaways } from './modules/giveaways/index.js';
import { tickReminders } from './modules/reminders/index.js';

const env = getEnv();
const log = createLogger('bot', env.LOG_LEVEL);

function fail(message: string): never {
  log.fatal(message);
  process.exit(1);
}

// ── Startup configuration validation (names only, never values) ──
if (!env.DATABASE_URL) fail('DATABASE_URL is not set. See .env.example.');
if (!env.GUILD_ID) fail('GUILD_ID is not set. This bot serves exactly one configured server.');
if (!looksLikeDiscordToken(env.TOKEN)) fail('TOKEN is missing or is still the placeholder value. Put your real main bot token in .env (never commit it).');
const ownershipProblems = validateCommandOwnership();
if (ownershipProblems.length) fail(`Command/module mismatch: ${ownershipProblems.join('; ')}`);
for (const s of integrationStatuses(env)) log.info({ integration: s.id, state: s.state, detail: s.detail }, 'integration status');

const db: Db = createDb(env.DATABASE_URL);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: verification, welcome, role workflows
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: autoresponders, automod, AI context, ticket first response
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember, Partials.Channel],
});
const ctx = new BotContext(env, log, db, client, env.GUILD_ID);
registerEvents(client, ctx);
const health = startHealthServer(ctx, env.BOT_HEALTH_PORT);
const timers: ReturnType<typeof setInterval>[] = [];
let stopCommandLoop: (() => Promise<void>) | null = null;

function every(ms: number, source: string, fn: () => Promise<unknown>): void {
  const t = setInterval(() => void fn().catch((err) => ctx.reportError(err, source)), ms);
  t.unref();
  timers.push(t);
}

async function heartbeat(): Promise<void> {
  await db.botHeartbeat.upsert({
    where: { id: 'main' },
    create: { id: 'main', online: client.isReady(), botUserId: client.user?.id, botTag: client.user?.tag, latencyMs: client.ws.ping >= 0 ? Math.round(client.ws.ping) : null },
    update: {
      online: client.isReady(),
      botUserId: client.user?.id,
      botTag: client.user?.tag,
      latencyMs: client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
      details: {
        ...(((await db.botHeartbeat.findUnique({ where: { id: 'main' } }))?.details as object) ?? {}),
        guildAvailable: Boolean(ctx.guild()),
        music: ctx.music ? { configured: ctx.music.configured, backendConnected: ctx.music.playback?.isNodeConnected() ?? false, nodes: ctx.music.playback?.connectedNodeIds() ?? [], onlineSlots: ctx.music.playback?.onlineSlots() ?? [] } : null,
        uptimeSec: Math.round((Date.now() - ctx.startedAt.getTime()) / 1000),
      },
    },
  });
}

/** Re-create persistent panels whose messages were deleted while the bot was offline. */
async function repairPanels(): Promise<void> {
  const { missing } = await auditPanels(ctx);
  if (!missing) return;
  const panels = await db.persistentPanel.findMany({ where: { guildId: ctx.guildId, messageId: null } });
  for (const p of panels) {
    try {
      if (p.kind === 'verification') await publishVerificationPanel(ctx);
      else if (p.kind === 'tempvc') await publishTempVcPanel(ctx);
      else if (p.kind === 'ticket') await publishTicketPanel(ctx, p.refId, p.channelId);
      else if (p.kind === 'rolepanel') await publishRolePanel(ctx, p.refId, p.channelId);
      else if (p.kind === 'honeypot') await publishHoneypotWarning(ctx);
    } catch (err) {
      ctx.reportError(err, 'panels.repair', { kind: p.kind, refId: p.refId });
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  startStatusRotation(c, async () => {
    const { statuses } = await ctx.profile();
    return { lines: statusLines(MAIN_STATUSES, statuses.main, statuses.useBuiltIn), intervalMinutes: statuses.intervalMinutes };
  });
  log.info({ user: c.user.tag }, 'main bot connected');
  const guild = ctx.guild();
  if (!guild) {
    log.error('The bot is not in the configured GUILD_ID. Invite it with the URL from the README, then restart.');
    await heartbeat().catch(() => undefined);
    return;
  }
  await guild.members.fetch().catch((err) => log.warn({ err: err.name }, 'member fetch failed (is the Server Members intent enabled?)'));
  ctx.music = new MusicRuntime(ctx);
  await ctx.music.start().catch((err) => ctx.reportError(err, 'music.start'));
  await syncCommands(ctx).catch((err) => ctx.reportError(err, 'commands.sync'));
  stopCommandLoop = await startDashboardCommandLoop(ctx);
  await sweepTempRooms(ctx).catch((err) => ctx.reportError(err, 'tempvc.sweep'));
  await repairPanels().catch((err) => ctx.reportError(err, 'panels.repair'));
  await reclassifyAiChannels(ctx).catch((err) => ctx.reportError(err, 'ai.reclassify'));
  // Verifications that succeeded on the website while the bot was offline.
  for (const row of await db.verificationCooldown.findMany({ where: { guildId: ctx.guildId, pendingRoleSync: true } })) {
    await applyVerificationSuccess(ctx, row.userId).catch((err) => ctx.reportError(err, 'verification.pendingSync'));
  }
  await heartbeat().catch(() => undefined);

  every(30_000, 'heartbeat', heartbeat);
  every(30_000, 'tempvc.sweep', () => sweepTempRooms(ctx));
  every(60_000, 'moderation.tempbans', () => tickTempbans(ctx));
  every(60_000, 'leveling.voice', () => tickVoiceXp(ctx));
  every(6 * 60 * 60_000, 'ai.learning', () => runLearningCycle(ctx));
  every(60_000, 'dashboard.drain', () => drainCommands(ctx));
  every(24 * 60 * 60_000, 'embeds.drafts', () => pruneEmbedDrafts(db));
  every(30_000, 'messages.scheduled', () => tickScheduledMessages(ctx));
  every(15_000, 'giveaways.end', () => tickGiveaways(ctx));
  every(30_000, 'reminders.send', () => tickReminders(ctx));
  void applyBotProfile(ctx, {}).catch((err) => ctx.reportError(err, 'profile.apply'));
});

client.on(Events.Error, (err) => ctx.reportError(err, 'discord.client'));
client.on(Events.ShardDisconnect, () => log.warn('gateway disconnected'));

process.on('unhandledRejection', (reason) => {
  ctx.reportError(reason, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception, exiting so the supervisor can restart cleanly');
  void shutdown(1);
});

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down');
  timers.forEach(clearInterval);
  await stopCommandLoop?.().catch(() => undefined);
  await ctx.music?.stop().catch(() => undefined);
  await db.botHeartbeat.updateMany({ where: { id: 'main' }, data: { online: false } }).catch(() => undefined);
  health.close();
  await client.destroy();
  await db.$disconnect();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

client.login(env.TOKEN).catch((err: Error) => fail(`Discord login failed: ${err.message.includes('TOKEN_INVALID') || err.name === 'Error' ? 'the TOKEN was rejected by Discord' : err.name}`));
