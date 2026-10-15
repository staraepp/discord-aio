/**
 * Safe template variable rendering. No eval, no arbitrary property access:
 * only an explicit allowlist of variable names is ever substituted.
 *
 * `{user}` renders a mention (may ping). Every other user-facing variable is
 * plain text with mass-mention sequences neutralised, so `{user.name}` never pings.
 */

export interface VariableContext {
  user?: { id: string; name: string; displayName?: string; avatarUrl?: string };
  server?: { id: string; name: string; memberCount?: number; iconUrl?: string };
  channel?: { id: string; name: string };
  message?: { content: string; link: string };
  staff?: { id: string; name: string };
  level?: { level: number; xp: number };
  ticket?: { number: number; type: string };
  now?: Date;
  /** Extra module-specific variables (already safe strings), e.g. `{track.title}`. */
  extra?: Record<string, string | number | undefined>;
}

export interface VariableDefinition {
  name: string;
  description: string;
  example: string;
  pings?: boolean;
}

export const VARIABLES: VariableDefinition[] = [
  { name: 'user', description: 'Mentions the user (pings)', example: '@Ada', pings: true },
  { name: 'user.id', description: 'User ID', example: '123456789012345678' },
  { name: 'user.name', description: 'Username (no ping)', example: 'ada' },
  { name: 'user.display_name', description: 'Server display name (no ping)', example: 'Ada L.' },
  { name: 'user.avatar', description: 'Avatar image URL', example: 'https://cdn.discordapp.com/embed/avatars/0.png' },
  { name: 'server.name', description: 'Server name', example: 'My Server' },
  { name: 'server.id', description: 'Server ID', example: '987654321098765432' },
  { name: 'server.member_count', description: 'Member count', example: '1,024' },
  { name: 'server.icon', description: 'Server icon URL', example: 'https://cdn.discordapp.com/embed/avatars/1.png' },
  { name: 'channel', description: 'Mentions the channel', example: '#general' },
  { name: 'channel.id', description: 'Channel ID', example: '111111111111111111' },
  { name: 'channel.name', description: 'Channel name', example: 'general' },
  { name: 'message.content', description: 'Triggering message content', example: 'hello there' },
  { name: 'message.link', description: 'Jump link to the triggering message', example: 'https://discord.com/channels/…' },
  { name: 'date', description: 'Current date (UTC)', example: '2026-09-26' },
  { name: 'staff', description: 'Mentions the staff member', example: '@Mod', pings: true },
  { name: 'staff.name', description: 'Staff username (no ping)', example: 'mod' },
  { name: 'level', description: 'Level (leveling)', example: '5' },
  { name: 'xp', description: 'Total XP (leveling)', example: '1200' },
];

const VARIABLE_PATTERN = /\{([a-z_]+(?:\.[a-z_]+)*)\}/gi;

/** Neutralise @everyone/@here and raw mention syntax in user-controlled text. */
export function neutraliseMentions(text: string): string {
  return text
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<(@[!&]?|#)(\d{17,20})>/g, '<​$1$2>');
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function resolve(name: string, ctx: VariableContext): string | undefined {
  const date = ctx.now ?? new Date();
  switch (name) {
    case 'user':
      return ctx.user ? `<@${ctx.user.id}>` : undefined;
    case 'user.id':
      return ctx.user?.id;
    case 'user.name':
      return ctx.user ? neutraliseMentions(ctx.user.name) : undefined;
    case 'user.display_name':
      return ctx.user ? neutraliseMentions(ctx.user.displayName ?? ctx.user.name) : undefined;
    case 'user.avatar':
      return ctx.user?.avatarUrl;
    case 'server.name':
      return ctx.server ? neutraliseMentions(ctx.server.name) : undefined;
    case 'server.id':
      return ctx.server?.id;
    case 'server.member_count':
      return ctx.server?.memberCount !== undefined ? formatNumber(ctx.server.memberCount) : undefined;
    case 'server.icon':
      return ctx.server?.iconUrl;
    case 'channel':
      return ctx.channel ? `<#${ctx.channel.id}>` : undefined;
    case 'channel.id':
      return ctx.channel?.id;
    case 'channel.name':
      return ctx.channel ? neutraliseMentions(ctx.channel.name) : undefined;
    case 'message.content':
      return ctx.message ? neutraliseMentions(ctx.message.content) : undefined;
    case 'message.link':
      return ctx.message?.link;
    case 'date':
      return date.toISOString().slice(0, 10);
    case 'staff':
      return ctx.staff ? `<@${ctx.staff.id}>` : undefined;
    case 'staff.name':
      return ctx.staff ? neutraliseMentions(ctx.staff.name) : undefined;
    case 'level':
      return ctx.level ? String(ctx.level.level) : undefined;
    case 'xp':
      return ctx.level ? String(ctx.level.xp) : undefined;
    default: {
      const extra = ctx.extra?.[name];
      return extra === undefined ? undefined : neutraliseMentions(String(extra));
    }
  }
}

export interface RenderResult {
  text: string;
  /** User IDs the rendered text is allowed to ping (from `{user}` / `{staff}` only). */
  mentionUserIds: string[];
  unknownVariables: string[];
}

export interface RenderOptions {
  /** Preview mode renders mentions as readable `@name` text instead of `<@id>`. */
  preview?: boolean;
  /** Leave unknown variables verbatim (default) or blank them out. */
  unknown?: 'keep' | 'blank';
}

export function renderTemplate(template: string, ctx: VariableContext, opts: RenderOptions = {}): RenderResult {
  const mentionUserIds = new Set<string>();
  const unknownVariables = new Set<string>();
  const text = template.replace(VARIABLE_PATTERN, (full, rawName: string) => {
    const name = rawName.toLowerCase();
    const value = resolve(name, ctx);
    if (value === undefined) {
      if (!VARIABLES.some((v) => v.name === name) && ctx.extra?.[name] === undefined) unknownVariables.add(name);
      return opts.unknown === 'blank' ? '' : full;
    }
    if (name === 'user' && ctx.user) {
      mentionUserIds.add(ctx.user.id);
      if (opts.preview) return `@${ctx.user.displayName ?? ctx.user.name}`;
    }
    if (name === 'staff' && ctx.staff) {
      mentionUserIds.add(ctx.staff.id);
      if (opts.preview) return `@${ctx.staff.name}`;
    }
    if (name === 'channel' && ctx.channel && opts.preview) return `#${ctx.channel.name}`;
    return value;
  });
  return { text, mentionUserIds: [...mentionUserIds], unknownVariables: [...unknownVariables] };
}

/** Sample context used by dashboard previews. */
export function sampleContext(overrides: Partial<VariableContext> = {}): VariableContext {
  return {
    user: { id: '123456789012345678', name: 'ada', displayName: 'Ada', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' },
    server: { id: '987654321098765432', name: 'My Server', memberCount: 1024, iconUrl: 'https://cdn.discordapp.com/embed/avatars/1.png' },
    channel: { id: '111111111111111111', name: 'general' },
    message: { content: 'hello there', link: 'https://discord.com/channels/987654321098765432/111111111111111111/222222222222222222' },
    staff: { id: '333333333333333333', name: 'mod' },
    level: { level: 5, xp: 1200 },
    now: new Date('2026-09-26T12:00:00Z'),
    ...overrides,
  };
}
