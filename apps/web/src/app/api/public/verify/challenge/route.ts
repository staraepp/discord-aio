import { z } from 'zod';
import { lookupAttempt } from '@aio/core/verification';
import { HttpError, publicRoute, readJson } from '@/lib/api';
import { db } from '@/lib/server';
import { limit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/session';
import { newBuiltinChallenge, verificationMode } from '@/lib/verification';

const schema = z.object({ token: z.string().min(40).max(64), kind: z.enum(['image', 'math']) });

/**
 * A new picture, or the plain-text question for people who can't read the picture.
 * Replaces the pending challenge; it does not count as a failed attempt.
 */
export const POST = publicRoute(async (req) => {
  limit('verifyChallenge', await clientIp());
  const body = await readJson(req, schema);
  if ((await verificationMode()) === 'turnstile') throw new HttpError(409, 'This server uses a different check.');
  const found = await lookupAttempt(db(), body.token);
  if (!found.ok) throw new HttpError(410, 'This verification link is no longer valid. Press Verify in Discord to get a new one.');
  return { prompt: await newBuiltinChallenge(found.attempt.id, body.kind) };
});
