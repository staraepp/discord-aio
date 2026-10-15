import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  OverwriteType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type GuildMember,
  type ModalSubmitInteraction,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import { authorizeRoomControl, clampBitrate, planRoomOverwrites, pickCategory, renderRoomName, shouldDeleteRoom, type RoomControlAction, type TempVisibility } from '@aio/core/tempvc';
import { loadSavedEmbed } from '@aio/core/embeds';
import { renderMessageTemplate, type MessageTemplate } from '@aio/discord-ui';
import type { TempVoicePreset, TempVoiceRoom } from '@aio/db';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, toMessageOptions } from '../../runtime/discord.js';
import type { BotModule } from '../../commands/types.js';
import { upsertPanelMessage } from '../../runtime/panels.js';

const DEFAULT_PANEL: MessageTemplate = {
  content: undefined,
  embeds: [{ title: 'Create a voice room', description: 'Pick how your room should work. You will be moved in automatically if you are already in a voice channel.\n\n**Public**: anyone can join\n**Private**: visible, only people you allow can join\n**Friends only**: hidden, only the members you pick\n**Custom**: name and size\n**Presets**: ready-made rooms', color: 0x6d5dfc, timestamp: false, fields: [] }],
  components: [],
};

function panelComponents() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('tv:create:public').setLabel('Public').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tv:create:private').setLabel('Private').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:friends').setLabel('Friends only').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:custom').setLabel('Custom').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tv:presets').setLabel('Presets').setStyle(ButtonStyle.Primary),
    ),
  ];
}

function controlComponents(channelId: string, room: Pick<TempVoiceRoom, 'locked' | 'hidden'>) {
  const id = (a: string) => `tv:ctl:${a}:${channelId}`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(id('rename')).setLabel('Rename').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('limit')).setLabel('Limit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('bitrate')).setLabel('Bitrate').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id(room.locked ? 'unlock' : 'lock')).setLabel(room.locked ? 'Unlock' : 'Lock').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id(room.hidden ? 'show' : 'hide')).setLabel(room.hidden ? 'Show' : 'Hide').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id('allow')).setPlaceholder('Allow members to join').setMinValues(0).setMaxValues(25)),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id('transfer')).setPlaceholder('Transfer ownership to…').setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(id('kick')).setPlaceholder('Kick a member from the room').setMinValues(1).setMaxValues(1)),
  ];
}

export async function publishTempVcPanel(ctx: BotContext): Promise<string> {
  const guild = ctx.requireGuild();
  const { settings } = await ctx.module('tempvc');
  if (!settings.panelChannelId) throw new Error('Choose a panel channel in the dashboard first.');
  const saved = settings.panelEmbedId ? await loadSavedEmbed(ctx.db, ctx.guildId, settings.panelEmbedId) : null;
  const rendered = renderMessageTemplate({ ...(saved?.template ?? DEFAULT_PANEL), components: [] }, { server: { id: guild.id, name: guild.name, memberCount: guild.memberCount } });
  const options = { ...toMessageOptions(rendered), components: panelComponents() };
  return upsertPanelMessage(ctx, { kind: 'tempvc', refId: 'creator', channelId: settings.panelChannelId, options });
}

async function createRoom(ctx: BotContext, member: GuildMember, params: { visibility: TempVisibility; allowed?: string[]; name?: string; limit?: number; preset?: TempVoicePreset }): Promise<string> {
  const guild = member.guild;
  const { settings } = await ctx.module('tempvc');
  const existing = await ctx.db.tempVoiceRoom.findFirst({ where: { guildId: guild.id, ownerId: member.id, deletedAt: null } });
  if (existing && guild.channels.cache.has(existing.channelId)) {
    if (member.voice.channelId) await member.voice.setChannel(existing.channelId).catch(() => undefined);
    return `You already have a room: <#${existing.channelId}>.`;
  }
  const categories = settings.categoryIds
    .map((id) => guild.channels.cache.get(id))
    .filter((c) => c?.type === ChannelType.GuildCategory)
    .map((c) => ({ id: c!.id, childCount: guild.channels.cache.filter((x) => x.parentId === c!.id).size }));
  const parent = pickCategory(categories);
  if (!parent) return 'No temporary room category is configured (or all are full). Ask staff to check the dashboard.';

  const visibility = params.preset?.visibility ?? params.visibility;
  const vctx = { user: { id: member.id, name: member.user.username, displayName: member.displayName }, server: { id: guild.id, name: guild.name } };
  const name = params.name ?? renderRoomName(params.preset?.nameTemplate ?? settings.defaultNameTemplate, vctx, params.preset?.emoji);
  const overwrites = planRoomOverwrites({ guildId: guild.id, ownerId: member.id, botId: guild.members.me!.id, visibility, locked: false, hidden: false, allowedUserIds: params.allowed ?? [] });
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent,
    userLimit: params.limit ?? params.preset?.userLimit ?? settings.defaultUserLimit,
    bitrate: params.preset?.bitrate ? clampBitrate(params.preset.bitrate, guild.premiumTier) : undefined,
    permissionOverwrites: overwrites.map((o) => ({ id: o.id, type: o.type === 0 ? OverwriteType.Role : OverwriteType.Member, allow: o.allow, deny: o.deny })),
    reason: `Temporary room for ${member.user.username}`,
  });
  const room = await ctx.db.tempVoiceRoom.create({
    data: { channelId: channel.id, guildId: guild.id, ownerId: member.id, categoryId: parent, visibility, allowedUserIds: params.allowed ?? [], presetId: params.preset?.id ?? null, graceUntil: new Date(Date.now() + settings.graceSeconds * 1000) },
  });
  const controls = await channel
    .send({ content: `<@${member.id}> this is your room. Manage it with the controls below. Music: use \`/play\` while in this room (its queue is separate and ends with the room).`, components: controlComponents(channel.id, room), allowedMentions: { users: [member.id] } })
    .catch(() => null);
  if (controls) await ctx.db.tempVoiceRoom.update({ where: { channelId: channel.id }, data: { controlMessageId: controls.id } });
  await ctx.audit({ actorId: member.id, module: 'tempvc', action: 'room.create', targetId: channel.id, meta: { visibility } });
  if (member.voice.channelId) {
    await member.voice.setChannel(channel).catch(() => undefined);
    return `Created <#${channel.id}> and moved you in.`;
  }
  return `Created <#${channel.id}>. Join it within ${settings.graceSeconds} seconds or it will be cleaned up.`;
}

async function applyRoomState(ctx: BotContext, channel: VoiceChannel, room: TempVoiceRoom): Promise<void> {
  const overwrites = planRoomOverwrites({ guildId: channel.guild.id, ownerId: room.ownerId, botId: channel.guild.members.me!.id, visibility: room.visibility, locked: room.locked, hidden: room.hidden, allowedUserIds: room.allowedUserIds });
  await channel.permissionOverwrites.set(overwrites.map((o) => ({ id: o.id, type: o.type === 0 ? OverwriteType.Role : OverwriteType.Member, allow: o.allow, deny: o.deny })));
  if (room.controlMessageId) {
    const msg = await channel.messages.fetch(room.controlMessageId).catch(() => null);
    await msg?.edit({ components: controlComponents(channel.id, room) }).catch(() => undefined);
  }
}

/** Delete an empty temp room and everything that belongs to it (including its music session). */
export async function deleteRoomIfEmpty(ctx: BotContext, channelId: string): Promise<void> {
  const room = await ctx.db.tempVoiceRoom.findFirst({ where: { channelId, deletedAt: null } });
  if (!room) return;
  const guild = ctx.guild();
  const channel = guild?.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (channel) {
    const humans = channel.members.filter((m) => !m.user.bot).size;
    const creatorJoined = room.graceUntil.getTime() <= room.createdAt.getTime();
    if (!shouldDeleteRoom({ humans, graceUntil: room.graceUntil, now: new Date(), creatorJoined })) return;
    await channel.delete('Temporary room is empty').catch((err) => ctx.reportError(err, 'tempvc.delete', { channelId }));
  }
  await ctx.db.tempVoiceRoom.update({ where: { channelId }, data: { deletedAt: new Date() } });
  await ctx.music?.service.handleTempRoomDeleted(ctx.guildId, channelId).catch((err) => ctx.reportError(err, 'tempvc.musicCleanup'));
  await ctx.audit({ actorType: 'bot', module: 'tempvc', action: 'room.delete', targetId: channelId });
}

export async function onTempVoiceState(ctx: BotContext, oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (newState.channelId && newState.member && !newState.member.user.bot) {
    const room = await ctx.db.tempVoiceRoom.findFirst({ where: { channelId: newState.channelId, deletedAt: null, ownerId: newState.member.id } });
    // Creator arrived: close the grace window (room now deletes as soon as it empties).
    if (room && room.graceUntil > room.createdAt) await ctx.db.tempVoiceRoom.update({ where: { channelId: room.channelId }, data: { graceUntil: room.createdAt } });
  }
  if (oldState.channelId && oldState.channelId !== newState.channelId) await deleteRoomIfEmpty(ctx, oldState.channelId);
}

/** Startup + periodic sweep: clean rooms whose channel vanished or that stayed empty past the grace window. */
export async function sweepTempRooms(ctx: BotContext): Promise<void> {
  const guild = ctx.guild();
  if (!guild) return;
  const rooms = await ctx.db.tempVoiceRoom.findMany({ where: { guildId: ctx.guildId, deletedAt: null } });
  for (const r of rooms) {
    if (!guild.channels.cache.has(r.channelId)) {
      await ctx.db.tempVoiceRoom.update({ where: { channelId: r.channelId }, data: { deletedAt: new Date() } });
      await ctx.music?.service.handleTempRoomDeleted(ctx.guildId, r.channelId).catch(() => undefined);
      continue;
    }
    await deleteRoomIfEmpty(ctx, r.channelId);
  }
}

async function roomForControl(ctx: BotContext, member: GuildMember, channelId: string, action: RoomControlAction, targetId?: string) {
  const room = await ctx.db.tempVoiceRoom.findFirst({ where: { channelId, deletedAt: null } });
  const channel = member.guild.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (!room || !channel) return { error: 'This room no longer exists.' } as const;
  const targetInRoom = targetId ? channel.members.has(targetId) : undefined;
  const auth = authorizeRoomControl({ actorId: member.id, ownerId: room.ownerId, actorIsStaff: await ctx.isStaff(member), action, targetId, targetInRoom });
  if (!auth.ok) return { error: auth.reason } as const;
  return { room, channel } as const;
}

function modal(id: string, title: string, label: string, placeholder: string, value?: string) {
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('value').setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(value ?? '')));
}

export const tempVcModule: BotModule = {
  commands: [
    {
      module: 'tempvc',
      data: new SlashCommandBuilder()
        .setName('room')
        .setDescription('Manage your temporary voice room')
        .addSubcommand((s) => s.setName('rename').setDescription('Rename your room').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('limit').setDescription('Set a user limit (0 = none)').addIntegerOption((o) => o.setName('users').setDescription('0–99').setRequired(true).setMinValue(0).setMaxValue(99)))
        .addSubcommand((s) => s.setName('lock').setDescription('Only allowed members can join'))
        .addSubcommand((s) => s.setName('unlock').setDescription('Unlock your room'))
        .addSubcommand((s) => s.setName('transfer').setDescription('Give ownership to someone in the room').addUserOption((o) => o.setName('member').setDescription('New owner').setRequired(true)))
        .toJSON(),
      async execute(i, ctx) {
        const vc = i.member.voice.channelId;
        if (!vc) return i.reply(ephemeral('Join your temporary room first.'));
        const sub = i.options.getSubcommand() as RoomControlAction;
        const target = i.options.getUser('member')?.id;
        const r = await roomForControl(ctx, i.member, vc, sub, target);
        if ('error' in r) return i.reply(ephemeral(r.error!));
        return i.reply(ephemeral(await runControl(ctx, i.member, r.room, r.channel, sub, { name: i.options.getString('name') ?? undefined, limit: i.options.getInteger('users') ?? undefined, targetId: target })));
      },
    },
  ],
  components: [
    {
      prefix: 'tv',
      module: 'tempvc',
      async handle(i, ctx, parts) {
        const [kind, a, b] = parts;
        if (kind === 'create' && i.isButton()) {
          await i.deferReply({ flags: 64 });
          return i.editReply({ content: await createRoom(ctx, i.member, { visibility: a as TempVisibility }), allowedMentions: { parse: [] } });
        }
        if (kind === 'friends' && i.isButton()) {
          return i.reply({ content: 'Pick the members who may see and join your room (Discord does not share friend lists, so choose them here):', components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId('tv:friendspick').setMinValues(1).setMaxValues(25).setPlaceholder('Choose members'))], flags: 64 });
        }
        if (kind === 'friendspick' && i.isUserSelectMenu()) {
          await i.deferUpdate();
          const msg = await createRoom(ctx, i.member, { visibility: 'friends', allowed: i.values.filter((v) => v !== i.user.id) });
          return i.editReply({ content: msg, components: [], allowedMentions: { parse: [] } });
        }
        if (kind === 'custom' && i.isButton()) {
          const m = new ModalBuilder()
            .setCustomId('tv:custommodal')
            .setTitle('Custom room')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Room name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(`${i.member.displayName}'s room`.slice(0, 100))),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('limit').setLabel('User limit (0 = none)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(false).setValue('0')),
              new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('visibility').setLabel('public, private or friends').setStyle(TextInputStyle.Short).setMaxLength(10).setRequired(false).setValue('public')),
            );
          return i.showModal(m);
        }
        if (kind === 'custommodal' && i.isModalSubmit()) {
          const name = i.fields.getTextInputValue('name').trim().slice(0, 100);
          const limit = Math.min(99, Math.max(0, Number(i.fields.getTextInputValue('limit') || '0') || 0));
          const vis = i.fields.getTextInputValue('visibility').trim().toLowerCase();
          const visibility: TempVisibility = vis === 'private' || vis === 'friends' ? vis : 'public';
          await i.deferReply({ flags: 64 });
          return i.editReply({ content: await createRoom(ctx, i.member, { visibility, name: name.replace(/@(everyone|here)/gi, '$1'), limit }), allowedMentions: { parse: [] } });
        }
        if (kind === 'presets' && i.isButton()) {
          const presets = await ctx.db.tempVoicePreset.findMany({ where: { guildId: ctx.guildId }, orderBy: { position: 'asc' }, take: 25 });
          if (!presets.length) return i.reply(ephemeral('No presets have been created yet.'));
          const menu = new StringSelectMenuBuilder()
            .setCustomId('tv:preset')
            .setPlaceholder('Choose a preset')
            .addOptions(presets.map((p) => ({ label: p.name, value: p.id, description: `${p.visibility}${p.userLimit ? ` · ${p.userLimit} max` : ''}`, emoji: p.emoji && [...p.emoji].length <= 2 ? p.emoji : undefined })));
          return i.reply({ components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], flags: 64 });
        }
        if (kind === 'preset' && i.isStringSelectMenu()) {
          const preset = await ctx.db.tempVoicePreset.findFirst({ where: { id: i.values[0], guildId: ctx.guildId } });
          if (!preset) return i.update({ content: 'That preset no longer exists.', components: [] });
          await i.deferUpdate();
          return i.editReply({ content: await createRoom(ctx, i.member, { visibility: preset.visibility, preset }), components: [], allowedMentions: { parse: [] } });
        }
        if (kind === 'ctl' && a && b) {
          const action = a as RoomControlAction;
          const channelId = b;
          if (i.isButton() && (action === 'rename' || action === 'limit' || action === 'bitrate')) {
            const r = await roomForControl(ctx, i.member, channelId, action);
            if ('error' in r) return i.reply(ephemeral(r.error!));
            const m =
              action === 'rename'
                ? modal(`tv:ctlm:rename:${channelId}`, 'Rename room', 'New name', 'Chill room', r.channel.name)
                : action === 'limit'
                  ? modal(`tv:ctlm:limit:${channelId}`, 'User limit', 'Max members (0 = none)', '0–99', String(r.channel.userLimit))
                  : modal(`tv:ctlm:bitrate:${channelId}`, 'Bitrate', 'Bitrate in kbps', '64', String(Math.round(r.channel.bitrate / 1000)));
            return i.showModal(m);
          }
          const targetId = i.isUserSelectMenu() ? i.values[0] : undefined;
          const r = await roomForControl(ctx, i.member, channelId, action, action === 'allow' ? undefined : targetId);
          if ('error' in r) return i.reply(ephemeral(r.error!));
          const allowed = action === 'allow' && i.isUserSelectMenu() ? i.values : undefined;
          return i.reply(ephemeral(await runControl(ctx, i.member, r.room, r.channel, action, { targetId, allowed })));
        }
        if (kind === 'ctlm' && a && b && i.isModalSubmit()) {
          const r = await roomForControl(ctx, i.member, b, a as RoomControlAction);
          if ('error' in r) return i.reply(ephemeral(r.error!));
          const value = (i as ModalSubmitInteraction).fields.getTextInputValue('value').trim();
          const opts = a === 'rename' ? { name: value } : a === 'limit' ? { limit: Number(value) } : { bitrateKbps: Number(value) };
          return i.reply(ephemeral(await runControl(ctx, i.member, r.room, r.channel, a as RoomControlAction, opts)));
        }
        return undefined;
      },
    },
  ],
};

async function runControl(
  ctx: BotContext,
  actor: GuildMember,
  room: TempVoiceRoom,
  channel: VoiceChannel,
  action: RoomControlAction,
  o: { name?: string; limit?: number; bitrateKbps?: number; targetId?: string; allowed?: string[] },
): Promise<string> {
  let message: string;
  switch (action) {
    case 'rename': {
      const name = (o.name ?? '').replace(/[\r\n]+/g, ' ').replace(/@(everyone|here)/gi, '$1').trim().slice(0, 100);
      if (!name) return 'Give the room a name.';
      await channel.setName(name);
      message = `Renamed to **${name}**. (Discord limits renames to twice per 10 minutes.)`;
      break;
    }
    case 'limit': {
      const n = Math.round(o.limit ?? NaN);
      if (!Number.isFinite(n) || n < 0 || n > 99) return 'The limit must be between 0 and 99.';
      await channel.setUserLimit(n);
      message = n ? `User limit set to ${n}.` : 'User limit removed.';
      break;
    }
    case 'bitrate': {
      const kbps = Math.round(o.bitrateKbps ?? NaN);
      if (!Number.isFinite(kbps)) return 'Enter a number in kbps, e.g. 64.';
      const bitrate = clampBitrate(kbps * 1000, channel.guild.premiumTier);
      await channel.setBitrate(bitrate);
      message = `Bitrate set to ${bitrate / 1000} kbps.`;
      break;
    }
    case 'lock':
    case 'unlock':
    case 'hide':
    case 'show': {
      const updated = await ctx.db.tempVoiceRoom.update({ where: { channelId: channel.id }, data: action === 'lock' || action === 'unlock' ? { locked: action === 'lock' } : { hidden: action === 'hide' } });
      await applyRoomState(ctx, channel, updated);
      message = { lock: 'Room locked. Only allowed members can join.', unlock: 'Room unlocked.', hide: 'Room hidden from others.', show: 'Room visible again.' }[action];
      break;
    }
    case 'allow': {
      const allowed = (o.allowed ?? []).filter((id) => id !== room.ownerId).slice(0, 25);
      const updated = await ctx.db.tempVoiceRoom.update({ where: { channelId: channel.id }, data: { allowedUserIds: allowed } });
      await applyRoomState(ctx, channel, updated);
      message = allowed.length ? `Allowed: ${allowed.map((id) => `<@${id}>`).join(', ')}` : 'Cleared the allowed members list.';
      break;
    }
    case 'disallow':
      return 'Use the allow list to change who can join.';
    case 'transfer': {
      const updated = await ctx.db.tempVoiceRoom.update({ where: { channelId: channel.id }, data: { ownerId: o.targetId! } });
      await applyRoomState(ctx, channel, updated);
      message = `Ownership transferred to <@${o.targetId}>.`;
      break;
    }
    case 'kick': {
      const target = channel.members.get(o.targetId!);
      await target?.voice.disconnect('Kicked from temporary room by owner');
      message = `Removed <@${o.targetId}> from the room. (This isn't a ban. Lock the room if you want to keep people out.)`;
      break;
    }
  }
  await ctx.audit({ actorId: actor.id, module: 'tempvc', action: `room.${action}`, targetId: channel.id, meta: { targetId: o.targetId } });
  return message;
}
