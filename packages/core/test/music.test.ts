import { describe, expect, it, vi } from 'vitest';
import {
  youtubeVideoId,
  allocatePlayer,
  alternateQueries,
  cleanArtist,
  cleanTrackTitle,
  pickAlternate,
  authorizeMusicAction,
  canMemberMove,
  classifyQuery,
  clampInterval,
  currentLineIndex,
  nextEditDelay,
  nextPosition,
  PanelScheduler,
  parseLrc,
  pendingEntries,
  pickBestMatch,
  planEnqueue,
  previousPosition,
  renderLyricWindow,
  renderNowPlayingPanel,
  shuffleEntries,
  trailingRunLength,
  TrackResolver,
  SpotifyMetadataClient,
  AppleMusicMetadataClient,
  type AudioSearchPort,
  type PlayableCandidate,
  type SoundCloudCatalog,
  type SchedulerClock,
  type Timeline,
} from '../src/music/index';

const req = (...ids: string[]) => ids.map((requesterId) => ({ requesterId }));

describe('five consecutive songs rule', () => {
  it('counts only the trailing run for the requester', () => {
    expect(trailingRunLength(req('a', 'a', 'b', 'a', 'a'), 'a')).toBe(2);
    expect(trailingRunLength(req('a', 'a', 'b'), 'a')).toBe(0);
    expect(trailingRunLength([], 'a')).toBe(0);
  });

  it('allows exactly five in a row, then rejects the sixth', () => {
    expect(planEnqueue({ pending: req('a', 'a', 'a', 'a'), requesterId: 'a', count: 1, limit: 5, bypass: false })).toEqual({ accepted: 1, rejected: 0 });
    expect(planEnqueue({ pending: req('a', 'a', 'a', 'a', 'a'), requesterId: 'a', count: 1, limit: 5, bypass: false })).toEqual({ accepted: 0, rejected: 1, reason: 'consecutive_limit' });
  });

  it('is a run-length rule, not a total: another requester breaks the run', () => {
    const pending = req('a', 'a', 'a', 'a', 'a', 'b');
    expect(planEnqueue({ pending, requesterId: 'a', count: 5, limit: 5, bypass: false })).toEqual({ accepted: 5, rejected: 0 });
  });

  it('accepts the fitting subset of a playlist and reports rejections', () => {
    expect(planEnqueue({ pending: req('b', 'a', 'a'), requesterId: 'a', count: 10, limit: 5, bypass: false })).toEqual({ accepted: 3, rejected: 7, reason: 'consecutive_limit' });
    expect(planEnqueue({ pending: req('b'), requesterId: 'a', count: 12, limit: 5, bypass: false })).toEqual({ accepted: 5, rejected: 7, reason: 'consecutive_limit' });
  });

  it('staff and temp rooms bypass the limit', () => {
    expect(planEnqueue({ pending: req('a', 'a', 'a', 'a', 'a'), requesterId: 'a', count: 50, limit: 5, bypass: true })).toEqual({ accepted: 50, rejected: 0 });
  });

  it('members cannot move their tracks to form a run longer than the limit', () => {
    const pending = ['a', 'a', 'a', 'a', 'a', 'c', 'a'].map((r, i) => ({ id: String(i), requesterId: r }));
    expect(canMemberMove({ pending, from: 6, to: 5, actorId: 'a', limit: 5, bypass: false }).ok).toBe(false); // would make 6 in a row
    expect(canMemberMove({ pending, from: 0, to: 6, actorId: 'a', limit: 5, bypass: false }).ok).toBe(true);
    expect(canMemberMove({ pending, from: 5, to: 0, actorId: 'a', limit: 5, bypass: false }).ok).toBe(false); // not theirs
    expect(canMemberMove({ pending, from: 5, to: 0, actorId: 'a', limit: 5, bypass: true }).ok).toBe(true);
  });
});

describe('timeline navigation', () => {
  const t = (cursor: number, n = 4): Timeline => ({ cursor, entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, position: i, requesterId: 'u' })) });

  it('previous always goes to the prior track, regardless of elapsed time', () => {
    expect(previousPosition(t(2))).toBe(1);
    expect(previousPosition(t(0))).toBeNull();
  });

  it('loop off stops at the end (no autoplay)', () => {
    expect(nextPosition(t(1), 'off', 'finished')).toBe(2);
    expect(nextPosition(t(3), 'off', 'finished')).toBeNull();
  });

  it('loop track repeats on finish but skip moves on', () => {
    expect(nextPosition(t(1), 'track', 'finished')).toBe(1);
    expect(nextPosition(t(1), 'track', 'skip')).toBe(2);
  });

  it('loop queue wraps to the first entry', () => {
    expect(nextPosition(t(3), 'queue', 'finished')).toBe(0);
  });

  it('shuffle only reorders pending entries and keeps metadata attached', () => {
    const timeline: Timeline<{ id: string; position: number; requesterId: string; title: string }> = {
      cursor: 0,
      entries: ['now', 'x', 'y', 'z'].map((title, i) => ({ id: title, position: i, requesterId: `r-${title}`, title })),
    };
    const pending = pendingEntries(timeline);
    let seed = 0.9;
    const shuffled = shuffleEntries(pending, () => (seed = (seed * 7.1) % 1));
    expect(shuffled.map((e) => e.title).sort()).toEqual(['x', 'y', 'z']);
    for (const e of shuffled) expect(e.requesterId).toBe(`r-${e.title}`);
    expect(shuffled.find((e) => e.title === 'now')).toBeUndefined();
  });
});

describe('music permissions (no DJ role, no vote skip)', () => {
  const member = { userId: 'u1', isStaff: false, inVoiceChannel: true };
  it('a member may skip only their own current song', () => {
    expect(authorizeMusicAction({ action: 'skip', actor: member, currentRequesterId: 'u1' }).ok).toBe(true);
    expect(authorizeMusicAction({ action: 'skip', actor: member, currentRequesterId: 'u2' }).ok).toBe(false);
  });
  it('staff may skip anybody', () => {
    expect(authorizeMusicAction({ action: 'skip', actor: { ...member, isStaff: true }, currentRequesterId: 'u2' }).ok).toBe(true);
  });
  it('members may remove/move only their own tracks', () => {
    expect(authorizeMusicAction({ action: 'remove', actor: member, targetRequesterId: 'u1' }).ok).toBe(true);
    expect(authorizeMusicAction({ action: 'remove', actor: member, targetRequesterId: 'u2' }).ok).toBe(false);
  });
  it('staff-only controls are denied to members', () => {
    for (const action of ['clear_all', 'jump', 'forceplay', 'disconnect', 'volume', 'loop', 'shuffle'] as const) {
      expect(authorizeMusicAction({ action, actor: member }).ok).toBe(false);
    }
  });
  it('temp room owners control their own room', () => {
    expect(authorizeMusicAction({ action: 'volume', actor: { ...member, isRoomOwner: true } }).ok).toBe(true);
  });
  it('must be in the voice channel (except staff on the dashboard)', () => {
    expect(authorizeMusicAction({ action: 'play', actor: { ...member, inVoiceChannel: false } }).ok).toBe(false);
    expect(authorizeMusicAction({ action: 'skip', actor: { userId: 'd', isStaff: true, inVoiceChannel: false, viaDashboard: true } }).ok).toBe(true);
    expect(authorizeMusicAction({ action: 'skip', actor: { userId: 'd', isStaff: false, inVoiceChannel: false, viaDashboard: true } }).ok).toBe(false);
  });
});

describe('three music identities', () => {
  const ids = [
    { slot: 1, online: true },
    { slot: 2, online: true },
    { slot: 3, online: true },
  ];
  it('reuses the player already in the room', () => {
    expect(allocatePlayer([{ slot: 1, online: true, voiceChannelId: 'vc1' }, ...ids.slice(1)], 'vc1')).toEqual({ ok: true, slot: 1, reused: true });
  });
  it('assigns idle identities to independent rooms, lowest slot first', () => {
    expect(allocatePlayer([{ slot: 1, online: true, voiceChannelId: 'vc1' }, ...ids.slice(1)], 'vc2')).toEqual({ ok: true, slot: 2, reused: false });
  });
  it('reports capacity instead of moving a busy player', () => {
    const busy = ids.map((i, n) => ({ ...i, voiceChannelId: `vc${n}` }));
    const r = allocatePlayer(busy, 'vc9');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('capacity');
  });
  it('ignores offline identities', () => {
    expect(allocatePlayer([{ slot: 1, online: true, voiceChannelId: 'a' }, { slot: 2, online: false }], 'b')).toMatchObject({ ok: false, reason: 'capacity' });
    expect(allocatePlayer([], 'b')).toMatchObject({ ok: false, reason: 'no_players_online' });
  });
});

describe('Now Playing panel scheduling', () => {
  function fakeClock() {
    let now = 0;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    let seq = 0;
    const clock: SchedulerClock = {
      now: () => now,
      setTimeout: (fn, ms) => {
        const t = { at: now + ms, fn, id: ++seq };
        timers.push(t);
        return t.id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id) => {
        const i = timers.findIndex((t) => t.id === (id as unknown as number));
        if (i >= 0) timers.splice(i, 1);
      },
    };
    const advance = async (ms: number) => {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift();
        now = next.at;
        next.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    };
    return { clock, advance };
  }

  it('clamps the interval to 5–15 seconds', () => {
    expect(clampInterval(1)).toBe(5000);
    expect(clampInterval(10)).toBe(10000);
    expect(clampInterval(60)).toBe(15000);
  });

  it('edits about every 10 seconds, not every tick', async () => {
    const { clock, advance } = fakeClock();
    const edit = vi.fn(async () => undefined);
    const s = new PanelScheduler(edit, clock);
    s.start('sess', 10);
    await advance(0);
    expect(edit).toHaveBeenCalledTimes(1);
    await advance(9_999);
    expect(edit).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(edit).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(edit).toHaveBeenCalledTimes(5);
  });

  it('coalesces bursts of urgent updates and keeps a minimum gap', async () => {
    const { clock, advance } = fakeClock();
    const edit = vi.fn(async () => undefined);
    const s = new PanelScheduler(edit, clock);
    s.request('sess');
    await advance(0);
    expect(edit).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) s.request('sess');
    await advance(1_999);
    expect(edit).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it('nextEditDelay respects the interval for ticks', () => {
    expect(nextEditDelay({ lastEditAt: 0, now: 3000, intervalMs: 10_000, urgent: false })).toBe(7000);
    expect(nextEditDelay({ lastEditAt: 0, now: 3000, intervalMs: 10_000, urgent: true })).toBe(0);
    expect(nextEditDelay({ lastEditAt: null, now: 3000, intervalMs: 10_000, urgent: false })).toBe(0);
  });

  it('renders one panel with volume 0–200 by 10 and fits Discord component limits', () => {
    const msg = renderNowPlayingPanel(
      {
        sessionId: 's1',
        state: 'playing',
        track: { title: 'Song', author: 'Artist', uri: 'https://youtu.be/x', sourceName: 'youtube', durationMs: 200_000, artworkUrl: 'https://i.ytimg.com/x.jpg', requesterId: '42', isStream: false },
        positionMs: 50_000,
        volume: 110,
        loopMode: 'queue',
        queueLength: 3,
        queuePosition: 1,
        is247: false,
        nextUp: { title: 'Next', requesterId: '43' },
        playerLabel: 'Player 1',
      },
      { color: 1, showArtwork: true, timelineHead: '●', timelineFilled: '━', timelineEmpty: '┄', footerText: 'x' },
    );
    expect(msg.components.length).toBeLessThanOrEqual(5);
    const volume = msg.components.flatMap((r) => r.components).find((c) => 'custom_id' in c && c.custom_id === 'mp:volume:s1');
    expect(volume && 'options' in volume ? volume.options.map((o) => o.value) : []).toEqual(Array.from({ length: 21 }, (_, i) => String(i * 10)));
    expect(volume && 'options' in volume ? volume.options.find((o) => o.default)?.value : null).toBe('110');
    expect(msg.embeds[0]!.description).toContain('0:50');
    expect(msg.embeds[0]!.thumbnail?.url).toBe('https://i.ytimg.com/x.jpg');
    for (const row of msg.components) expect(row.components.length).toBeLessThanOrEqual(5);
  });
});

describe('synced lyrics', () => {
  const lrc = '[00:01.00]First\n[00:05.50]Second\n[00:10.00][00:20.00]Chorus\n[ar:meta]';
  it('parses LRC including multi-timestamp lines', () => {
    const lines = parseLrc(lrc);
    expect(lines.map((l) => l.timeMs)).toEqual([1000, 5500, 10000, 20000]);
  });
  it('aligns the current line to the player position', () => {
    const lines = parseLrc(lrc);
    expect(currentLineIndex(lines, 0)).toBe(-1);
    expect(currentLineIndex(lines, 5_499)).toBe(0);
    expect(currentLineIndex(lines, 5_500)).toBe(1);
    expect(currentLineIndex(lines, 25_000)).toBe(3);
    expect(renderLyricWindow(lines, 6000)).toContain('**▶ Second**');
  });
});

describe('source resolution', () => {
  const cand = (title: string, durationMs: number, extra: Partial<PlayableCandidate> = {}): PlayableCandidate => ({
    encoded: `enc-${title}`,
    title,
    author: 'x',
    durationMs,
    uri: `https://youtube.com/watch?v=${title}`,
    sourceName: 'youtube',
    artworkUrl: null,
    isStream: false,
    isSeekable: true,
    ...extra,
  });

  it('classifies YouTube, Spotify and Apple Music links', () => {
    expect(classifyQuery('never gonna give you up').kind).toBe('search');
    expect(classifyQuery('https://youtu.be/dQw4w9WgXcQ').kind).toBe('youtube');
    expect(classifyQuery('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=1')).toMatchObject({ kind: 'spotify', entity: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
    expect(classifyQuery('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toMatchObject({ kind: 'spotify', entity: 'playlist' });
    expect(classifyQuery('https://music.apple.com/us/album/some-album/1440857781?i=1440857782')).toMatchObject({ kind: 'applemusic', entity: 'track', id: '1440857782' });
    expect(classifyQuery('https://music.apple.com/gb/playlist/x/pl.u-abc')).toMatchObject({ kind: 'applemusic', entity: 'playlist', storefront: 'gb' });
  });

  it('prefers ISRC, then close duration, then the top result', () => {
    const meta = { title: 'Song', artists: ['A'], durationMs: 200_000, isrc: 'US1' };
    expect(pickBestMatch(meta, [cand('a', 1), cand('b', 1, { isrc: 'US1' })])!.title).toBe('b');
    expect(pickBestMatch({ ...meta, isrc: undefined }, [cand('a', 100_000), cand('b', 202_000)])!.title).toBe('b');
    expect(pickBestMatch({ ...meta, isrc: undefined, durationMs: null }, [cand('a', 1), cand('b', 2)])!.title).toBe('a');
  });

  function resolver(search: AudioSearchPort | null, spotify = new SpotifyMetadataClient(undefined, undefined)) {
    return new TrackResolver(search, spotify, new AppleMusicMetadataClient(undefined));
  }
  const opts = { cap: 500, sources: { youtube: true, spotify: true, appleMusic: true } };

  it('/play selects the first search result automatically', async () => {
    const load = vi.fn(async () => ({ type: 'search' as const, tracks: [cand('top', 1000), cand('second', 1000)] }));
    const r = await resolver({ load }).resolve('some song', opts);
    expect(load).toHaveBeenCalledWith('ytsearch:some song');
    expect(r.ok && r.tracks.map((t) => t.title)).toEqual(['top']);
  });

  it('reads the video id from every single-video YouTube link form', () => {
    for (const link of ['https://www.youtube.com/watch?v=jOTfBlKSQYY&t=4', 'https://youtu.be/jOTfBlKSQYY?si=x', 'https://music.youtube.com/watch?v=jOTfBlKSQYY', 'https://m.youtube.com/shorts/jOTfBlKSQYY']) {
      expect(youtubeVideoId(link)).toBe('jOTfBlKSQYY');
    }
    expect(youtubeVideoId('https://www.youtube.com/playlist?list=PL123')).toBeNull();
    expect(youtubeVideoId('https://example.com/watch?v=jOTfBlKSQYY')).toBeNull();
  });

  it('finds a refused YouTube link through a search for its exact id, never a different video', async () => {
    const video = (id: string, title: string) => cand(title, 217_000, { uri: `https://www.youtube.com/watch?v=${id}`, sourceName: 'youtube' });
    const load = vi.fn(async (id: string) =>
      id.startsWith('ytsearch:') ? { type: 'search' as const, tracks: [video('otherVideo1', 'Reaction video'), video('jOTfBlKSQYY', 'ETA MV')] } : { type: 'error' as const, message: 'Something went wrong while looking up the track.' },
    );
    const r = await resolver({ load }).resolve('https://youtu.be/jOTfBlKSQYY?si=AGk', opts);
    expect(load).toHaveBeenLastCalledWith('ytsearch:jOTfBlKSQYY');
    expect(r.ok && r.tracks.map((t) => t.title)).toEqual(['ETA MV']);

    const onlyOthers = vi.fn(async (id: string) => (id.startsWith('ytsearch:') ? { type: 'search' as const, tracks: [video('otherVideo1', 'Reaction video')] } : { type: 'error' as const, message: 'blocked' }));
    expect(await resolver({ load: onlyOthers }).resolve('https://youtu.be/jOTfBlKSQYY', opts)).toMatchObject({ ok: false, message: 'Could not load that link: blocked' });
  });

  it('reports Not Configured without an audio backend instead of pretending', async () => {
    const r = await resolver(null).resolve('x', opts);
    expect(r).toMatchObject({ ok: false, notConfigured: true });
  });

  it('reports Spotify credentials missing honestly', async () => {
    const r = await resolver({ load: async () => ({ type: 'empty' }) }).resolve('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', opts);
    expect(r).toMatchObject({ ok: false, notConfigured: true });
    if (!r.ok) expect(r.message).toMatch(/SPOTIFY_CLIENT_ID/);
  });

  it('matches Spotify metadata to a playable source and labels the substitution', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('accounts.spotify.com')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      return new Response(JSON.stringify({ name: 'Real Song', duration_ms: 180_000, artists: [{ name: 'Real Artist' }], external_ids: { isrc: 'ISRC1' }, external_urls: { spotify: 'https://open.spotify.com/track/abc' }, album: { images: [{ url: 'https://i.scdn.co/a.jpg' }] } }));
    });
    const spotify = new SpotifyMetadataClient('id', 'secret', fetchImpl as unknown as typeof fetch);
    const load = vi.fn(async () => ({ type: 'search' as const, tracks: [cand('wrong', 60_000), cand('right', 181_000)] }));
    const r = await resolver({ load }, spotify).resolve('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', opts);
    expect(load).toHaveBeenCalledWith('ytsearch:Real Artist - Real Song');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tracks[0]).toMatchObject({ title: 'Real Song', encoded: 'enc-right', resolvedFrom: 'spotify' });
      expect(r.tracks[0]!.substitutionNote).toMatch(/Spotify metadata matched/);
    }
  });

  it('queues Spotify playlists as metadata for lazy matching and respects the import cap', async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ track: { name: `S${i}`, duration_ms: 1000, artists: [{ name: 'A' }] } }));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('accounts.spotify.com')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      return new Response(JSON.stringify({ name: 'PL', tracks: { items, next: null } }));
    });
    const spotify = new SpotifyMetadataClient('id', 'secret', fetchImpl as unknown as typeof fetch);
    const r = await resolver({ load: async () => ({ type: 'empty' }) }, spotify).resolve('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { ...opts, cap: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tracks).toHaveLength(5);
      expect(r.truncated).toBe(true);
      expect(r.tracks.every((t) => t.encoded === '' && t.resolvedFrom === 'spotify')).toBe(true);
    }
  });
});

describe('alternate source matching', () => {
  const sc = (title: string, seconds: number, extra: Partial<PlayableCandidate> = {}): PlayableCandidate => ({ encoded: title, title, author: 'someone', durationMs: seconds * 1000, uri: null, sourceName: 'soundcloud', artworkUrl: null, isStream: false, isSeekable: true, ...extra });

  it('cleans YouTube titles and label channels for the search', () => {
    expect(cleanTrackTitle("NewJeans (뉴진스) 'Ditto' Official MV")).toBe('NewJeans Ditto');
    expect(cleanTrackTitle('Rick Astley - Never Gonna Give You Up (Official Music Video)')).toBe('Rick Astley - Never Gonna Give You Up');
    expect(cleanArtist('HYBE LABELS')).toBe('');
    expect(cleanArtist('IVE - Topic')).toBe('IVE');
    expect(alternateQueries({ title: "NewJeans (뉴진스) 'Ditto' Official MV", author: 'HYBE LABELS', durationMs: 196_000, exactDuration: false })).toEqual(['NewJeans Ditto']);
    expect(alternateQueries({ title: 'After LIKE', author: 'IVE', durationMs: 177_000, exactDuration: true })).toEqual(['IVE After LIKE', 'After LIKE']);
  });

  it('picks the real song over loops, reverb edits, covers and previews (real SoundCloud results)', () => {
    const results = [sc('NewJeans (뉴진스) - Ditto (1 HOUR LOOP)', 3948), sc('Ditto (Reverb) | Newjeans', 188), sc('Ditto', 186)];
    // A YouTube MV runs a little longer than the song.
    expect(pickAlternate({ title: "NewJeans (뉴진스) 'Ditto' Official MV", author: 'HYBE LABELS', durationMs: 196_000, exactDuration: false }, results)?.title).toBe('Ditto');
    expect(pickAlternate({ title: 'Never Gonna Give You Up', author: 'Rick Astley', durationMs: 214_000, exactDuration: true }, [sc('Branime Studios - Never Gonna Give You Up ( Rick Astley Cover )', 198), sc('Never Gonna Give You Up (Remastered 2022)', 214)])?.title).toBe('Never Gonna Give You Up (Remastered 2022)');
    expect(pickAlternate({ title: 'After LIKE', author: 'IVE', durationMs: 177_000, exactDuration: true }, [sc('After LIKE', 30)])).toBeUndefined();
  });

  it('matches a long music video to the shorter song (real ETA results)', () => {
    const mv = { title: "NewJeans (뉴진스) 'ETA' Official MV", author: 'HYBE LABELS', durationMs: 217_000, exactDuration: false };
    const results = [sc('NewJeans(뉴진스) - ETA', 149, { author: 'woozzal' }), sc('NewJeans - ETA (Foxela Jersey Club Remix)', 147), sc('뉴진스 NewJeans - GET UP • Super Shy ETA Cool With You ASAP', 733)];
    expect(pickAlternate(mv, results)?.title).toBe('NewJeans(뉴진스) - ETA');
    // A plain upload of about the same length still needs its title to match.
    expect(pickAlternate({ title: 'ETA', author: 'NewJeans - Topic', durationMs: 151_000, exactDuration: false }, [sc('Eva Eva', 150)])).toBeUndefined();
  });

  it('accepts a requested variant and refuses to guess without a length or title match', () => {
    expect(pickAlternate({ title: 'Ditto (Sped Up)', author: 'NewJeans', durationMs: 150_000, exactDuration: true }, [sc('Ditto sped up', 150)])?.title).toBe('Ditto sped up');
    expect(pickAlternate({ title: 'Ditto', author: 'NewJeans', durationMs: null, exactDuration: false }, [sc('Something else', 186)])).toBeUndefined();
    expect(pickAlternate({ title: 'Ditto', author: 'NewJeans', durationMs: 186_000, exactDuration: true }, [sc('Ditto', 186, { isStream: true })])).toBeUndefined();
  });
});

describe('SoundCloud fallback avoids previews', () => {
  it('uses the catalog to skip SNIP uploads and loads the full one', async () => {
    const loaded: string[] = [];
    const lavalink: AudioSearchPort = {
      async load(identifier) {
        loaded.push(identifier);
        return { type: 'track', tracks: [{ encoded: `enc:${identifier}`, title: 'IVE - After Like', author: 'Detsuki', durationMs: 177_000, uri: identifier, sourceName: 'soundcloud', artworkUrl: null, isStream: false, isSeekable: true }] };
      },
    };
    const catalog = {
      search: async () => [
        { title: 'After LIKE', username: 'IVE', permalinkUrl: 'https://soundcloud.com/ive59257/after-like', policy: 'SNIP', fullDurationMs: 177_006 },
        { title: 'IVE - After Like [Jetlag Remix]', username: 'Jetlag', permalinkUrl: 'https://soundcloud.com/x/remix', policy: 'ALLOW', fullDurationMs: 196_000 },
        { title: 'IVE - After Like', username: 'Detsuki', permalinkUrl: 'https://soundcloud.com/detsuki/ive-afterlike', policy: 'ALLOW', fullDurationMs: 177_000 },
      ],
    } as unknown as SoundCloudCatalog;
    const resolver = new TrackResolver(lavalink, new SpotifyMetadataClient(undefined, undefined), new AppleMusicMetadataClient(undefined), catalog);
    const alt = await resolver.findAlternate({ title: 'After LIKE', author: 'IVE', durationMs: 177_000, resolvedFrom: 'applemusic', artworkUrl: null });
    expect(loaded).toEqual(['https://soundcloud.com/detsuki/ive-afterlike']);
    expect(alt).toMatchObject({ encoded: 'enc:https://soundcloud.com/detsuki/ive-afterlike', title: 'After LIKE', sourceName: 'soundcloud' });
  });
});
