import { formatDuration } from '@aio/discord-ui';
import type { AudioSearchPort, PlayableCandidate } from '@aio/core/music';

export interface Choice {
  name: string;
  value: string;
}

// Discord limits: 25 choices, 100 characters for both the name and the value.
const MAX_CHOICES = 8;
const LIMIT = 100;

/** "Ditto · NewJeans · 3:06", cut to fit Discord's 100 characters. */
export function choiceName(title: string, author: string, durationMs: number | null, isStream = false): string {
  const tail = ` · ${author} · ${isStream ? 'LIVE' : formatDuration(durationMs)}`;
  const room = LIMIT - tail.length;
  const head = room < 12 ? title.slice(0, LIMIT) : title.length > room ? `${title.slice(0, room - 1)}…` : title;
  return (room < 12 ? head : head + tail).slice(0, LIMIT);
}

function toChoices(tracks: PlayableCandidate[]): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const t of tracks) {
    // The link plays exactly the suggested video; without one, fall back to the title search.
    const value = t.uri && t.uri.length <= LIMIT ? t.uri : `${t.title} ${t.author}`.slice(0, LIMIT);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ name: choiceName(t.title, t.author, t.durationMs, t.isStream), value });
    if (out.length === MAX_CHOICES) break;
  }
  return out;
}

/**
 * Search suggestions for `/play` while the user types. Discord drops autocomplete answers after
 * 3 seconds, so slow searches give up early (the typed text still works), and recent answers
 * are cached because every keystroke asks again.
 */
export class PlaySuggester {
  private readonly cache = new Map<string, { at: number; choices: Choice[] }>();

  constructor(
    private readonly search: AudioSearchPort | null,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 2_200,
  ) {}

  async suggest(query: string): Promise<Choice[]> {
    const q = query.trim();
    if (!this.search || q.length < 2 || /^https?:\/\//i.test(q)) return [];
    const key = q.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < 60_000) return hit.choices;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.timeoutMs);
    });
    const res = await Promise.race([this.search.load(`ytsearch:${q}`).catch(() => null), timeout]);
    clearTimeout(timer);
    if (!res || (res.type !== 'search' && res.type !== 'track')) return [];

    const choices = toChoices(res.tracks);
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.now(), choices });
    return choices;
  }
}
