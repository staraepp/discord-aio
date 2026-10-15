import { adminRoute, audit, awaitCommand, command, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

/** Posts the message right now, without touching its schedule. */
export const POST = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const row = await db().scheduledMessage.findFirst({ where: { id: params.id, guildId } });
  if (!row) throw new HttpError(404, 'Scheduled message not found');
  const id = await command(session, 'schedule.send_now', { id: row.id });
  await audit(session, { module: 'core', action: 'schedule.send_now', targetId: row.id });
  const done = await awaitCommand(id);
  if (!done) return { message: 'Queued. The bot will send it when it is online.' };
  if (done.status === 'failed') throw new HttpError(502, done.error ?? 'Sending failed');
  return { message: 'Sent.' };
});
