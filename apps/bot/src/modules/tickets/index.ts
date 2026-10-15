import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  OverwriteType,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js';
import type { Ticket, TicketType } from '@aio/db';
import {
  authorizeTicketAction,
  claimFirstResponder,
  createTicketRecord,
  decideFirstResponder,
  planTicketOverwrites,
  reserveTicketNumber,
  setTicketStatus,
  takeOver,
  ticketChannelName,
  ticketQuestionSchema,
  toChannelName,
  type TicketAction,
  type TranscriptMessage,
} from '@aio/core/tickets';
import { messageTemplateSchema, renderMessageTemplate } from '@aio/discord-ui';
import { renderTemplate } from '@aio/variables';
import { z } from 'zod';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, textChannel, toMessageOptions } from '../../runtime/discord.js';
import { variableContext } from '../../runtime/actions.js';
import { upsertPanelMessage } from '../../runtime/panels.js';
import type { BotModule } from '../../commands/types.js';

const STYLE: Record<string, ButtonStyle> = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

export async function publishTicketPanel(ctx: BotContext, panelId: string, channelId: string): Promise<string> {
  const panel = await ctx.db.ticketPanel.findFirst({ where: { id: panelId, guildId: ctx.guildId }, include: { types: { orderBy: { position: 'asc' } } } });
  if (!panel) throw new Error('Ticket panel not found');
  const template = messageTemplateSchema.parse(panel.template);
  const guild = ctx.requireGuild();
  const rendered = renderMessageTemplate({ ...template, components: [] }, { server: { id: guild.id, name: guild.name, memberCount: guild.memberCount } });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    panel.types.slice(0, 5).map((t) => {
      const b = new ButtonBuilder().setCustomId(`tk:open:${t.id}`).setLabel(t.label).setStyle(STYLE[t.style] ?? ButtonStyle.Primary);
      if (t.emoji) b.setEmoji(t.emoji);
      return b;
    }),
  );
  return upsertPanelMessage(ctx, { kind: 'ticket', refId: panel.id, channelId, options: { ...toMessageOptions(rendered), components: [row] } });
}

async function staffRoleIdsFor(ctx: BotContext, type: TicketType | null): Promise<string[]> {
  const cfg = await ctx.staffRoles();
  return [...new Set([...(type?.staffRoleIds ?? []), ...cfg.ticketStaffRoleIds, ...cfg.staffRoleIds])];
}

function controls(ticket: Pick<Ticket, 'id' | 'status'>) {
  const id = (a: string) => `tk:${a}:${ticket.id}`;
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ticket.status === 'open'
        ? new ButtonBuilder().setCustomId(id('close')).setLabel('Close').setStyle(ButtonStyle.Danger)
        : new ButtonBuilder().setCustomId(id('reopen')).setLabel('Reopen').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id('takeover')).setLabel('Take over').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('rename')).setLabel('Rename').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('transcript')).setLabel('Transcript').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id('add')).setPlaceholder('Staff: add a member to this ticket').setMinValues(1).setMaxValues(5)),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id('remove')).setPlaceholder('Staff: remove a member from this ticket').setMinValues(1).setMaxValues(5)),
  ];
  return rows;
}

async function openTicket(ctx: BotContext, member: GuildMember, type: TicketType, answers: { question: string; answer: string }[]): Promise<string> {
  const guild = member.guild;
  const { settings } = await ctx.module('tickets');
  const open = await ctx.db.ticket.count({ where: { guildId: ctx.guildId, openerId: member.id, status: 'open' } });
  if (open >= settings.maxOpenPerUser) {
    const existing = await ctx.db.ticket.findFirst({ where: { guildId: ctx.guildId, openerId: member.id, status: 'open' } });
    return `You already have an open ticket${existing ? `: <#${existing.channelId}>` : ''}.`;
  }
  const number = await reserveTicketNumber(ctx.db, ctx.guildId);
  const staffRoles = await staffRoleIdsFor(ctx, type);
  const overwrites = planTicketOverwrites({ guildId: guild.id, botId: guild.members.me!.id, openerId: member.id, staffRoleIds: staffRoles, participantIds: [], status: 'open' });
  const parent = type.categoryId && guild.channels.cache.get(type.categoryId)?.type === ChannelType.GuildCategory ? type.categoryId : undefined;
  const channel = await guild.channels.create({
    name: ticketChannelName(type.waitingNameTemplate, { userName: member.user.username, number, type: type.label }),
    type: ChannelType.GuildText,
    parent,
    permissionOverwrites: overwrites.map((o) => ({ id: o.id, type: o.type === 0 ? OverwriteType.Role : OverwriteType.Member, allow: o.allow, deny: o.deny })),
    reason: `Ticket #${number} opened by ${member.user.username}`,
  });
  const ticket = await createTicketRecord(ctx.db, { guildId: ctx.guildId, number, typeId: type.id, openerId: member.id, channelId: channel.id, answers });
  const greeting = renderTemplate(type.openingMessage, variableContext(member, channel));
  await channel.send({
    content: greeting.text.slice(0, 2000),
    embeds: answers.length ? [{ title: `${type.label} · #${number}`, color: await ctx.replyColor(0x6d5dfc), fields: answers.map((a) => ({ name: a.question.slice(0, 256), value: (a.answer || '(no answer)').slice(0, 1024) })) }] : [],
    components: controls(ticket),
    allowedMentions: { users: [member.id] },
  });
  await logTicket(ctx, `Ticket #${number} opened by <@${member.id}> in <#${channel.id}>`);
  return `Your ticket is ready: <#${channel.id}>`;
}

async function logTicket(ctx: BotContext, text: string): Promise<void> {
  const { settings } = await ctx.module('tickets');
  const guild = ctx.guild();
  const ch = guild ? textChannel(guild, settings.logChannelId) : null;
  await ch?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function applyStatus(ctx: BotContext, ticket: Ticket, channel: TextChannel): Promise<void> {
  const participants = await ctx.db.ticketParticipant.findMany({ where: { ticketId: ticket.id, removedAt: null } });
  const type = ticket.typeId ? await ctx.db.ticketType.findUnique({ where: { id: ticket.typeId } }) : null;
  const overwrites = planTicketOverwrites({ guildId: channel.guild.id, botId: channel.guild.members.me!.id, openerId: ticket.openerId, staffRoleIds: await staffRoleIdsFor(ctx, type), participantIds: participants.map((p) => p.userId), status: ticket.status });
  await channel.permissionOverwrites.set(overwrites.map((o) => ({ id: o.id, type: o.type === 0 ? OverwriteType.Role : OverwriteType.Member, allow: o.allow, deny: o.deny })));
}

export async function createTranscript(ctx: BotContext, ticket: Ticket, channel: TextChannel, actorId: string): Promise<{ id: string; count: number }> {
  const messages: TranscriptMessage[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) messages.push({ id: m.id, authorId: m.author.id, authorName: m.author.username, content: m.content, createdAt: m.createdAt.toISOString(), attachments: [...m.attachments.values()].map((a) => a.name) });
    before = batch.last()?.id;
  }
  messages.reverse();
  const t = await ctx.db.ticketTranscript.create({ data: { ticketId: ticket.id, createdById: actorId, messageCount: messages.length, content: messages as never } });
  await ctx.audit({ actorId, module: 'tickets', action: 'ticket.transcript', targetId: ticket.openerId, meta: { number: ticket.number, messages: messages.length } });
  const { settings } = await ctx.module('tickets');
  const out = textChannel(channel.guild, settings.transcriptChannelId);
  if (out) {
    const text = messages.map((m) => `[${m.createdAt}] ${m.authorName}: ${m.content}${m.attachments.length ? ` [attachments: ${m.attachments.join(', ')}]` : ''}`).join('\n');
    await out.send({ content: `Transcript for ticket #${ticket.number} (<@${ticket.openerId}>)`, files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${ticket.number}.txt` })], allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  return { id: t.id, count: messages.length };
}

async function runTicketAction(ctx: BotContext, member: GuildMember, ticket: Ticket, action: TicketAction, extra: { userIds?: string[]; name?: string } = {}): Promise<string> {
  const isStaff = await ctx.isTicketStaff(member);
  const auth = authorizeTicketAction({ action, actorIsStaff: isStaff, ticketStatus: ticket.status });
  if (!auth.ok) return auth.reason;
  const channel = member.guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  if (!channel) return 'The ticket channel no longer exists.';
  switch (action) {
    case 'close':
    case 'reopen': {
      const updated = await setTicketStatus(ctx.db, ticket, action === 'close' ? 'closed' : 'open', member.id);
      if (!updated) return 'That ticket was already updated by someone else.';
      await applyStatus(ctx, updated, channel);
      await channel.send({ content: action === 'close' ? `Ticket closed by <@${member.id}>. The member can't see it anymore, but staff can reopen it.` : `Ticket reopened by <@${member.id}>.`, components: controls(updated), allowedMentions: { parse: [] } });
      await logTicket(ctx, `Ticket #${ticket.number} ${action === 'close' ? 'closed' : 'reopened'} by <@${member.id}>`);
      return action === 'close' ? 'Ticket closed.' : 'Ticket reopened.';
    }
    case 'takeover':
      await takeOver(ctx.db, ticket, member.id);
      await channel.send({ content: `<@${member.id}> is taking over this ticket.`, allowedMentions: { parse: [] } });
      return 'You are now the handler. (The channel name keeps the first responder.)';
    case 'rename': {
      const name = toChannelName(extra.name ?? '');
      await channel.setName(name);
      await ctx.db.ticket.update({ where: { id: ticket.id }, data: { nameLocked: true } });
      await ctx.audit({ actorId: member.id, module: 'tickets', action: 'ticket.rename', targetId: ticket.openerId, meta: { number: ticket.number, name } });
      return `Renamed to #${name}.`;
    }
    case 'add_user':
    case 'remove_user': {
      const ids = (extra.userIds ?? []).filter((id) => id !== ticket.openerId);
      for (const userId of ids) {
        if (action === 'add_user') await ctx.db.ticketParticipant.upsert({ where: { ticketId_userId: { ticketId: ticket.id, userId } }, create: { ticketId: ticket.id, userId, addedById: member.id }, update: { removedAt: null, addedById: member.id } });
        else await ctx.db.ticketParticipant.updateMany({ where: { ticketId: ticket.id, userId }, data: { removedAt: new Date() } });
      }
      await applyStatus(ctx, ticket, channel);
      await ctx.audit({ actorId: member.id, module: 'tickets', action: `ticket.${action}`, targetId: ticket.openerId, meta: { number: ticket.number, userIds: ids } });
      return `${action === 'add_user' ? 'Added' : 'Removed'} ${ids.map((id) => `<@${id}>`).join(', ') || 'nobody'}.`;
    }
    case 'transcript': {
      const t = await createTranscript(ctx, ticket, channel, member.id);
      return `Saved a transcript with ${t.count} messages. Admins can view it in the dashboard.`;
    }
  }
}

/** First staff message renames the channel exactly once. */
export async function handleTicketMessage(ctx: BotContext, message: Message<true>): Promise<void> {
  if (message.author.bot || !message.member) return;
  const ticket = await ctx.db.ticket.findUnique({ where: { channelId: message.channelId }, include: { type: true } });
  if (!ticket || ticket.firstResponderId || ticket.nameLocked || ticket.status !== 'open') return;
  const isStaff = await ctx.isTicketStaff(message.member);
  const opener = await message.guild.members.fetch(ticket.openerId).catch(() => null);
  const decision = decideFirstResponder({
    ticket,
    authorId: message.author.id,
    authorIsStaff: isStaff,
    authorIsBot: message.author.bot,
    authorName: message.member.user.username,
    openerName: opener?.user.username ?? 'user',
    handledNameTemplate: ticket.type?.handledNameTemplate ?? '{staff.name}-{user.name}',
    typeLabel: ticket.type?.label,
  });
  if (!decision.rename) return;
  if (!(await claimFirstResponder(ctx.db, ticket.id, message.author.id))) return;
  await (message.channel as TextChannel).setName(decision.name, 'First staff response').catch((err) => ctx.reportError(err, 'tickets.rename'));
  await ctx.audit({ actorId: message.author.id, module: 'tickets', action: 'ticket.first_response', targetId: ticket.openerId, meta: { number: ticket.number, name: decision.name } });
}

export const ticketsModule: BotModule = {
  commands: [
    {
      module: 'tickets',
      data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Staff ticket controls (use inside a ticket channel)')
        .addSubcommand((s) => s.setName('close').setDescription('Close this ticket'))
        .addSubcommand((s) => s.setName('reopen').setDescription('Reopen this ticket'))
        .addSubcommand((s) => s.setName('add').setDescription('Add a member').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a member').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
        .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('takeover').setDescription('Become the handler (does not rename)'))
        .addSubcommand((s) => s.setName('transcript').setDescription('Save a transcript'))
        .toJSON(),
      async execute(i, ctx) {
        const ticket = await ctx.db.ticket.findUnique({ where: { channelId: i.channelId } });
        if (!ticket) return i.reply(ephemeral('Use this inside a ticket channel.'));
        const sub = i.options.getSubcommand();
        const map: Record<string, TicketAction> = { close: 'close', reopen: 'reopen', add: 'add_user', remove: 'remove_user', rename: 'rename', takeover: 'takeover', transcript: 'transcript' };
        await i.deferReply({ flags: 64 });
        const user = i.options.getUser('member');
        return i.editReply(await runTicketAction(ctx, i.member, ticket, map[sub]!, { userIds: user ? [user.id] : [], name: i.options.getString('name') ?? undefined }));
      },
    },
  ],
  components: [
    {
      prefix: 'tk',
      module: 'tickets',
      async handle(i, ctx, [action, id]) {
        if (!id) return;
        if (action === 'open' && i.isButton()) {
          const type = await ctx.db.ticketType.findUnique({ where: { id }, include: { panel: true } });
          if (!type || type.panel.guildId !== ctx.guildId) return i.reply(ephemeral('This ticket option no longer exists.'));
          const questions = z.array(ticketQuestionSchema).safeParse(type.questions);
          if (questions.success && questions.data.length) {
            const modal = new ModalBuilder().setCustomId(`tk:q:${type.id}`).setTitle(type.label.slice(0, 45));
            questions.data.slice(0, 5).forEach((q, n) =>
              modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId(`q${n}`)
                    .setLabel(q.label)
                    .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                    .setRequired(q.required)
                    .setMaxLength(q.maxLength)
                    .setPlaceholder(q.placeholder ?? ''),
                ),
              ),
            );
            return i.showModal(modal);
          }
          await i.deferReply({ flags: 64 });
          return i.editReply(await openTicket(ctx, i.member, type, []));
        }
        if (action === 'q' && i.isModalSubmit()) {
          const type = await ctx.db.ticketType.findUnique({ where: { id } });
          if (!type) return i.reply(ephemeral('This ticket option no longer exists.'));
          const questions = z.array(ticketQuestionSchema).parse(type.questions);
          const answers = questions.slice(0, 5).map((q, n) => ({ question: q.label, answer: i.fields.getTextInputValue(`q${n}`) }));
          await i.deferReply({ flags: 64 });
          return i.editReply(await openTicket(ctx, i.member, type, answers));
        }
        const ticket = await ctx.db.ticket.findUnique({ where: { id } });
        if (!ticket) return i.reply(ephemeral('Ticket not found.'));
        if (action === 'rename' && i.isButton()) {
          if (!(await ctx.isTicketStaff(i.member))) return i.reply(ephemeral('Only staff can use ticket controls.'));
          return i.showModal(new ModalBuilder().setCustomId(`tk:renamem:${ticket.id}`).setTitle('Rename ticket').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Channel name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true))));
        }
        const map: Record<string, TicketAction> = { close: 'close', reopen: 'reopen', takeover: 'takeover', transcript: 'transcript', add: 'add_user', remove: 'remove_user', renamem: 'rename' };
        const act = map[action ?? ''];
        if (!act) return;
        await i.deferReply({ flags: 64 });
        const userIds = i.isUserSelectMenu() ? i.values : [];
        const name = i.isModalSubmit() ? i.fields.getTextInputValue('name') : undefined;
        return i.editReply(await runTicketAction(ctx, i.member, ticket, act, { userIds, name }));
      },
    },
  ],
};
