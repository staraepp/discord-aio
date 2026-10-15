import { z } from 'zod';

/**
 * Scheduled and sticky messages. Times are wall-clock times in an IANA timezone so
 * "every Monday 09:00" stays 09:00 across daylight-saving changes.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:30');

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.iso.datetime({ offset: true }) }),
  z.object({ kind: z.literal('daily'), time: hhmm }),
  z.object({ kind: z.literal('weekly'), time: hhmm, days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  // At least every 10 minutes so a schedule can't be turned into a spam cannon.
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(10).max(60 * 24 * 7) }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

/** A message is either a saved embed or plain text. */
const messageBody = {
  embedId: z.string().max(40).nullable().default(null),
  content: z.string().max(2000).nullable().default(null),
};
const oneBody = (v: { embedId: string | null; content: string | null }) => Boolean(v.embedId) !== Boolean(v.content?.trim());
const oneBodyMessage = { message: 'Choose a saved embed or write a message (one of the two).', path: ['content'] };

export const scheduledMessageInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    channelId: snowflake,
    ...messageBody,
    schedule: scheduleSchema,
    timezone: z.string().max(64).refine(isValidTimezone, 'Unknown timezone'),
    enabled: z.boolean().default(true),
  })
  .refine(oneBody, oneBodyMessage);
export type ScheduledMessageInput = z.infer<typeof scheduledMessageInputSchema>;

export const stickyMessageInputSchema = z
  .object({
    channelId: snowflake,
    ...messageBody,
    enabled: z.boolean().default(true),
    /** Wait this long after the last message before re-posting, so busy chats get one re-post. */
    delaySeconds: z.number().int().min(5).max(600).default(15),
  })
  .refine(oneBody, oneBodyMessage);
export type StickyMessageInput = z.infer<typeof stickyMessageInputSchema>;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, weekday: WEEKDAYS[parts.weekday!]! };
}

/** Milliseconds the zone is ahead of UTC at `date`. */
function offsetAt(date: Date, tz: string): number {
  const p = localParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** UTC instant for a wall-clock time in `tz` (second pass settles DST transitions). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(new Date(guess), tz);
  return new Date(guess - offsetAt(new Date(first), tz));
}

/**
 * Next time the schedule fires strictly after `after`. `anchor` is where interval
 * schedules count from (creation or last change). Null when a one-time message is done.
 */
export function nextRunAt(schedule: Schedule, tz: string, after: Date, anchor: Date = after): Date | null {
  switch (schedule.kind) {
    case 'once': {
      const at = new Date(schedule.at);
      return at > after ? at : null;
    }
    case 'interval': {
      const step = schedule.everyMinutes * 60_000;
      const n = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / step) + 1);
      return new Date(anchor.getTime() + n * step);
    }
    default: {
      const [h, m] = schedule.time.split(':').map(Number) as [number, number];
      const today = localParts(after, tz);
      for (let d = 0; d <= 8; d++) {
        // Walk calendar days in the zone; Date.UTC normalises month/year overflow.
        const day = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
        const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, tz);
        if (candidate <= after) continue;
        if (schedule.kind === 'weekly' && !schedule.days.includes(day.getUTCDay())) continue;
        return candidate;
      }
      return null;
    }
  }
}

export function describeSchedule(schedule: Schedule, tz: string): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (schedule.kind) {
    case 'once':
      return `Once, ${new Date(schedule.at).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}`;
    case 'daily':
      return `Every day at ${schedule.time}`;
    case 'weekly':
      return `${[...schedule.days].sort().map((d) => names[d]).join(', ')} at ${schedule.time}`;
    case 'interval':
      return schedule.everyMinutes % 60 === 0 ? `Every ${schedule.everyMinutes / 60}h` : `Every ${schedule.everyMinutes} min`;
  }
}
