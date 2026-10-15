import { SlashCommandBuilder, type GuildMember, type GuildTextBasedChannel, type Message } from 'discord.js';
import { adjustXp, levelFromXp, progressBar, randomXp, rewardRolesFor, xpForSetLevel, xpMultiplier, type AwardResult } from '@aio/core/leveling';
import type { LevelingSettings } from '@aio/core';
import { renderTemplate } from '@aio/variables';
import { checkRoleAssignable } from '@aio/permissions';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, textChannel, toMessageOptions } from '../../runtime/discord.js';
import { renderSavedEmbed, variableContext } from '../../runtime/actions.js';
import type { BotModule } from '../../commands/types.js';

const lastXp = new Map<string, number>();

async function afterAward(ctx: BotContext, member: GuildMember, s: LevelingSettings, r: AwardResult, channel?: GuildTextBasedChannel | null): Promise<void> {
  if (r.level === r.previousLevel) return;
  await syncRewards(ctx, member, r.level, s);
  if (!r.leveledUp || !s.levelUpNotify) return;
  const target = textChannel(member.guild, s.levelUpChannelId) ?? channel;
  if (!target) return;
  const vctx = { ...variableContext(member, target), level: { level: r.level, xp: r.xp } };
  if (s.levelUpEmbedId) {
    const rendered = await renderSavedEmbed(ctx, s.levelUpEmbedId, vctx);
    if (rendered) {
      await target.send(toMessageOptions(rendered)).catch(() => undefined);
      return;
    }
  }
  const text = renderTemplate(s.levelUpMessage, vctx);
  await target.send({ content: text.text.slice(0, 2000), allowedMentions: { parse: [], users: text.mentionUserIds } }).catch(() => undefined);
}

async function syncRewards(ctx: BotContext, member: GuildMember, level: number, s: LevelingSettings): Promise<void> {
  const rewards = await ctx.db.levelRoleReward.findMany({ where: { guildId: ctx.guildId } });
  if (!rewards.length) return;
  const { keep } = rewardRolesFor(level, rewards, s.stackRewards);
  const allRewardRoles = new Set(rewards.map((r) => r.roleId));
  const me = member.guild.members.me!;
  const assignable = (id: string) => {
    const role = member.guild.roles.cache.get(id);
    return role && checkRoleAssignable({ role: { id, position: role.position, managed: role.managed }, botHighestPosition: me.roles.highest.position, botPermissions: me.permissions.bitfield }).ok;
  };
  const add = keep.filter((id) => !member.roles.cache.has(id) && assignable(id));
  // Reward roles the member should no longer hold (lower tiers without stacking, or above their level after /xp remove).
  const drop = [...allRewardRoles].filter((id) => !keep.includes(id) && member.roles.cache.has(id) && assignable(id));
  if (add.length) await member.roles.add(add, `Level ${level} reward`).catch((err) => ctx.reportError(err, 'leveling.rewards'));
  if (drop.length) await member.roles.remove(drop, `Level ${level} reward update`).catch((err) => ctx.reportError(err, 'leveling.rewards'));
}

export async function handleLevelingMessage(ctx: BotContext, message: Message<true>): Promise<void> {
  const mod = await ctx.module('leveling');
  if (!mod.enabled || !mod.settings.textXp || message.author.bot || !message.member) return;
  const s = mod.settings;
  const key = message.author.id;
  const now = Date.now();
  if ((lastXp.get(key) ?? 0) + s.cooldownSeconds * 1000 > now) return;
  const profile = await ctx.db.levelProfile.findUnique({ where: { guildId_userId: { guildId: ctx.guildId, userId: key } } });
  const channel = message.channel as GuildTextBasedChannel;
  const mult = xpMultiplier(s, {
    channelId: channel.id,
    parentChannelId: channel.isThread() ? (channel.parentId ?? undefined) : undefined,
    roleIds: [...message.member.roles.cache.keys()],
    isStaff: await ctx.isStaff(message.member),
    optedOut: profile?.optedOut ?? false,
  });
  if (mult <= 0) return;
  lastXp.set(key, now);
  const r = await adjustXp(ctx.db, { guildId: ctx.guildId, userId: key, delta: Math.round(randomXp(s.xpMin, s.xpMax) * mult), settings: s, countMessage: true });
  await afterAward(ctx, message.member, s, r, channel);
}

/** Every minute: award voice XP to humans in active voice rooms (≥2 humans, not self-deafened, not AFK). */
export async function tickVoiceXp(ctx: BotContext): Promise<void> {
  const mod = await ctx.module('leveling');
  const guild = ctx.guild();
  if (!mod.enabled || !mod.settings.voiceXp || !guild || mod.settings.voiceXpPerMinute <= 0) return;
  for (const [, state] of guild.voiceStates.cache) {
    const member = state.member;
    const ch = state.channel;
    if (!member || member.user.bot || !ch || ch.id === guild.afkChannelId || state.selfDeaf || state.serverDeaf) continue;
    if (ch.members.filter((m) => !m.user.bot).size < 2) continue;
    const profile = await ctx.db.levelProfile.findUnique({ where: { guildId_userId: { guildId: ctx.guildId, userId: member.id } } });
    const mult = xpMultiplier(mod.settings, { channelId: ch.id, parentChannelId: ch.parentId ?? undefined, roleIds: [...member.roles.cache.keys()], isStaff: await ctx.isStaff(member), optedOut: profile?.optedOut ?? false });
    if (mult <= 0) continue;
    const r = await adjustXp(ctx.db, { guildId: ctx.guildId, userId: member.id, delta: Math.round(mod.settings.voiceXpPerMinute * mult), settings: mod.settings, voiceMinutes: 1 });
    await afterAward(ctx, member, mod.settings, r, null);
  }
}

async function staffGuard(ctx: BotContext, member: GuildMember): Promise<boolean> {
  return ctx.isAdmin(member) || (await ctx.isStaff(member));
}

export const levelingModule: BotModule = {
  commands: [
    {
      module: 'leveling',
      data: new SlashCommandBuilder().setName('rank').setDescription('Show your level (or someone else’s)').addUserOption((o) => o.setName('member').setDescription('Member')).toJSON(),
      async execute(i, ctx) {
        const { settings } = await ctx.module('leveling');
        if (!settings.rankEnabled) return i.reply(ephemeral('`/rank` is turned off on this server.'));
        const user = i.options.getUser('member') ?? i.user;
        const p = await ctx.db.levelProfile.findUnique({ where: { guildId_userId: { guildId: ctx.guildId, userId: user.id } } });
        if (!p) return i.reply(ephemeral(`${user.id === i.user.id ? 'You have' : `<@${user.id}> has`} no XP yet.`));
        if (p.optedOut && user.id !== i.user.id) return i.reply(ephemeral('That member has opted out of leveling.'));
        const lvl = levelFromXp(p.xp, settings.formula, settings.difficulty);
        const position = (await ctx.db.levelProfile.count({ where: { guildId: ctx.guildId, xp: { gt: p.xp }, optedOut: false } })) + 1;
        return i.reply({ content: `**<@${user.id}>** · Level **${lvl.level}** · Rank #${position}\n${progressBar(lvl.intoLevel, lvl.needed)} ${lvl.intoLevel}/${lvl.needed} XP\n-# ${p.xp} total XP · ${p.messageCount} messages · ${p.voiceMinutes} voice minutes`, allowedMentions: { parse: [] } });
      },
    },
    {
      module: 'leveling',
      data: new SlashCommandBuilder().setName('leaderboard').setDescription('Top members by XP').addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1)).toJSON(),
      async execute(i, ctx) {
        const { settings } = await ctx.module('leveling');
        if (!settings.leaderboardEnabled) return i.reply(ephemeral('`/leaderboard` is turned off on this server.'));
        const page = i.options.getInteger('page') ?? 1;
        const rows = await ctx.db.levelProfile.findMany({ where: { guildId: ctx.guildId, optedOut: false }, orderBy: { xp: 'desc' }, skip: (page - 1) * 10, take: 10 });
        if (!rows.length) return i.reply(ephemeral('Nobody on this page yet.'));
        return i.reply({ content: rows.map((r, n) => `\`#${(page - 1) * 10 + n + 1}\` <@${r.userId}> · Level ${r.level} · ${r.xp} XP`).join('\n'), allowedMentions: { parse: [] } });
      },
    },
    {
      module: 'leveling',
      data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('Staff: change a member’s XP')
        .addSubcommand((s) => s.setName('add').setDescription('Add XP').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(1).setMaxValue(1_000_000)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove XP').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(1).setMaxValue(1_000_000)))
        .addSubcommand((s) => s.setName('set').setDescription('Set XP').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(0).setMaxValue(100_000_000)))
        .toJSON(),
      async execute(i, ctx) {
        if (!(await staffGuard(ctx, i.member))) return i.reply(ephemeral('Only staff can change XP.'));
        const { settings } = await ctx.module('leveling');
        const member = i.options.getMember('member');
        if (!member) return i.reply(ephemeral('That user is not in the server.'));
        const sub = i.options.getSubcommand();
        const amount = i.options.getInteger('amount', true);
        const r = await adjustXp(ctx.db, { guildId: ctx.guildId, userId: member.id, settings, ...(sub === 'set' ? { set: amount } : { delta: sub === 'add' ? amount : -amount }) });
        await afterAward(ctx, member, settings, r, null);
        await ctx.audit({ actorId: i.user.id, module: 'leveling', action: `xp.${sub}`, targetId: member.id, after: { amount, xp: r.xp, level: r.level } });
        return i.reply(ephemeral(`<@${member.id}> now has **${r.xp} XP** (level ${r.level}).`));
      },
    },
    {
      module: 'leveling',
      data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Staff: set a member’s level')
        .addSubcommand((s) => s.setName('set').setDescription('Set level').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(0).setMaxValue(1000)))
        .toJSON(),
      async execute(i, ctx) {
        if (!(await staffGuard(ctx, i.member))) return i.reply(ephemeral('Only staff can change levels.'));
        const { settings } = await ctx.module('leveling');
        const member = i.options.getMember('member');
        if (!member) return i.reply(ephemeral('That user is not in the server.'));
        const level = i.options.getInteger('level', true);
        const r = await adjustXp(ctx.db, { guildId: ctx.guildId, userId: member.id, set: xpForSetLevel(level, settings), settings });
        await afterAward(ctx, member, settings, { ...r, leveledUp: false }, null);
        await ctx.audit({ actorId: i.user.id, module: 'leveling', action: 'level.set', targetId: member.id, after: { level } });
        return i.reply(ephemeral(`<@${member.id}> is now level **${r.level}**.`));
      },
    },
    {
      module: 'leveling',
      data: new SlashCommandBuilder()
        .setName('levels')
        .setDescription('Your leveling preferences')
        .addSubcommand((s) => s.setName('optout').setDescription('Stop earning XP and hide from the leaderboard'))
        .addSubcommand((s) => s.setName('optin').setDescription('Start earning XP again'))
        .toJSON(),
      async execute(i, ctx) {
        const { settings } = await ctx.module('leveling');
        if (!settings.allowOptOut) return i.reply(ephemeral('Opting out is disabled on this server.'));
        const optedOut = i.options.getSubcommand() === 'optout';
        await ctx.db.levelProfile.upsert({ where: { guildId_userId: { guildId: ctx.guildId, userId: i.user.id } }, create: { guildId: ctx.guildId, userId: i.user.id, optedOut }, update: { optedOut } });
        return i.reply(ephemeral(optedOut ? 'You opted out of leveling.' : 'You opted back in to leveling.'));
      },
    },
  ],
};
