import { SlashCommandBuilder } from 'discord.js';
import { ReminderLimitError, claimReminder, createReminder, dueReminders, reminderInputSchema } from '@aio/core/community';
import { parseDuration } from '@aio/core/moderation';
import { escapeMd, truncate } from '@aio/core/music';
import type { Reminder } from '@aio/db';
import type { BotContext } from '../../runtime/context.js';
import { card, cardReply } from '../../runtime/cards.js';
import { botCanSend, textChannel, ts } from '../../runtime/discord.js';
import type { BotModule } from '../../commands/types.js';

async function deliver(ctx: BotContext, r: Reminder): Promise<void> {
  const guild = ctx.requireGuild();
  const embed = await card(ctx, { eyebrow: 'Reminder', body: escapeMd(r.text), notes: [`You asked me ${ts(r.createdAt)}`] });
  if (!r.channelId) {
    const user = await ctx.client.users.fetch(r.userId).catch(() => null);
    if (user && (await user.send({ embeds: [embed] }).then(() => true).catch(() => false))) return;
  }
  // Channel reminders, and DMs that couldn't be delivered (closed DMs), go to the channel with a mention.
  const channel = textChannel(guild, r.channelId ?? r.originChannelId);
  if (!channel || !botCanSend(guild, channel)) return;
  await channel.send({ content: `<@${r.userId}>`, embeds: [embed], allowedMentions: { users: [r.userId] } });
}

export async function tickReminders(ctx: BotContext): Promise<void> {
  if (!ctx.guild() || !(await ctx.module('reminders')).enabled) return;
  for (const r of await dueReminders(ctx.db, ctx.guildId, new Date())) {
    // Claim first: a crash mid-send loses one reminder instead of sending it twice.
    if (!(await claimReminder(ctx.db, r.id, new Date()))) continue;
    await deliver(ctx, r).catch((err) => ctx.reportError(err, 'reminders.send'));
  }
}

const command = new SlashCommandBuilder()
  .setName('remind')
  .setDescription('Get reminded about something later')
  .addSubcommand((s) =>
    s
      .setName('me')
      .setDescription('Set a reminder')
      .addStringOption((o) => o.setName('in').setDescription('When, like 10m, 2h, 3d or 1w2d').setRequired(true).setMaxLength(20))
      .addStringOption((o) => o.setName('about').setDescription('What to remind you about').setRequired(true).setMaxLength(1000))
      .addBooleanOption((o) => o.setName('here').setDescription('Remind me in this channel instead of by DM')),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Show your reminders'))
  .addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('Cancel one of your reminders')
      .addStringOption((o) => o.setName('reminder').setDescription('Which reminder').setRequired(true).setAutocomplete(true)),
  )
  .toJSON();

export const remindersModule: BotModule = {
  commands: [
    {
      module: 'reminders',
      data: command,
      async autocomplete(i, ctx) {
        const typed = i.options.getFocused().toLowerCase();
        const rows = await ctx.db.reminder.findMany({
          where: { guildId: ctx.guildId, userId: i.user.id, sentAt: null, text: { contains: typed, mode: 'insensitive' } },
          orderBy: { remindAt: 'asc' },
          take: 25,
        });
        return i.respond(rows.map((r) => ({ name: truncate(`${r.remindAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${r.text}`, 100), value: r.id }))).catch(() => undefined);
      },
      async execute(i, ctx) {
        const sub = i.options.getSubcommand();
        if (sub === 'me') {
          const { settings } = await ctx.module('reminders');
          const here = i.options.getBoolean('here') ?? false;
          if (here && !settings.allowChannelReminders) return i.reply(await cardReply(ctx, { tone: 'warn', body: 'Channel reminders are turned off here, so I can only remind you by DM.' }));
          const delayMs = parseDuration(i.options.getString('in', true));
          if (!delayMs) return i.reply(await cardReply(ctx, { tone: 'warn', body: "I didn't get that time. Try something like `10m`, `2h`, `3d` or `1w2d`." }));
          const parsed = reminderInputSchema.safeParse({ text: i.options.getString('about', true), delayMs });
          if (!parsed.success) return i.reply(await cardReply(ctx, { tone: 'warn', body: parsed.error.issues[0]?.message ?? "That reminder doesn't look right." }));
          const remindAt = new Date(Date.now() + parsed.data.delayMs);
          const r = await createReminder(ctx.db, {
            guildId: ctx.guildId,
            userId: i.user.id,
            channelId: here ? i.channelId : null,
            originChannelId: i.channelId,
            text: parsed.data.text,
            remindAt,
            max: settings.maxPerUser,
          }).catch((err: unknown) => (err instanceof ReminderLimitError ? err : Promise.reject(err)));
          if (r instanceof ReminderLimitError) return i.reply(await cardReply(ctx, { tone: 'warn', body: r.message }));
          return i.reply(
            await cardReply(ctx, {
              tone: 'good',
              body: `Got it. I'll remind you ${ts(remindAt)} ${here ? 'in this channel' : 'by DM'}.`,
              notes: [here ? '' : "If your DMs are closed, I'll ping you in this channel instead."],
            }),
          );
        }
        if (sub === 'cancel') {
          const r = await ctx.db.reminder.deleteMany({ where: { id: i.options.getString('reminder', true), guildId: ctx.guildId, userId: i.user.id, sentAt: null } });
          return i.reply(await cardReply(ctx, r.count ? { tone: 'good', body: 'Reminder cancelled.' } : { tone: 'warn', body: "I couldn't find that reminder. It may have already gone off." }));
        }
        const rows = await ctx.db.reminder.findMany({ where: { guildId: ctx.guildId, userId: i.user.id, sentAt: null }, orderBy: { remindAt: 'asc' }, take: 15 });
        return i.reply(
          await cardReply(ctx, {
            eyebrow: 'Your reminders',
            title: rows.length ? `${rows.length} coming up` : 'Nothing coming up',
            body: rows.map((r) => `${ts(r.remindAt)} · ${escapeMd(truncate(r.text, 80))}${r.channelId ? ` · <#${r.channelId}>` : ''}`).join('\n') || 'Set one with `/remind me`.',
          }),
        );
      },
    },
  ],
};
