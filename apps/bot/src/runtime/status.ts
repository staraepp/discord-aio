import { ActivityType, type Client } from 'discord.js';

/**
 * Rotating custom statuses so the bots feel like members, not appliances.
 * Keep them short (Discord shows ~40 chars in the member list), no em dashes,
 * and only the emojis the server likes, sparingly.
 */

export const MAIN_STATUSES = [
  'pretending to be busy',
  'running on 3 hours of sleep 😭',
  'one more episode, I swear',
  'procrastinating professionally',
  'rereading the rules so you don\'t have to',
  'forgot why I opened this tab',
  'my sleep schedule is a myth 🫩',
  'keeping Prism Shade cozy',
  'waiting for someone to say help',
  'lowkey the favorite bot 😛',
  'not a spam bot, pinky promise',
  'loading personality...',
  'drinking water, you should too',
  'caught in 4k',
  'touching grass later',
  'counting members for fun',
  'being perceived 😨',
  'overthinking a reply',
];

export const MUSIC_STATUSES = [
  'skipping the intro every time',
  'someone queued this 5 times 😭',
  'sad songs at 3am 🥺',
  'humming off-key',
  'this song goes hard',
  'volume at 200%, sorry',
  'shuffle is never really random 😣',
  'not skipping this one',
  'headphones on, world off',
  'fighting over the aux',
  'playing it one more time',
  'guessing the lyrics wrong',
  'vibing in the voice channel',
  'rating your queue 7/10 😛',
];

export interface StatusSource {
  lines: readonly string[];
  intervalMinutes: number;
}

/** Next line, never the same one twice in a row. */
export function pickStatus(lines: readonly string[], previous: string | null, rand: () => number = Math.random): string {
  const pool = lines.length > 1 ? lines.filter((l) => l !== previous) : lines;
  return pool[Math.floor(rand() * pool.length)]!;
}

/**
 * Sets a random status now and keeps rotating. `source` is read before every change so
 * dashboard edits (lines, interval) apply without a restart. Returns a stop function.
 */
export function startStatusRotation(client: Client, source: () => Promise<StatusSource>): () => void {
  let current: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tick = async () => {
    const { lines, intervalMinutes } = await source().catch(() => ({ lines: [] as string[], intervalMinutes: 4 }));
    if (client.user && lines.length) {
      current = pickStatus(lines, current);
      client.user.setPresence({ status: 'online', activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: current }] });
    }
    if (stopped) return;
    timer = setTimeout(() => void tick(), Math.max(1, intervalMinutes) * 60_000);
    timer.unref();
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Built-in lines plus the admin's own (or only theirs when built-ins are off). */
export function statusLines(builtIn: readonly string[], custom: readonly string[], useBuiltIn: boolean): string[] {
  const lines = [...(useBuiltIn ? builtIn : []), ...custom];
  return lines.length ? lines : [...builtIn];
}
