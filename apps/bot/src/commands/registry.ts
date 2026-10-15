import { SlashCommandBuilder, type GuildMember, type Interaction, type Message } from 'discord.js';
import { checkCommandRule, CommandCooldowns, DEFAULT_RULE, type CommandSettings } from '@aio/core/customize';
import { commandsForEnabledModules, getEnabledModules, getModule, MODULES, type ModuleId } from '@aio/core';
import type { BotContext } from '../runtime/context.js';
import { ephemeral } from '../runtime/discord.js';
import { cardReply } from '../runtime/cards.js';
import type { BotModule, ComponentHandler, SlashCommand } from './types.js';
import { hasDefaultPermissions, matchPrefix, runPrefixCommand, SlashOnlyError } from '../runtime/prefix.js';
import { musicCommands } from '../modules/music/commands.js';
import { musicComponents } from '../modules/music/components.js';
import { tempVcModule } from '../modules/tempvc/index.js';
import { embedsModule } from '../modules/embeds/index.js';
import { levelingModule } from '../modules/leveling/index.js';
import { moderationModule } from '../modules/moderation/index.js';
import { ticketsModule } from '../modules/tickets/index.js';
import { verificationModule } from '../modules/verification/index.js';
import { rolePanelsModule } from '../modules/rolepanels/index.js';
import { aiModule } from '../modules/ai/index.js';
import { giveawaysModule } from '../modules/giveaways/index.js';
import { pollsModule } from '../modules/polls/index.js';
import { remindersModule } from '../modules/reminders/index.js';
import { helpCommand, helpComponents } from './help.js';

const coreModule: BotModule = {
  components: [helpComponents(() => allCommands())],
  commands: [
    helpCommand(() => allCommands()),
    {
      module: 'core',
      data: new SlashCommandBuilder().setName('modules').setDescription('Show which modules are enabled').toJSON(),
      async execute(i, ctx) {
        const enabled = await getEnabledModules(ctx.db, ctx.guildId);
        return i.reply(ephemeral(MODULES.map((m) => `${m.name}: ${enabled.has(m.id) ? 'on' : 'off'}`).join('\n')));
      },
    },
  ],
};

export const ALL_MODULES: BotModule[] = [coreModule, musicCommands, musicComponents, tempVcModule, embedsModule, levelingModule, moderationModule, ticketsModule, verificationModule, rolePanelsModule, aiModule, giveawaysModule, pollsModule, remindersModule];

const commands = new Map<string, SlashCommand>();
const components = new Map<string, ComponentHandler>();
for (const m of ALL_MODULES) {
  for (const c of m.commands ?? []) {
    if (commands.has(c.data.name)) throw new Error(`Duplicate command /${c.data.name}`);
    commands.set(c.data.name, c);
  }
  for (const h of m.components ?? []) components.set(h.prefix, h);
}

export function allCommands(): SlashCommand[] {
  return [...commands.values()];
}

/** Every registered command must be owned by a known module so toggles work. */
export function validateCommandOwnership(): string[] {
  const problems: string[] = [];
  for (const c of commands.values()) {
    if (c.module === 'core') continue;
    const def = getModule(c.module);
    if (!def) problems.push(`/${c.data.name}: unknown module ${c.module}`);
    else if (!def.commands.includes(c.data.name)) problems.push(`/${c.data.name}: not listed in module ${c.module}`);
  }
  return problems;
}

/** Registers guild commands for enabled modules only (single guild → instant updates). */
export async function syncCommands(ctx: BotContext): Promise<{ count: number; names: string[] }> {
  const guild = ctx.requireGuild();
  const enabled = await getEnabledModules(ctx.db, ctx.guildId);
  const allowed = commandsForEnabledModules(enabled);
  const rules = (await ctx.commandSettings()).commands;
  // Commands turned off in the dashboard disappear from Discord's slash menu too.
  const list = allCommands().filter((c) => allowed.has(c.data.name) && rules[c.data.name]?.enabled !== false);
  await guild.commands.set(list.map((c) => c.data));
  const names = list.map((c) => c.data.name).sort();
  // Full definitions let the dashboard show usage and settings for every command.
  const catalog = allCommands().map((c) => ({ module: c.module, data: c.data }));
  const details = { commands: names, catalog, commandsSyncedAt: new Date().toISOString() };
  await ctx.db.botHeartbeat.upsert({
    where: { id: 'main' },
    create: { id: 'main', online: true, details: details as object },
    update: { details: details as object },
  });
  ctx.log.info({ count: names.length }, 'slash commands synced');
  return { count: names.length, names };
}

async function moduleEnabled(ctx: BotContext, id: ModuleId | 'core'): Promise<boolean> {
  return id === 'core' || (await ctx.module(id)).enabled;
}

const cooldowns = new CommandCooldowns();

/**
 * Everything a command must pass before it runs, for slash and prefix alike.
 * Returns the reply to send when it may not run.
 */
async function gate(ctx: BotContext, cmd: SlashCommand, member: GuildMember, channel: { id: string; parentId?: string | null }, settings: CommandSettings): Promise<string | null> {
  if (!(await moduleEnabled(ctx, cmd.module))) return ctx.reply('module.disabled');
  const name = cmd.data.name;
  const rule = settings.commands[name] ?? DEFAULT_RULE;
  const check = checkCommandRule(rule, name, { roleIds: [...member.roles.cache.keys()], isAdmin: ctx.isAdmin(member), channelId: channel.id, parentChannelId: channel.parentId });
  if (!check.ok) return ctx.reply(check.reply, check.vars);
  const wait = ctx.isAdmin(member) ? 0 : cooldowns.hit(name, member.id, rule.cooldownSeconds);
  if (wait > 0) return ctx.reply('command.cooldown', { command: name, seconds: wait });
  return null;
}

/**
 * Text-prefix entry point (`+warn @user being bad`). Returns true when the message was a
 * command, so other message handlers can skip it.
 */
export async function routePrefixMessage(ctx: BotContext, message: Message<true>): Promise<boolean> {
  if (message.author.bot || message.webhookId || !message.member || !message.content) return false;
  const settings = await ctx.commandSettings();
  if (!settings.prefixEnabled) return false;
  const match = matchPrefix(message.content, settings.prefix, commands, settings);
  if (!match) return false;
  const quiet = { allowedMentions: { parse: [] as never[], repliedUser: false } };
  const say = async (content: string) => {
    const m = await message.reply({ content, ...quiet }).catch(() => null);
    if (m) setTimeout(() => void m.delete().catch(() => undefined), 15_000).unref();
  };
  try {
    // Discord hides these commands from members without permission; prefix has to check itself.
    if (!hasDefaultPermissions(match.cmd, message.member)) {
      await say(await ctx.reply('command.noPermission', { command: match.name }));
      return true;
    }
    const blocked = await gate(ctx, match.cmd, message.member, message.channel as { id: string; parentId?: string | null }, settings);
    if (blocked) {
      await say(blocked);
      return true;
    }
    const rule = settings.commands[match.name] ?? DEFAULT_RULE;
    const r = await runPrefixCommand(ctx, message, match, settings.prefix, rule.deleteTrigger);
    if (!r.ok) await say(await ctx.reply('prefix.usage', { error: r.error, usage: r.usage }));
  } catch (err) {
    if (err instanceof SlashOnlyError) {
      await say(await ctx.reply('prefix.slashOnly', { command: match.name }));
      return true;
    }
    const id = ctx.reportError(err, 'prefix', { command: match.name });
    await say(await ctx.reply('error.generic', { errorId: id }));
  }
  return true;
}

/** Single entry point for all interactions, with a global error handler that returns an error ID. */
export async function routeInteraction(ctx: BotContext, interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.guildId !== ctx.guildId) {
    if (interaction.isRepliable()) await interaction.reply(ephemeral('This bot only works in its configured server.')).catch(() => undefined);
    return;
  }
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (!cmd) return void (await interaction.reply(ephemeral('Unknown command.')));
      const blocked = await gate(ctx, cmd, interaction.member, interaction.channel ?? { id: interaction.channelId }, await ctx.commandSettings());
      if (blocked) return void (await interaction.reply(await cardReply(ctx, { tone: 'warn', body: blocked })));
      await cmd.execute(interaction, ctx);
      return;
    }
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete && (await moduleEnabled(ctx, cmd.module))) await cmd.autocomplete(interaction, ctx);
      else await interaction.respond([]);
      return;
    }
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const parts = interaction.customId.split(':');
      const handler = components.get(parts[0]!);
      if (!handler) return;
      if (!(await moduleEnabled(ctx, handler.module))) return void (await interaction.reply(await cardReply(ctx, { tone: 'warn', body: await ctx.reply('module.disabled') })));
      await handler.handle(interaction, ctx, parts.slice(1));
    }
  } catch (err) {
    const id = ctx.reportError(err, 'interaction', { type: interaction.type, id: 'customId' in interaction ? interaction.customId : 'commandName' in interaction ? interaction.commandName : undefined });
    if (!interaction.isRepliable()) return;
    const failed = await cardReply(ctx, { tone: 'bad', body: await ctx.reply('error.generic', { errorId: id }) });
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: '', embeds: failed.embeds, components: [] }).catch(() => undefined);
    else await interaction.reply(failed).catch(() => undefined);
  }
}
