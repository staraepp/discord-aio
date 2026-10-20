import { MessageFlags, PermissionsBitField, type ChatInputCommandInteraction, type GuildMember, type Message, type MessageCreateOptions, type User } from 'discord.js';
import { mentionId, parsePrefixArgs, resolveCommandName, usageFor, OPT, type CmdSpec, type EntityResolver, type ParsedValue } from '@aio/core/customize';
import type { BotContext } from './context.js';
import type { SlashCommand } from '../commands/types.js';

/**
 * Runs slash commands from text messages (`+warn @user being bad`). The message is wrapped
 * in an object that behaves like a ChatInputCommandInteraction, so every command handler
 * works unchanged and keeps its own permission checks.
 */

/** Modules whose private replies may hold staff-only information: those go to DMs. */
const SENSITIVE_MODULES = new Set(['moderation', 'verification']);
const EPHEMERAL_TTL_MS = 20_000;

export class SlashOnlyError extends Error {}

const prefixInvocations = new WeakSet<object>();

/** True when a command handler is running from a `+command` message instead of a slash command. */
export function isPrefixInvocation(i: object): boolean {
  return prefixInvocations.has(i);
}

function resolverFor(message: Message<true>): EntityResolver {
  const guild = message.guild;
  const byName = <T extends { id: string }>(items: Iterable<T>, names: (x: T) => (string | null | undefined)[], token: string) => {
    const t = token.replace(/^[@#]/, '').toLowerCase();
    for (const x of items) if (names(x).some((n) => n?.toLowerCase() === t)) return x.id;
    return null;
  };
  return {
    user: (t) => mentionId(t, 'user') ?? byName(guild.members.cache.values(), (m) => [m.user.username, m.user.globalName, m.displayName], t),
    channel: (t) => mentionId(t, 'channel') ?? byName(guild.channels.cache.values(), (c) => [c.name], t),
    role: (t) => mentionId(t, 'role') ?? byName(guild.roles.cache.values(), (r) => [r.name], t),
  };
}

/** Maps typed text to the value an autocomplete option expects (e.g. a draft name to its id). */
async function resolveAutocomplete(cmd: SlashCommand, ctx: BotContext, message: Message<true>, sub: string | undefined, optionName: string, text: string): Promise<string> {
  if (!cmd.autocomplete || cmd.suggestionsOnly) return text;
  let choices: { name: string; value: string | number }[] = [];
  const fake = {
    commandName: cmd.data.name,
    user: message.author,
    member: message.member,
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    channelId: message.channelId,
    options: {
      getFocused: (full?: boolean) => (full ? { name: optionName, value: text } : text),
      getSubcommand: () => sub ?? null,
      getSubcommandGroup: () => null,
      getString: () => null,
    },
    respond: async (c: typeof choices) => {
      choices = c;
    },
  };
  await cmd.autocomplete(fake as never, ctx).catch(() => undefined);
  const t = text.toLowerCase();
  const hit = choices.find((c) => String(c.value).toLowerCase() === t || c.name.toLowerCase() === t) ?? choices.find((c) => c.name.toLowerCase().startsWith(t));
  return hit ? String(hit.value) : text;
}

function normalise(opts: unknown): MessageCreateOptions & { ephemeral: boolean } {
  const o = (typeof opts === 'string' ? { content: opts } : { ...(opts as Record<string, unknown>) }) as Record<string, unknown>;
  const flags = new MessageFlagsBitFieldLike(o.flags);
  const ephemeral = Boolean(o.ephemeral) || flags.has(MessageFlags.Ephemeral);
  delete o.ephemeral;
  delete o.fetchReply;
  delete o.withResponse;
  o.flags = flags.without(MessageFlags.Ephemeral);
  const allowed = (o.allowedMentions as Record<string, unknown> | undefined) ?? { parse: [] };
  o.allowedMentions = { ...allowed, repliedUser: false };
  return { ...(o as MessageCreateOptions), ephemeral };
}

/** Small helper so we don't depend on how the handler spelled its flags. */
class MessageFlagsBitFieldLike {
  private readonly bits: number;
  constructor(raw: unknown) {
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    this.bits = list.reduce<number>((acc, f) => acc | (typeof f === 'number' ? f : typeof f === 'bigint' ? Number(f) : 0), 0);
  }
  has(flag: number): boolean {
    return (this.bits & flag) === flag;
  }
  without(flag: number): number | undefined {
    const v = this.bits & ~flag;
    return v || undefined;
  }
}

interface ResolvedOptions {
  sub?: string;
  group?: string;
  values: Record<string, ParsedValue>;
  users: Map<string, User>;
  members: Map<string, GuildMember>;
}

function optionsShim(message: Message<true>, r: ResolvedOptions) {
  const get = <T>(name: string, required: boolean | undefined, pick: (v: ParsedValue) => T | null): T | null => {
    const v = r.values[name];
    const out = v ? pick(v) : null;
    if (out === null && required) throw new TypeError(`Missing required option "${name}"`);
    return out;
  };
  const guild = message.guild;
  return {
    getString: (n: string, req?: boolean) => get(n, req, (v) => String(v.value)),
    getInteger: (n: string, req?: boolean) => get(n, req, (v) => Number(v.value)),
    getNumber: (n: string, req?: boolean) => get(n, req, (v) => Number(v.value)),
    getBoolean: (n: string, req?: boolean) => get(n, req, (v) => Boolean(v.value)),
    getUser: (n: string, req?: boolean) => get(n, req, (v) => r.users.get(String(v.value)) ?? null),
    getMember: (n: string) => get(n, false, (v) => r.members.get(String(v.value)) ?? null),
    getChannel: (n: string, req?: boolean) => get(n, req, (v) => guild.channels.cache.get(String(v.value)) ?? null),
    getRole: (n: string, req?: boolean) => get(n, req, (v) => guild.roles.cache.get(String(v.value)) ?? null),
    getMentionable: (n: string, req?: boolean) => get(n, req, (v) => r.members.get(String(v.value)) ?? r.users.get(String(v.value)) ?? guild.roles.cache.get(String(v.value)) ?? null),
    getAttachment: () => null,
    getSubcommand: (req = true) => {
      if (!r.sub && req) throw new TypeError('No subcommand');
      return r.sub ?? null;
    },
    getSubcommandGroup: () => r.group ?? null,
    getFocused: () => '',
    get: (n: string) => (r.values[n] ? { name: n, type: r.values[n]!.type, value: r.values[n]!.value } : null),
  };
}

/** An interaction look-alike whose replies become normal messages (private ones DM'd or auto-deleted). */
function interactionFor(message: Message<true>, cmd: SlashCommand, r: ResolvedOptions, triggerDeleted: () => boolean) {
  let sent: Message | null = null;
  let deferredEphemeral = false;
  const sensitive = SENSITIVE_MODULES.has(cmd.module);

  const post = async (raw: unknown, forceEphemeral = false): Promise<Message> => {
    const { ephemeral, ...opts } = normalise(raw);
    const isPrivate = ephemeral || forceEphemeral;
    if (isPrivate && sensitive) {
      const dm = await message.author.send(opts).catch(() => null);
      if (dm) {
        const note = await message.channel.send({ content: `<@${message.author.id}> check your DMs 😛`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
        if (note) setTimeout(() => void note.delete().catch(() => undefined), 8_000).unref();
        return dm;
      }
    }
    const msg = triggerDeleted() ? await message.channel.send(opts) : await message.reply(opts);
    if (isPrivate) setTimeout(() => void msg.delete().catch(() => undefined), EPHEMERAL_TTL_MS).unref();
    return msg;
  };

  const shim = {
    commandName: cmd.data.name,
    commandType: 1,
    id: message.id,
    createdTimestamp: message.createdTimestamp,
    user: message.author,
    member: message.member,
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    channelId: message.channelId,
    client: message.client,
    locale: 'en-US',
    options: optionsShim(message, r),
    deferred: false,
    replied: false,
    ephemeral: false,
    isChatInputCommand: () => true,
    isCommand: () => true,
    isRepliable: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isMessageComponent: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    inGuild: () => true,
    inCachedGuild: () => true,
    async reply(opts: unknown) {
      shim.replied = true;
      sent = await post(opts);
      return sent;
    },
    async deferReply(opts?: { flags?: unknown; ephemeral?: boolean }) {
      shim.deferred = true;
      deferredEphemeral = normalise(opts ?? {}).ephemeral;
      await message.channel.sendTyping().catch(() => undefined);
    },
    async editReply(opts: unknown) {
      if (sent) {
        const { ephemeral: _e, flags: _f, ...rest } = normalise(opts);
        return sent.edit(rest as never);
      }
      shim.replied = true;
      sent = await post(opts, deferredEphemeral);
      return sent;
    },
    async followUp(opts: unknown) {
      return post(opts);
    },
    async fetchReply() {
      return sent;
    },
    async deleteReply() {
      await sent?.delete().catch(() => undefined);
    },
    async showModal() {
      throw new SlashOnlyError();
    },
  };
  prefixInvocations.add(shim);
  return shim;
}

export interface PrefixMatch {
  cmd: SlashCommand;
  name: string;
  args: string;
}

/** Finds the command a message calls, or null when it isn't a prefix command. */
export function matchPrefix(content: string, prefix: string, commands: ReadonlyMap<string, SlashCommand>, settings: Parameters<typeof resolveCommandName>[2]): PrefixMatch | null {
  if (!content.startsWith(prefix)) return null;
  const body = content.slice(prefix.length);
  const m = /^([^\s]+)([\s\S]*)$/.exec(body);
  if (!m) return null;
  const name = resolveCommandName(m[1]!, new Set(commands.keys()), settings);
  if (!name) return null;
  return { cmd: commands.get(name)!, name, args: m[2]!.trim() };
}

/** True when the member has the command's default permissions (Discord enforces these only for slash). */
export function hasDefaultPermissions(cmd: SlashCommand, member: GuildMember): boolean {
  const required = cmd.data.default_member_permissions;
  if (required === undefined || required === null) return true;
  if (required === '0') return member.permissions.has(PermissionsBitField.Flags.Administrator);
  return member.permissions.has(BigInt(required));
}

/**
 * Parses arguments and runs the command. Checks for module/rules/cooldowns happen in the
 * caller so slash and prefix share them.
 */
export async function runPrefixCommand(ctx: BotContext, message: Message<true>, match: PrefixMatch, prefix: string, deleteTrigger: boolean): Promise<{ ok: true } | { ok: false; error: string; usage: string }> {
  const spec = match.cmd.data as unknown as CmdSpec;
  const parsed = parsePrefixArgs(prefix, spec, match.args, resolverFor(message));
  if (!parsed.ok) return parsed;

  for (const o of parsed.options) {
    const v = parsed.values[o.name];
    if (v && o.type === OPT.STRING && o.autocomplete) v.value = await resolveAutocomplete(match.cmd, ctx, message, parsed.sub, o.name, String(v.value));
  }

  const users = new Map<string, User>();
  const members = new Map<string, GuildMember>();
  for (const v of Object.values(parsed.values)) {
    if (v.type !== OPT.USER && v.type !== OPT.MENTIONABLE) continue;
    const id = String(v.value);
    const member = message.guild.members.cache.get(id) ?? (await message.guild.members.fetch(id).catch(() => null));
    if (member) {
      members.set(id, member);
      users.set(id, member.user);
      continue;
    }
    const user = await message.client.users.fetch(id).catch(() => null);
    if (user) users.set(id, user);
    else if (v.type === OPT.USER) return { ok: false, error: `I couldn't find that user.`, usage: usageFor(prefix, spec) };
  }

  let deleted = false;
  if (deleteTrigger || match.cmd.deletePrefixTrigger) deleted = await message.delete().then(() => true, () => false);
  const shim = interactionFor(message, match.cmd, { sub: parsed.sub, group: parsed.group, values: parsed.values, users, members }, () => deleted);
  await match.cmd.execute(shim as unknown as ChatInputCommandInteraction<'cached'>, ctx);
  return { ok: true };
}
