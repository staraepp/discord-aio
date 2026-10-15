import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type InteractionUpdateOptions,
} from 'discord.js';
import { RateLimiter } from '@aio/core';
import {
  auditGateVisibility,
  isNewAccount,
  issueAttempt,
  issueChallenge,
  planRoleSwap,
  recordAttemptResult,
  resetMember,
  verifyBuiltinAnswer,
  type ChallengeKind,
  type IssuedChallenge,
} from '@aio/core/verification';
import { loadSavedEmbed } from '@aio/core/embeds';
import { renderMessageTemplate, type MessageTemplate } from '@aio/discord-ui';
import { checkRoleAssignable } from '@aio/permissions';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, textChannel, toMessageOptions, ts } from '../../runtime/discord.js';
import { upsertPanelMessage } from '../../runtime/panels.js';
import type { BotModule } from '../../commands/types.js';

const DEFAULT_PANEL: MessageTemplate = {
  content: undefined,
  embeds: [{ title: 'Verify to join {server.name}', description: 'Press **Verify** and type the code from the picture. It only takes a few seconds.', color: 0x2fb87a, timestamp: false, fields: [] }],
  components: [],
};

function verifyButtons() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('vf:start').setLabel('Verify').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vf:status').setLabel('Check my status').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function publishVerificationPanel(ctx: BotContext): Promise<string> {
  const guild = ctx.requireGuild();
  const { settings } = await ctx.module('verification');
  if (!settings.verificationChannelId) throw new Error('Choose a verification channel first.');
  const saved = settings.panelEmbedId ? await loadSavedEmbed(ctx.db, ctx.guildId, settings.panelEmbedId) : null;
  const template = saved?.template ?? settings.panelTemplate ?? DEFAULT_PANEL;
  const rendered = renderMessageTemplate({ ...template, components: [] }, { server: { id: guild.id, name: guild.name, memberCount: guild.memberCount } });
  return upsertPanelMessage(ctx, { kind: 'verification', refId: 'main', channelId: settings.verificationChannelId, options: { ...toMessageOptions(rendered), components: verifyButtons() } });
}

async function vlog(ctx: BotContext, kind: 'joins' | 'success' | 'failures' | 'cooldowns' | 'accountAge' | 'resets', content: string, pingRoleId?: string): Promise<void> {
  const { settings } = await ctx.module('verification');
  if (!settings.logFilters[kind]) return;
  const guild = ctx.guild();
  const ch = guild ? textChannel(guild, settings.logChannelId) : null;
  await ch?.send({ content: `${pingRoleId ? `<@&${pingRoleId}> ` : ''}${content}`, allowedMentions: { parse: [], roles: pingRoleId ? [pingRoleId] : [] } }).catch(() => undefined);
}

/** On join: assign Unverified; flag accounts younger than 3 days to staff (never blocks). */
export async function onMemberJoinVerification(ctx: BotContext, member: GuildMember): Promise<void> {
  const mod = await ctx.module('verification');
  if (!mod.enabled || member.user.bot) return;
  const s = mod.settings;
  if (s.unverifiedRoleId && !member.roles.cache.has(s.unverifiedRoleId)) await member.roles.add(s.unverifiedRoleId, 'Verification: new member').catch((err) => ctx.reportError(err, 'verification.assignUnverified'));
  await vlog(ctx, 'joins', `<@${member.id}> joined (account created ${ts(member.user.createdAt)}).`);
  if (isNewAccount(member.user.createdAt, new Date())) {
    await vlog(ctx, 'accountAge', `<@${member.id}>'s account is less than 3 days old (created ${ts(member.user.createdAt)}). They can still verify normally.`, s.staffAlertRoleId);
    await ctx.audit({ actorType: 'bot', module: 'verification', action: 'verification.new_account_alert', targetId: member.id });
  }
}

/** Idempotent role swap after a server-verified success (called from the dashboard command queue). */
export async function applyVerificationSuccess(ctx: BotContext, userId: string): Promise<{ ok: boolean }> {
  const guild = ctx.requireGuild();
  const { settings } = await ctx.module('verification');
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false };
  const plan = planRoleSwap({ memberRoleIds: [...member.roles.cache.keys()], verifiedRoleId: settings.verifiedRoleId, unverifiedRoleId: settings.unverifiedRoleId, direction: 'verify' });
  if (plan.add.length) await member.roles.add(plan.add, 'Verification passed');
  if (plan.remove.length) await member.roles.remove(plan.remove, 'Verification passed');
  await ctx.db.verificationCooldown.updateMany({ where: { guildId: ctx.guildId, userId }, data: { pendingRoleSync: false } });
  await vlog(ctx, 'success', `<@${userId}> verified.`);
  return { ok: true };
}

export async function logVerificationFailure(ctx: BotContext, userId: string, cooldownUntil?: Date): Promise<void> {
  if (cooldownUntil) await vlog(ctx, 'cooldowns', `<@${userId}> failed 3 checks. Verification is paused until ${ts(cooldownUntil, 'f')} (verification only, no timeout or kick).`);
  else await vlog(ctx, 'failures', `<@${userId}> failed a verification check.`);
}

/** Staff reset: Verified → Unverified, clear cooldown/tokens, reopen verification. */
export async function staffReset(ctx: BotContext, actorId: string, userId: string): Promise<string> {
  const guild = ctx.requireGuild();
  const { settings } = await ctx.module('verification');
  await resetMember(ctx.db, { guildId: ctx.guildId, userId, actorId });
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    const plan = planRoleSwap({ memberRoleIds: [...member.roles.cache.keys()], verifiedRoleId: settings.verifiedRoleId, unverifiedRoleId: settings.unverifiedRoleId, direction: 'reset' });
    if (plan.add.length) await member.roles.add(plan.add, `Verification reset by staff`);
    if (plan.remove.length) await member.roles.remove(plan.remove, `Verification reset by staff`);
  }
  await vlog(ctx, 'resets', `<@${actorId}> reset verification for <@${userId}>.`);
  return `Reset verification for <@${userId}>. They must verify again.`;
}

/** Checks that Unverified can only see the verification channel + allowlist, and that roles are manageable. */
export async function auditVerificationGate(ctx: BotContext): Promise<{ leaking: string[]; unreachable: string[]; roleProblems: string[] }> {
  const guild = ctx.requireGuild();
  const { settings } = await ctx.module('verification');
  const roleProblems: string[] = [];
  const me = guild.members.me!;
  for (const [label, id] of [['Unverified', settings.unverifiedRoleId], ['Verified', settings.verifiedRoleId]] as const) {
    const role = id ? guild.roles.cache.get(id) : undefined;
    if (!role) {
      roleProblems.push(`${label} role is not set or no longer exists.`);
      continue;
    }
    const check = checkRoleAssignable({ role: { id: role.id, position: role.position, managed: role.managed }, botHighestPosition: me.roles.highest.position, botPermissions: me.permissions.bitfield });
    if (!check.ok) roleProblems.push(`${label}: ${check.reason}`);
  }
  const unverified = settings.unverifiedRoleId ? guild.roles.cache.get(settings.unverifiedRoleId) : undefined;
  if (!unverified) return { leaking: [], unreachable: [], roleProblems };
  const channels = guild.channels.cache
    .filter((c) => c.type !== ChannelType.GuildCategory && !c.isThread())
    .map((c) => ({ channelId: c.id, name: c.name, unverifiedCanView: Boolean('permissionsFor' in c && c.permissionsFor(unverified)?.has(PermissionFlagsBits.ViewChannel)) }));
  const r = auditGateVisibility({ channels, verificationChannelId: settings.verificationChannelId, allowlist: settings.allowlistChannelIds });
  return { leaking: r.leaking.map((c) => `#${c.name}`), unreachable: r.unreachable.map((c) => `#${c.name}`), roleProblems };
}

// ── In-Discord CAPTCHA ──

/** New pictures cost a little CPU to draw; cap them per member. */
const challengeLimiter = new RateLimiter(20, 10 * 60_000);

function challengeView(attemptId: string, expiresAt: Date, c: IssuedChallenge, note?: string, color = 0x5865f2): InteractionUpdateOptions & { flags?: number } {
  const image = c.kind === 'image';
  const lines = [
    note ? `**${note}**\n` : '',
    image ? 'Type the letters and numbers in the picture. Capital or lowercase both work.' : `**${c.text}**`,
    image ? 'Press **Enter code** when you are ready.' : 'Press **Enter answer** and type the number. Digits or the word both work.',
    `-# This check expires ${ts(expiresAt)}.`,
  ].filter(Boolean);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vf:ans:${attemptId}:${c.kind}`).setLabel(image ? 'Enter code' : 'Enter answer').setStyle(ButtonStyle.Success),
    image
      ? new ButtonBuilder().setCustomId(`vf:img:${attemptId}`).setLabel('New picture').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId(`vf:img:${attemptId}`).setLabel('Use a picture instead').setStyle(ButtonStyle.Secondary),
    ...(image ? [new ButtonBuilder().setCustomId(`vf:math:${attemptId}`).setLabel("Can't read it? Text question").setStyle(ButtonStyle.Secondary)] : []),
  );
  return {
    content: '',
    embeds: [{ title: "Verify you're human", description: lines.join('\n'), color, ...(image ? { image: { url: 'attachment://captcha.png' } } : {}) }],
    files: image && c.png ? [new AttachmentBuilder(c.png, { name: 'captcha.png', description: 'Picture of a code to type' })] : [],
    attachments: [],
    components: [row],
  };
}

/** The attempt must belong to this member, this server, and still be open. */
async function ownAttempt(ctx: BotContext, attemptId: string, userId: string) {
  const attempt = await ctx.db.verificationAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.guildId !== ctx.guildId || attempt.userId !== userId) return null;
  if (attempt.result !== 'pending' || attempt.consumedAt || attempt.expiresAt <= new Date()) return null;
  return attempt;
}

const EXPIRED = { content: 'This check expired or was already used. Press **Verify** again to get a new one.', embeds: [], components: [], attachments: [] };

export const verificationModule: BotModule = {
  commands: [
    {
      module: 'verification',
      data: new SlashCommandBuilder()
        .setName('verification')
        .setDescription('Staff verification tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand((s) => s.setName('reset').setDescription('Make a member verify again').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
        .addSubcommand((s) => s.setName('check').setDescription('Check the Unverified channel gate'))
        .toJSON(),
      async execute(i, ctx) {
        if (!ctx.isAdmin(i.member) && !(await ctx.isStaff(i.member))) return i.reply(ephemeral('Only staff can use verification tools.'));
        if (i.options.getSubcommand() === 'check') {
          const r = await auditVerificationGate(ctx);
          const lines = [
            r.leaking.length ? `Heads up: Unverified can see channels outside the allowlist: ${r.leaking.join(', ')}` : 'Unverified only sees the allowed channels.',
            r.unreachable.length ? `Heads up: allowed but not visible to Unverified: ${r.unreachable.join(', ')}` : '',
            ...r.roleProblems.map((p) => `Heads up: ${p}`),
          ].filter(Boolean);
          return i.reply(ephemeral(lines.join('\n')));
        }
        const user = i.options.getUser('member', true);
        await i.deferReply({ flags: 64 });
        return i.editReply(await staffReset(ctx, i.user.id, user.id));
      },
    },
  ],
  components: [
    {
      prefix: 'vf',
      module: 'verification',
      async handle(i, ctx, [action, attemptId, kindArg]) {
        const { settings } = await ctx.module('verification');
        const secret = ctx.env.AUTH_SECRET;

        // Answer submitted from the pop-up.
        if (i.isModalSubmit() && action === 'sub' && attemptId) {
          if (!i.isFromMessage()) return;
          const attempt = await ownAttempt(ctx, attemptId, i.user.id);
          if (!attempt || !secret) return i.update(EXPIRED);
          const answer = i.fields.getTextInputValue('answer');
          const outcome = await recordAttemptResult(ctx.db, { attemptId, passed: verifyBuiltinAnswer(secret, attempt, answer) });
          switch (outcome.status) {
            case 'success':
              await i.update({ content: '', embeds: [{ title: "You're verified 🥹", description: 'Your roles are being added now. Welcome in!', color: 0x4fcb8c }], components: [], attachments: [] });
              await applyVerificationSuccess(ctx, i.user.id).catch((err) => ctx.reportError(err, 'verification.applySuccess'));
              return;
            case 'failed': {
              await logVerificationFailure(ctx, i.user.id);
              const kind: ChallengeKind = kindArg === 'math' ? 'math' : 'image';
              const next = await issueChallenge(ctx.db, secret, attemptId, kind);
              const tries = outcome.remainingInCycle;
              return i.update(challengeView(attemptId, attempt.expiresAt, next, `That wasn't right. ${tries} more ${tries === 1 ? 'try' : 'tries'} before a short pause.`, await ctx.replyColor(0x5865f2)));
            }
            case 'cooldown':
              await logVerificationFailure(ctx, i.user.id, outcome.until);
              return i.update({ content: `Too many wrong answers 😔 You can try again ${ts(outcome.until)}. This only pauses verification, you are not timed out or removed.`, embeds: [], components: [], attachments: [] });
            case 'invalid':
              return i.update(EXPIRED);
          }
        }
        if (!i.isButton()) return;

        // Buttons on the private challenge message.
        if ((action === 'ans' || action === 'img' || action === 'math') && attemptId) {
          const attempt = await ownAttempt(ctx, attemptId, i.user.id);
          if (!attempt || !secret) return i.update(EXPIRED);
          if (action === 'ans') {
            const kind: ChallengeKind = kindArg === 'math' ? 'math' : 'image';
            const input = new TextInputBuilder()
              .setCustomId('answer')
              .setLabel(kind === 'image' ? 'Code from the picture' : 'Your answer')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(20)
              .setPlaceholder(kind === 'image' ? 'e.g. 8ENQU3' : 'e.g. 7 or seven');
            return i.showModal(new ModalBuilder().setCustomId(`vf:sub:${attemptId}:${kind}`).setTitle('Verify').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
          }
          if (!challengeLimiter.consume(i.user.id).allowed) return i.reply(ephemeral("That's a lot of new pictures 😣 Give it a few minutes and try again."));
          const next = await issueChallenge(ctx.db, secret, attemptId, action === 'math' ? 'math' : 'image');
          return i.update(challengeView(attemptId, attempt.expiresAt, next, undefined, await ctx.replyColor(0x5865f2)));
        }

        const state = await ctx.db.verificationCooldown.findUnique({ where: { guildId_userId: { guildId: ctx.guildId, userId: i.user.id } } });
        const isVerified = settings.verifiedRoleId ? i.member.roles.cache.has(settings.verifiedRoleId) : Boolean(state?.verifiedAt);
        if (action === 'status') {
          if (isVerified) return i.reply(ephemeral('You are verified, welcome in 🥹'));
          if (state?.pendingRoleSync) return i.reply(ephemeral('You passed! Your roles are still being updated, so give it a few seconds and check again.'));
          if (state?.cooldownUntil && state.cooldownUntil > new Date()) return i.reply(ephemeral(`You can try verifying again ${ts(state.cooldownUntil)}. You can still use the other channels you can see.`));
          return i.reply(ephemeral('You are not verified yet. Press **Verify** to start.'));
        }
        if (isVerified) return i.reply(ephemeral('You are already verified.'));
        const issued = await issueAttempt(ctx.db, { guildId: ctx.guildId, userId: i.user.id, ttlMinutes: settings.tokenTtlMinutes });
        if (!issued.ok) {
          if (issued.reason === 'cooldown') return i.reply(ephemeral(`Too many failed attempts 😔 You can try again ${ts(issued.until)} (${ts(issued.until, 'f')}). This only pauses verification, you are not timed out.`));
          return i.reply(ephemeral('You started verification too many times. Please wait a few minutes.'));
        }

        // Turnstile runs in the browser, so it keeps the one-time link. Everything else happens right here in Discord.
        const turnstile = settings.captchaProvider === 'turnstile' && Boolean(ctx.env.TURNSTILE_SITE_KEY && ctx.env.TURNSTILE_SECRET_KEY);
        if (turnstile) {
          const url = `${ctx.env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/verify/${issued.token}`;
          return i.reply({
            content: `Here is your private, one-time verification link (expires ${ts(issued.attempt.expiresAt)}). Don't share it.\nAfter finishing, press **Check my status** if you don't get a DM.`,
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Open verification').setStyle(ButtonStyle.Link).setURL(url), new ButtonBuilder().setCustomId('vf:status').setLabel('Check my status').setStyle(ButtonStyle.Secondary))],
            flags: 64,
          });
        }
        if (!secret) {
          ctx.log.error('Verification: AUTH_SECRET is not set, so CAPTCHA answers cannot be checked.');
          return i.reply(ephemeral("Verification isn't fully set up yet 😣 Please let a staff member know."));
        }
        await i.deferReply({ flags: 64 });
        const challenge = await issueChallenge(ctx.db, secret, issued.attempt.id, settings.captchaProvider === 'builtin' ? 'math' : 'image');
        const view = challengeView(issued.attempt.id, issued.attempt.expiresAt, challenge, undefined, await ctx.replyColor(0x5865f2));
        return i.editReply({ content: view.content, embeds: view.embeds, files: view.files, components: view.components });
      },
    },
  ],
};
