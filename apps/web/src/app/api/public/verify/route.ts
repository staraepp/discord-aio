import { z } from 'zod';
import { lookupAttempt, recordAttemptResult, verifyBuiltinAnswer } from '@aio/core/verification';
import { enqueueDashboardCommand } from '@aio/core';
import { HttpError, publicRoute, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { limit } from '@/lib/ratelimit';
import { authSecret, clientIp } from '@/lib/session';
import { verifyTurnstile } from '@/lib/captcha';
import { newBuiltinChallenge, verificationMode } from '@/lib/verification';

const schema = z.object({ token: z.string().min(40).max(64), answer: z.string().max(20).optional(), captcha: z.string().max(4096).optional(), kind: z.enum(['image', 'math']).optional() });

const INVALID: Record<string, string> = {
  invalid: 'This verification link is not valid. Press Verify in Discord to get a new one.',
  expired: 'This verification link has expired. Press Verify in Discord to get a new one.',
  used: 'This verification link was already used. Press Verify in Discord to get a new one.',
  cooldown: 'Verification is paused for your account for a little while. Please try again later.',
};

function until(d: Date): string {
  const mins = Math.max(1, Math.ceil((d.getTime() - Date.now()) / 60_000));
  return mins >= 60 ? `${Math.round(mins / 60)} hour${mins >= 120 ? 's' : ''}` : `${mins} minute${mins === 1 ? '' : 's'}`;
}

/**
 * CAPTCHA result is decided here, server-side. Failures only start a
 * verification-only cooldown; nobody is kicked or timed out.
 */
export const POST = publicRoute(async (req) => {
  const ip = await clientIp();
  limit('verify', ip);
  const body = await readJson(req, schema);
  const found = await lookupAttempt(db(), body.token);
  if (!found.ok) return { status: 'invalid', message: found.reason === 'cooldown' && found.until ? `Please wait ${until(found.until)} before trying again.` : INVALID[found.reason] };
  const { attempt } = found;
  const mode = await verificationMode();
  let passed: boolean;
  if (mode === 'turnstile') {
    const outcome = await verifyTurnstile(body.captcha, ip, attempt.id);
    if (outcome === 'unavailable') throw new HttpError(503, 'The CAPTCHA service is unavailable right now. This did not count as a failed attempt, so please try again shortly.');
    passed = outcome === 'passed';
  } else {
    if (!body.answer?.trim()) throw new HttpError(422, 'Please type what you see.');
    passed = verifyBuiltinAnswer(authSecret(), attempt, body.answer);
  }
  const outcome = await recordAttemptResult(db(), { attemptId: attempt.id, passed });
  const cmd = (type: 'verification.sync_roles' | 'verification.failed', payload: Record<string, unknown>) => enqueueDashboardCommand(db(), { guildId: attempt.guildId, type, payload, createdBy: null });
  switch (outcome.status) {
    case 'success':
      await cmd('verification.sync_roles', { userId: attempt.userId });
      return { status: 'success', message: 'You are verified! You can close this page and return to Discord. Your roles update within a few seconds.' };
    case 'failed': {
      await cmd('verification.failed', { userId: attempt.userId });
      // Keep the kind the member was answering (they may have switched from the picture to the text question).
      const kind = mode === 'turnstile' ? null : (body.kind ?? mode);
      const prompt = kind ? await newBuiltinChallenge(attempt.id, kind) : null;
      return { status: 'failed', message: `That wasn't right. You have ${outcome.remainingInCycle} more ${outcome.remainingInCycle === 1 ? 'try' : 'tries'} before a short pause.`, prompt };
    }
    case 'cooldown':
      await cmd('verification.failed', { userId: attempt.userId, cooldownUntil: outcome.until.toISOString() });
      return { status: 'cooldown', message: `Too many incorrect answers. Verification is paused for ${until(outcome.until)}. You won't be removed from the server, just come back and press Verify again later.` };
    case 'invalid':
      return { status: 'invalid', message: INVALID[outcome.reason] };
  }
});
