import { randomInt } from 'node:crypto';
import type { Db, VerificationAttempt, VerificationCooldown } from '@aio/db';
import { generateToken, hashToken, hmac, safeEqual } from '../crypto/index';
import { writeAudit } from '../audit/index';
import { generateCode, normaliseCode, pngDataUri, renderCaptchaPng } from './captcha-image';

export * from './captcha-image';

/**
 * Verification: accessible CAPTCHA on a one-use link bound to (guild, member).
 * Failures lead to a VERIFICATION-ONLY cooldown — never a kick, never a
 * Discord timeout. Young accounts are flagged to staff but still allowed.
 */

export const FAILURES_PER_CYCLE = 3;
export const COOLDOWN_STEPS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;
export const NEW_ACCOUNT_DAYS = 3;
export const ISSUE_LIMIT = { count: 5, windowMs: 10 * 60_000 };

/** Cooldown after the Nth failed cycle (1-based): 5m, 15m, 1h, then 6h cap. */
export function cooldownForCycle(cycle: number): number {
  const idx = Math.min(COOLDOWN_STEPS_MS.length - 1, Math.max(0, cycle - 1));
  return COOLDOWN_STEPS_MS[idx]!;
}

export interface FailureState {
  failuresInCycle: number;
  cyclesFailed: number;
  cooldownUntil: Date | null;
}

/** Pure transition for one failed attempt. */
export function applyFailure(state: FailureState, now: Date): FailureState & { cooldownStarted: boolean; cooldownMs: number } {
  const failures = state.failuresInCycle + 1;
  if (failures < FAILURES_PER_CYCLE) return { ...state, failuresInCycle: failures, cooldownStarted: false, cooldownMs: 0 };
  const cycles = state.cyclesFailed + 1;
  const ms = cooldownForCycle(cycles);
  return { failuresInCycle: 0, cyclesFailed: cycles, cooldownUntil: new Date(now.getTime() + ms), cooldownStarted: true, cooldownMs: ms };
}

export function isInCooldown(state: Pick<FailureState, 'cooldownUntil'> | null | undefined, now: Date): boolean {
  return Boolean(state?.cooldownUntil && state.cooldownUntil > now);
}

/** Accounts created within the last 3 days are flagged (never blocked). */
export function isNewAccount(accountCreatedAt: Date, now: Date, days = NEW_ACCOUNT_DAYS): boolean {
  return now.getTime() - accountCreatedAt.getTime() < days * 24 * 60 * 60_000;
}

/** Discord snowflake → creation date. */
export function snowflakeDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
}

// ── Built-in accessible challenge ──

// Covers every possible answer (the largest question is 11 + 9).
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

export interface Challenge {
  prompt: string;
  answer: string;
}

/** Plain-text arithmetic question: screen-reader friendly, no images or audio required. */
export function generateChallenge(rand: (max: number) => number = (max) => randomInt(max)): Challenge {
  const a = rand(10) + 2;
  const b = rand(9) + 1;
  const plus = rand(2) === 0;
  const [x, y] = plus || a >= b ? [a, b] : [b, a];
  const op = plus ? 'plus' : 'minus';
  const answer = plus ? x + y : x - y;
  const word = (n: number) => (rand(2) === 0 ? String(n) : NUMBER_WORDS[n] ?? String(n));
  return { prompt: `What is ${word(x)} ${op} ${word(y)}? Answer with a number.`, answer: String(answer) };
}

export function normaliseAnswer(input: string): string {
  const s = input.trim().toLowerCase();
  const idx = NUMBER_WORDS.indexOf(s);
  return idx >= 0 ? String(idx) : s.replace(/[^\d-]/g, '');
}

export type ChallengeKind = 'image' | 'math';

/** What the member sees: a picture of a code, or a plain-text question (the accessible alternative). */
export type ChallengePrompt = { kind: 'image'; image: string } | { kind: 'math'; text: string };

/** A challenge ready to send: the PNG for Discord, the data URI for the web page, and the answer to hash. */
export interface IssuedChallenge {
  kind: ChallengeKind;
  answer: string;
  png?: Buffer;
  text?: string;
}

/** Only an HMAC of the normalised answer is stored. The kind is part of the input, so answers can't cross kinds. */
export function challengeHash(secret: string, attemptId: string, answer: string, kind: ChallengeKind = 'math'): string {
  const normalised = kind === 'image' ? `code:${normaliseCode(answer)}` : normaliseAnswer(answer);
  return hmac(secret, `${attemptId}:${normalised}`);
}

export function generateImageChallenge(rand?: (max: number) => number): { prompt: ChallengePrompt; answer: string; png: Buffer } {
  const code = generateCode(rand);
  const png = renderCaptchaPng(code, rand);
  return { prompt: { kind: 'image', image: pngDataUri(png) }, answer: code, png };
}

/** Creates a challenge of the given kind and stores only the HMAC of its answer on the attempt. */
export async function issueChallenge(db: Db, secret: string, attemptId: string, kind: ChallengeKind): Promise<IssuedChallenge> {
  if (kind === 'image') {
    const c = generateImageChallenge();
    await setChallenge(db, attemptId, challengeHash(secret, attemptId, c.answer, 'image'));
    return { kind, answer: c.answer, png: c.png };
  }
  const c = generateChallenge();
  await setChallenge(db, attemptId, challengeHash(secret, attemptId, c.answer, 'math'));
  return { kind, answer: c.answer, text: c.prompt };
}

// ── Turnstile ──

export interface CaptchaVerifier {
  verify(params: { response: string; remoteIp?: string; expectedCdata: string }): Promise<{ success: boolean; error?: string }>;
}

export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(params: { response: string; remoteIp?: string; expectedCdata: string }): Promise<{ success: boolean; error?: string }> {
    const body = new URLSearchParams({ secret: this.secret, response: params.response });
    if (params.remoteIp) body.set('remoteip', params.remoteIp);
    try {
      const res = await this.fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { success: false, error: `siteverify HTTP ${res.status}` };
      const data = (await res.json()) as { success: boolean; cdata?: string; 'error-codes'?: string[] };
      if (!data.success) return { success: false, error: (data['error-codes'] ?? []).join(',') || 'failed' };
      if (data.cdata !== params.expectedCdata) return { success: false, error: 'cdata-mismatch' };
      return { success: true };
    } catch {
      return { success: false, error: 'siteverify-unreachable' };
    }
  }
}

// ── Persistence ──

export type IssueResult =
  | { ok: true; token: string; attempt: VerificationAttempt }
  | { ok: false; reason: 'cooldown'; until: Date }
  | { ok: false; reason: 'rate_limited' };

/** Issue a fresh one-use link. Previous pending links for the member are superseded. */
export async function issueAttempt(db: Db, params: { guildId: string; userId: string; ttlMinutes: number; now?: Date }): Promise<IssueResult> {
  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "VerificationCooldown" ("guildId", "userId", "updatedAt") VALUES (${params.guildId}, ${params.userId}, now()) ON CONFLICT DO NOTHING`;
    const [state] = await tx.$queryRaw<VerificationCooldown[]>`SELECT * FROM "VerificationCooldown" WHERE "guildId" = ${params.guildId} AND "userId" = ${params.userId} FOR UPDATE`;
    if (isInCooldown(state, now)) return { ok: false as const, reason: 'cooldown' as const, until: state!.cooldownUntil! };
    const recent = await tx.verificationAttempt.count({
      where: { guildId: params.guildId, userId: params.userId, createdAt: { gt: new Date(now.getTime() - ISSUE_LIMIT.windowMs) } },
    });
    if (recent >= ISSUE_LIMIT.count) return { ok: false as const, reason: 'rate_limited' as const };
    await tx.verificationAttempt.updateMany({ where: { guildId: params.guildId, userId: params.userId, result: 'pending' }, data: { result: 'superseded', consumedAt: now } });
    const token = generateToken(32);
    const attempt = await tx.verificationAttempt.create({
      data: { guildId: params.guildId, userId: params.userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + params.ttlMinutes * 60_000), createdAt: now },
    });
    return { ok: true as const, token, attempt };
  });
}

export type AttemptLookup =
  | { ok: true; attempt: VerificationAttempt; state: VerificationCooldown | null }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'cooldown'; until?: Date };

export async function lookupAttempt(db: Db, token: string, now = new Date()): Promise<AttemptLookup> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { ok: false, reason: 'invalid' };
  const attempt = await db.verificationAttempt.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!attempt) return { ok: false, reason: 'invalid' };
  if (attempt.result !== 'pending' || attempt.consumedAt) return { ok: false, reason: 'used' };
  if (attempt.expiresAt <= now) return { ok: false, reason: 'expired' };
  const state = await db.verificationCooldown.findUnique({ where: { guildId_userId: { guildId: attempt.guildId, userId: attempt.userId } } });
  if (isInCooldown(state, now)) return { ok: false, reason: 'cooldown', until: state!.cooldownUntil! };
  return { ok: true, attempt, state };
}

/** Store the (hashed) answer for a newly shown built-in challenge. */
export async function setChallenge(db: Db, attemptId: string, hash: string): Promise<void> {
  await db.verificationAttempt.updateMany({ where: { id: attemptId, result: 'pending' }, data: { challengeHash: hash } });
}

export type SubmitOutcome =
  | { status: 'success'; attempt: VerificationAttempt }
  | { status: 'failed'; remainingInCycle: number }
  | { status: 'cooldown'; until: Date; cooldownMs: number; cycle: number }
  | { status: 'invalid'; reason: 'invalid' | 'expired' | 'used' | 'cooldown' };

/**
 * Record the server-side CAPTCHA result for an attempt. The caller has already
 * verified the CAPTCHA server-side (`passed`); client-reported success is never trusted.
 * Runs under row locks so a link cannot be consumed twice (replay).
 */
export async function recordAttemptResult(db: Db, params: { attemptId: string; passed: boolean; now?: Date }): Promise<SubmitOutcome> {
  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    const [attempt] = await tx.$queryRaw<VerificationAttempt[]>`SELECT * FROM "VerificationAttempt" WHERE id = ${params.attemptId} FOR UPDATE`;
    if (!attempt) return { status: 'invalid' as const, reason: 'invalid' as const };
    if (attempt.result !== 'pending' || attempt.consumedAt) return { status: 'invalid' as const, reason: 'used' as const };
    if (attempt.expiresAt <= now) return { status: 'invalid' as const, reason: 'expired' as const };
    await tx.$executeRaw`INSERT INTO "VerificationCooldown" ("guildId", "userId", "updatedAt") VALUES (${attempt.guildId}, ${attempt.userId}, now()) ON CONFLICT DO NOTHING`;
    const [state] = await tx.$queryRaw<VerificationCooldown[]>`SELECT * FROM "VerificationCooldown" WHERE "guildId" = ${attempt.guildId} AND "userId" = ${attempt.userId} FOR UPDATE`;
    if (isInCooldown(state, now)) return { status: 'invalid' as const, reason: 'cooldown' as const };

    if (params.passed) {
      const done = await tx.verificationAttempt.update({ where: { id: attempt.id }, data: { result: 'success', consumedAt: now } });
      await tx.verificationCooldown.update({
        where: { guildId_userId: { guildId: attempt.guildId, userId: attempt.userId } },
        data: { failuresInCycle: 0, cyclesFailed: 0, cooldownUntil: null, verifiedAt: now, lastAttemptAt: now, pendingRoleSync: true },
      });
      await writeAudit(tx, { guildId: attempt.guildId, actorId: attempt.userId, module: 'verification', action: 'verification.success', targetId: attempt.userId });
      return { status: 'success' as const, attempt: done };
    }

    const next = applyFailure({ failuresInCycle: state!.failuresInCycle, cyclesFailed: state!.cyclesFailed, cooldownUntil: state!.cooldownUntil }, now);
    await tx.verificationCooldown.update({
      where: { guildId_userId: { guildId: attempt.guildId, userId: attempt.userId } },
      data: { failuresInCycle: next.failuresInCycle, cyclesFailed: next.cyclesFailed, cooldownUntil: next.cooldownUntil, lastAttemptAt: now },
    });
    await tx.verificationAttempt.update({
      where: { id: attempt.id },
      data: next.cooldownStarted ? { failureCount: { increment: 1 }, result: 'failed', consumedAt: now, challengeHash: null } : { failureCount: { increment: 1 }, challengeHash: null },
    });
    await writeAudit(tx, {
      guildId: attempt.guildId,
      actorId: attempt.userId,
      module: 'verification',
      action: next.cooldownStarted ? 'verification.cooldown' : 'verification.failed',
      targetId: attempt.userId,
      meta: next.cooldownStarted ? { cycle: next.cyclesFailed, cooldownMs: next.cooldownMs } : { failuresInCycle: next.failuresInCycle },
    });
    if (next.cooldownStarted) return { status: 'cooldown' as const, until: next.cooldownUntil!, cooldownMs: next.cooldownMs, cycle: next.cyclesFailed };
    return { status: 'failed' as const, remainingInCycle: FAILURES_PER_CYCLE - next.failuresInCycle };
  });
}

export function verifyBuiltinAnswer(secret: string, attempt: Pick<VerificationAttempt, 'id' | 'challengeHash'>, answer: string): boolean {
  if (!attempt.challengeHash) return false;
  // Only one challenge hash is stored per attempt, so checking both kinds can only match the one that was issued.
  return safeEqual(attempt.challengeHash, challengeHash(secret, attempt.id, answer, 'image')) || safeEqual(attempt.challengeHash, challengeHash(secret, attempt.id, answer, 'math'));
}

/** Staff reset: clears counters/cooldown, invalidates links, and re-opens verification. */
export async function resetMember(db: Db, params: { guildId: string; userId: string; actorId: string }): Promise<void> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.verificationAttempt.updateMany({ where: { guildId: params.guildId, userId: params.userId, result: 'pending' }, data: { result: 'superseded', consumedAt: now } });
    await tx.verificationCooldown.upsert({
      where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
      create: { guildId: params.guildId, userId: params.userId },
      update: { failuresInCycle: 0, cyclesFailed: 0, cooldownUntil: null, verifiedAt: null, pendingRoleSync: false },
    });
    await writeAudit(tx, { guildId: params.guildId, actorId: params.actorId, module: 'verification', action: 'verification.reset', targetId: params.userId });
  });
}

export interface RoleSyncPlan {
  add: string[];
  remove: string[];
}

/** Idempotent role swap on success (or the reverse on reset). */
export function planRoleSwap(params: { memberRoleIds: string[]; verifiedRoleId?: string; unverifiedRoleId?: string; direction: 'verify' | 'reset' }): RoleSyncPlan {
  const has = (id?: string) => Boolean(id && params.memberRoleIds.includes(id));
  const add: string[] = [];
  const remove: string[] = [];
  const give = params.direction === 'verify' ? params.verifiedRoleId : params.unverifiedRoleId;
  const take = params.direction === 'verify' ? params.unverifiedRoleId : params.verifiedRoleId;
  if (give && !has(give)) add.push(give);
  if (take && has(take)) remove.push(take);
  return { add, remove };
}

export interface ChannelVisibilityInput {
  channelId: string;
  name: string;
  /** Effective ViewChannel for a member holding only @everyone + Unverified. */
  unverifiedCanView: boolean;
}

/**
 * Validates the gate: Unverified may see ONLY the verification channel and the
 * allowlist. Returns channels that leak (visible but not allowed) and allowed
 * channels that are not actually visible.
 */
export function auditGateVisibility(params: { channels: ChannelVisibilityInput[]; verificationChannelId?: string; allowlist: string[] }): {
  leaking: ChannelVisibilityInput[];
  unreachable: ChannelVisibilityInput[];
} {
  const allowed = new Set([params.verificationChannelId, ...params.allowlist].filter(Boolean) as string[]);
  return {
    leaking: params.channels.filter((c) => c.unverifiedCanView && !allowed.has(c.channelId)),
    unreachable: params.channels.filter((c) => allowed.has(c.channelId) && !c.unverifiedCanView),
  };
}
