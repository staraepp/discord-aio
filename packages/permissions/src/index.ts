/**
 * Central permission logic shared by slash commands, components and the dashboard.
 * Pure functions over plain data so the same rules apply everywhere and are testable.
 */

export const Perm = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MoveMembers: 1n << 24n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ModerateMembers: 1n << 40n,
  SendPolls: 1n << 49n,
} as const;

export type PermissionName = keyof typeof Perm;

export function hasPermission(bits: bigint, perm: bigint): boolean {
  if ((bits & Perm.Administrator) === Perm.Administrator) return true;
  return (bits & perm) === perm;
}

export function missingPermissions(bits: bigint, required: PermissionName[]): PermissionName[] {
  return required.filter((name) => !hasPermission(bits, Perm[name]));
}

/** Roles configured per guild that define staff categories. There is no DJ role by design. */
export interface StaffRoleConfig {
  staffRoleIds: string[];
  musicStaffRoleIds: string[];
  ticketStaffRoleIds: string[];
}

export interface Actor {
  userId: string;
  roleIds: string[];
  /** Computed guild-level permission bits for the member. */
  permissions: bigint;
  isGuildOwner?: boolean;
}

export type Capability = 'owner' | 'admin' | 'staff' | 'musicStaff' | 'ticketStaff' | 'member';

export function isBotOwner(actor: Pick<Actor, 'userId'>, ownerId: string): boolean {
  return actor.userId === ownerId;
}

export function isAdmin(actor: Actor): boolean {
  return actor.isGuildOwner === true || hasPermission(actor.permissions, Perm.Administrator);
}

function hasAnyRole(actor: Actor, roleIds: string[]): boolean {
  return roleIds.some((r) => actor.roleIds.includes(r));
}

export function isStaff(actor: Actor, cfg: StaffRoleConfig): boolean {
  return (
    isAdmin(actor) ||
    hasAnyRole(actor, cfg.staffRoleIds) ||
    hasPermission(actor.permissions, Perm.ModerateMembers) ||
    hasPermission(actor.permissions, Perm.ManageGuild)
  );
}

/** Music staff bypass: admins, general staff, or explicit music-staff roles. Not a DJ role. */
export function isMusicStaff(actor: Actor, cfg: StaffRoleConfig): boolean {
  return isStaff(actor, cfg) || hasAnyRole(actor, cfg.musicStaffRoleIds);
}

export function isTicketStaff(actor: Actor, cfg: StaffRoleConfig): boolean {
  return isStaff(actor, cfg) || hasAnyRole(actor, cfg.ticketStaffRoleIds);
}

export function capabilities(actor: Actor, cfg: StaffRoleConfig, ownerId: string): Set<Capability> {
  const caps = new Set<Capability>(['member']);
  if (isBotOwner(actor, ownerId)) caps.add('owner');
  if (isAdmin(actor)) caps.add('admin');
  if (isStaff(actor, cfg)) caps.add('staff');
  if (isMusicStaff(actor, cfg)) caps.add('musicStaff');
  if (isTicketStaff(actor, cfg)) caps.add('ticketStaff');
  return caps;
}

export interface RoleInfo {
  id: string;
  position: number;
  managed?: boolean;
}

export type HierarchyResult = { ok: true } | { ok: false; reason: string };

/** Can the bot (and the acting member, if not owner) assign/remove `role`? */
export function checkRoleAssignable(params: {
  role: RoleInfo;
  botHighestPosition: number;
  botPermissions: bigint;
  actorHighestPosition?: number;
  actorIsOwner?: boolean;
  isEveryoneRole?: boolean;
}): HierarchyResult {
  const { role } = params;
  if (params.isEveryoneRole) return { ok: false, reason: 'The @everyone role cannot be assigned.' };
  if (role.managed) return { ok: false, reason: 'This role is managed by an integration and cannot be assigned.' };
  if (!hasPermission(params.botPermissions, Perm.ManageRoles))
    return { ok: false, reason: 'The bot is missing the Manage Roles permission.' };
  if (role.position >= params.botHighestPosition)
    return { ok: false, reason: "This role is above or equal to the bot's highest role. Move the bot's role higher." };
  if (params.actorHighestPosition !== undefined && !params.actorIsOwner && role.position >= params.actorHighestPosition)
    return { ok: false, reason: 'You cannot manage a role above or equal to your own highest role.' };
  return { ok: true };
}

/** Moderation hierarchy: actor and bot must both outrank the target; nobody can act on the guild owner. */
export function checkCanModerate(params: {
  actorId: string;
  targetId: string;
  actorHighestPosition: number;
  targetHighestPosition: number;
  botHighestPosition: number;
  actorIsOwner: boolean;
  targetIsOwner: boolean;
  botId: string;
}): HierarchyResult {
  if (params.targetId === params.actorId) return { ok: false, reason: 'You cannot moderate yourself.' };
  if (params.targetId === params.botId) return { ok: false, reason: 'The bot cannot moderate itself.' };
  if (params.targetIsOwner) return { ok: false, reason: 'The server owner cannot be moderated.' };
  if (!params.actorIsOwner && params.targetHighestPosition >= params.actorHighestPosition)
    return { ok: false, reason: "That member's highest role is equal to or above yours." };
  if (params.targetHighestPosition >= params.botHighestPosition)
    return { ok: false, reason: "That member's highest role is equal to or above the bot's highest role." };
  return { ok: true };
}

/** Compute base guild permissions from role data (Discord's algorithm, without channel overwrites). */
export function computeBasePermissions(params: {
  memberRoleIds: string[];
  guildId: string;
  ownerId: string;
  userId: string;
  roles: { id: string; permissions: string | bigint }[];
}): bigint {
  if (params.userId === params.ownerId) return ~0n & ((1n << 53n) - 1n);
  const everyone = params.roles.find((r) => r.id === params.guildId);
  let bits = everyone ? BigInt(everyone.permissions) : 0n;
  for (const role of params.roles) {
    if (params.memberRoleIds.includes(role.id)) bits |= BigInt(role.permissions);
  }
  if ((bits & Perm.Administrator) === Perm.Administrator) return ~0n & ((1n << 53n) - 1n);
  return bits;
}

export interface Overwrite {
  id: string;
  type: 0 | 1; // 0 = role, 1 = member
  allow: bigint;
  deny: bigint;
}

/** Apply channel overwrites to base permissions (Discord's documented order). */
export function computeChannelPermissions(params: {
  base: bigint;
  guildId: string;
  userId: string;
  memberRoleIds: string[];
  overwrites: Overwrite[];
}): bigint {
  if ((params.base & Perm.Administrator) === Perm.Administrator) return params.base;
  let bits = params.base;
  const everyone = params.overwrites.find((o) => o.type === 0 && o.id === params.guildId);
  if (everyone) bits = (bits & ~everyone.deny) | everyone.allow;
  let allow = 0n;
  let deny = 0n;
  for (const o of params.overwrites) {
    if (o.type === 0 && o.id !== params.guildId && params.memberRoleIds.includes(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  bits = (bits & ~deny) | allow;
  const member = params.overwrites.find((o) => o.type === 1 && o.id === params.userId);
  if (member) bits = (bits & ~member.deny) | member.allow;
  return bits;
}

export function canViewChannel(bits: bigint): boolean {
  return hasPermission(bits, Perm.ViewChannel);
}

export const SNOWFLAKE_RE = /^\d{17,20}$/;
export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE_RE.test(value);
}
