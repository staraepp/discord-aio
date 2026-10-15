import { nextRunAt, type ScheduledMessageInput } from '@aio/core/customize';
import { HttpError } from '@/lib/api';
import { db } from '@/lib/server';

export async function checkEmbed(guildId: string, embedId: string | null): Promise<void> {
  if (embedId && !(await db().savedEmbed.findFirst({ where: { id: embedId, guildId } }))) throw new HttpError(400, 'That saved embed no longer exists.');
}

/** When a (re)saved schedule should first fire; null when disabled or already past. */
export function firstRun(input: ScheduledMessageInput, now = new Date()): Date | null {
  return input.enabled ? nextRunAt(input.schedule, input.timezone, now, now) : null;
}
