import 'server-only';
import { looksLikeDiscordToken } from '@aio/config';
import { computeBasePermissions, Perm } from '@aio/permissions';
import { env, guildId } from './server';

/**
 * Server-side Discord REST access using the bot token (never sent to the browser).
 * Used for admin verification and channel/role pickers. All Discord mutations
 * happen in the bot process via the DashboardCommand queue.
 */

const API = 'https://discord.com/api/v10';

export class DiscordUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordUnavailableError';
  }
}

async function botGet<T>(path: string): Promise<T> {
  const token = env().TOKEN;
  if (!looksLikeDiscordToken(token)) throw new DiscordUnavailableError('The bot TOKEN is not configured.');
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw new DiscordUnavailableError('Not found');
  if (!res.ok) throw new DiscordUnavailableError(`Discord API returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface GuildRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  managed: boolean;
}

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
  permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
}

interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  roles: GuildRole[];
  approximate_member_count?: number;
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateGuildCache(): void {
  cache.clear();
}

export async function getGuild(): Promise<GuildInfo> {
  return cached('guild', 30_000, () => botGet<GuildInfo>(`/guilds/${guildId()}?with_counts=true`));
}

export async function getChannels(): Promise<GuildChannel[]> {
  return cached('channels', 30_000, () => botGet<GuildChannel[]>(`/guilds/${guildId()}/channels`));
}

export async function getMember(userId: string): Promise<{ roles: string[]; user?: { username: string; avatar: string | null } } | null> {
  return cached(`member:${userId}`, 60_000, async () => {
    try {
      return await botGet<{ roles: string[]; user?: { username: string; avatar: string | null } }>(`/guilds/${guildId()}/members/${userId}`);
    } catch (err) {
      if (err instanceof DiscordUnavailableError && err.message === 'Not found') return null;
      throw err;
    }
  });
}

export interface MemberResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bot: boolean;
}

type RawMember = { nick: string | null; user: { id: string; username: string; global_name: string | null; avatar: string | null; bot?: boolean } };

function toMemberResult({ nick, user }: RawMember): MemberResult {
  return {
    id: user.id,
    username: user.username,
    displayName: nick ?? user.global_name ?? user.username,
    avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`,
    bot: Boolean(user.bot),
  };
}

/** Members whose username or nickname starts with `query` (Discord's own member search). */
export async function searchMembers(query: string): Promise<MemberResult[]> {
  const rows = await botGet<RawMember[]>(`/guilds/${guildId()}/members/search?query=${encodeURIComponent(query)}&limit=10`);
  return rows.map(toMemberResult);
}

/** One member by user ID, or null when they aren't in the server. */
export async function findMember(userId: string): Promise<MemberResult | null> {
  try {
    return toMemberResult(await botGet<RawMember>(`/guilds/${guildId()}/members/${userId}`));
  } catch (err) {
    if (err instanceof DiscordUnavailableError && err.message === 'Not found') return null;
    throw err;
  }
}

/** Server-side ADMINISTRATOR check in the one configured guild. */
export async function isGuildAdmin(userId: string): Promise<boolean> {
  const [guild, member] = await Promise.all([getGuild(), getMember(userId)]);
  if (!member) return false;
  if (guild.owner_id === userId) return true;
  const bits = computeBasePermissions({ memberRoleIds: member.roles, guildId: guild.id, ownerId: guild.owner_id, userId, roles: guild.roles });
  return (bits & Perm.Administrator) === Perm.Administrator;
}

export const CHANNEL_TYPES = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 } as const;

export interface GuildResources {
  guild: { id: string; name: string; iconUrl: string | null; memberCount: number | null };
  roles: { id: string; name: string; color: number; position: number; managed: boolean; isEveryone: boolean }[];
  channels: { id: string; name: string; type: number; parentId: string | null; position: number; everyoneCanView: boolean }[];
}

export async function getResources(): Promise<GuildResources> {
  const [guild, channels] = await Promise.all([getGuild(), getChannels()]);
  const everyone = guild.roles.find((r) => r.id === guild.id);
  const everyoneBase = everyone ? BigInt(everyone.permissions) : 0n;
  return {
    guild: { id: guild.id, name: guild.name, iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` : null, memberCount: guild.approximate_member_count ?? null },
    roles: guild.roles
      .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed, isEveryone: r.id === guild.id }))
      .sort((a, b) => b.position - a.position),
    channels: channels
      .map((c) => {
        const ow = c.permission_overwrites?.find((o) => o.id === guild.id);
        let bits = everyoneBase;
        if (ow) bits = (bits & ~BigInt(ow.deny)) | BigInt(ow.allow);
        return { id: c.id, name: c.name, type: c.type, parentId: c.parent_id, position: c.position, everyoneCanView: (bits & Perm.ViewChannel) === Perm.ViewChannel || (bits & Perm.Administrator) === Perm.Administrator };
      })
      .sort((a, b) => a.position - b.position),
  };
}

/** Rejects IDs that don't belong to the configured guild (never trust client-provided IDs). */
export async function assertGuildIds(ids: { channels?: (string | null | undefined)[]; roles?: (string | null | undefined)[]; channelTypes?: number[] }): Promise<string | null> {
  let res: GuildResources;
  try {
    res = await getResources();
  } catch {
    // Without Discord access we cannot validate: accept only well-formed snowflakes.
    const all = [...(ids.channels ?? []), ...(ids.roles ?? [])].filter(Boolean) as string[];
    return all.every((id) => /^\d{17,20}$/.test(id)) ? null : 'Invalid Discord ID';
  }
  for (const id of (ids.channels ?? []).filter(Boolean) as string[]) {
    const ch = res.channels.find((c) => c.id === id);
    if (!ch) return `Channel ${id} is not in this server`;
    if (ids.channelTypes && !ids.channelTypes.includes(ch.type)) return `#${ch.name} is not the right kind of channel`;
  }
  for (const id of (ids.roles ?? []).filter(Boolean) as string[]) {
    if (!res.roles.some((r) => r.id === id)) return `Role ${id} is not in this server`;
  }
  return null;
}

// ── OAuth ──

export async function exchangeOAuthCode(code: string): Promise<{ id: string; username: string; avatar: string | null }> {
  const e = env();
  if (!e.DISCORD_CLIENT_ID || !e.DISCORD_CLIENT_SECRET) throw new DiscordUnavailableError('Discord OAuth is not configured');
  const redirect = e.DISCORD_REDIRECT_URI ?? `${e.PUBLIC_BASE_URL}/api/auth/callback/discord`;
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.DISCORD_CLIENT_ID, client_secret: e.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirect }),
    signal: AbortSignal.timeout(8000),
  });
  if (!tokenRes.ok) throw new DiscordUnavailableError(`OAuth token exchange failed (HTTP ${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  try {
    const me = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) });
    if (!me.ok) throw new DiscordUnavailableError('Could not read your Discord profile');
    const u = (await me.json()) as { id: string; username: string; avatar: string | null };
    return { id: u.id, username: u.username, avatar: u.avatar };
  } finally {
    // The OAuth token is not stored; revoke it immediately after identifying the user.
    void fetch(`${API}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: e.DISCORD_CLIENT_ID, client_secret: e.DISCORD_CLIENT_SECRET, token: access_token, token_type_hint: 'access_token' }),
    }).catch(() => undefined);
  }
}

export function oauthAuthorizeUrl(state: string): string {
  const e = env();
  const redirect = e.DISCORD_REDIRECT_URI ?? `${e.PUBLIC_BASE_URL}/api/auth/callback/discord`;
  const q = new URLSearchParams({ client_id: e.DISCORD_CLIENT_ID ?? '', redirect_uri: redirect, response_type: 'code', scope: 'identify', state, prompt: 'none' });
  return `https://discord.com/oauth2/authorize?${q}`;
}

// ── Role hierarchy ──

async function botUserId(): Promise<string> {
  return cached('bot-user', 3600_000, async () => (await botGet<{ id: string }>('/users/@me')).id);
}

/**
 * Returns a human-readable problem if the bot could not manage one of these roles
 * (managed/integration role, @everyone, or at/above the bot's highest role).
 * Returns null when Discord cannot be reached; the bot re-checks at runtime.
 */
export async function roleHierarchyProblem(roleIds: (string | null | undefined)[]): Promise<string | null> {
  const ids = roleIds.filter(Boolean) as string[];
  if (!ids.length) return null;
  let guild: GuildInfo;
  let botRoles: string[];
  try {
    guild = await getGuild();
    const member = await getMember(await botUserId());
    if (!member) return 'The bot is not a member of the configured server.';
    botRoles = member.roles;
  } catch {
    return null;
  }
  const top = Math.max(0, ...guild.roles.filter((r) => botRoles.includes(r.id)).map((r) => r.position));
  for (const id of ids) {
    const role = guild.roles.find((r) => r.id === id);
    if (!role) return `Role ${id} is not in this server.`;
    if (role.id === guild.id) return 'The @everyone role cannot be assigned.';
    if (role.managed) return `@${role.name} is managed by an integration and cannot be assigned.`;
    if (role.position >= top) return `@${role.name} is above (or equal to) the bot's highest role. Move the bot's role higher in Server Settings → Roles.`;
  }
  return null;
}
