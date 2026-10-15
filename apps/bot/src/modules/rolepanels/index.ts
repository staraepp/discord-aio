import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type GuildMember, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';
import { applyOptionClick, applySelection, type PanelRules } from '@aio/core/rolepanels';
import { messageTemplateSchema, renderMessageTemplate } from '@aio/discord-ui';
import { checkRoleAssignable } from '@aio/permissions';
import type { RolePanel, RolePanelOption } from '@aio/db';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, textChannel, toMessageOptions } from '../../runtime/discord.js';
import { upsertPanelMessage } from '../../runtime/panels.js';
import type { BotModule } from '../../commands/types.js';

type PanelWithOptions = RolePanel & { options: RolePanelOption[] };
const STYLE: Record<string, ButtonStyle> = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

function rules(p: RolePanel): PanelRules {
  return { exclusive: p.exclusive, maxRoles: p.maxRoles, requiredRoleIds: p.requiredRoleIds, blockedRoleIds: p.blockedRoleIds };
}

/** Validates hierarchy for every option before publishing (blueprint: validate before applying). */
export function validatePanelRoles(member: GuildMember, panel: PanelWithOptions): string[] {
  const guild = member.guild;
  const me = guild.members.me!;
  return panel.options.flatMap((o) => {
    const role = guild.roles.cache.get(o.roleId);
    if (!role) return [`${o.label}: role no longer exists`];
    const r = checkRoleAssignable({ role: { id: role.id, position: role.position, managed: role.managed }, botHighestPosition: me.roles.highest.position, botPermissions: me.permissions.bitfield, isEveryoneRole: role.id === guild.id });
    return r.ok ? [] : [`${o.label}: ${r.reason}`];
  });
}

export async function publishRolePanel(ctx: BotContext, panelId: string, channelId: string): Promise<string> {
  const guild = ctx.requireGuild();
  const panel = await ctx.db.rolePanel.findFirst({ where: { id: panelId, guildId: ctx.guildId }, include: { options: { orderBy: { position: 'asc' } } } });
  if (!panel) throw new Error('Role panel not found');
  const problems = validatePanelRoles(guild.members.me!, panel);
  if (problems.length) throw new Error(`Fix these roles first: ${problems.join('; ')}`);
  const rendered = renderMessageTemplate({ ...messageTemplateSchema.parse(panel.template), components: [] }, { server: { id: guild.id, name: guild.name, memberCount: guild.memberCount } });
  let components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (panel.kind === 'button') {
    for (let r = 0; r < Math.ceil(panel.options.length / 5); r++) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          panel.options.slice(r * 5, r * 5 + 5).map((o) => {
            const b = new ButtonBuilder().setCustomId(`rp:${panel.id}:${o.id}`).setLabel(o.label).setStyle(STYLE[o.style] ?? ButtonStyle.Secondary);
            if (o.emoji) b.setEmoji(o.emoji);
            return b;
          }),
        ),
      );
    }
  } else if (panel.kind === 'select') {
    const max = panel.exclusive ? 1 : Math.min(panel.maxRoles ?? panel.options.length, panel.options.length);
    components = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`rp:${panel.id}`)
          .setPlaceholder(panel.placeholder ?? 'Choose your roles')
          .setMinValues(0)
          .setMaxValues(max)
          .addOptions(panel.options.map((o) => ({ label: o.label, value: o.id, description: o.description ?? undefined, emoji: o.emoji ?? undefined }))),
      ),
    ];
  }
  const messageId = await upsertPanelMessage(ctx, { kind: 'rolepanel', refId: panel.id, channelId, options: { ...toMessageOptions(rendered), components: components.slice(0, 5) } });
  if (panel.kind === 'reaction') {
    const msg = await textChannel(guild, channelId)?.messages.fetch(messageId);
    for (const o of panel.options) if (o.emoji) await msg?.react(o.emoji).catch(() => undefined);
  }
  return messageId;
}

async function apply(ctx: BotContext, member: GuildMember, panel: PanelWithOptions, change: { add: string[]; remove: string[] }): Promise<string | null> {
  const problems = validatePanelRoles(member, { ...panel, options: panel.options.filter((o) => change.add.includes(o.roleId) || change.remove.includes(o.roleId)) });
  if (problems.length) return `I can't manage some of these roles: ${problems.join('; ')}`;
  if (change.add.length) await member.roles.add(change.add, `Role panel: ${panel.name}`);
  if (change.remove.length) await member.roles.remove(change.remove, `Role panel: ${panel.name}`);
  if (panel.logChannelId && (change.add.length || change.remove.length)) {
    await textChannel(member.guild, panel.logChannelId)
      ?.send({ content: `<@${member.id}> used **${panel.name}**: ${change.add.map((r) => `+<@&${r}>`).join(' ')} ${change.remove.map((r) => `−<@&${r}>`).join(' ')}`, allowedMentions: { parse: [] } })
      .catch(() => undefined);
  }
  return null;
}

async function loadPanel(ctx: BotContext, id: string): Promise<PanelWithOptions | null> {
  return ctx.db.rolePanel.findFirst({ where: { id, guildId: ctx.guildId }, include: { options: { orderBy: { position: 'asc' } } } });
}

export async function handleRoleReaction(ctx: BotContext, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, removed: boolean): Promise<void> {
  if (user.bot) return;
  if (!(await ctx.module('rolepanels')).enabled) return;
  const panelRow = await ctx.db.persistentPanel.findFirst({ where: { kind: 'rolepanel', messageId: reaction.message.id } });
  if (!panelRow) return;
  const panel = await loadPanel(ctx, panelRow.refId);
  if (!panel || panel.kind !== 'reaction') return;
  const emojiKey = reaction.emoji.id ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const option = panel.options.find((o) => o.emoji === emojiKey || o.emoji === reaction.emoji.name);
  if (!option) return;
  const member = await ctx.requireGuild().members.fetch(user.id).catch(() => null);
  if (!member) return;
  const change = applyOptionClick({ rules: rules(panel), options: panel.options, clicked: option, memberRoleIds: [...member.roles.cache.keys()], reactionRemoved: removed });
  if (!change.ok) {
    if (!removed) await reaction.users.remove(user.id).catch(() => undefined);
    return;
  }
  await apply(ctx, member, panel, change);
}

export const rolePanelsModule: BotModule = {
  components: [
    {
      prefix: 'rp',
      module: 'rolepanels',
      async handle(i, ctx, [panelId, optionId]) {
        if (!panelId || !i.isMessageComponent()) return;
        const panel = await loadPanel(ctx, panelId);
        if (!panel) return i.reply(ephemeral('This role panel no longer exists.'));
        const memberRoleIds = [...i.member.roles.cache.keys()];
        let change;
        if (i.isStringSelectMenu()) {
          const selected = panel.options.filter((o) => i.values.includes(o.id)).map((o) => o.roleId);
          change = applySelection({ rules: rules(panel), options: panel.options, selectedRoleIds: selected, memberRoleIds });
        } else {
          const option = panel.options.find((o) => o.id === optionId);
          if (!option) return i.reply(ephemeral('This option no longer exists.'));
          change = applyOptionClick({ rules: rules(panel), options: panel.options, clicked: option, memberRoleIds });
        }
        if (!change.ok) return i.reply(ephemeral(change.message));
        const problem = await apply(ctx, i.member, panel, change);
        return i.reply(ephemeral(problem ?? change.message));
      },
    },
  ],
};
