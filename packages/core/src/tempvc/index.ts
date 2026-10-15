import { z } from 'zod';
import { Perm } from '@aio/permissions';
import { renderTemplate, type VariableContext } from '@aio/variables';

/** Temporary voice channel lifecycle rules and permission-overwrite planning. */

export type TempVisibility = 'public' | 'private' | 'friends';

export interface RoomLifecycleInput {
  humans: number;
  graceUntil: Date;
  now: Date;
  /** True once the creator has actually joined the room (moved in). */
  creatorJoined: boolean;
}

/**
 * Delete immediately when the last human leaves, but never before the creator
 * had a chance to be moved in: a fresh room is protected until either the
 * creator joined or the grace window elapsed. Bots are not counted as humans.
 */
export function shouldDeleteRoom(input: RoomLifecycleInput): boolean {
  if (input.humans > 0) return false;
  if (!input.creatorJoined && input.now < input.graceUntil) return false;
  return true;
}

export function countHumans(members: { bot: boolean }[]): number {
  return members.filter((m) => !m.bot).length;
}

/** Discord voice channel names: 1–100 chars. Strip newlines and mass mentions. */
export function renderRoomName(template: string, ctx: VariableContext, emoji?: string | null): string {
  const withEmoji = template.replace(/\{emoji\}/g, emoji ?? '');
  const rendered = renderTemplate(withEmoji, ctx, { preview: true, unknown: 'blank' }).text;
  const clean = rendered.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return (clean || 'Voice room').slice(0, 100);
}

export const MAX_BITRATE_BY_TIER = [96_000, 128_000, 256_000, 384_000] as const;

export function clampBitrate(requested: number, premiumTier: number): number {
  const max = MAX_BITRATE_BY_TIER[Math.min(3, Math.max(0, premiumTier))]!;
  return Math.min(max, Math.max(8_000, Math.round(requested)));
}

export interface PlannedOverwrite {
  id: string;
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

/**
 * Overwrites for a temp room.
 * - public: everyone can see/join
 * - private: everyone can see, only owner + allowed users can connect
 * - friends: only owner + allowed users can see and connect
 * `locked` removes Connect for everyone else; `hidden` removes View.
 * The bot always keeps access; no permanent per-user bans are ever written.
 */
export function planRoomOverwrites(params: {
  guildId: string;
  ownerId: string;
  botId: string;
  visibility: TempVisibility;
  locked: boolean;
  hidden: boolean;
  allowedUserIds: string[];
}): PlannedOverwrite[] {
  const view = Perm.ViewChannel;
  const connect = Perm.Connect;
  const everyone: PlannedOverwrite = { id: params.guildId, type: 0, allow: 0n, deny: 0n };
  const restrictConnect = params.locked || params.visibility === 'private' || params.visibility === 'friends';
  const restrictView = params.hidden || params.visibility === 'friends';
  if (restrictConnect) everyone.deny |= connect;
  if (restrictView) everyone.deny |= view;

  const ownerAllow = view | connect | Perm.Speak | Perm.MoveMembers | Perm.SendMessages | Perm.ReadMessageHistory;
  const out: PlannedOverwrite[] = [
    everyone,
    { id: params.botId, type: 1, allow: view | connect | Perm.Speak | Perm.ManageChannels | Perm.MoveMembers | Perm.SendMessages | Perm.EmbedLinks, deny: 0n },
    { id: params.ownerId, type: 1, allow: ownerAllow, deny: 0n },
  ];
  for (const id of new Set(params.allowedUserIds)) {
    if (id === params.ownerId || id === params.botId) continue;
    out.push({ id, type: 1, allow: view | connect | Perm.Speak | Perm.SendMessages | Perm.ReadMessageHistory, deny: 0n });
  }
  return out;
}

export function pickCategory(categories: { id: string; childCount: number }[]): string | undefined {
  // Discord allows 50 channels per category.
  return categories.find((c) => c.childCount < 50)?.id;
}

export const roomEditSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
  bitrate: z.number().int().min(8000).max(384000).optional(),
});

export type RoomControlAction = 'rename' | 'limit' | 'bitrate' | 'lock' | 'unlock' | 'hide' | 'show' | 'allow' | 'disallow' | 'transfer' | 'kick';

/** Only the owner (or staff) can manage a room. Transfer target must currently be in the room. */
export function authorizeRoomControl(params: {
  actorId: string;
  ownerId: string;
  actorIsStaff: boolean;
  action: RoomControlAction;
  targetId?: string;
  targetInRoom?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (params.actorId !== params.ownerId && !params.actorIsStaff) return { ok: false, reason: 'Only the room owner can do that.' };
  if (params.action === 'transfer') {
    if (!params.targetId) return { ok: false, reason: 'Choose a member to transfer ownership to.' };
    if (params.targetId === params.ownerId) return { ok: false, reason: 'They already own this room.' };
    if (!params.targetInRoom) return { ok: false, reason: 'The new owner must be in the room.' };
  }
  if (params.action === 'kick') {
    if (!params.targetId) return { ok: false, reason: 'Choose a member to kick from the room.' };
    if (params.targetId === params.ownerId) return { ok: false, reason: 'You cannot kick the room owner.' };
    if (!params.targetInRoom) return { ok: false, reason: 'That member is not in this room.' };
  }
  return { ok: true };
}

export const presetInputSchema = z.object({
  name: z.string().min(1).max(40),
  emoji: z.string().max(32).optional().nullable(),
  nameTemplate: z.string().min(1).max(100),
  userLimit: z.number().int().min(0).max(99).default(0),
  bitrate: z.number().int().min(8000).max(384000).optional().nullable(),
  visibility: z.enum(['public', 'private', 'friends']).default('public'),
  position: z.number().int().min(0).max(100).default(0),
});
