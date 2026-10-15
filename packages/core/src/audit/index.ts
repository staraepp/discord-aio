import type { DbOrTx } from '@aio/db';
import { redactDeep } from '@aio/logging';

export interface AuditEntry {
  guildId: string;
  actorId?: string | null;
  actorType?: 'user' | 'system' | 'bot';
  module: string;
  action: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

/** Keys that must never appear in audit rows (secrets, answers, private notes). */
const FORBIDDEN_KEYS = /^(token|secret|password|apikey|api_key|key|encryptedkey|answer|captcha.*|edittoken|accesstoken|refreshtoken|adminnotes|privatenotes)$/i;

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeAuditValue(v, depth + 1));
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = FORBIDDEN_KEYS.test(k) ? '[REDACTED]' : sanitizeAuditValue(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return redactDeep(value.length > 4000 ? `${value.slice(0, 4000)}…` : value);
  return value;
}

export async function writeAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      guildId: entry.guildId,
      actorId: entry.actorId ?? null,
      actorType: entry.actorType ?? (entry.actorId ? 'user' : 'system'),
      module: entry.module,
      action: entry.action,
      targetId: entry.targetId ?? null,
      before: (sanitizeAuditValue(entry.before) ?? undefined) as object | undefined,
      after: (sanitizeAuditValue(entry.after) ?? undefined) as object | undefined,
      meta: (sanitizeAuditValue(entry.meta) ?? undefined) as object | undefined,
    },
  });
}
