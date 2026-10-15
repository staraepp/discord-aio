import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, type Message, type MessageCreateOptions } from 'discord.js';
import { effectiveHoneypotAction, honeypotWarningCopy, isExempt, shouldTrigger, type HoneypotAction } from '@aio/core/honeypot';
import { createCase } from '@aio/core/moderation';
import type { BotContext } from '../../runtime/context.js';
import { textChannel, toMessageOptions } from '../../runtime/discord.js';
import { renderSavedEmbed } from '../../runtime/actions.js';
import { upsertPanelMessage } from '../../runtime/panels.js';

const HONEY = 0xf2a93b;
// Microsoft Fluent UI Emoji "Honey pot" 3D (MIT), see apps/bot/assets/README.txt. The bot runs from apps/bot.
const HONEYPOT_IMAGE = resolve(process.cwd(), 'assets/honeypot.png');

/** Default trap-channel card: big warning, what happens, a live catch counter and the honey pot art. */
export function honeypotWarningMessage(action: HoneypotAction, caught: number): MessageCreateOptions {
  const copy = honeypotWarningCopy(action);
  const text = new TextDisplayBuilder().setContent(`## ${copy.title}\n${copy.body}`);
  const hasArt = existsSync(HONEYPOT_IMAGE);
  const container = new ContainerBuilder().setAccentColor(HONEY);
  if (hasArt) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://honeypot.png').setDescription('A honey pot')));
  else container.addTextDisplayComponents(text);
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      // Display only: a disabled button is the badge-style counter.
      new ButtonBuilder().setCustomId('hp:count').setStyle(ButtonStyle.Secondary).setEmoji('🍯').setLabel(`${copy.counterLabel}: ${caught.toLocaleString('en-US')}`).setDisabled(true),
    ),
  );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: hasArt ? [new AttachmentBuilder(HONEYPOT_IMAGE, { name: 'honeypot.png' })] : [],
    allowedMentions: { parse: [] },
  };
}

/** Posts (or updates) the warning message in the trap channel. */
export async function publishHoneypotWarning(ctx: BotContext): Promise<string> {
  const cfg = await ctx.db.honeypotConfig.findUnique({ where: { guildId: ctx.guildId } });
  if (!cfg?.channelId) throw new Error('Choose a honeypot channel first.');
  const guild = ctx.requireGuild();
  const saved = cfg.warningEmbedId ? await renderSavedEmbed(ctx, cfg.warningEmbedId, { server: { id: guild.id, name: guild.name } }) : null;
  let options: MessageCreateOptions;
  if (saved) options = toMessageOptions(saved);
  else {
    const caught = await ctx.db.moderationCase.count({ where: { guildId: ctx.guildId, type: 'honeypot' } });
    options = honeypotWarningMessage(effectiveHoneypotAction(cfg.action, cfg.actionConfirmedBy), caught);
  }
  return upsertPanelMessage(ctx, { kind: 'honeypot', refId: 'main', channelId: cfg.channelId, options });
}

// Coalesce counter refreshes so a spam wave edits the card once, not once per message.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCounterRefresh(ctx: BotContext): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void (async () => {
      const panel = await ctx.db.persistentPanel.findUnique({ where: { kind_refId: { kind: 'honeypot', refId: 'main' } } });
      if (panel?.messageId) await publishHoneypotWarning(ctx);
    })().catch((err) => ctx.reportError(err, 'honeypot.counter'));
  }, 5_000);
}

/**
 * Opt-in trap channel. Because the admin deliberately enabled this module and
 * chose the action, automatic action is allowed here (unlike normal moderation).
 */
export async function handleHoneypot(ctx: BotContext, message: Message<true>): Promise<boolean> {
  if (!(await ctx.module('honeypot')).enabled) return false;
  const cfg = await ctx.db.honeypotConfig.findUnique({ where: { guildId: ctx.guildId } });
  if (!cfg?.channelId || message.channelId !== cfg.channelId || !message.member) return false;
  // Never act on our own warning message or other bots.
  const exempt = isExempt({ userId: message.author.id, roleIds: [...message.member.roles.cache.keys()], isBot: message.author.bot || Boolean(message.webhookId), isAdmin: ctx.isAdmin(message.member) || (await ctx.isStaff(message.member)), exemptRoleIds: cfg.exemptRoleIds, exemptUserIds: cfg.exemptUserIds });
  if (!shouldTrigger({ enabled: true, trapChannelId: cfg.channelId, messageChannelId: message.channelId, exempt })) return false;

  const member = message.member;
  const guild = message.guild;
  // Destructive actions run only when an admin explicitly confirmed them in the dashboard.
  const action = effectiveHoneypotAction(cfg.action, cfg.actionConfirmedBy);
  if (cfg.deleteMessage || action !== 'delete_alert') await message.delete().catch(() => undefined);
  let outcome = 'message removed';
  try {
    const me = guild.members.me!;
    const canAct = member.roles.highest.position < me.roles.highest.position && guild.ownerId !== member.id;
    if (action !== 'delete_alert' && !canAct) outcome = `could not ${action} (role hierarchy)`;
    else if (action === 'kick') {
      await member.kick('Honeypot: posted in trap channel');
      outcome = 'kicked';
    } else if (action === 'softban') {
      await guild.bans.create(member.id, { reason: 'Honeypot: posted in trap channel (softban)', deleteMessageSeconds: 86400 });
      await guild.bans.remove(member.id, 'Honeypot softban: immediate unban');
      outcome = 'softbanned (messages from the last day removed)';
    } else if (action === 'ban') {
      await guild.bans.create(member.id, { reason: 'Honeypot: posted in trap channel', deleteMessageSeconds: 86400 });
      outcome = 'banned';
    }
  } catch (err) {
    outcome = `action failed (${ctx.reportError(err, 'honeypot.action')})`;
  }
  const c = await createCase(ctx.db, { guildId: ctx.guildId, type: 'honeypot', targetId: member.id, moderatorId: guild.members.me!.id, reason: `Honeypot trap (${action}): ${outcome}`, channelId: message.channelId });
  await textChannel(guild, cfg.logChannelId)
    ?.send({ content: `Honeypot: <@${member.id}> (\`${member.id}\`) posted in <#${cfg.channelId}>. Result: ${outcome}. Case #${c.caseNumber}.\n> ${message.content.slice(0, 300).replace(/\n/g, ' ')}`, allowedMentions: { parse: [] } })
    .catch(() => undefined);
  scheduleCounterRefresh(ctx);
  return true;
}
