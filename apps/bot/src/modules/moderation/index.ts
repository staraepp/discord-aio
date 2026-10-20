import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message,
  type TextChannel,
  type SlashCommandStringOption,
} from 'discord.js';
import type { ModerationCase } from '@aio/db';
import { AutomodTracker, CASE_LABEL, MAX_TIMEOUT_MS, createCase, deleteCase, dueTempbans, editCase, parseDuration, validateReason, warnMember } from '@aio/core/moderation';
import { checkCanModerate } from '@aio/permissions';
import { COLORS, formatDuration } from '@aio/discord-ui';
import type { BotContext } from '../../runtime/context.js';
import { botCanSend, ephemeral, highestRolePosition, textChannel, ts } from '../../runtime/discord.js';
import { isPrefixInvocation } from '../../runtime/prefix.js';
import type { BotModule, SlashCommand } from '../../commands/types.js';

const tracker = new AutomodTracker();

async function requireStaff(i: ChatInputCommandInteraction<'cached'>, ctx: BotContext): Promise<boolean> {
  if (ctx.isAdmin(i.member) || (await ctx.isStaff(i.member))) return true;
  await i.reply(ephemeral('Only staff can use moderation commands.'));
  return false;
}

function hierarchy(i: ChatInputCommandInteraction<'cached'>, target: GuildMember) {
  const me = i.guild.members.me!;
  return checkCanModerate({
    actorId: i.user.id,
    targetId: target.id,
    actorHighestPosition: highestRolePosition(i.member),
    targetHighestPosition: highestRolePosition(target),
    botHighestPosition: highestRolePosition(me),
    actorIsOwner: i.guild.ownerId === i.user.id,
    targetIsOwner: i.guild.ownerId === target.id,
    botId: me.id,
  });
}

async function modLog(ctx: BotContext, c: ModerationCase): Promise<void> {
  const { settings } = await ctx.module('moderation');
  const guild = ctx.guild();
  const ch = guild ? textChannel(guild, settings.modLogChannelId) : null;
  if (!ch) return;
  await ch
    .send({
      embeds: [
        {
          color: ['ban', 'tempban', 'softban', 'kick'].includes(c.type) ? COLORS.danger : c.type === 'warn' ? COLORS.warning : COLORS.info,
          title: `Case #${c.caseNumber} · ${CASE_LABEL[c.type]}`,
          description: [
            c.targetId ? `**Member:** <@${c.targetId}> (\`${c.targetId}\`)` : null,
            `**Moderator:** <@${c.moderatorId}>`,
            c.reason ? `**Reason:** ${c.reason}` : null,
            c.durationMs ? `**Duration:** ${formatDuration(c.durationMs)}` : null,
            c.evidence ? `**Evidence:** ${c.evidence}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: c.createdAt.toISOString(),
        },
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
}

async function dmTarget(ctx: BotContext, target: GuildMember | { send: GuildMember['send'] }, action: string, reason: string | null, guildName: string): Promise<boolean> {
  const { settings } = await ctx.module('moderation');
  if (!settings.dmOnAction) return false;
  try {
    await target.send({ content: `You received a **${action}** in **${guildName}**.${reason ? `\nReason: ${reason}` : ''}`, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

async function record(ctx: BotContext, input: Parameters<typeof createCase>[1]): Promise<ModerationCase> {
  const c = await createCase(ctx.db, input);
  await modLog(ctx, c);
  return c;
}

const reasonOpt = (required: boolean) => (o: SlashCommandStringOption) => o.setName('reason').setDescription(required ? 'Reason (required)' : 'Reason').setRequired(required).setMaxLength(1000);
const evidenceOpt = (o: SlashCommandStringOption) => o.setName('evidence').setDescription('Evidence or message link').setMaxLength(500);

type Handler = (i: ChatInputCommandInteraction<'cached'>, ctx: BotContext) => Promise<unknown>;
function cmd(data: { toJSON(): SlashCommand['data'] }, handler: Handler): SlashCommand {
  return {
    module: 'moderation',
    data: data.toJSON(),
    async execute(i, ctx) {
      if (!(await requireStaff(i, ctx))) return;
      return handler(i, ctx);
    },
  };
}

async function targetMember(i: ChatInputCommandInteraction<'cached'>, name = 'member'): Promise<GuildMember | null> {
  const m = i.options.getMember(name);
  if (!m) await i.reply(ephemeral('That user is not in the server.'));
  return m;
}

const warn = cmd(
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (reason required)').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(reasonOpt(true)).addStringOption(evidenceOpt),
  async (i, ctx) => {
    const target = await targetMember(i);
    if (!target) return;
    const h = hierarchy(i, target);
    if (!h.ok) return i.reply(ephemeral(h.reason));
    const reason = i.options.getString('reason', true);
    const check = validateReason('warn', reason);
    if (!check.ok) return i.reply(ephemeral(check.message));
    const { case: c, warningCount: count } = await warnMember(ctx.db, { guildId: ctx.guildId, targetId: target.id, moderatorId: i.user.id, reason, evidence: i.options.getString('evidence') });
    await modLog(ctx, c);
    const dmed = await dmTarget(ctx, target, 'warning', reason, i.guild.name);
    // Informational only: no automatic escalation happens at any count.
    return i.reply(ephemeral(`Warned <@${target.id}> (case #${c.caseNumber}). They now have **${count}** warning${count === 1 ? '' : 's'}.${dmed ? '' : ' (Could not DM them.)'}`));
  },
);

const warnings = cmd(
  new SlashCommandBuilder().setName('warnings').setDescription('List a member’s warnings').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  async (i, ctx) => {
    const user = i.options.getUser('member', true);
    const rows = await ctx.db.moderationCase.findMany({ where: { guildId: ctx.guildId, targetId: user.id, type: 'warn', deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 25 });
    if (!rows.length) return i.reply(ephemeral(`<@${user.id}> has no warnings.`));
    return i.reply(ephemeral(`**${rows.length} warning(s) for <@${user.id}>**\n${rows.map((c) => `#${c.caseNumber} ${ts(c.createdAt)} by <@${c.moderatorId}>: ${c.reason}`).join('\n')}`));
  },
);

const modhistory = cmd(
  new SlashCommandBuilder().setName('modhistory').setDescription('Full moderation history for a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  async (i, ctx) => {
    const user = i.options.getUser('member', true);
    const [cases, notes] = await Promise.all([
      ctx.db.moderationCase.findMany({ where: { guildId: ctx.guildId, targetId: user.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
      ctx.db.moderationNote.findMany({ where: { guildId: ctx.guildId, targetId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    const lines = cases.map((c) => `#${c.caseNumber} **${CASE_LABEL[c.type]}** ${ts(c.createdAt)} by <@${c.moderatorId}>${c.reason ? `: ${c.reason}` : ''}`);
    const noteLines = notes.map((n) => `Note ${ts(n.createdAt)} <@${n.authorId}>: ${n.content}`);
    return i.reply(ephemeral([`**History for <@${user.id}>**`, ...(lines.length ? lines : ['No cases.']), ...(noteLines.length ? ['', '**Staff notes**', ...noteLines] : [])].join('\n')));
  },
);

const caseCmd = cmd(
  new SlashCommandBuilder()
    .setName('case')
    .setDescription('View or change a moderation case')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName('view').setDescription('View a case').addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('edit').setDescription('Edit reason/evidence').addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)).addStringOption(reasonOpt(false)).addStringOption(evidenceOpt))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a case (kept in the audit log)').addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))),
  async (i, ctx) => {
    const n = i.options.getInteger('number', true);
    const sub = i.options.getSubcommand();
    if (sub === 'view') {
      const c = await ctx.db.moderationCase.findUnique({ where: { guildId_caseNumber: { guildId: ctx.guildId, caseNumber: n } }, include: { edits: { orderBy: { createdAt: 'asc' } } } });
      if (!c || c.deletedAt) return i.reply(ephemeral('Case not found.'));
      const edits = c.edits.map((e) => `-# ${ts(e.createdAt)} <@${e.editorId}> changed ${e.field}`);
      return i.reply(ephemeral([`**Case #${c.caseNumber} · ${CASE_LABEL[c.type]}**`, c.targetId ? `Member: <@${c.targetId}>` : '', `Moderator: <@${c.moderatorId}>`, `When: ${ts(c.createdAt, 'f')}`, c.reason ? `Reason: ${c.reason}` : '', c.durationMs ? `Duration: ${formatDuration(c.durationMs)}` : '', c.evidence ? `Evidence: ${c.evidence}` : '', ...edits].filter(Boolean).join('\n')));
    }
    if (sub === 'edit') {
      const reason = i.options.getString('reason') ?? undefined;
      const evidence = i.options.getString('evidence') ?? undefined;
      if (reason === undefined && evidence === undefined) return i.reply(ephemeral('Provide a new reason or evidence.'));
      try {
        const c = await editCase(ctx.db, { guildId: ctx.guildId, caseNumber: n, editorId: i.user.id, reason, evidence });
        return i.reply(ephemeral(c ? `Updated case #${n}.` : 'Case not found.'));
      } catch (err) {
        return i.reply(ephemeral((err as Error).message));
      }
    }
    return i.reply(ephemeral((await deleteCase(ctx.db, { guildId: ctx.guildId, caseNumber: n, actorId: i.user.id })) ? `Deleted case #${n}.` : 'Case not found.'));
  },
);

const note = cmd(
  new SlashCommandBuilder().setName('note').setDescription('Add a private staff note about a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('text').setDescription('Note').setRequired(true).setMaxLength(1000)),
  async (i, ctx) => {
    const user = i.options.getUser('member', true);
    await ctx.db.moderationNote.create({ data: { guildId: ctx.guildId, targetId: user.id, authorId: i.user.id, content: i.options.getString('text', true) } });
    await ctx.audit({ actorId: i.user.id, module: 'moderation', action: 'note.add', targetId: user.id }); // note text is never written to the audit log
    return i.reply(ephemeral(`Noted for <@${user.id}>.`));
  },
);

const timeout = cmd(
  new SlashCommandBuilder().setName('timeout').setDescription('Time out a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true).setMaxLength(20)).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const target = await targetMember(i);
    if (!target) return;
    const h = hierarchy(i, target);
    if (!h.ok) return i.reply(ephemeral(h.reason));
    const ms = parseDuration(i.options.getString('duration', true));
    if (!ms || ms > MAX_TIMEOUT_MS) return i.reply(ephemeral('Use a duration like 10m, 2h or 3d (max 28 days).'));
    const reason = i.options.getString('reason');
    await target.timeout(ms, reason ?? undefined);
    const c = await record(ctx, { guildId: ctx.guildId, type: 'timeout', targetId: target.id, moderatorId: i.user.id, reason, durationMs: ms });
    return i.reply(ephemeral(`Timed out <@${target.id}> for ${formatDuration(ms)} (case #${c.caseNumber}).`));
  },
);

const untimeout = cmd(
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const target = await targetMember(i);
    if (!target) return;
    const reason = i.options.getString('reason');
    await target.timeout(null, reason ?? undefined);
    const c = await record(ctx, { guildId: ctx.guildId, type: 'untimeout', targetId: target.id, moderatorId: i.user.id, reason });
    return i.reply(ephemeral(`Removed the timeout for <@${target.id}> (case #${c.caseNumber}).`));
  },
);

function removalCommand(type: 'kick' | 'softban', description: string, perm: bigint) {
  return cmd(
    new SlashCommandBuilder().setName(type).setDescription(description).setDefaultMemberPermissions(perm).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(reasonOpt(true)).addStringOption(evidenceOpt),
    async (i, ctx) => {
      const target = await targetMember(i);
      if (!target) return;
      const h = hierarchy(i, target);
      if (!h.ok) return i.reply(ephemeral(h.reason));
      const reason = i.options.getString('reason', true);
      const check = validateReason(type, reason);
      if (!check.ok) return i.reply(ephemeral(check.message));
      const dmed = await dmTarget(ctx, target, type === 'kick' ? 'kick' : 'kick (softban)', reason, i.guild.name);
      if (type === 'kick') await target.kick(reason);
      else {
        await i.guild.bans.create(target.id, { reason: `Softban: ${reason}`, deleteMessageSeconds: 7 * 86400 });
        await i.guild.bans.remove(target.id, 'Softban: immediate unban');
      }
      const c = await record(ctx, { guildId: ctx.guildId, type, targetId: target.id, moderatorId: i.user.id, reason, evidence: i.options.getString('evidence') });
      return i.reply(ephemeral(`${type === 'kick' ? 'Kicked' : 'Softbanned'} <@${target.id}> (case #${c.caseNumber}).${dmed ? '' : ' (Could not DM them.)'}`));
    },
  );
}

const voicekick = cmd(
  new SlashCommandBuilder().setName('voicekick').setDescription('Disconnect a member from voice').setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers).addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const target = await targetMember(i);
    if (!target) return;
    if (!target.voice.channelId) return i.reply(ephemeral('That member is not in a voice channel.'));
    const h = hierarchy(i, target);
    if (!h.ok) return i.reply(ephemeral(h.reason));
    const reason = i.options.getString('reason');
    await target.voice.disconnect(reason ?? undefined);
    const c = await record(ctx, { guildId: ctx.guildId, type: 'voicekick', targetId: target.id, moderatorId: i.user.id, reason });
    return i.reply(ephemeral(`Disconnected <@${target.id}> from voice (case #${c.caseNumber}).`));
  },
);

async function banFlow(i: ChatInputCommandInteraction<'cached'>, ctx: BotContext, type: 'ban' | 'tempban', durationMs?: number) {
  const user = i.options.getUser('user', true);
  const member = i.options.getMember('user');
  if (member) {
    const h = hierarchy(i, member);
    if (!h.ok) return i.reply(ephemeral(h.reason));
  }
  const reason = i.options.getString('reason', true);
  const check = validateReason(type, reason);
  if (!check.ok) return i.reply(ephemeral(check.message));
  const dmed = member ? await dmTarget(ctx, member, type === 'ban' ? 'ban' : `temporary ban (${formatDuration(durationMs!)})`, reason, i.guild.name) : false;
  await i.guild.bans.create(user.id, { reason, deleteMessageSeconds: (i.options.getInteger('delete_days') ?? 0) * 86400 });
  const c = await record(ctx, { guildId: ctx.guildId, type, targetId: user.id, moderatorId: i.user.id, reason, durationMs: durationMs ?? null, evidence: i.options.getString('evidence') });
  return i.reply(ephemeral(`${type === 'ban' ? 'Banned' : `Banned for ${formatDuration(durationMs!)}`} <@${user.id}> (case #${c.caseNumber}).${member && !dmed ? ' (Could not DM them.)' : ''}`));
}

const ban = cmd(
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user (reason required)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(reasonOpt(true))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days').setMinValue(0).setMaxValue(7))
    .addStringOption(evidenceOpt),
  (i, ctx) => banFlow(i, ctx, 'ban'),
);

const tempban = cmd(
  new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a user (reason required)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 1d, 7d, 2w').setRequired(true).setMaxLength(20))
    .addStringOption(reasonOpt(true))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days').setMinValue(0).setMaxValue(7))
    .addStringOption(evidenceOpt),
  async (i, ctx) => {
    const ms = parseDuration(i.options.getString('duration', true));
    if (!ms) return i.reply(ephemeral('Use a duration like 1d, 7d or 2w.'));
    return banFlow(i, ctx, 'tempban', ms);
  },
);

const unban = cmd(
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true).setMaxLength(20)).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const id = i.options.getString('user_id', true).trim();
    if (!/^\d{17,20}$/.test(id)) return i.reply(ephemeral('That is not a valid user ID.'));
    const reason = i.options.getString('reason');
    const ok = await i.guild.bans.remove(id, reason ?? undefined).then(() => true).catch(() => false);
    if (!ok) return i.reply(ephemeral('That user is not banned (or I lack permission).'));
    await ctx.db.moderationCase.updateMany({ where: { guildId: ctx.guildId, targetId: id, type: { in: ['ban', 'tempban'] }, active: true }, data: { active: false } });
    const c = await record(ctx, { guildId: ctx.guildId, type: 'unban', targetId: id, moderatorId: i.user.id, reason });
    return i.reply(ephemeral(`Unbanned <@${id}> (case #${c.caseNumber}).`));
  },
);

const purge = cmd(
  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete recent messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption((o) => o.setName('amount').setDescription('1–100').setRequired(true).setMinValue(1).setMaxValue(100)).addUserOption((o) => o.setName('user').setDescription('Only messages from this user')).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const ch = i.channel;
    if (!ch || !('bulkDelete' in ch)) return i.reply(ephemeral('Use this in a text channel.'));
    await i.deferReply({ flags: 64 });
    const amount = i.options.getInteger('amount', true);
    const user = i.options.getUser('user');
    const fetched = await ch.messages.fetch({ limit: 100 });
    const targets = [...fetched.values()].filter((m) => !user || m.author.id === user.id).slice(0, amount);
    const deleted = await ch.bulkDelete(targets, true);
    const c = await record(ctx, { guildId: ctx.guildId, type: 'purge', targetId: user?.id ?? null, moderatorId: i.user.id, reason: i.options.getString('reason'), channelId: ch.id });
    return i.editReply(`Deleted ${deleted.size} message(s) (case #${c.caseNumber}). Messages older than 14 days can't be bulk-deleted.`);
  },
);

const slowmode = cmd(
  new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode for a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addIntegerOption((o) => o.setName('seconds').setDescription('0 to disable, max 21600').setRequired(true).setMinValue(0).setMaxValue(21600)).addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)),
  async (i, ctx) => {
    const ch = (i.options.getChannel('channel') ?? i.channel) as TextChannel;
    if (!ch || !('setRateLimitPerUser' in ch)) return i.reply(ephemeral('Choose a text channel.'));
    const s = i.options.getInteger('seconds', true);
    await ch.setRateLimitPerUser(s);
    await record(ctx, { guildId: ctx.guildId, type: 'slowmode', moderatorId: i.user.id, channelId: ch.id, durationMs: s * 1000 });
    return i.reply(ephemeral(s ? `Slowmode in <#${ch.id}> set to ${s}s.` : `Slowmode disabled in <#${ch.id}>.`));
  },
);

const echo: SlashCommand = {
  ...cmd(
    new SlashCommandBuilder().setName('echo').setDescription('Make the bot post a message in this channel').addStringOption((o) => o.setName('message').setDescription('What the bot should say').setRequired(true).setMaxLength(2000)),
    async (i, ctx) => {
      const fromPrefix = isPrefixInvocation(i);
      const channel = i.channel;
      if (!channel || !botCanSend(i.guild, channel)) return fromPrefix ? undefined : i.reply(ephemeral("I can't send messages in this channel."));

      const message = i.options.getString('message', true);
      // Neither form leaves a trace besides the bot's copy: the prefix runner deletes the `+echo`
      // message, and the slash acknowledgement is removed once the message is out.
      if (!fromPrefix) await i.deferReply({ flags: MessageFlags.Ephemeral });
      const sent = await channel.send({ content: message, allowedMentions: { parse: [] } });
      await ctx.audit({ actorId: i.user.id, module: 'moderation', action: 'echo.send', meta: { channelId: channel.id, messageId: sent.id, preview: message.slice(0, 200) } });

      if (!fromPrefix) await i.deleteReply().catch(() => undefined);
    },
  ),
  deletePrefixTrigger: true,
};

async function setLocked(ch: TextChannel, locked: boolean, reason: string | null): Promise<void> {
  await ch.permissionOverwrites.edit(ch.guild.id, { SendMessages: locked ? false : null, SendMessagesInThreads: locked ? false : null, AddReactions: locked ? false : null }, { reason: reason ?? undefined });
}

const lock = cmd(
  new SlashCommandBuilder().setName('lock').setDescription('Stop @everyone from sending messages in a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const ch = (i.options.getChannel('channel') ?? i.channel) as TextChannel;
    const reason = i.options.getString('reason');
    await setLocked(ch, true, reason);
    await record(ctx, { guildId: ctx.guildId, type: 'lock', moderatorId: i.user.id, channelId: ch.id, reason });
    return i.reply(ephemeral(`Locked <#${ch.id}>.`));
  },
);

const unlock = cmd(
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock a channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)).addStringOption(reasonOpt(false)),
  async (i, ctx) => {
    const ch = (i.options.getChannel('channel') ?? i.channel) as TextChannel;
    const reason = i.options.getString('reason');
    await setLocked(ch, false, reason);
    await record(ctx, { guildId: ctx.guildId, type: 'unlock', moderatorId: i.user.id, channelId: ch.id, reason });
    return i.reply(ephemeral(`Unlocked <#${ch.id}>.`));
  },
);

const lockdown = cmd(
  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock every public text channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('start').setDescription('Lock all public text channels').addStringOption(reasonOpt(false)))
    .addSubcommand((s) => s.setName('end').setDescription('Undo the last lockdown')),
  async (i, _ctx) => {
    const start = i.options.getSubcommand() === 'start';
    const reason = (i.options.getString('reason') ?? '').slice(0, 60);
    return i.reply({
      content: start ? 'Lock every text channel where @everyone can currently talk? This is logged as a case.' : 'Unlock the channels locked by the last lockdown?',
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`mod:lockdown:${start ? 'start' : 'end'}:${encodeURIComponent(reason)}`).setLabel(start ? 'Yes, lock down' : 'Yes, unlock').setStyle(start ? ButtonStyle.Danger : ButtonStyle.Success))],
      flags: 64,
    });
  },
);

async function runLockdown(ctx: BotContext, actorId: string, start: boolean, reason: string | null): Promise<string> {
  const guild = ctx.requireGuild();
  if (start) {
    const channels = guild.channels.cache.filter((c): c is TextChannel => c.type === ChannelType.GuildText && Boolean(c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.SendMessages)));
    for (const ch of channels.values()) await setLocked(ch, true, reason).catch(() => undefined);
    const c = await createCase(ctx.db, { guildId: ctx.guildId, type: 'lockdown', moderatorId: actorId, reason, evidence: JSON.stringify([...channels.keys()]) });
    await modLog(ctx, c);
    return `Locked ${channels.size} channel(s) (case #${c.caseNumber}). Use \`/lockdown end\` to undo.`;
  }
  const last = await ctx.db.moderationCase.findFirst({ where: { guildId: ctx.guildId, type: 'lockdown', active: true, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!last) return 'There is no active lockdown.';
  const ids = JSON.parse(last.evidence ?? '[]') as string[];
  for (const id of ids) {
    const ch = guild.channels.cache.get(id);
    if (ch?.type === ChannelType.GuildText) await setLocked(ch, false, 'Lockdown ended').catch(() => undefined);
  }
  await ctx.db.moderationCase.update({ where: { id: last.id }, data: { active: false } });
  return `Unlocked ${ids.length} channel(s).`;
}

export async function tickTempbans(ctx: BotContext): Promise<void> {
  const guild = ctx.guild();
  if (!guild) return;
  for (const c of await dueTempbans(ctx.db, ctx.guildId)) {
    await guild.bans.remove(c.targetId!, `Tempban expired (case #${c.caseNumber})`).catch(() => undefined);
    await ctx.db.moderationCase.update({ where: { id: c.id }, data: { active: false } });
    const unban = await createCase(ctx.db, { guildId: ctx.guildId, type: 'unban', targetId: c.targetId, moderatorId: guild.members.me!.id, reason: `Tempban from case #${c.caseNumber} expired` });
    await modLog(ctx, unban);
  }
}

/** Conservative automod: delete/contain + alert staff. Never times out, kicks or bans. */
export async function handleAutomod(ctx: BotContext, message: Message<true>): Promise<boolean> {
  const mod = await ctx.module('moderation');
  const s = mod.settings.automod;
  if (!mod.enabled || !s.enabled || !message.member || message.author.bot) return false;
  if (ctx.isAdmin(message.member) || (await ctx.isStaff(message.member)) || s.exemptRoleIds.some((r) => message.member!.roles.cache.has(r))) return false;
  const hit = tracker.check(message.author.id, message.content, message.mentions.users.size + message.mentions.roles.size, s);
  if (!hit) return false;
  await message.delete().catch(() => undefined);
  const c = await createCase(ctx.db, { guildId: ctx.guildId, type: 'automod', targetId: message.author.id, moderatorId: message.guild.members.me!.id, reason: `Automod: ${hit.detail}`, channelId: message.channelId });
  const alert = textChannel(message.guild, s.alertChannelId ?? mod.settings.modLogChannelId);
  await alert?.send({ content: `Automod removed a message from <@${message.author.id}> in <#${message.channelId}> (${hit.detail}). Case #${c.caseNumber}. Staff decide any further action.`, allowedMentions: { parse: [] } }).catch(() => undefined);
  return true;
}

export const moderationModule: BotModule = {
  commands: [warn, warnings, modhistory, caseCmd, note, timeout, untimeout, removalCommand('kick', 'Kick a member (reason required)', PermissionFlagsBits.KickMembers), voicekick, ban, tempban, removalCommand('softban', 'Ban and immediately unban to clear messages (reason required)', PermissionFlagsBits.BanMembers), unban, purge, slowmode, lock, unlock, lockdown, echo],
  components: [
    {
      prefix: 'mod',
      module: 'moderation',
      async handle(i, ctx, [kind, mode, reason]) {
        if (kind !== 'lockdown' || !i.isButton()) return;
        if (!ctx.isAdmin(i.member) && !(await ctx.isStaff(i.member))) return i.reply(ephemeral('Only staff can do that.'));
        await i.deferUpdate();
        const text = await runLockdown(ctx, i.user.id, mode === 'start', reason ? decodeURIComponent(reason) || null : null);
        return i.editReply({ content: text, components: [] });
      },
    },
  ],
};

