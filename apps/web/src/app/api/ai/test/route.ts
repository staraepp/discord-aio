import { z } from 'zod';
import { AI_ANSWER_LABEL, AI_MISTAKE_ADVISORY } from '@aio/core/ai';
import { adminRoute, awaitCommand, command, HttpError, readJson } from '@/lib/api';
import { limit } from '@/lib/ratelimit';

/** Dry-run question answered by the bot using the admin's own channel visibility. Not posted to Discord. */
export const POST = adminRoute(async ({ req, session }) => {
  limit('aiTest', session.userId);
  const { question } = await readJson(req, z.object({ question: z.string().min(1).max(2000) }));
  const id = await command(session, 'ai.test_query', { question });
  const result = await awaitCommand(id, 45_000);
  if (!result) throw new HttpError(503, 'The bot did not answer in time (it may be offline).');
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'Test failed.');
  const answer = result.result as { ok?: boolean } | null;
  // The label and advisory are fixed text, the same as on every Discord answer.
  return answer?.ok ? { ...answer, label: AI_ANSWER_LABEL, advisory: AI_MISTAKE_ADVISORY } : answer;
});
