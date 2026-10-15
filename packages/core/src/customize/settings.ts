import { z } from 'zod';
import type { DbOrTx } from '@aio/db';

/**
 * Dashboard-only customisation that slash commands can't express well:
 * the text prefix, per-command rules, the bot's look and its standard replies.
 * Stored as JSON on GuildConfig so one read gives the whole picture.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
export const commandNameRe = /^[a-z0-9_-]{1,32}$/;

export const commandRuleSchema = z.object({
  enabled: z.boolean().default(true),
  /** Extra prefix names, e.g. `p` for play. Slash names can't be aliased by Discord. */
  aliases: z.array(z.string().regex(commandNameRe, 'Aliases use lowercase letters, numbers, - or _')).max(5).default([]),
  /** Empty = everyone who already has permission. */
  allowedRoleIds: z.array(snowflake).max(25).default([]),
  /** Empty = every channel. */
  allowedChannelIds: z.array(snowflake).max(50).default([]),
  cooldownSeconds: z.number().int().min(0).max(3600).default(0),
  /** Prefix only: remove the `+command` message after it runs. */
  deleteTrigger: z.boolean().default(false),
});
export type CommandRule = z.infer<typeof commandRuleSchema>;

export const commandSettingsSchema = z
  .object({
    prefix: z
      .string()
      .min(1)
      .max(5)
      .regex(/^\S+$/, 'The prefix cannot contain spaces')
      .refine((p) => !/^[@#<]/.test(p), 'The prefix cannot start with @, # or <')
      .default('+'),
    prefixEnabled: z.boolean().default(true),
    commands: z.record(z.string().regex(commandNameRe), commandRuleSchema).default({}),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, string>();
    for (const [name, rule] of Object.entries(v.commands)) {
      for (const alias of rule.aliases) {
        const owner = seen.get(alias);
        if (owner && owner !== name) ctx.addIssue({ code: 'custom', path: ['commands', name, 'aliases'], message: `"${alias}" is already an alias of ${owner}` });
        seen.set(alias, name);
      }
    }
  });
export type CommandSettings = z.infer<typeof commandSettingsSchema>;

export const DEFAULT_RULE: CommandRule = commandRuleSchema.parse({});

/** Standard replies admins can reword. Variables in braces are filled in by the bot. */
export const REPLY_CATALOG = {
  'error.generic': { label: 'Something broke', vars: ['errorId'], text: 'Something went wrong. Please try again, or give staff this error ID: `{errorId}`' },
  'module.disabled': { label: 'Module turned off', vars: [], text: 'That module is currently disabled.' },
  'command.disabled': { label: 'Command turned off', vars: ['command'], text: '`{command}` is turned off right now.' },
  'command.noPermission': { label: 'Missing permission', vars: ['command'], text: "You don't have permission to use `{command}`." },
  'command.missingRole': { label: 'Missing role', vars: ['command', 'roles'], text: 'You need one of these roles to use `{command}`: {roles}' },
  'command.wrongChannel': { label: 'Wrong channel', vars: ['command', 'channels'], text: '`{command}` only works in {channels}.' },
  'command.cooldown': { label: 'Cooldown', vars: ['command', 'seconds'], text: 'Slow down a little 😣 You can use `{command}` again in {seconds}s.' },
  'prefix.usage': { label: 'Wrong prefix usage', vars: ['error', 'usage'], text: "That's not quite right 😔 {error}\nUsage: `{usage}`" },
  'prefix.slashOnly': { label: 'Needs the slash command', vars: ['command'], text: 'That part of `{command}` only works as a slash command.' },
} as const satisfies Record<string, { label: string; vars: readonly string[]; text: string }>;
export type ReplyKey = keyof typeof REPLY_CATALOG;

const statusLine = z.string().trim().min(1).max(60);

export const botProfileSchema = z.object({
  /** Embed accent for the bot's own replies (not saved embeds, which have their own color). */
  replyColor: z.number().int().min(0).max(0xffffff).nullable().default(null),
  /** Server nickname. Null leaves it alone. */
  nickname: z.string().trim().max(32).nullable().default(null),
  statuses: z
    .object({
      useBuiltIn: z.boolean().default(true),
      main: z.array(statusLine).max(50).default([]),
      music: z.array(statusLine).max(50).default([]),
      intervalMinutes: z.number().int().min(1).max(60).default(4),
    })
    .default({ useBuiltIn: true, main: [], music: [], intervalMinutes: 4 }),
  replies: z.partialRecord(z.enum(Object.keys(REPLY_CATALOG) as [ReplyKey, ...ReplyKey[]]), z.string().trim().min(1).max(500)).default({}),
});
export type BotProfile = z.infer<typeof botProfileSchema>;

export function renderReply(profile: Pick<BotProfile, 'replies'> | null | undefined, key: ReplyKey, vars: Record<string, string | number> = {}): string {
  const text = profile?.replies[key] ?? REPLY_CATALOG[key].text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export async function getCommandSettings(db: DbOrTx, guildId: string): Promise<CommandSettings> {
  const row = await db.guildConfig.findUnique({ where: { id: guildId }, select: { commandSettings: true } });
  const parsed = commandSettingsSchema.safeParse(row?.commandSettings ?? {});
  return parsed.success ? parsed.data : commandSettingsSchema.parse({});
}

export async function getBotProfile(db: DbOrTx, guildId: string): Promise<BotProfile> {
  const row = await db.guildConfig.findUnique({ where: { id: guildId }, select: { botProfile: true } });
  const parsed = botProfileSchema.safeParse(row?.botProfile ?? {});
  return parsed.success ? parsed.data : botProfileSchema.parse({});
}

/** Finds the command a prefix word points at: real names win over aliases. */
export function resolveCommandName(word: string, names: ReadonlySet<string>, settings: CommandSettings): string | null {
  const w = word.toLowerCase();
  if (names.has(w)) return w;
  for (const [name, rule] of Object.entries(settings.commands)) if (rule.aliases.includes(w) && names.has(name)) return name;
  return null;
}

export type RuleCheck =
  | { ok: true }
  | { ok: false; reply: ReplyKey; vars: Record<string, string> };

/** Channel/role/enabled rules shared by slash and prefix. Cooldowns are checked separately. */
export function checkCommandRule(rule: CommandRule, command: string, who: { roleIds: readonly string[]; isAdmin: boolean; channelId: string; parentChannelId?: string | null }): RuleCheck {
  if (!rule.enabled) return { ok: false, reply: 'command.disabled', vars: { command } };
  if (who.isAdmin) return { ok: true };
  if (rule.allowedChannelIds.length && !rule.allowedChannelIds.includes(who.channelId) && !(who.parentChannelId && rule.allowedChannelIds.includes(who.parentChannelId)))
    return { ok: false, reply: 'command.wrongChannel', vars: { command, channels: rule.allowedChannelIds.map((c) => `<#${c}>`).join(', ') } };
  if (rule.allowedRoleIds.length && !rule.allowedRoleIds.some((r) => who.roleIds.includes(r)))
    return { ok: false, reply: 'command.missingRole', vars: { command, roles: rule.allowedRoleIds.map((r) => `<@&${r}>`).join(', ') } };
  return { ok: true };
}

/** Per-user cooldowns kept in memory (they only need to survive a few minutes). */
export class CommandCooldowns {
  private readonly until = new Map<string, number>();
  /** Returns seconds left, or 0 and starts the cooldown. */
  hit(command: string, userId: string, seconds: number, now = Date.now()): number {
    if (seconds <= 0) return 0;
    const key = `${command}:${userId}`;
    const left = (this.until.get(key) ?? 0) - now;
    if (left > 0) return Math.ceil(left / 1000);
    this.until.set(key, now + seconds * 1000);
    if (this.until.size > 5000) for (const [k, t] of this.until) if (t < now) this.until.delete(k);
    return 0;
  }
}
