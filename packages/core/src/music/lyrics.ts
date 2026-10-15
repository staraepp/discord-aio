/**
 * Lyrics: LRC parsing, time alignment and an optional LRCLIB adapter.
 * Lyric text is never bulk-stored in the database or repository; only a small
 * in-memory cache plus metadata (found/synced/attribution) is kept.
 */

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  provider: string;
  attribution: string;
  synced: LyricLine[] | null;
  plain: string | null;
  sourceUrl?: string;
}

const LRC_LINE = /^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
const LRC_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = LRC_LINE.exec(raw);
    if (!m) continue;
    const text = m[2]!.trim();
    for (const tag of m[1]!.matchAll(LRC_TAG)) {
      const min = Number(tag[1]);
      const sec = Number(tag[2]);
      const frac = tag[3] ?? '0';
      const ms = Number(frac.padEnd(3, '0').slice(0, 3));
      lines.push({ timeMs: (min * 60 + sec) * 1000 + ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the line being sung at `positionMs` (last line whose time <= position), or -1 before the first. */
export function currentLineIndex(lines: LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.timeMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Window of lines around the current one with the current line highlighted. */
export function renderLyricWindow(lines: LyricLine[], positionMs: number, before = 2, after = 4): string {
  if (lines.length === 0) return '';
  const idx = currentLineIndex(lines, positionMs);
  const center = Math.max(0, idx);
  const start = Math.max(0, center - before);
  const end = Math.min(lines.length, center + after + 1);
  return lines
    .slice(start, end)
    .map((l, i) => {
      const text = l.text || '♪';
      return start + i === idx ? `**▶ ${text}**` : `-# ${text}`;
    })
    .join('\n');
}

export interface LyricsLookup {
  title: string;
  artist: string;
  durationMs?: number | null;
}

export interface LyricsProvider {
  id: string;
  fetch(query: LyricsLookup): Promise<LyricsResult | null>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Strips common noise like "(Official Video)" so lookups match. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:official|lyrics?|audio|video|music video|mv|hd|4k|visualizer|live)[^)\]]*[)\]]/gi, '')
    .replace(/\s*-\s*topic$/i, '')
    .trim();
}

/**
 * LRCLIB (https://lrclib.net) community lyrics API. Disabled by default; the
 * admin must enable it and confirm they reviewed its terms for their use.
 */
export class LrclibProvider implements LyricsProvider {
  readonly id = 'lrclib';
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly userAgent = 'discord-aio-bot (https://github.com/)',
  ) {}

  async fetch(q: LyricsLookup): Promise<LyricsResult | null> {
    const params = new URLSearchParams({ track_name: cleanTitle(q.title), artist_name: q.artist.replace(/\s*-\s*Topic$/i, '') });
    if (q.durationMs) params.set('duration', String(Math.round(q.durationMs / 1000)));
    const res = await this.fetchImpl(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Lyrics provider returned HTTP ${res.status}`);
    const body = (await res.json()) as { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean; id?: number };
    if (body.instrumental) return { provider: this.id, attribution: 'Lyrics via LRCLIB', synced: null, plain: '(Instrumental)' };
    const synced = body.syncedLyrics ? parseLrc(body.syncedLyrics) : null;
    if (!synced?.length && !body.plainLyrics) return null;
    return {
      provider: this.id,
      attribution: 'Lyrics via LRCLIB (community-sourced)',
      synced: synced?.length ? synced : null,
      plain: body.plainLyrics ?? null,
      sourceUrl: body.id ? `https://lrclib.net/api/get/${body.id}` : undefined,
    };
  }
}

/** Tiny TTL+LRU cache so the panel doesn't refetch lyrics every tick. */
export class LyricsCache {
  private readonly map = new Map<string, { at: number; value: LyricsResult | null }>();
  constructor(
    private readonly max = 50,
    private readonly ttlMs = 60 * 60 * 1000,
  ) {}

  static key(q: LyricsLookup): string {
    return `${cleanTitle(q.title).toLowerCase()}|${q.artist.toLowerCase()}|${Math.round((q.durationMs ?? 0) / 2000)}`;
  }

  get(key: string): LyricsResult | null | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: LyricsResult | null): void {
    this.map.set(key, { at: Date.now(), value });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}
