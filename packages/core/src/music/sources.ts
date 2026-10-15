/**
 * Source resolution. Spotify and Apple Music links provide METADATA only; they
 * are never streamed. Metadata is matched to a permitted playable source via
 * the audio backend's search and the substitution is labelled transparently.
 */

export type SourceKind = 'youtube' | 'spotify' | 'applemusic' | 'url' | 'search';

export interface ClassifiedQuery {
  kind: SourceKind;
  /** For Spotify/Apple: entity type. */
  entity?: 'track' | 'album' | 'playlist' | 'artist';
  id?: string;
  storefront?: string;
  url?: string;
  query: string;
}

export function classifyQuery(input: string): ClassifiedQuery {
  const q = input.trim();
  let url: URL | undefined;
  try {
    url = new URL(q);
  } catch {
    return { kind: 'search', query: q };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'search', query: q };
  const host = url.hostname.replace(/^www\.|^m\./, '');

  if (['youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return { kind: 'youtube', url: url.toString(), query: q };

  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{10,32})/.exec(url.pathname);
    if (m) return { kind: 'spotify', entity: m[1] as ClassifiedQuery['entity'], id: m[2], url: url.toString(), query: q };
  }
  if (host === 'music.apple.com') {
    // /us/album/name/123?i=456  |  /us/song/name/456  |  /us/playlist/name/pl.xxxx
    const parts = url.pathname.split('/').filter(Boolean);
    const storefront = parts[0] && /^[a-z]{2}$/.test(parts[0]) ? parts[0] : 'us';
    const typeIdx = parts[0] === storefront ? 1 : 0;
    const type = parts[typeIdx];
    const id = parts[parts.length - 1];
    const songParam = url.searchParams.get('i');
    if (type === 'album' && songParam) return { kind: 'applemusic', entity: 'track', id: songParam, storefront, url: url.toString(), query: q };
    if (type === 'song' && id) return { kind: 'applemusic', entity: 'track', id, storefront, url: url.toString(), query: q };
    if (type === 'album' && id) return { kind: 'applemusic', entity: 'album', id, storefront, url: url.toString(), query: q };
    if (type === 'playlist' && id) return { kind: 'applemusic', entity: 'playlist', id, storefront, url: url.toString(), query: q };
  }
  return { kind: 'url', url: url.toString(), query: q };
}

export interface MetadataTrack {
  title: string;
  artists: string[];
  durationMs: number | null;
  isrc?: string;
  artworkUrl?: string;
  sourceUrl?: string;
}

export interface MetadataCollection {
  name: string;
  tracks: MetadataTrack[];
  /** True when the provider had more tracks than we fetched (import cap). */
  truncated: boolean;
}

export class SourceNotConfiguredError extends Error {
  constructor(
    public readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceNotConfiguredError';
  }
}

export class SourceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceResolutionError';
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Spotify Web API (client-credentials flow) — metadata only. */
export class SpotifyMetadataClient {
  private token: { value: string; exp: number } | null = null;

  constructor(
    private readonly clientId: string | undefined,
    private readonly clientSecret: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async accessToken(): Promise<string> {
    if (!this.configured) throw new SourceNotConfiguredError('spotify', 'Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (metadata only). Ask staff to configure them, or search by name instead.');
    if (this.token && this.token.exp > Date.now() + 30_000) return this.token.value;
    const res = await this.fetchImpl('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new SourceResolutionError(`Spotify authentication failed (HTTP ${res.status}).`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) throw new SourceResolutionError('That Spotify link was not found or is private. Playlists made by Spotify itself (like Today\'s Top Hits or Discover Weekly) are blocked for bots by Spotify, but playlists made by people work.');
    if (!res.ok) throw new SourceResolutionError(`Spotify returned HTTP ${res.status}.`);
    return (await res.json()) as T;
  }

  static mapTrack(t: SpotifyTrack, fallbackArt?: string): MetadataTrack {
    return {
      title: t.name,
      artists: t.artists.map((a) => a.name),
      durationMs: t.duration_ms ?? null,
      isrc: t.external_ids?.isrc,
      artworkUrl: t.album?.images?.[0]?.url ?? fallbackArt,
      sourceUrl: t.external_urls?.spotify,
    };
  }

  async resolve(entity: string, id: string, cap: number): Promise<MetadataCollection> {
    if (entity === 'track') {
      const t = await this.get<SpotifyTrack>(`/tracks/${id}`);
      return { name: t.name, tracks: [SpotifyMetadataClient.mapTrack(t)], truncated: false };
    }
    if (entity === 'album') {
      const album = await this.get<{ name: string; images?: { url: string }[]; tracks: SpotifyPage<SpotifyTrack> }>(`/albums/${id}`);
      const art = album.images?.[0]?.url;
      const tracks = album.tracks.items.map((t) => SpotifyMetadataClient.mapTrack(t, art));
      let next = album.tracks.next;
      while (next && tracks.length < cap) {
        const page = await this.get<SpotifyPage<SpotifyTrack>>(next.replace('https://api.spotify.com/v1', ''));
        tracks.push(...page.items.map((t) => SpotifyMetadataClient.mapTrack(t, art)));
        next = page.next;
      }
      return { name: album.name, tracks: tracks.slice(0, cap), truncated: tracks.length > cap || Boolean(next) };
    }
    if (entity === 'playlist') {
      const pl = await this.get<{ name: string; tracks: SpotifyPage<{ track: SpotifyTrack | null }> }>(`/playlists/${id}`);
      const tracks: MetadataTrack[] = [];
      const push = (items: { track: SpotifyTrack | null }[]) => items.forEach((i) => i.track && i.track.name && tracks.push(SpotifyMetadataClient.mapTrack(i.track)));
      push(pl.tracks.items);
      let next = pl.tracks.next;
      while (next && tracks.length < cap) {
        const page = await this.get<SpotifyPage<{ track: SpotifyTrack | null }>>(next.replace('https://api.spotify.com/v1', ''));
        push(page.items);
        next = page.next;
      }
      return { name: pl.name, tracks: tracks.slice(0, cap), truncated: tracks.length > cap || Boolean(next) };
    }
    throw new SourceResolutionError('Spotify artist links are not supported. Share a track, album or playlist link.');
  }
}

interface SpotifyTrack {
  name: string;
  duration_ms?: number;
  artists: { name: string }[];
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  album?: { images?: { url: string }[] };
}
interface SpotifyPage<T> {
  items: T[];
  next: string | null;
}

/**
 * Apple Music metadata. Songs/albums use the public iTunes Lookup API.
 * Playlists need an Apple Music API developer token: a fixed string, or a provider
 * that signs fresh ones from a MusicKit key (see apple-token.ts).
 */
export class AppleMusicMetadataClient {
  constructor(
    private readonly developerToken: string | (() => string) | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async catalog<T>(pathOrUrl: string): Promise<T> {
    const token = typeof this.developerToken === 'function' ? this.developerToken() : this.developerToken!;
    const res = await this.fetchImpl(pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.music.apple.com${pathOrUrl}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) throw new SourceResolutionError('Apple Music rejected the developer token. Check the MusicKit key settings.');
    if (res.status === 404) throw new SourceResolutionError('Apple Music playlist not found. Personal library playlists can\'t be read, only public ones.');
    if (!res.ok) throw new SourceResolutionError(`Apple Music returned HTTP ${res.status}.`);
    return (await res.json()) as T;
  }

  async resolve(entity: string, id: string, storefront: string, cap: number): Promise<MetadataCollection> {
    if (entity === 'playlist') {
      if (!this.developerToken)
        throw new SourceNotConfiguredError('apple-music', 'Apple Music playlists need a MusicKit key (APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY). Songs and albums work without it.');
      type TrackPage = { data: AppleSong[]; next?: string };
      const body = await this.catalog<{ data: { attributes: { name: string }; relationships?: { tracks?: TrackPage } }[] }>(`/v1/catalog/${storefront}/playlists/${encodeURIComponent(id)}?include=tracks`);
      const pl = body.data[0];
      if (!pl) throw new SourceResolutionError('Apple Music playlist not found.');
      // The first 100 tracks come inline; follow `next` for the rest, up to what the queue can take.
      const songs: AppleSong[] = [...(pl.relationships?.tracks?.data ?? [])];
      let next = pl.relationships?.tracks?.next;
      for (let page = 0; next && songs.length <= cap && page < 20; page++) {
        const more = await this.catalog<TrackPage>(next);
        songs.push(...more.data);
        next = more.next;
      }
      const playable = songs.filter((s) => s.attributes?.name);
      return {
        name: pl.attributes.name,
        tracks: playable.slice(0, cap).map((s) => ({
          title: s.attributes.name,
          artists: [s.attributes.artistName],
          durationMs: s.attributes.durationInMillis ?? null,
          isrc: s.attributes.isrc,
          artworkUrl: s.attributes.artwork?.url?.replace('{w}', '512').replace('{h}', '512'),
          sourceUrl: s.attributes.url,
        })),
        truncated: playable.length > cap || Boolean(next),
      };
    }
    const res = await this.fetchImpl(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&country=${storefront}&limit=${Math.min(cap, 200)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new SourceResolutionError(`Apple Music lookup returned HTTP ${res.status}.`);
    const body = (await res.json()) as { results: ITunesResult[] };
    const collection = body.results.find((r) => r.wrapperType === 'collection');
    const songs = body.results.filter((r) => r.wrapperType === 'track' && r.kind === 'song');
    if (songs.length === 0) throw new SourceResolutionError('No songs were found for that Apple Music link.');
    const tracks = songs.slice(0, cap).map((s) => ({
      title: s.trackName ?? 'Unknown',
      artists: [s.artistName ?? 'Unknown'],
      durationMs: s.trackTimeMillis ?? null,
      artworkUrl: s.artworkUrl100?.replace('100x100', '512x512'),
      sourceUrl: s.trackViewUrl,
    }));
    return { name: entity === 'track' ? tracks[0]!.title : collection?.collectionName ?? 'Apple Music album', tracks, truncated: songs.length > cap };
  }
}

interface AppleSong {
  attributes: { name: string; artistName: string; durationInMillis?: number; isrc?: string; url?: string; artwork?: { url?: string } };
}
interface ITunesResult {
  wrapperType: string;
  kind?: string;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

// ── Matching metadata to a playable track ──

export interface PlayableCandidate {
  encoded: string;
  title: string;
  author: string;
  durationMs: number | null;
  uri: string | null;
  sourceName: string;
  artworkUrl: string | null;
  isStream: boolean;
  isSeekable: boolean;
  isrc?: string | null;
}

/** Search port implemented by the audio backend adapter (Lavalink). */
export interface AudioSearchPort {
  /** `identifier` may be a URL or a prefixed search like `ytsearch:query`. */
  load(identifier: string): Promise<
    | { type: 'track'; tracks: PlayableCandidate[] }
    | { type: 'playlist'; name: string; tracks: PlayableCandidate[] }
    | { type: 'search'; tracks: PlayableCandidate[] }
    | { type: 'empty' }
    | { type: 'error'; message: string }
  >;
}

export function metadataSearchQuery(t: MetadataTrack): string {
  return `${t.artists.join(' ')} - ${t.title}`.replace(/["\n]/g, ' ').slice(0, 200);
}

/**
 * Pick the best candidate for a metadata track: prefer an ISRC match, then the
 * top result whose duration is within 5 s, otherwise the top result.
 */
export function pickBestMatch(meta: MetadataTrack, candidates: PlayableCandidate[]): PlayableCandidate | undefined {
  if (candidates.length === 0) return undefined;
  if (meta.isrc) {
    const isrc = candidates.find((c) => c.isrc && c.isrc === meta.isrc);
    if (isrc) return isrc;
  }
  if (meta.durationMs) {
    const close = candidates.slice(0, 5).find((c) => c.durationMs !== null && Math.abs(c.durationMs - meta.durationMs!) <= 5000);
    if (close) return close;
  }
  return candidates[0];
}

/**
 * The video id of a single-video YouTube link (watch, youtu.be, shorts, embed, live, music),
 * or null for playlists and other pages.
 */
export function youtubeVideoId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const id =
    host === 'youtu.be'
      ? url.pathname.split('/')[1]
      : ['youtube.com', 'music.youtube.com'].includes(host)
        ? (url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1])
        : undefined;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// ── Alternate source (used when YouTube refuses to stream a track) ──

/** Words that mark a different version of a song; only accepted when the original has them too. */
const VARIANT_WORDS = ['loop', 'hour', 'remix', 'cover', 'sped', 'slowed', 'reverb', 'nightcore', '8d', 'karaoke', 'instrumental', 'mashup', 'edit', 'live', 'acoustic', 'bootleg', 'flip', 'mix', 'jersey', 'tiktok', 'version', 'piano', 'lofi'];

const NOISE = /\b(official|music|video|mv|m\/v|audio|lyrics?|lyric video|visualizer|hd|4k|performance|teaser|clip)\b/gi;

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** "NewJeans (뉴진스) 'Ditto' Official MV" → "NewJeans Ditto". */
export function cleanTrackTitle(title: string): string {
  return title
    .replace(/[([{【][^)\]}】]*[)\]}】]/g, ' ')
    .replace(/['"‘’“”「」『』]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s*[|/]\s*.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Channel names like "RickAstleyVEVO", "IVE - Topic" or "HYBE LABELS" aren't the artist. */
export function cleanArtist(author: string): string {
  const a = author.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\bofficial\b/gi, '').trim();
  return /\b(labels?|records|entertainment|music|tv|channel)\b/i.test(a) ? '' : a;
}

export interface AlternateTarget {
  title: string;
  author: string;
  durationMs: number | null;
  /** Metadata from Spotify/Apple has exact durations; YouTube video lengths include intros/outros. */
  exactDuration: boolean;
}

/** Search queries to try on the alternate source, best first. */
export function alternateQueries(t: AlternateTarget): string[] {
  const title = cleanTrackTitle(t.title) || t.title;
  const artist = cleanArtist(t.author);
  const qs = [artist && !words(title).some((w) => words(artist).includes(w)) ? `${artist} ${title}` : title, title];
  return [...new Set(qs.map((q) => q.slice(0, 200)))];
}

/**
 * Picks the same song from alternate-source results, or nothing. Rejects previews, streams
 * and other versions (remixes, loops, covers…), requires a close length when it is known,
 * and prefers results whose title matches.
 */
export function pickAlternate(t: AlternateTarget, candidates: PlayableCandidate[]): PlayableCandidate | undefined {
  const original = new Set(words(`${t.title} ${t.author}`));
  const titleWords = words(cleanTrackTitle(t.title) || t.title);
  // Music videos run longer than the song (intros, outros, dance breaks), so only an upper bound holds.
  const musicVideo = !t.exactDuration && MUSIC_VIDEO.test(t.title);
  const tolerance = t.durationMs ? (t.exactDuration ? Math.max(4000, t.durationMs * 0.03) : Math.max(15_000, t.durationMs * 0.1)) : 0;
  const fitsLength = (ms: number) => {
    if (!t.durationMs) return true;
    if (musicVideo) return ms <= t.durationMs + tolerance && ms >= t.durationMs * 0.4;
    return Math.abs(ms - t.durationMs) <= tolerance;
  };
  const ok = candidates.filter((c) => {
    if (c.isStream || c.durationMs === null) return false;
    if (c.durationMs < 35_000 && (t.durationMs ?? 0) > 60_000) return false; // 30 s previews
    const cw = words(c.title);
    if (VARIANT_WORDS.some((v) => cw.includes(v) && !original.has(v))) return false;
    return fitsLength(c.durationMs);
  });
  const missing = (c: PlayableCandidate) => {
    const cw = new Set(words(`${c.title} ${c.author}`));
    return titleWords.filter((w) => !cw.has(w)).length;
  };
  if (!titleWords.length) return t.durationMs && t.exactDuration ? ok[0] : undefined;
  const titled = ok.find((c) => missing(c) === 0);
  if (titled) return titled;
  // Uploaders often drop the artist ("Ditto" for "NewJeans Ditto"), so one missing word is fine.
  const close = titleWords.length > 1 ? ok.find((c) => missing(c) === 1) : undefined;
  if (close) return close;
  // Only an exact Spotify/Apple length is trustworthy enough to go without a title match.
  return t.durationMs && t.exactDuration ? ok[0] : undefined;
}

const MUSIC_VIDEO = /\b(mv|m\/v|music video|official video|performance|visuali[sz]er|dance practice)\b/i;

// ── SoundCloud catalog (tells full songs from 30-second previews) ──

export interface SoundCloudTrackInfo {
  title: string;
  username: string;
  permalinkUrl: string;
  /** ALLOW / MONETIZE play fully; SNIP is a 30 s preview (label-restricted); BLOCK can't play. */
  policy: string;
  fullDurationMs: number;
}

export const SOUNDCLOUD_FULL_POLICIES = new Set(['ALLOW', 'MONETIZE']);

/**
 * SoundCloud's public web API, used only to read track policies so the bot never picks a
 * preview. Needs the same public client id the soundcloud.com website uses, read from its
 * scripts and cached. Any failure returns null so callers can fall back.
 */
export class SoundCloudCatalog {
  private clientId: { value: string; at: number } | null = null;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async getClientId(force = false): Promise<string | null> {
    if (!force && this.clientId && Date.now() - this.clientId.at < 6 * 3600_000) return this.clientId.value;
    const home = await this.fetchImpl('https://soundcloud.com/', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
    if (!home.ok) return null;
    const scripts = [...(await home.text()).matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    // The id lives in one of the last bundles.
    for (const src of scripts.reverse()) {
      const js = await this.fetchImpl(src, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.text() : ''));
      const m = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/.exec(js);
      if (m) {
        this.clientId = { value: m[1]!, at: Date.now() };
        return m[1]!;
      }
    }
    return null;
  }

  async search(query: string, limit = 10): Promise<SoundCloudTrackInfo[] | null> {
    try {
      for (const force of [false, true]) {
        const id = await this.getClientId(force);
        if (!id) return null;
        const res = await this.fetchImpl(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${id}`, { signal: AbortSignal.timeout(10_000) });
        if (res.status === 401 || res.status === 403) continue; // stale id: fetch a fresh one once
        if (!res.ok) return null;
        const body = (await res.json()) as { collection?: { title?: string; user?: { username?: string }; permalink_url?: string; policy?: string; full_duration?: number; duration?: number }[] };
        return (body.collection ?? [])
          .filter((t) => t.permalink_url && t.title)
          .map((t) => ({ title: t.title!, username: t.user?.username ?? '', permalinkUrl: t.permalink_url!, policy: t.policy ?? 'UNKNOWN', fullDurationMs: t.full_duration ?? t.duration ?? 0 }));
      }
      return null;
    } catch {
      return null;
    }
  }
}
