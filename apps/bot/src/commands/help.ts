import { PermissionFlagsBits, SlashCommandBuilder, type GuildMember, type InteractionReplyOptions } from 'discord.js';
import { MODULES, getEnabledModules, type ModuleId } from '@aio/core';
import { usageFor, type CmdSpec } from '@aio/core/customize';
import type { BotContext } from '../runtime/context.js';
import { card } from '../runtime/cards.js';
import { hasDefaultPermissions } from '../runtime/prefix.js';
import type { ComponentHandler, SlashCommand } from './types.js';

type Getter = () => SlashCommand[];

const SUB = 1;
const GROUP = 2;

/** `</play:123>` renders as a clickable command in Discord; plain `/play` until commands are synced. */
function mention(ctx: BotContext, name: string, sub?: string): string {
  const id = ctx.guild()?.commands.cache.find((c) => c.name === name)?.id;
  const full = sub ? `${name} ${sub}` : name;
  return id ? `</${full}:${id}>` : `\`/${full}\``;
}

/** One line per command (or per subcommand) the member can actually use. */
function commandLines(ctx: BotContext, cmds: SlashCommand[]): string[] {
  const lines: string[] = [];
  for (const c of cmds) {
    const subs = (c.data.options ?? []).filter((o) => o.type === SUB || o.type === GROUP);
    if (subs.length === 0) {
      lines.push(`${mention(ctx, c.data.name)} ${c.data.description}`);
      continue;
    }
    for (const s of subs) {
      if (s.type === SUB) lines.push(`${mention(ctx, c.data.name, s.name)} ${s.description}`);
      else for (const g of (s as { options?: { name: string; description: string }[] }).options ?? []) lines.push(`${mention(ctx, c.data.name, `${s.name} ${g.name}`)} ${g.description}`);
    }
  }
  return lines;
}

async function visibleCommands(ctx: BotContext, member: GuildMember, all: Getter): Promise<{ enabled: Set<ModuleId>; usable: SlashCommand[] }> {
  const enabled = await getEnabledModules(ctx.db, ctx.guildId);
  const rules = (await ctx.commandSettings()).commands;
  const usable = all().filter((c) => (c.module === 'core' || enabled.has(c.module)) && rules[c.data.name]?.enabled !== false && hasDefaultPermissions(c, member));
  return { enabled, usable };
}

function topicMenu(modules: { id: string; name: string; description: string }[], selected?: string) {
  return {
    type: 1 as const,
    components: [
      {
        type: 3 as const,
        custom_id: 'help:topic',
        placeholder: 'Pick a topic',
        options: modules.slice(0, 25).map((m) => ({ label: m.name, value: m.id, description: m.description.slice(0, 100), default: m.id === selected })),
      },
    ],
  };
}

function dashboardRow(ctx: BotContext, member: GuildMember) {
  // Only admins can sign in to the dashboard, so only they get the button.
  if (!ctx.env.PUBLIC_BASE_URL || !member.permissions.has(PermissionFlagsBits.Administrator)) return [];
  return [{ type: 1 as const, components: [{ type: 2 as const, style: 5 as const, label: 'Open the dashboard', url: `${ctx.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/dashboard` }] }];
}

/** The /help overview, or one module's commands when `topic` is set. */
export async function helpView(ctx: BotContext, member: GuildMember, all: Getter, topic?: string): Promise<InteractionReplyOptions> {
  const { enabled, usable } = await visibleCommands(ctx, member, all);
  const modules = MODULES.filter((m) => enabled.has(m.id) && usable.some((c) => c.module === m.id));
  const cs = await ctx.commandSettings();
  const prefixNote = cs.prefixEnabled ? `Every command also works with \`${cs.prefix}\`, like \`${cs.prefix}play ditto\`.` : '';
  const mod = topic ? modules.find((m) => m.id === topic) : undefined;

  const embed = mod
    ? await card(ctx, {
        eyebrow: 'Help',
        title: mod.name,
        body: `${mod.description}\n\n${commandLines(ctx, usable.filter((c) => c.module === mod.id)).join('\n')}`,
        notes: [prefixNote, 'Click a command to use it.'],
      })
    : await card(ctx, {
        eyebrow: 'Help',
        title: "Here's what I can do",
        body: [
          usable.some((c) => c.data.name === 'play') ? `Put on some music with ${mention(ctx, 'play')}, and see what's on with ${mention(ctx, 'nowplaying')}.` : '',
          `Pick a topic below to see its commands, or look one up with ${mention(ctx, 'help')} \`command\`.`,
          '',
          modules.map((m) => `**${m.name}**: ${m.description}`).join('\n'),
        ]
          .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
          .join('\n'),
        notes: [prefixNote],
      });
  return { embeds: [embed], components: [topicMenu(modules, mod?.id), ...dashboardRow(ctx, member)], flags: 64, allowedMentions: { parse: [] } };
}

/** Details for one command: what it does, its options and the prefix form. */
async function commandView(ctx: BotContext, member: GuildMember, all: Getter, name: string): Promise<InteractionReplyOptions> {
  const { usable } = await visibleCommands(ctx, member, all);
  const cmd = usable.find((c) => c.data.name === name.replace(/^\//, '').toLowerCase());
  if (!cmd) return { embeds: [await card(ctx, { tone: 'warn', body: `There's no command called \`${name.slice(0, 50)}\` that you can use here. Try ${mention(ctx, 'help')} to see them all.` })], flags: 64 };
  const opts = (cmd.data.options ?? []) as { type: number; name: string; description: string; required?: boolean }[];
  const valueOpts = opts.filter((o) => o.type !== SUB && o.type !== GROUP);
  const cs = await ctx.commandSettings();
  return {
    embeds: [
      await card(ctx, {
        eyebrow: 'Command',
        title: `/${cmd.data.name}`,
        body: [
          cmd.data.description,
          commandLines(ctx, [cmd]).length > 1 ? `\n${commandLines(ctx, [cmd]).join('\n')}` : '',
          valueOpts.length ? `\n${valueOpts.map((o) => `\`${o.name}\`${o.required ? '' : ' (optional)'}: ${o.description}`).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        notes: [cs.prefixEnabled ? `Prefix: \`${usageFor(cs.prefix, cmd.data as unknown as CmdSpec)}\`` : ''],
      }),
    ],
    flags: 64,
    allowedMentions: { parse: [] },
  };
}

export function helpCommand(all: Getter): SlashCommand {
  return {
    module: 'core',
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('What this bot can do')
      .addStringOption((o) => o.setName('command').setDescription('Look up one command').setAutocomplete(true).setMaxLength(32))
      .toJSON(),
    async autocomplete(i, ctx) {
      const typed = i.options.getFocused().toLowerCase().replace(/^\//, '');
      const { usable } = await visibleCommands(ctx, i.member, all);
      const choices = usable
        .filter((c) => c.data.name.includes(typed))
        .sort((a, b) => Number(!a.data.name.startsWith(typed)) - Number(!b.data.name.startsWith(typed)) || a.data.name.localeCompare(b.data.name))
        .slice(0, 25)
        .map((c) => ({ name: `/${c.data.name}: ${c.data.description}`.slice(0, 100), value: c.data.name }));
      return i.respond(choices).catch(() => undefined);
    },
    async execute(i, ctx) {
      const name = i.options.getString('command');
      return i.reply(name ? await commandView(ctx, i.member, all, name) : await helpView(ctx, i.member, all));
    },
  };
}

/** The topic menu under /help: `help:topic`. */
export function helpComponents(all: Getter): ComponentHandler {
  return {
    prefix: 'help',
    module: 'core',
    async handle(i, ctx) {
      if (!i.isStringSelectMenu()) return;
      const { flags: _flags, ...view } = (await helpView(ctx, i.member, all, i.values[0])) as InteractionReplyOptions & { flags?: unknown };
      return i.update(view as never);
    },
  };
}
