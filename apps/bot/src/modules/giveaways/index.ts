import { PermissionFlagsBits, SlashCommandBuilder, type APIEmbed, type AutocompleteInteraction, type BaseMessageOptions } from 'discord.js';
import { claimGiveawayEnd, dueGiveaways, giveawayInputSchema, pickWinners, toggleGiveawayEntry, type GiveawayInput } from '@aio/core/community';
import { parseDuration } from '@aio/core/moderation';
import { escapeMd, truncate } from '@aio/core/music';
import type { Giveaway } from '@aio/db';
import type { BotContext } from '../../runtime/context.js';
import { card, cardReply } from '../../runtime/cards.js';
import { botCanSend, jumpUrl, textChannel, ts } from '../../runtime/discord.js';
import type { BotModule } from '../../commands/types.js';

const DAY = 86_400_000;

async function giveawayEmbed(ctx: BotContext, g: Giveaway, entries: number): Promise<APIEmbed> {
  const ended = g.endedAt !== null;
  const winners = g.winnerIds.length ? g.winnerIds.map((id) => `<@${id}>`).join(', ') : 'Nobody entered 😔';
  return card(ctx, {
    eyebrow: ended ? 'Giveaway ended' : 'Giveaway',
    title: truncate(g.prize, 250),
    body: [
      g.description ? escapeMd(g.description) : '',
      ended ? `**Winner${g.winnerCount === 1 ? '' : 's'}:** ${winners}` : `Press **Enter** to join. Ends ${ts(g.endsAt)} (${ts(g.endsAt, 'f')}).`,
      g.requiredRoleId && !ended ? `Only members with <@&${g.requiredRoleId}> can enter.` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    fields: [
      { name: 'Hosted by', value: `<@${g.hostId}>`, inline: true },
      { name: 'Winners', value: String(g.winnerCount), inline: true },
      { name: 'Entries', value: String(entries), inline: true },
    ],
  });
}

async function giveawayMessage(ctx: BotContext, g: Giveaway, entries: number): Promise<BaseMessageOptions> {
  return {
    embeds: [await giveawayEmbed(ctx, g, entries)],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: g.endedAt ? 2 : 1, label: g.endedAt ? `Ended · ${entries} entered` : `Enter · ${entries}`, custom_id: `gw:enter:${g.id}`, disabled: g.endedAt !== null }],
      },
    ],
    allowedMentions: { parse: [] },
  };
}

async function refreshMessage(ctx: BotContext, id: string): Promise<void> {
  const g = await ctx.db.giveaway.findUnique({ where: { id } });
  if (!g?.messageId) return;
  const msg = await textChannel(ctx.requireGuild(), g.channelId)?.messages.fetch(g.messageId).catch(() => null);
  if (!msg) return;
  const entries = await ctx.db.giveawayEntry.count({ where: { giveawayId: id } });
  await msg.edit(await giveawayMessage(ctx, g, entries));
}

// Popular giveaways get many clicks a second; the entry count on the message catches up a moment later.
const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRefresh(ctx: BotContext, id: string): void {
  if (pendingRefresh.has(id)) return;
  const t = setTimeout(() => {
    pendingRefresh.delete(id);
    void refreshMessage(ctx, id).catch((err) => ctx.reportError(err, 'giveaways.refresh'));
  }, 3_000);
  t.unref();
  pendingRefresh.set(id, t);
}

/** Posts a giveaway. Shared by `/giveaway start` and the dashboard. */
export async function startGiveaway(ctx: BotContext, input: GiveawayInput, hostId: string): Promise<Giveaway> {
  const { settings } = await ctx.module('giveaways');
  if (input.durationMs > settings.maxDurationDays * DAY) throw new Error(`Giveaways can last at most ${settings.maxDurationDays} days.`);
  const guild = ctx.requireGuild();
  const channel = textChannel(guild, input.channelId);
  if (!channel || !botCanSend(guild, channel)) throw new Error("I can't post in that channel. Check that I can see it and send messages there.");
  const g = await ctx.db.giveaway.create({
    data: {
      guildId: ctx.guildId,
      channelId: input.channelId,
      hostId,
      prize: input.prize,
      description: input.description ?? null,
      winnerCount: input.winnerCount,
      requiredRoleId: input.requiredRoleId ?? null,
      endsAt: new Date(Date.now() + input.durationMs),
    },
  });
  try {
    const ping = settings.pingRoleId ? { content: `<@&${settings.pingRoleId}>`, allowedMentions: { roles: [settings.pingRoleId] } } : {};
    const msg = await channel.send({ ...(await giveawayMessage(ctx, g, 0)), ...ping });
    await ctx.audit({ actorId: hostId, module: 'giveaways', action: 'giveaway.start', targetId: g.id, meta: { prize: g.prize, channelId: g.channelId } });
    return ctx.db.giveaway.update({ where: { id: g.id }, data: { messageId: msg.id } });
  } catch (err) {
    await ctx.db.giveaway.delete({ where: { id: g.id } }).catch(() => undefined);
    throw err;
  }
}

/** Entrants who are still in the server (and still have the required role). */
async function eligibleEntrants(ctx: BotContext, g: Giveaway, exclude: string[] = []): Promise<string[]> {
  const entries = await ctx.db.giveawayEntry.findMany({ where: { giveawayId: g.id }, select: { userId: true } });
  const ids = entries.map((e) => e.userId).filter((id) => !exclude.includes(id));
  if (ids.length === 0) return [];
  const guild = ctx.requireGuild();
  const members = await guild.members.fetch({ user: ids }).catch(() => null);
  if (!members) return ids;
  return ids.filter((id) => {
    const m = members.get(id);
    return m && !m.user.bot && (!g.requiredRoleId || m.roles.cache.has(g.requiredRoleId));
  });
}

async function announce(ctx: BotContext, g: Giveaway, winners: string[], reroll: boolean): Promise<void> {
  const channel = textChannel(ctx.requireGuild(), g.channelId);
  if (!channel) return;
  const content = winners.length
    ? `${reroll ? 'New pick' : 'Congrats'} ${winners.map((id) => `<@${id}>`).join(', ')}! You won **${escapeMd(g.prize)}** 🥹`
    : `Nobody could win **${escapeMd(g.prize)}**, there were no eligible entries 😔`;
  await channel.send({
    content,
    allowedMentions: { users: winners },
    reply: g.messageId ? { messageReference: g.messageId, failIfNotExists: false } : undefined,
  });
}

/** Draws a giveaway exactly once. Returns null when it was already ended. */
export async function endGiveaway(ctx: BotContext, id: string, actorId: string | null): Promise<string[] | null> {
  const g = await ctx.db.giveaway.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!g || !(await claimGiveawayEnd(ctx.db, id, new Date()))) return null;
  const winners = pickWinners(await eligibleEntrants(ctx, g), g.winnerCount);
  const saved = await ctx.db.giveaway.update({ where: { id }, data: { winnerIds: winners } });
  await refreshMessage(ctx, id).catch((err) => ctx.reportError(err, 'giveaways.end'));
  await announce(ctx, saved, winners, false).catch((err) => ctx.reportError(err, 'giveaways.announce'));
  await ctx.audit({ actorId, module: 'giveaways', action: 'giveaway.end', targetId: id, meta: { winners } });
  return winners;
}

/** Picks replacement winners among entrants who haven't won this giveaway yet. */
export async function rerollGiveaway(ctx: BotContext, id: string, count: number, actorId: string | null): Promise<string[]> {
  const g = await ctx.db.giveaway.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!g) throw new Error('That giveaway no longer exists.');
  if (!g.endedAt) throw new Error("That giveaway hasn't ended yet. End it first.");
  const winners = pickWinners(await eligibleEntrants(ctx, g, g.winnerIds), count);
  if (winners.length) {
    await ctx.db.giveaway.update({ where: { id }, data: { winnerIds: [...g.winnerIds, ...winners] } });
    await refreshMessage(ctx, id).catch(() => undefined);
  }
  await announce(ctx, g, winners, true);
  await ctx.audit({ actorId, module: 'giveaways', action: 'giveaway.reroll', targetId: id, meta: { winners } });
  return winners;
}

export async function tickGiveaways(ctx: BotContext): Promise<void> {
  if (!ctx.guild() || !(await ctx.module('giveaways')).enabled) return;
  for (const g of await dueGiveaways(ctx.db, ctx.guildId, new Date())) await endGiveaway(ctx, g.id, null);
}

async function suggestGiveaways(i: AutocompleteInteraction<'cached'>, ctx: BotContext, ended: boolean) {
  const typed = i.options.getFocused().toLowerCase();
  const rows = await ctx.db.giveaway.findMany({
    where: { guildId: ctx.guildId, endedAt: ended ? { not: null } : null, prize: { contains: typed, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  return i.respond(rows.map((g) => ({ name: truncate(`${g.prize} · ${ended ? 'ended' : 'ends'} ${g.endsAt.toISOString().slice(0, 10)}`, 100), value: g.id }))).catch(() => undefined);
}

const command = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Run giveaways')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Start a giveaway in this channel')
      .addStringOption((o) => o.setName('prize').setDescription('What people can win').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('duration').setDescription('How long it runs, like 1h, 2d or 1w').setRequired(true).setMaxLength(20))
      .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(20))
      .addRoleOption((o) => o.setName('role').setDescription('Only members with this role can enter'))
      .addStringOption((o) => o.setName('details').setDescription('Extra details shown on the giveaway').setMaxLength(1000)),
  )
  .addSubcommand((s) =>
    s
      .setName('end')
      .setDescription('End a giveaway now and draw the winners')
      .addStringOption((o) => o.setName('giveaway').setDescription('Which giveaway').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Pick new winners for an ended giveaway')
      .addStringOption((o) => o.setName('giveaway').setDescription('Which giveaway').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Show running giveaways'))
  .toJSON();

export const giveawaysModule: BotModule = {
  commands: [
    {
      module: 'giveaways',
      data: command,
      async autocomplete(i, ctx) {
        return suggestGiveaways(i, ctx, i.options.getSubcommand() === 'reroll');
      },
      async execute(i, ctx) {
        const sub = i.options.getSubcommand();
        if (sub === 'start') {
          const durationMs = parseDuration(i.options.getString('duration', true));
          if (!durationMs) return i.reply(await cardReply(ctx, { tone: 'warn', body: 'I didn\'t get that duration. Try something like `30m`, `12h`, `3d` or `1w`.' }));
          const parsed = giveawayInputSchema.safeParse({
            channelId: i.channelId,
            prize: i.options.getString('prize', true),
            description: i.options.getString('details'),
            winnerCount: i.options.getInteger('winners') ?? 1,
            requiredRoleId: i.options.getRole('role')?.id ?? null,
            durationMs,
          });
          if (!parsed.success) return i.reply(await cardReply(ctx, { tone: 'warn', body: parsed.error.issues[0]?.message ?? 'Something about that giveaway is off.' }));
          await i.deferReply({ flags: 64 });
          const g = await startGiveaway(ctx, parsed.data, i.user.id).catch((err: Error) => err);
          if (g instanceof Error) return i.editReply({ embeds: [await card(ctx, { tone: 'bad', body: g.message })] });
          return i.editReply({ embeds: [await card(ctx, { tone: 'good', body: `Giveaway started. It ends ${ts(g.endsAt)}.` })] });
        }
        if (sub === 'end') {
          await i.deferReply({ flags: 64 });
          const winners = await endGiveaway(ctx, i.options.getString('giveaway', true), i.user.id);
          if (!winners) return i.editReply({ embeds: [await card(ctx, { tone: 'warn', body: 'That giveaway already ended or no longer exists.' })] });
          return i.editReply({ embeds: [await card(ctx, { tone: 'good', body: winners.length ? `Drew ${winners.map((w) => `<@${w}>`).join(', ')}.` : 'Ended it, but nobody eligible had entered.' })], allowedMentions: { parse: [] } });
        }
        if (sub === 'reroll') {
          await i.deferReply({ flags: 64 });
          const r = await rerollGiveaway(ctx, i.options.getString('giveaway', true), i.options.getInteger('winners') ?? 1, i.user.id).catch((err: Error) => err);
          if (r instanceof Error) return i.editReply({ embeds: [await card(ctx, { tone: 'warn', body: r.message })] });
          return i.editReply({ embeds: [await card(ctx, { tone: r.length ? 'good' : 'warn', body: r.length ? `Picked ${r.map((w) => `<@${w}>`).join(', ')}.` : 'Everyone eligible has already won 😔' })], allowedMentions: { parse: [] } });
        }
        const running = await ctx.db.giveaway.findMany({ where: { guildId: ctx.guildId, endedAt: null }, orderBy: { endsAt: 'asc' }, take: 15, include: { _count: { select: { entries: true } } } });
        const lines = running.map(
          (g) => `**${g.messageId ? `[${escapeMd(truncate(g.prize, 60))}](${jumpUrl(ctx.guildId, g.channelId, g.messageId)})` : escapeMd(truncate(g.prize, 60))}** · ends ${ts(g.endsAt)} · ${g._count.entries} entered`,
        );
        return i.reply(await cardReply(ctx, { eyebrow: 'Giveaways', title: running.length ? `${running.length} running` : 'Nothing running', body: lines.join('\n') || 'Start one with `/giveaway start`.' }));
      },
    },
  ],
  components: [
    {
      prefix: 'gw',
      module: 'giveaways',
      async handle(i, ctx, [action, id]) {
        if (action !== 'enter' || !id || !i.isButton()) return;
        const g = await ctx.db.giveaway.findFirst({ where: { id, guildId: ctx.guildId }, select: { requiredRoleId: true } });
        if (g?.requiredRoleId && !i.member.roles.cache.has(g.requiredRoleId)) {
          return i.reply(await cardReply(ctx, { tone: 'warn', body: `You need the <@&${g.requiredRoleId}> role to enter this one.` }));
        }
        const r = await toggleGiveawayEntry(ctx.db, id, i.user.id);
        if (r.status === 'missing') return i.reply(await cardReply(ctx, { tone: 'warn', body: 'This giveaway no longer exists.' }));
        if (r.status === 'ended') return i.reply(await cardReply(ctx, { tone: 'warn', body: 'This giveaway already ended.' }));
        scheduleRefresh(ctx, id);
        return i.reply(
          await cardReply(ctx, r.status === 'entered' ? { tone: 'good', body: "You're in! Good luck 🥺" } : { body: 'You left the giveaway. Press Enter again to rejoin.' }),
        );
      },
    },
  ],
};
