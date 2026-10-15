import { z } from 'zod';
import { adminRoute, awaitCommand, command, HttpError, readJson, snowflake } from '@/lib/api';

/** Staff reset: clears failures/cooldown; the bot swaps roles back to Unverified. */
export const POST = adminRoute(async ({ req, session }) => {
  const { userId } = await readJson(req, z.object({ userId: snowflake }));
  const id = await command(session, 'verification.reset', { userId });
  const result = await awaitCommand(id);
  if (!result) return { queued: true, message: 'Queued. The bot will reset the member when it is online.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'Reset failed.');
  return { queued: false, message: (result.result as { message?: string } | null)?.message ?? 'Reset.' };
});
