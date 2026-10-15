import { describe, expect, it, vi } from 'vitest';
import { queueSpot, type AddedSummary, type AudioSearchPort } from '@aio/core/music';
import { addedCard, waitLabel } from '../src/modules/music/cards';
import { PlaySuggester, choiceName } from '../src/modules/music/suggest';

const entry = (id: string, position: number, durationMs: number | null, isStream = false) => ({ id, position, requesterId: 'u', durationMs, isStream });

describe('queue spot', () => {
  const t = { cursor: 0, entries: [entry('now', 0, 200_000), entry('a', 1, 180_000), entry('b', 2, 120_000), entry('c', 3, 60_000)] };

  it('adds the rest of the current song and every song ahead', () => {
    expect(queueSpot(t, 'now', { positionMs: 50_000, loopMode: 'off' })).toEqual({ playingNow: true, place: 0, etaMs: 0 });
    expect(queueSpot(t, 'a', { positionMs: 50_000, loopMode: 'off' })).toEqual({ playingNow: false, place: 1, etaMs: 150_000 });
    expect(queueSpot(t, 'c', { positionMs: 50_000, loopMode: 'off' })).toEqual({ playingNow: false, place: 3, etaMs: 450_000 });
  });

  it("can't know the wait behind a live stream or while one track loops", () => {
    const live = { cursor: 0, entries: [entry('now', 0, null, true), entry('a', 1, 180_000)] };
    expect(queueSpot(live, 'a', { positionMs: 0, loopMode: 'off' })?.etaMs).toBeNull();
    expect(queueSpot(t, 'b', { positionMs: 0, loopMode: 'track' })).toEqual({ playingNow: false, place: 2, etaMs: null });
    expect(queueSpot(t, 'missing', { positionMs: 0, loopMode: 'off' })).toBeNull();
  });
});

describe('added card', () => {
  const base: AddedSummary = { title: 'ETA', author: 'NewJeans', uri: 'https://youtu.be/x', artworkUrl: 'https://img/x.jpg', sourceName: 'youtube', durationMs: 151_000, isStream: false, count: 1, collectionName: null, spot: { playingNow: false, place: 2, etaMs: 402_000 }, notes: ['Playing from SoundCloud'] };

  it('shows place in line and wait for a queued song', () => {
    const c = addedCard(base);
    expect(c.eyebrow).toBe('Added to the queue');
    expect(c.title).toBe('ETA');
    expect(c.fields).toEqual([
      { name: 'Place in line', value: '#2', inline: true },
      { name: 'Plays in', value: '~6:42', inline: true },
    ]);
    expect(c.notes).toEqual(['Playing from SoundCloud']);
  });

  it('says "Playing now" without queue fields, and summarizes playlists', () => {
    expect(addedCard({ ...base, spot: { playingNow: true, place: 0, etaMs: 0 } })).toMatchObject({ eyebrow: 'Playing now', fields: [] });
    const pl = addedCard({ ...base, count: 23, collectionName: 'Get Up' });
    expect(pl.title).toBe('23 tracks from Get Up');
    expect(pl.url).toBeNull();
    expect(waitLabel({ ...base, spot: { playingNow: false, place: 1, etaMs: null } })).toBe('After the songs ahead of it');
  });

  it('never uses em dashes in its wording', () => {
    expect(JSON.stringify(addedCard(base))).not.toContain('—');
  });
});

describe('play suggestions', () => {
  it('fits names into 100 characters', () => {
    expect(choiceName('Ditto', 'NewJeans', 186_000)).toBe('Ditto · NewJeans · 3:06');
    const long = choiceName('x'.repeat(150), 'Artist', 60_000);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith(' · Artist · 1:00')).toBe(true);
  });

  const track = (title: string, uri: string) => ({ encoded: '', title, author: 'NewJeans', durationMs: 186_000, uri, sourceName: 'youtube', artworkUrl: null, isStream: false, isSeekable: true });

  it('suggests exact links, caches repeats and skips links and short input', async () => {
    const load = vi.fn<AudioSearchPort['load']>(async () => ({ type: 'search', tracks: [track('Ditto', 'https://yt/1'), track('Ditto', 'https://yt/1'), track('OMG', 'https://yt/2')] }));
    const s = new PlaySuggester({ load });
    expect(await s.suggest('ditto')).toEqual([
      { name: 'Ditto · NewJeans · 3:06', value: 'https://yt/1' },
      { name: 'OMG · NewJeans · 3:06', value: 'https://yt/2' },
    ]);
    await s.suggest('Ditto ');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await s.suggest('d')).toEqual([]);
    expect(await s.suggest('https://youtu.be/abc')).toEqual([]);
  });

  it('gives up quietly when the search is too slow for Discord', async () => {
    const load = vi.fn<AudioSearchPort['load']>(() => new Promise(() => undefined));
    expect(await new PlaySuggester({ load }, Date.now, 20).suggest('ditto')).toEqual([]);
  });
});
