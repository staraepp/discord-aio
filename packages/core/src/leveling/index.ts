import type { Db } from '@aio/db';
import type { LevelingSettings } from '../settings/schemas';

/** Leveling math. Intentionally simple and configurable — not an RPG. */

export type Formula = LevelingSettings['formula'];

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number, formula: Formula, difficulty: number): number {
  let base: number;
  switch (formula) {
    case 'linear':
      base = 100 + 50 * level;
      break;
    case 'quadratic':
      base = 5 * level * level + 50 * level + 100;
      break;
    case 'exponential':
      base = 100 * Math.pow(1.15, level);
      break;
  }
  return Math.max(1, Math.round(base * difficulty));
}

/** Total XP required to reach `level` from 0. */
export function totalXpForLevel(level: number, formula: Formula, difficulty: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l, formula, difficulty);
  return total;
}

export function levelFromXp(xp: number, formula: Formula, difficulty: number): { level: number; intoLevel: number; needed: number } {
  let level = 0;
  let remaining = Math.max(0, xp);
  for (;;) {
    const need = xpToNext(level, formula, difficulty);
    if (remaining < need || level >= 1000) return { level, intoLevel: remaining, needed: need };
    remaining -= need;
    level++;
  }
}

export const LEVELING_PRESETS: Record<'casual' | 'active' | 'competitive', Partial<LevelingSettings>> = {
  casual: { cooldownSeconds: 60, xpMin: 15, xpMax: 25, formula: 'quadratic', difficulty: 1, voiceXp: false },
  active: { cooldownSeconds: 45, xpMin: 20, xpMax: 30, formula: 'quadratic', difficulty: 0.8, voiceXp: true, voiceXpPerMinute: 3 },
  competitive: { cooldownSeconds: 60, xpMin: 10, xpMax: 20, formula: 'exponential', difficulty: 1.25, voiceXp: true, voiceXpPerMinute: 2 },
};

export function applyPreset(settings: LevelingSettings, preset: LevelingSettings['preset']): LevelingSettings {
  if (preset === 'custom') return { ...settings, preset };
  return { ...settings, ...LEVELING_PRESETS[preset], preset };
}

export function randomXp(min: number, max: number, random: () => number = Math.random): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(random() * (hi - lo + 1));
}

export interface XpContext {
  channelId: string;
  parentChannelId?: string;
  roleIds: string[];
  isStaff: boolean;
  optedOut: boolean;
}

/** Returns the multiplier for a message/voice minute, or 0 if no XP should be awarded. */
export function xpMultiplier(s: LevelingSettings, ctx: XpContext): number {
  if (ctx.optedOut) return 0;
  const ch = [ctx.channelId, ctx.parentChannelId].filter(Boolean) as string[];
  if (s.ignoredChannelIds.some((id) => ch.includes(id))) return 0;
  if (s.ignoredRoleIds.some((id) => ctx.roleIds.includes(id))) return 0;
  if (ctx.isStaff && s.staffMode === 'no_xp') return 0;
  let m = 1;
  const channelBonus = Math.max(1, ...s.bonusChannels.filter((b) => ch.includes(b.id)).map((b) => b.multiplier));
  const roleBonus = Math.max(1, ...s.bonusRoles.filter((b) => ctx.roleIds.includes(b.id)).map((b) => b.multiplier));
  m *= channelBonus * roleBonus;
  if (ctx.isStaff && s.staffMode === 'bonus') m *= s.staffMultiplier;
  return m;
}

export interface RoleReward {
  level: number;
  roleId: string;
}

/** Roles a member at `level` should hold. With stacking off, only the highest earned tier is kept. */
export function rewardRolesFor(level: number, rewards: RoleReward[], stack: boolean): { keep: string[]; remove: string[] } {
  const earned = rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const all = rewards.map((r) => r.roleId);
  if (stack) return { keep: [...new Set(earned.map((r) => r.roleId))], remove: [] };
  const top = earned.length ? earned[earned.length - 1]!.level : -1;
  const keep = [...new Set(earned.filter((r) => r.level === top).map((r) => r.roleId))];
  return { keep, remove: [...new Set(all.filter((id) => !keep.includes(id)))] };
}

export function progressBar(into: number, needed: number, width = 12): string {
  const ratio = needed > 0 ? Math.min(1, into / needed) : 0;
  const filled = Math.round(ratio * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

// ── Persistence ──


export interface AwardResult {
  xp: number;
  previousLevel: number;
  level: number;
  leveledUp: boolean;
}

/** Atomically add XP (can be negative for staff removal) and recompute the level. */
export async function adjustXp(
  db: Db,
  params: { guildId: string; userId: string; delta?: number; set?: number; settings: Pick<LevelingSettings, 'formula' | 'difficulty'>; countMessage?: boolean; voiceMinutes?: number },
): Promise<AwardResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "LevelProfile" ("guildId", "userId", "updatedAt") VALUES (${params.guildId}, ${params.userId}, now()) ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<{ xp: number; level: number }[]>`SELECT xp, level FROM "LevelProfile" WHERE "guildId" = ${params.guildId} AND "userId" = ${params.userId} FOR UPDATE`;
    const before = rows[0]!;
    const xp = Math.max(0, params.set ?? before.xp + (params.delta ?? 0));
    const level = levelFromXp(xp, params.settings.formula, params.settings.difficulty).level;
    await tx.levelProfile.update({
      where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
      data: {
        xp,
        level,
        ...(params.countMessage ? { messageCount: { increment: 1 }, lastMessageXpAt: new Date() } : {}),
        ...(params.voiceMinutes ? { voiceMinutes: { increment: params.voiceMinutes } } : {}),
      },
    });
    return { xp, previousLevel: before.level, level, leveledUp: level > before.level };
  });
}

/** Set a member directly to the start of `level`. */
export function xpForSetLevel(level: number, settings: Pick<LevelingSettings, 'formula' | 'difficulty'>): number {
  return totalXpForLevel(Math.max(0, Math.min(1000, level)), settings.formula, settings.difficulty);
}
