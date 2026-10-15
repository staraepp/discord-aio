import { adminRoute, awaitCommand, command, HttpError } from '@/lib/api';
import { db } from '@/lib/server';

async function find(id: string, guildId: string) {
  const t = await db().ticket.findFirst({ where: { id, guildId } });
  if (!t) throw new HttpError(404, 'Ticket not found');
  return t;
}

export const GET = adminRoute<{ id: string }>(async ({ params, guildId }) => {
  const t = await find(params.id, guildId);
  return db().ticketTranscript.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'desc' } });
});

/** Asks the bot to capture a transcript (the bot reads channel history). */
export const POST = adminRoute<{ id: string }>(async ({ params, session, guildId }) => {
  const t = await find(params.id, guildId);
  const id = await command(session, 'ticket.transcript', { ticketId: t.id });
  const result = await awaitCommand(id, 15_000);
  if (!result) return { queued: true, message: 'Queued. The bot will capture the transcript when it is online.' };
  if (result.status === 'failed') throw new HttpError(502, result.error ?? 'Could not create a transcript.');
  return { queued: false, message: 'Transcript saved.' };
});
