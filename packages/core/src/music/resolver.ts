import type { NewTrack } from './repository';
import {
  alternateQueries,
  type AppleMusicMetadataClient,
  classifyQuery,
  pickAlternate,
  youtubeVideoId,
  SOUNDCLOUD_FULL_POLICIES,
  type SoundCloudCatalog,
  metadataSearchQuery,
  pickBestMatch,
  SourceNotConfiguredError,
  SourceResolutionError,
  type SpotifyMetadataClient,
  type AudioSearchPort,
  type MetadataTrack,
  type PlayableCandidate,
} from './sources';

export interface ResolveOptions {
  cap: number;
  sources: { youtube: boolean; spotify: boolean; appleMusic: boolean };
}

export type ResolveResult =
  | { ok: true; tracks: NewTrack[]; collectionName?: string; truncated: boolean; notes: string[] }
  | { ok: false; message: string; notConfigured?: boolean };

const SEARCH_PREFIX = 'ytsearch:';

export function candidateToTrack(c: PlayableCandidate, extra: Partial<NewTrack> = {}): NewTrack {
  return {
    title: c.title,
    author: c.author,
    durationMs: c.isStream ? null : c.durationMs,
    uri: c.uri,
    sourceName: c.sourceName,
    encoded: c.encoded,
    artworkUrl: c.artworkUrl,
    isStream: c.isStream,
    isSeekable: c.isSeekable,
    isrc: c.isrc ?? null,
    ...extra,
  };
}

function metadataToLazyTrack(m: MetadataTrack, from: 'spotify' | 'applemusic'): NewTrack {
  return {
    title: m.title,
    author: m.artists.join(', '),
    durationMs: m.durationMs,
    uri: m.sourceUrl ?? null,
    sourceName: from,
    encoded: '',
    artworkUrl: m.artworkUrl ?? null,
    isStream: false,
    isSeekable: true,
    isrc: m.isrc ?? null,
    resolvedFrom: from,
    originalUri: m.sourceUrl ?? null,
    substitutionNote: null,
  };
}

const FROM_LABEL = { spotify: 'Spotify', applemusic: 'Apple Music' } as const;

type LoadResult = Awaited<ReturnType<AudioSearchPort['load']>>;

/**
 * Resolves `/play` input. Plain text picks the TOP search result (no chooser).
 * Spotify/Apple links resolve metadata; single tracks are matched immediately,
 * collections are queued as metadata and matched lazily right before playback.
 */
export class TrackResolver {
  constructor(
    private readonly search: AudioSearchPort | null,
    private readonly spotify: SpotifyMetadataClient,
    private readonly apple: AppleMusicMetadataClient,
    /**
     * Optional: lets the SoundCloud fallback skip 30-second previews. A null search result
     * means "can't tell from here" and falls back to a plain search on the audio node.
     */
    private readonly soundcloud: Pick<SoundCloudCatalog, 'search'> | null = null,
  ) {}

  get audioConfigured(): boolean {
    return this.search !== null;
  }

  async resolve(input: string, opts: ResolveOptions): Promise<ResolveResult> {
    if (!this.search) {
      return { ok: false, notConfigured: true, message: 'Music playback is not configured yet (no Lavalink audio backend). Staff can check the Music page in the dashboard.' };
    }
    const q = classifyQuery(input);
    try {
      switch (q.kind) {
        case 'search': {
          if (!opts.sources.youtube) return { ok: false, message: 'Search is disabled because the YouTube source is turned off.' };
          const res = await this.search.load(`${SEARCH_PREFIX}${q.query}`);
          if (res.type === 'error') return { ok: false, message: `Search failed: ${res.message}` };
          if (res.type === 'empty' || res.tracks.length === 0) return { ok: false, message: `No results for “${q.query.slice(0, 100)}”.` };
          return { ok: true, tracks: [candidateToTrack(res.tracks[0]!)], truncated: false, notes: [] };
        }
        case 'youtube':
        case 'url': {
          if (q.kind === 'youtube' && !opts.sources.youtube) return { ok: false, message: 'The YouTube source is turned off by staff.' };
          let res = await this.search.load(q.url!);
          if (q.kind === 'youtube' && (res.type === 'error' || res.type === 'empty')) res = await this.loadYoutubeById(q.url!, res);
          if (res.type === 'error') return { ok: false, message: `Could not load that link: ${res.message}` };
          if (res.type === 'empty' || res.tracks.length === 0) return { ok: false, message: 'Nothing playable was found at that link.' };
          if (res.type === 'playlist') {
            const truncated = res.tracks.length > opts.cap;
            return { ok: true, collectionName: res.name, tracks: res.tracks.slice(0, opts.cap).map((c) => candidateToTrack(c)), truncated, notes: [] };
          }
          return { ok: true, tracks: [candidateToTrack(res.tracks[0]!)], truncated: false, notes: [] };
        }
        case 'spotify':
        case 'applemusic': {
          const from = q.kind;
          if ((from === 'spotify' && !opts.sources.spotify) || (from === 'applemusic' && !opts.sources.appleMusic)) {
            return { ok: false, message: `${FROM_LABEL[from]} links are turned off by staff.` };
          }
          const collection =
            from === 'spotify'
              ? await this.spotify.resolve(q.entity!, q.id!, opts.cap)
              : await this.apple.resolve(q.entity!, q.id!, q.storefront ?? 'us', opts.cap);
          if (collection.tracks.length === 0) return { ok: false, message: `That ${FROM_LABEL[from]} link has no tracks.` };
          if (q.entity === 'track') {
            const match = await this.matchMetadata(collection.tracks[0]!, from);
            if (!match) return { ok: false, message: `Couldn't find a playable match for that ${FROM_LABEL[from]} track.` };
            return { ok: true, tracks: [match], truncated: false, notes: [match.substitutionNote ?? ''] };
          }
          return {
            ok: true,
            collectionName: collection.name,
            tracks: collection.tracks.map((m) => metadataToLazyTrack(m, from)),
            truncated: collection.truncated,
            notes: [`${FROM_LABEL[from]} provides metadata only; each song is matched to a playable YouTube source right before it plays.`],
          };
        }
      }
    } catch (err) {
      if (err instanceof SourceNotConfiguredError) return { ok: false, notConfigured: true, message: err.message };
      if (err instanceof SourceResolutionError) return { ok: false, message: err.message };
      throw err;
    }
  }

  /**
   * YouTube refuses to open some links from servers ("requires login") even though the same
   * video plays fine once found through search. Search for the exact video id and keep only
   * that video, so the result is never a different song.
   */
  private async loadYoutubeById(link: string, failed: LoadResult): Promise<LoadResult> {
    const id = youtubeVideoId(link);
    if (!id || !this.search) return failed;
    const res = await this.search.load(`${SEARCH_PREFIX}${id}`);
    if (res.type !== 'search' && res.type !== 'track') return failed;
    const same = res.tracks.find((t) => t.sourceName === 'youtube' && t.uri !== null && youtubeVideoId(t.uri) === id);
    return same ? { type: 'track', tracks: [same] } : failed;
  }

  /** Match a metadata-only track to a playable source. Returns null if no match. */
  async matchMetadata(meta: MetadataTrack, from: 'spotify' | 'applemusic'): Promise<NewTrack | null> {
    if (!this.search) return null;
    const res = await this.search.load(`${SEARCH_PREFIX}${metadataSearchQuery(meta)}`);
    if (res.type !== 'search' && res.type !== 'track') return null;
    const best = pickBestMatch(meta, res.tracks);
    if (!best) return null;
    return candidateToTrack(best, {
      title: meta.title,
      author: meta.artists.join(', '),
      artworkUrl: meta.artworkUrl ?? best.artworkUrl,
      resolvedFrom: from,
      originalUri: meta.sourceUrl ?? null,
      substitutionNote: `${FROM_LABEL[from]} metadata matched to “${best.title}” on ${best.sourceName === 'youtube' ? 'YouTube' : best.sourceName}`,
    });
  }

  /**
   * Finds the same song on SoundCloud when YouTube refuses to stream it.
   * Returns null when nothing matches closely enough, rather than playing the wrong song.
   */
  async findAlternate(entry: { title: string; author: string; durationMs: number | null; resolvedFrom: string | null; artworkUrl: string | null }): Promise<NewTrack | null> {
    if (!this.search) return null;
    const target = { title: entry.title, author: entry.author, durationMs: entry.durationMs, exactDuration: Boolean(entry.resolvedFrom) };
    const extra = (title: string) => ({
      title: entry.title,
      author: entry.author,
      substitutionNote: `Playing from SoundCloud (“${title}”) because YouTube blocked this one`,
    });
    for (const q of alternateQueries(target)) {
      const infos = this.soundcloud ? await this.soundcloud.search(q) : null;
      if (infos) {
        // Only uploads SoundCloud lets us play in full; label uploads are often 30 s previews.
        const full: PlayableCandidate[] = infos
          .filter((t) => SOUNDCLOUD_FULL_POLICIES.has(t.policy))
          .map((t) => ({ encoded: '', title: t.title, author: t.username, durationMs: t.fullDurationMs || null, uri: t.permalinkUrl, sourceName: 'soundcloud', artworkUrl: null, isStream: false, isSeekable: true }));
        const best = pickAlternate(target, full);
        if (!best) continue;
        const loaded = await this.search.load(best.uri!).catch(() => null);
        const track = loaded && (loaded.type === 'track' || loaded.type === 'search') ? loaded.tracks[0] : undefined;
        if (track) return candidateToTrack(track, { ...extra(best.title), artworkUrl: entry.artworkUrl ?? track.artworkUrl });
        continue;
      }
      // Catalog unavailable: plain search (previews are then caught when they end early).
      const res = await this.search.load(`scsearch:${q}`).catch(() => null);
      if (!res || (res.type !== 'search' && res.type !== 'track')) continue;
      const best = pickAlternate(target, res.tracks.slice(0, 10));
      if (best) return candidateToTrack(best, { ...extra(best.title), artworkUrl: entry.artworkUrl ?? best.artworkUrl });
    }
    return null;
  }

  /** Lazily resolve a queued metadata-only entry. */
  async resolveLazy(entry: { title: string; author: string; durationMs: number | null; isrc: string | null; resolvedFrom: string | null; originalUri: string | null; artworkUrl: string | null }): Promise<NewTrack | null> {
    const from = entry.resolvedFrom === 'applemusic' ? 'applemusic' : 'spotify';
    return this.matchMetadata(
      { title: entry.title, artists: [entry.author], durationMs: entry.durationMs, isrc: entry.isrc ?? undefined, sourceUrl: entry.originalUri ?? undefined, artworkUrl: entry.artworkUrl ?? undefined },
      from,
    );
  }
}
