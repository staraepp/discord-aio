import { adminRoute, awaitCommand, command, HttpError } from '@/lib/api';

/** Asks the bot to check which channels Unverified members can see. */
export const POST = adminRoute(async ({ session }) => {
  const id = await command(session, 'verification.audit');
  const result = await awaitCommand(id, 12_000);
  if (!result) throw new HttpError(503, 'The bot is offline, so the channel visibility check could not run.');
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'Audit failed.');
  return result.result;
});
