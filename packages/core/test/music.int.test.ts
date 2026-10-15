import { beforeEach, describe, expect, it } from 'vitest';
import { GUILD, hasDb, resetDb, snow, testDb } from './helpers';
import {
  AppleMusicMetadataClient,
  enqueueTracks,
  getOrCreateSession,
  MusicService,
  SpotifyMetadataClient,
  TrackResolver,
  type AudioSearchPort,
  type MusicActor,
  type MusicNotifier,
  type PlaybackPort,
  type PlayableCandidate,
  type PresencePort,
} from '../src/music/index';
import { musicSettingsSchema } from '../src/settings/schemas';

class FakePlayback implements PlaybackPort {
  online = [1, 2, 3];
  connected = new Map<number, string>();
  playing = new Map<number, { encoded: string; startMs: number; paused: boolean; volume: number }>();
  positions = new Map<number, number>();
  onlineSlots() {
    return this.online;
  }
  label(slot: number) {
    return `Player ${slot}`;
  }
  async connect(slot: number, vc: string) {
    this.connected.set(slot, vc);
  }
  async disconnect(slot: number) {
    this.connected.delete(slot);
    this.playing.delete(slot);
  }
  async play(slot: number, encoded: string, opts: { startMs: number; volume: number; paused: boolean }) {
    this.playing.set(slot, { encoded, ...opts });
    this.positions.set(slot, opts.startMs);
  }
  async stop(slot: number) {
    this.playing.delete(slot);
  }
  async setPaused(slot: number, paused: boolean) {
    const p = this.playing.get(slot);
    if (p) p.paused = paused;
  }
  async seek(slot: number, ms: number) {
    this.positions.set(slot, ms);
  }
  async setVolume(slot: number, v: number) {
    const p = this.playing.get(slot);
    if (p) p.volume = v;
  }
  async setFilters() {}
  position(slot: number) {
    return this.positions.get(slot) ?? null;
  }
  supportedFilters() {
    return ['equalizer', 'timescale', 'karaoke', 'rotation'];
  }
}

class FakePresence implements PresencePort {
  humans = new Map<string, number>();
  deleted = new Set<string>();
  humansIn(vc: string) {
    return this.humans.get(vc) ?? 0;
  }
  channelExists(vc: string) {
    return !this.deleted.has(vc);
  }
}

const notifier: MusicNotifier = { panel() {}, panelStop() {}, panelTicking() {}, notice() {}, trackStarted() {} };

const cand = (title: string, extra: Partial<PlayableCandidate> = {}): PlayableCandidate => ({
  encoded: `enc:${title}`,
  title,
  author: 'Artist',
  durationMs: 180_000,
  uri: `https://youtube.com/watch?v=${title}`,
  sourceName: 'youtube',
  artworkUrl: null,
  isStream: false,
  isSeekable: true,
  ...extra,
});

/** SoundCloud results the fake returns, per query (empty = YouTube-only, as before). */
const soundcloud = new Map<string, PlayableCandidate[]>();

const search: AudioSearchPort = {
  async load(identifier: string) {
    if (identifier.startsWith('scsearch:')) {
      const tracks = soundcloud.get(identifier.slice(9)) ?? [];
      return tracks.length ? { type: 'search', tracks } : { type: 'empty' };
    }
    if (identifier.startsWith('ytsearch:')) return { type: 'search', tracks: [cand(identifier.slice(9)), cand('other')] };
    if (identifier.includes('list=')) return { type: 'playlist', name: 'My playlist', tracks: Array.from({ length: 12 }, (_, i) => cand(`pl${i}`)) };
    return { type: 'track', tracks: [cand('link')] };
  },
};

const VC1 = snow(1);
const VC2 = snow(2);
const VC3 = snow(3);
const VC4 = snow(4);
const member = (id: string): MusicActor => ({ userId: id, isStaff: false, inVoiceChannel: true });
const staff: MusicActor = { userId: snow(99), isStaff: true, inVoiceChannel: true };

function setup() {
  const db = testDb();
  const playback = new FakePlayback();
  const presence = new FakePresence();
  const resolver = new TrackResolver(search, new SpotifyMetadataClient(undefined, undefined), new AppleMusicMetadataClient(undefined));
  const settings = musicSettingsSchema.parse({});
  const service = new MusicService(db, playback, presence, resolver, notifier, async () => settings);
  const play = (vc: string, actor: MusicActor, query: string, kind: 'public' | 'temp' = 'public') =>
    service.play({ guildId: GUILD, voiceChannelId: vc, kind, actor, query });
  return { db, playback, presence, service, play };
}

describe.skipIf(!hasDb)('music service (PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('plays the first result immediately and allows duplicates', async () => {
    const { play, playback, db } = setup();
    const u = snow(10);
    await play(VC1, member(u), 'song');
    await play(VC1, member(u), 'song');
    expect(playback.playing.get(1)?.encoded).toBe('enc:song');
    const entries = await db.musicQueueEntry.findMany({ orderBy: { position: 'asc' } });
    expect(entries.map((e) => e.title)).toEqual(['song', 'song']);
    expect(entries.every((e) => e.requesterId === u)).toBe(true);
    expect(await db.musicHistory.count()).toBe(1);
  });

  it('enforces five consecutive queued tracks atomically under concurrency', async () => {
    const { db } = setup();
    const s = await getOrCreateSession(db, { guildId: GUILD, voiceChannelId: VC1, kind: 'public', volume: 100 });
    const track = { title: 't', author: 'a', durationMs: 1, uri: null, sourceName: 'youtube', encoded: 'e', artworkUrl: null, isStream: false, isSeekable: true };
    const results = await Promise.all(Array.from({ length: 12 }, () => enqueueTracks(db, { sessionId: s.id, requesterId: 'u', tracks: [track], bypass: false, limit: 5, staffAdded: false })));
    expect(results.filter((r) => r.accepted === 1)).toHaveLength(5);
    expect(await db.musicQueueEntry.count()).toBe(5);
  });

  it('accepts only the fitting part of a playlist for members, all for staff', async () => {
    const { play, db } = setup();
    const r = await play(VC1, member(snow(10)), 'https://youtube.com/playlist?list=abc');
    expect(r.message).toMatch(/Queued \*\*5\*\* tracks/);
    expect(r.message).toMatch(/7 tracks were not added/);
    await play(VC1, staff, 'https://youtube.com/playlist?list=abc');
    expect(await db.musicQueueEntry.count()).toBe(17);
  });

  it('temp rooms have independent, unlimited queues', async () => {
    const { play, db } = setup();
    await play(VC1, member(snow(10)), 'https://youtube.com/playlist?list=abc', 'temp');
    expect(await db.musicQueueEntry.count()).toBe(12);
  });

  it('only the requester (or staff) can skip the current song', async () => {
    const { play, service, playback } = setup();
    const a = snow(10);
    const b = snow(11);
    await play(VC1, member(a), 'first');
    await play(VC1, member(b), 'second');
    expect((await service.skip(GUILD, VC1, member(b))).ok).toBe(false);
    expect((await service.skip(GUILD, VC1, member(a))).ok).toBe(true);
    expect(playback.playing.get(1)?.encoded).toBe('enc:second');
    expect((await service.skip(GUILD, VC1, staff, true)).ok).toBe(true);
  });

  it('/previous goes back to the prior track even mid-song', async () => {
    const { play, service, playback } = setup();
    const u = snow(10);
    await play(VC1, member(u), 'one');
    await play(VC1, member(u), 'two');
    await service.skip(GUILD, VC1, member(u));
    playback.positions.set(1, 120_000);
    const r = await service.previous(GUILD, VC1, member(u));
    expect(r.ok).toBe(true);
    expect(playback.playing.get(1)?.encoded).toBe('enc:one');
    await service.handleTrackEnd(1, 'finished');
    expect(playback.playing.get(1)?.encoded).toBe('enc:two');
  });

  it('stops after three load failures in a row and keeps the queue for /resume', async () => {
    const { play, service, playback, db } = setup();
    for (const t of ['a', 'b', 'c', 'd', 'e']) await play(VC1, staff, t);
    await service.handleTrackEnd(1, 'loadFailed', 'that video is unavailable.');
    await service.handleTrackEnd(1, 'loadFailed');
    expect(playback.playing.get(1)?.encoded).toBe('enc:c');
    await service.handleTrackEnd(1, 'loadFailed');
    expect(playback.playing.has(1)).toBe(false);
    const s = await db.musicSession.findFirstOrThrow();
    expect(s.state).toBe('suspended');
    expect(await db.musicQueueEntry.count({ where: { sessionId: s.id } })).toBe(5);
  });

  it('plays the same song from SoundCloud when YouTube refuses, without counting a failure', async () => {
    const { play, service, playback, db } = setup();
    soundcloud.set('Artist a', [
      cand('a (1 HOUR LOOP)', { sourceName: 'soundcloud', durationMs: 3_600_000, encoded: 'sc:loop' }),
      cand('a (Sped Up)', { sourceName: 'soundcloud', durationMs: 150_000, encoded: 'sc:sped' }),
      cand('a', { sourceName: 'soundcloud', durationMs: 181_000, encoded: 'sc:a' }),
    ]);
    try {
      await play(VC1, staff, 'a');
      await play(VC1, staff, 'b');
      await service.handleTrackEnd(1, 'loadFailed', 'YouTube is blocking this server');
      expect(playback.playing.get(1)?.encoded).toBe('sc:a');
      const entry = await db.musicQueueEntry.findFirstOrThrow({ where: { title: 'a' } });
      expect(entry).toMatchObject({ sourceName: 'soundcloud', substitutionNote: expect.stringContaining('SoundCloud') });
      // The SoundCloud copy failing too is a normal failure: skip to the next song.
      await service.handleTrackEnd(1, 'loadFailed');
      expect(playback.playing.get(1)?.encoded).toBe('enc:b');
    } finally {
      soundcloud.clear();
    }
  });

  it('a SoundCloud preview that ends after 30 s is skipped with a reason, even with loop track on', async () => {
    let clock = 1_000_000;
    const db = testDb();
    const playback = new FakePlayback();
    const notices: string[] = [];
    const resolver = new TrackResolver(search, new SpotifyMetadataClient(undefined, undefined), new AppleMusicMetadataClient(undefined));
    const service = new MusicService(db, playback, new FakePresence(), resolver, { ...notifier, notice: (_id, t) => void notices.push(t) }, async () => musicSettingsSchema.parse({}), () => clock);
    soundcloud.set('Artist a', [cand('a', { sourceName: 'soundcloud', durationMs: 181_000, encoded: 'sc:a' })]);
    try {
      const add = (q: string) => service.play({ guildId: GUILD, voiceChannelId: VC1, kind: 'public', actor: staff, query: q });
      await add('a');
      await add('b');
      await service.setLoop(GUILD, VC1, staff, 'track');
      await service.handleTrackEnd(1, 'loadFailed');
      expect(playback.playing.get(1)?.encoded).toBe('sc:a');
      clock += 30_000;
      await service.handleTrackEnd(1, 'finished');
      expect(playback.playing.get(1)?.encoded).toBe('enc:b');
      expect(notices.at(-1)).toMatch(/30-second preview/);
    } finally {
      soundcloud.clear();
    }
  });

  it('a finished track resets the failure streak', async () => {
    const { play, service, playback } = setup();
    for (const t of ['a', 'b', 'c', 'd', 'e']) await play(VC1, staff, t);
    await service.handleTrackEnd(1, 'loadFailed');
    await service.handleTrackEnd(1, 'loadFailed');
    await service.handleTrackEnd(1, 'finished');
    await service.handleTrackEnd(1, 'loadFailed');
    expect(playback.playing.get(1)?.encoded).toBe('enc:e');
  });

  it('loop track repeats and loop queue wraps; loop off ends without autoplay', async () => {
    const { play, service, playback, db } = setup();
    await play(VC1, staff, 'a');
    await play(VC1, staff, 'b');
    await service.setLoop(GUILD, VC1, staff, 'track');
    await service.handleTrackEnd(1, 'finished');
    expect(playback.playing.get(1)?.encoded).toBe('enc:a');
    await service.setLoop(GUILD, VC1, staff, 'queue');
    await service.handleTrackEnd(1, 'finished');
    await service.handleTrackEnd(1, 'finished');
    expect(playback.playing.get(1)?.encoded).toBe('enc:a');
    await service.setLoop(GUILD, VC1, staff, 'off');
    await service.handleTrackEnd(1, 'finished');
    await service.handleTrackEnd(1, 'finished');
    expect(playback.playing.has(1)).toBe(false);
    expect((await db.musicSession.findFirstOrThrow()).state).toBe('idle');
  });

  it('empty room preserves queue + position, disconnects, and /resume reattaches', async () => {
    const { play, service, playback, presence, db } = setup();
    presence.humans.set(VC1, 1);
    await play(VC1, staff, 'a');
    await play(VC1, staff, 'b');
    playback.positions.set(1, 42_000);
    presence.humans.set(VC1, 0);
    await service.handleRoomMaybeEmpty(GUILD, VC1);
    const s = await db.musicSession.findFirstOrThrow();
    expect(s.state).toBe('suspended');
    expect(s.positionMs).toBe(42_000);
    expect(s.identitySlot).toBeNull();
    expect(playback.connected.size).toBe(0);
    expect(await db.musicQueueEntry.count()).toBe(2);

    presence.humans.set(VC1, 1);
    const r = await service.resume(GUILD, VC1, member(snow(10)));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/0:42/);
    expect(playback.playing.get(1)).toMatchObject({ encoded: 'enc:a', startMs: 42_000 });
  });

  it('falls back to restarting the track when the position cannot be restored', async () => {
    const { play, service, playback, presence } = setup();
    presence.humans.set(VC1, 1);
    await play(VC1, staff, 'live');
    const db = testDb();
    await db.musicQueueEntry.updateMany({ data: { isSeekable: false } });
    playback.positions.set(1, 30_000);
    presence.humans.set(VC1, 0);
    await service.handleRoomMaybeEmpty(GUILD, VC1);
    presence.humans.set(VC1, 1);
    const r = await service.resume(GUILD, VC1, staff);
    expect(r.message).toMatch(/from the start/);
    expect(playback.playing.get(1)?.startMs).toBe(0);
  });

  it('24/7 sessions stay connected when the room empties', async () => {
    const { play, service, playback, presence, db } = setup();
    await db.moduleConfig.create({ data: { guildId: GUILD, moduleId: 'music', enabled: true, settings: { allow247: true } } });
    const settings = musicSettingsSchema.parse({ allow247: true });
    const svc = new MusicService(db, playback, presence, (service as unknown as { resolver: TrackResolver }).resolver, notifier, async () => settings);
    presence.humans.set(VC1, 1);
    await play(VC1, staff, 'a');
    expect((await svc.toggle247(GUILD, VC1, staff, true)).ok).toBe(true);
    presence.humans.set(VC1, 0);
    await svc.handleRoomMaybeEmpty(GUILD, VC1);
    expect(playback.connected.get(1)).toBe(VC1);
  });

  it('recovers sessions after a crash without joining empty rooms', async () => {
    const { play, playback, presence, db } = setup();
    presence.humans.set(VC1, 1);
    presence.humans.set(VC2, 1);
    await play(VC1, staff, 'a');
    await play(VC2, staff, 'b');
    await db.musicSession.updateMany({ data: { positionMs: 10_000 } });

    // Simulated restart: new process, no connections.
    const playback2 = new FakePlayback();
    const presence2 = new FakePresence();
    presence2.humans.set(VC1, 2); // listeners still there
    presence2.humans.set(VC2, 0); // room empty
    const service2 = new MusicService(db, playback2, presence2, new TrackResolver(search, new SpotifyMetadataClient(undefined, undefined), new AppleMusicMetadataClient(undefined)), notifier, async () => musicSettingsSchema.parse({}));
    const result = await service2.recoverOnStartup();
    expect(result).toEqual({ resumed: 1, suspended: 1, removed: 0 });
    expect(playback2.connected.get(1)).toBe(VC1);
    expect([...playback2.connected.values()]).not.toContain(VC2);
    const s2 = await db.musicSession.findFirstOrThrow({ where: { voiceChannelId: VC2 } });
    expect(s2.state).toBe('suspended');
    expect(await db.musicQueueEntry.count()).toBe(2);
    void playback;
  });

  it('runs three independent rooms and reports capacity for a fourth', async () => {
    const { play, playback, db } = setup();
    expect((await play(VC1, staff, 'a')).ok).toBe(true);
    expect((await play(VC2, staff, 'b')).ok).toBe(true);
    expect((await play(VC3, staff, 'c')).ok).toBe(true);
    const fourth = await play(VC4, staff, 'd');
    expect(fourth.ok).toBe(false);
    expect(fourth.message).toMatch(/busy/);
    expect(new Set(playback.connected.values())).toEqual(new Set([VC1, VC2, VC3]));
    expect(playback.playing.get(2)?.encoded).toBe('enc:b');
    const s1 = await db.musicSession.findFirstOrThrow({ where: { voiceChannelId: VC1 } });
    expect(s1.identitySlot).toBe(1);
  });

  it('a failing identity does not corrupt another room', async () => {
    const { play, playback, db } = setup();
    await play(VC1, staff, 'a');
    await play(VC2, staff, 'b');
    playback.online = [1, 3]; // player 2 went offline
    await play(VC2, staff, 'c');
    const s1 = await db.musicQueueEntry.findMany({ where: { session: { voiceChannelId: VC1 } } });
    expect(s1.map((e) => e.title)).toEqual(['a']);
  });

  it('deleting a temp room removes its own queue only', async () => {
    const { play, service, db } = setup();
    await play(VC1, staff, 'public');
    await play(VC2, member(snow(5)), 'temp', 'temp');
    await service.handleTempRoomDeleted(GUILD, VC2);
    expect(await db.musicSession.count()).toBe(1);
    expect((await db.musicQueueEntry.findMany()).map((e) => e.title)).toEqual(['public']);
  });

  it('shuffle keeps requester metadata and never moves the playing track', async () => {
    const { play, service, db } = setup();
    for (let i = 0; i < 6; i++) await play(VC1, staff, `t${i}`);
    const before = await db.musicQueueEntry.findMany();
    await service.shuffle(GUILD, VC1, staff);
    const after = await db.musicQueueEntry.findMany({ orderBy: { position: 'asc' } });
    expect(after[0]!.title).toBe('t0');
    for (const e of after) expect(e.requesterId).toBe(before.find((b) => b.id === e.id)!.requesterId);
    expect(after.map((e) => e.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('members remove/move only their own tracks; clear mine leaves others', async () => {
    const { play, service, db } = setup();
    const a = snow(10);
    const b = snow(11);
    await play(VC1, member(a), 'a0');
    await play(VC1, member(a), 'a1');
    await play(VC1, member(b), 'b1');
    expect((await service.remove(GUILD, VC1, member(a), 2)).ok).toBe(false);
    expect((await service.move(GUILD, VC1, member(a), 1, 2)).ok).toBe(true);
    expect((await service.clear(GUILD, VC1, member(a), true)).ok).toBe(true);
    const titles = (await db.musicQueueEntry.findMany({ orderBy: { position: 'asc' } })).map((e) => e.title);
    expect(titles).toEqual(['a0', 'b1']);
  });
});
