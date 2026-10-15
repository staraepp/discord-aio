import type { CaseType, Db, DbOrTx, ModerationCase } from '@aio/db';
import { nextCounter } from '../settings/index';
import { writeAudit } from '../audit/index';

/**
 * Moderation keeps humans in charge: reasons are mandatory for warn/kick/ban
 * variants, warn counts are informational, and nothing escalates automatically.
 */

export const REASON_REQUIRED: ReadonlySet<CaseType> = new Set<CaseType>(['warn', 'kick', 'ban', 'tempban', 'softban']);

export function reasonRequired(type: CaseType): boolean {
  return REASON_REQUIRED.has(type);
}

export function validateReason(type: CaseType, reason: string | null | undefined): { ok: true; reason: string | null } | { ok: false; message: string } {
  const r = reason?.trim() ?? '';
  if (reasonRequired(type) && r.length < 3) return { ok: false, message: `A reason (at least 3 characters) is required for ${type}.` };
  if (r.length > 1000) return { ok: false, message: 'Reasons must be at most 1000 characters.' };
  return { ok: true, reason: r || null };
}

/** Parse `10m`, `2h`, `7d`, `1w`, `1d12h` into milliseconds. Returns null for anything else. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const unit = '(secs?|s|mins?|m|hrs?|h|days?|d|wks?|w)';
  if (!new RegExp(`^(\\d+${unit})+$`).test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(new RegExp(`(\\d+)${unit}`, 'g'))) {
    const n = Number(m[1]);
    const u = m[2]![0];
    total += n * (u === 's' ? 1000 : u === 'm' ? 60_000 : u === 'h' ? 3_600_000 : u === 'd' ? 86_400_000 : 604_800_000);
  }
  return total > 0 ? total : null;
}

export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export interface CreateCaseInput {
  guildId: string;
  type: CaseType;
  targetId?: string | null;
  moderatorId: string;
  reason?: string | null;
  durationMs?: number | null;
  evidence?: string | null;
  messageLink?: string | null;
  channelId?: string | null;
}

export async function createCase(db: Db, input: CreateCaseInput): Promise<ModerationCase> {
  const check = validateReason(input.type, input.reason);
  if (!check.ok) throw new Error(check.message);
  return db.$transaction(async (tx) => {
    const caseNumber = await nextCounter(tx, input.guildId, 'case');
    const c = await tx.moderationCase.create({
      data: {
        guildId: input.guildId,
        caseNumber,
        type: input.type,
        targetId: input.targetId ?? null,
        moderatorId: input.moderatorId,
        reason: check.reason,
        durationMs: input.durationMs ?? null,
        expiresAt: input.durationMs && (input.type === 'tempban' || input.type === 'timeout') ? new Date(Date.now() + input.durationMs) : null,
        evidence: input.evidence ?? null,
        messageLink: input.messageLink ?? null,
        channelId: input.channelId ?? null,
      },
    });
    await writeAudit(tx, { guildId: input.guildId, actorId: input.moderatorId, module: 'moderation', action: `case.${input.type}`, targetId: input.targetId, after: { caseNumber, reason: check.reason, durationMs: input.durationMs ?? null } });
    return c;
  });
}

/** Active (non-deleted) warning count. Informational only — never triggers punishment. */
export async function warningCount(db: DbOrTx, guildId: string, targetId: string): Promise<number> {
  return db.moderationCase.count({ where: { guildId, targetId, type: 'warn', deletedAt: null } });
}

export async function warnMember(db: Db, input: Omit<CreateCaseInput, 'type'>): Promise<{ case: ModerationCase; warningCount: number }> {
  const c = await createCase(db, { ...input, type: 'warn' });
  return { case: c, warningCount: await warningCount(db, input.guildId, input.targetId!) };
}

export async function editCase(db: Db, params: { guildId: string; caseNumber: number; editorId: string; reason?: string; evidence?: string | null }): Promise<ModerationCase | null> {
  return db.$transaction(async (tx) => {
    const c = await tx.moderationCase.findUnique({ where: { guildId_caseNumber: { guildId: params.guildId, caseNumber: params.caseNumber } } });
    if (!c || c.deletedAt) return null;
    const data: { reason?: string; evidence?: string | null } = {};
    if (params.reason !== undefined) {
      const check = validateReason(c.type, params.reason);
      if (!check.ok) throw new Error(check.message);
      data.reason = check.reason ?? undefined;
      await tx.moderationCaseEdit.create({ data: { caseId: c.id, editorId: params.editorId, field: 'reason', oldValue: c.reason, newValue: check.reason } });
    }
    if (params.evidence !== undefined) {
      data.evidence = params.evidence;
      await tx.moderationCaseEdit.create({ data: { caseId: c.id, editorId: params.editorId, field: 'evidence', oldValue: c.evidence, newValue: params.evidence } });
    }
    const updated = await tx.moderationCase.update({ where: { id: c.id }, data });
    await writeAudit(tx, { guildId: params.guildId, actorId: params.editorId, module: 'moderation', action: 'case.edit', targetId: c.targetId, before: { reason: c.reason, evidence: c.evidence }, after: data, meta: { caseNumber: c.caseNumber } });
    return updated;
  });
}

/** Soft delete so the audit trail survives. */
export async function deleteCase(db: Db, params: { guildId: string; caseNumber: number; actorId: string }): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const c = await tx.moderationCase.findUnique({ where: { guildId_caseNumber: { guildId: params.guildId, caseNumber: params.caseNumber } } });
    if (!c || c.deletedAt) return false;
    // A deleted tempban keeps its scheduled unban (active stays true until the unban runs).
    await tx.moderationCase.update({ where: { id: c.id }, data: { deletedAt: new Date(), deletedBy: params.actorId, active: c.type === 'tempban' ? c.active : false } });
    await writeAudit(tx, { guildId: params.guildId, actorId: params.actorId, module: 'moderation', action: 'case.delete', targetId: c.targetId, meta: { caseNumber: c.caseNumber, type: c.type } });
    return true;
  });
}

/** Tempbans whose time is up (the bot's scheduler unbans them and closes the case). */
export async function dueTempbans(db: DbOrTx, guildId: string, now = new Date()): Promise<ModerationCase[]> {
  return db.moderationCase.findMany({ where: { guildId, type: 'tempban', active: true, expiresAt: { lte: now } } });
}

export const CASE_LABEL: Record<CaseType, string> = {
  warn: 'Warn',
  timeout: 'Timeout',
  untimeout: 'Timeout removed',
  kick: 'Kick',
  voicekick: 'Voice kick',
  ban: 'Ban',
  tempban: 'Temporary ban',
  softban: 'Softban',
  unban: 'Unban',
  purge: 'Purge',
  slowmode: 'Slowmode',
  lock: 'Lock',
  unlock: 'Unlock',
  lockdown: 'Lockdown',
  honeypot: 'Honeypot',
  automod: 'Automod',
};

// ── Automod (conservative: delete/contain + alert staff; never punishes) ──

export interface AutomodSettings {
  keywords: string[];
  spam: { enabled: boolean; maxMessages: number; perSeconds: number };
  mentions: { enabled: boolean; max: number };
  repeated: { enabled: boolean; count: number; withinSeconds: number };
}

export type AutomodHit = { rule: 'keyword' | 'spam' | 'mentions' | 'repeated'; detail: string };

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function keywordHit(content: string, keywords: string[]): string | undefined {
  const text = normalise(content);
  return keywords.find((k) => {
    const kw = normalise(k.trim());
    if (!kw) return false;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
  });
}

/** Tracks recent messages per user to detect flooding and repeated content. */
export class AutomodTracker {
  private readonly recent = new Map<string, { at: number; content: string }[]>();
  constructor(private readonly now: () => number = Date.now) {}

  check(userId: string, content: string, mentionCount: number, s: AutomodSettings): AutomodHit | undefined {
    const kw = keywordHit(content, s.keywords);
    if (kw) return { rule: 'keyword', detail: 'Filtered keyword' };
    if (s.mentions.enabled && mentionCount > s.mentions.max) return { rule: 'mentions', detail: `${mentionCount} mentions` };
    const t = this.now();
    const windowMs = Math.max(s.spam.perSeconds, s.repeated.withinSeconds) * 1000;
    const list = (this.recent.get(userId) ?? []).filter((m) => m.at > t - windowMs);
    list.push({ at: t, content: normalise(content).trim() });
    this.recent.set(userId, list.slice(-50));
    if (s.spam.enabled && list.filter((m) => m.at > t - s.spam.perSeconds * 1000).length > s.spam.maxMessages)
      return { rule: 'spam', detail: `More than ${s.spam.maxMessages} messages in ${s.spam.perSeconds}s` };
    if (s.repeated.enabled && content.trim().length > 0) {
      const same = list.filter((m) => m.at > t - s.repeated.withinSeconds * 1000 && m.content === normalise(content).trim()).length;
      if (same >= s.repeated.count) return { rule: 'repeated', detail: `Same message ${same} times` };
    }
    return undefined;
  }
}
