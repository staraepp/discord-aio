import { describe, expect, it, vi, afterEach } from 'vitest';
import { FailureAlarm, LavalinkSearch, describeTrackFailure, lavalinkNodes } from '../src/modules/music/lavalink';

const env = { LAVALINK_URL: 'http://lavalink:2333', LAVALINK_PASSWORD: 'server-pw', LAVALINK_SECURE: false };

describe('lavalink nodes', () => {
  it('puts the home node first and works with either node alone', () => {
    expect(lavalinkNodes({ ...env, LAVALINK_HOME_URL: 'http://home-link:2333', LAVALINK_HOME_PASSWORD: 'home-pw' })?.nodes.map((n) => n.id)).toEqual(['home', 'server']);
    expect(lavalinkNodes(env)?.nodes.map((n) => n.id)).toEqual(['server']);
    expect(lavalinkNodes({ LAVALINK_SECURE: false, LAVALINK_HOME_URL: 'http://home-link:2333', LAVALINK_HOME_PASSWORD: 'home-pw' })?.nodes.map((n) => n.id)).toEqual(['home']);
    expect(lavalinkNodes({ LAVALINK_SECURE: false, LAVALINK_HOME_URL: 'http://home-link:2333' })).toBeNull();
  });

  it('does not tell staff that a sign-in fixes a blocked server', () => {
    expect(describeTrackFailure('This video requires login.')).not.toMatch(/sign-in|staff/i);
  });
});

describe('search failover', () => {
  afterEach(() => vi.unstubAllGlobals());
  const cfg = lavalinkNodes({ ...env, LAVALINK_HOME_URL: 'http://home-link:2333', LAVALINK_HOME_PASSWORD: 'home-pw' })!;
  const ok = () => new Response(JSON.stringify({ loadType: 'empty', data: {} }), { status: 200 });

  it('searches on the home node, skips it for 30 s when it is down, then tries it again', async () => {
    let now = 0;
    const calls: string[] = [];
    let homeUp = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(`${new URL(url).hostname}:${init.headers.Authorization}`);
      if (url.includes('home-link') && !homeUp) throw new TypeError('fetch failed');
      return ok();
    }));
    const search = new LavalinkSearch(cfg, () => now);
    expect(search.activeNodeId()).toBe('home');

    expect(await search.load('ytsearch:ditto')).toEqual({ type: 'empty' });
    expect(calls).toEqual(['home-link:home-pw', 'lavalink:server-pw']);
    expect(search.activeNodeId()).toBe('server');

    calls.length = 0;
    await search.load('ytsearch:eta');
    expect(calls).toEqual(['lavalink:server-pw']);

    homeUp = true;
    now = 31_000;
    calls.length = 0;
    await search.load('ytsearch:eta');
    expect(calls).toEqual(['home-link:home-pw']);
    expect(search.activeNodeId()).toBe('home');
  });

  it('reports unreachable only when every node fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await new LavalinkSearch(cfg, () => 0).load('x')).toEqual({ type: 'error', message: 'The audio backend is unreachable.' });
  });
});

describe('YouTube failure alarm', () => {
  it('fires on the fifth failure within 10 minutes, then stays quiet for an hour', () => {
    const alarm = new FailureAlarm();
    const min = 60_000;
    expect([0, 1, 2, 3].map((m) => alarm.record(m * min))).toEqual([false, false, false, false]);
    expect(alarm.record(4 * min)).toBe(true);
    expect(alarm.record(5 * min)).toBe(false);
    // Failures spread out over time never add up to an alarm.
    const slow = new FailureAlarm();
    expect([0, 11, 22, 33, 44].map((m) => slow.record(m * min)).some(Boolean)).toBe(false);
    // After the quiet hour a new burst alarms again.
    expect([70, 71, 72, 73, 74].map((m) => alarm.record(m * min)).at(-1)).toBe(true);
  });
});
