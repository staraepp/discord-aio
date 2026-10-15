import { describe, expect, it } from 'vitest';
import {
  botProfileSchema,
  checkCommandRule,
  CommandCooldowns,
  commandRuleSchema,
  commandSettingsSchema,
  mentionId,
  nextRunAt,
  OPT,
  parsePrefixArgs,
  renderReply,
  resolveCommandName,
  scheduledMessageInputSchema,
  tokenize,
  usageFor,
  type CmdSpec,
  type EntityResolver,
} from '../src/customize/index';

const ALICE = '111111111111111111';
const GENERAL = '222222222222222222';
const MODS = '333333333333333333';
const resolver: EntityResolver = {
  user: (t) => mentionId(t, 'user') ?? (t.toLowerCase() === 'alice' ? ALICE : null),
  channel: (t) => mentionId(t, 'channel') ?? (t.replace(/^#/, '') === 'general' ? GENERAL : null),
  role: (t) => mentionId(t, 'role') ?? (t.toLowerCase() === 'mods' ? MODS : null),
};

const str = (name: string, required = false, extra = {}) => ({ type: OPT.STRING, name, required, ...extra });
const user = (name: string, required = false) => ({ type: OPT.USER, name, required });
const int = (name: string, required = false, extra = {}) => ({ type: OPT.INTEGER, name, required, ...extra });
const chan = (name: string, required = false) => ({ type: OPT.CHANNEL, name, required });

const warn: CmdSpec = { name: 'warn', options: [user('member', true), str('reason', true), str('evidence')] };
const timeout: CmdSpec = { name: 'timeout', options: [user('member', true), str('duration', true), str('reason')] };
const ban: CmdSpec = { name: 'ban', options: [user('user', true), str('reason', true), int('delete_days', false, { min_value: 0, max_value: 7 }), str('evidence')] };
const queue: CmdSpec = { name: 'queue', options: [{ type: OPT.SUB, name: 'view', options: [int('page')] }, { type: OPT.SUB, name: 'search', options: [str('query', true)] }] };
const embed: CmdSpec = { name: 'embed', options: [{ type: OPT.SUB, name: 'create', options: [str('name', true)] }, { type: OPT.SUB, name: 'send', options: [str('name', true, { autocomplete: true }), chan('channel')] }] };
const lock: CmdSpec = { name: 'lock', options: [chan('channel'), str('reason')] };
const loop: CmdSpec = { name: 'loop', options: [str('mode', true, { choices: [{ name: 'Off', value: 'off' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' }] })] };
const volume: CmdSpec = { name: 'volume', options: [int('percent', true, { min_value: 0, max_value: 200 })] };

const vals = (r: ReturnType<typeof parsePrefixArgs>) => {
  if (!r.ok) throw new Error(r.error);
  return Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v.value]));
};

describe('prefix parsing', () => {
  it('tokenizes quotes and keeps positions', () => {
    expect(tokenize('a "b c"  “d e” f').map((t) => t.text)).toEqual(['a', 'b c', 'd e', 'f']);
  });

  it('+warn @user being bad: the reason takes the rest', () => {
    expect(vals(parsePrefixArgs('+', warn, `<@${ALICE}> being   bad`, resolver))).toEqual({ member: ALICE, reason: 'being   bad' });
  });

  it('named values work anywhere, including multi-word text', () => {
    expect(vals(parsePrefixArgs('+', warn, `alice spam links evidence:https://x.test/a b`, resolver))).toEqual({ member: ALICE, reason: 'spam links', evidence: 'https://x.test/a b' });
    expect(vals(parsePrefixArgs('+', ban, `alice delete_days:1 raid bot`, resolver))).toEqual({ user: ALICE, delete_days: 1, reason: 'raid bot' });
  });

  it('+timeout keeps the duration as one word and the reason as the rest', () => {
    expect(vals(parsePrefixArgs('+', timeout, `alice 10m calm down please`, resolver))).toEqual({ member: ALICE, duration: '10m', reason: 'calm down please' });
  });

  it('reports what is missing with usage', () => {
    const r = parsePrefixArgs('+', warn, `alice`, resolver);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Missing reason/);
      expect(r.usage).toBe('+warn <member> <reason…> [evidence]');
    }
    const who = parsePrefixArgs('+', warn, `nobody spam`, resolver);
    expect(!who.ok && who.error).toMatch(/couldn't find a member/);
  });

  it('subcommands, with the first one as default when it needs nothing', () => {
    const view = parsePrefixArgs('+', queue, '2', resolver);
    expect(view.ok && view.sub).toBe('view');
    expect(vals(view)).toEqual({ page: 2 });
    const search = parsePrefixArgs('+', queue, 'search never gonna', resolver);
    expect(search.ok && search.sub).toBe('search');
    expect(vals(search)).toEqual({ query: 'never gonna' });
    const bad = parsePrefixArgs('+', embed, '', resolver);
    expect(!bad.ok && bad.usage).toBe('+embed <create|send> …');
  });

  it('leaves trailing typed values for later options', () => {
    expect(vals(parsePrefixArgs('+', embed, 'send big welcome #general', resolver))).toEqual({ name: 'big welcome', channel: GENERAL });
  });

  it('skips optional options that do not match', () => {
    expect(vals(parsePrefixArgs('+', lock, 'raid in progress', resolver))).toEqual({ reason: 'raid in progress' });
    expect(vals(parsePrefixArgs('+', lock, `<#${GENERAL}> raid`, resolver))).toEqual({ channel: GENERAL, reason: 'raid' });
  });

  it('choices and number ranges', () => {
    expect(vals(parsePrefixArgs('+', loop, 'TRACK', resolver))).toEqual({ mode: 'track' });
    expect(parsePrefixArgs('+', loop, 'forever', resolver).ok).toBe(false);
    expect(vals(parsePrefixArgs('+', volume, '150%', resolver))).toEqual({ percent: 150 });
    const high = parsePrefixArgs('+', volume, '500', resolver);
    expect(!high.ok && high.error).toMatch(/at most 200/);
  });

  it('usage marks the greedy option', () => {
    expect(usageFor('!', ban)).toBe('!ban <user> <reason…> [delete_days] [evidence]');
    expect(usageFor('+', loop)).toBe('+loop <Off|Track|Queue>');
  });
});

describe('command settings', () => {
  it('validates the prefix and duplicate aliases', () => {
    expect(commandSettingsSchema.parse({}).prefix).toBe('+');
    expect(commandSettingsSchema.safeParse({ prefix: '+ ' }).success).toBe(false);
    expect(commandSettingsSchema.safeParse({ prefix: '@' }).success).toBe(false);
    expect(commandSettingsSchema.safeParse({ commands: { play: { aliases: ['p'] }, pause: { aliases: ['p'] } } }).success).toBe(false);
  });

  it('real names win over aliases', () => {
    const s = commandSettingsSchema.parse({ commands: { play: { aliases: ['p', 'skip'] } } });
    const names = new Set(['play', 'skip']);
    expect(resolveCommandName('P', names, s)).toBe('play');
    expect(resolveCommandName('skip', names, s)).toBe('skip');
    expect(resolveCommandName('nope', names, s)).toBeNull();
  });

  it('rules: disabled, channels (incl. thread parent), roles; admins bypass restrictions but not disabled', () => {
    const rule = commandRuleSchema.parse({ allowedChannelIds: [GENERAL], allowedRoleIds: [MODS] });
    const who = { roleIds: [MODS], isAdmin: false, channelId: GENERAL };
    expect(checkCommandRule(rule, 'play', who).ok).toBe(true);
    expect(checkCommandRule(rule, 'play', { ...who, channelId: '9'.repeat(18), parentChannelId: GENERAL }).ok).toBe(true);
    expect(checkCommandRule(rule, 'play', { ...who, channelId: '9'.repeat(18) })).toMatchObject({ ok: false, reply: 'command.wrongChannel' });
    expect(checkCommandRule(rule, 'play', { ...who, roleIds: [] })).toMatchObject({ ok: false, reply: 'command.missingRole' });
    expect(checkCommandRule(rule, 'play', { ...who, roleIds: [], isAdmin: true }).ok).toBe(true);
    expect(checkCommandRule({ ...rule, enabled: false }, 'play', { ...who, isAdmin: true })).toMatchObject({ ok: false, reply: 'command.disabled' });
  });

  it('cooldowns are per user and per command', () => {
    const c = new CommandCooldowns();
    expect(c.hit('play', 'a', 10, 0)).toBe(0);
    expect(c.hit('play', 'a', 10, 4000)).toBe(6);
    expect(c.hit('play', 'b', 10, 4000)).toBe(0);
    expect(c.hit('play', 'a', 10, 10_000)).toBe(0);
  });

  it('replies can be reworded and keep variables', () => {
    const profile = botProfileSchema.parse({ replies: { 'command.cooldown': 'chill for {seconds}s 🫩' } });
    expect(renderReply(profile, 'command.cooldown', { seconds: 3, command: 'play' })).toBe('chill for 3s 🫩');
    expect(renderReply(null, 'module.disabled')).toBe('That module is currently disabled.');
  });
});

describe('schedules', () => {
  const tz = 'America/Sao_Paulo'; // UTC-3, no DST
  it('daily at a wall-clock time in the zone', () => {
    const after = new Date('2026-09-27T11:00:00Z'); // 08:00 local
    expect(nextRunAt({ kind: 'daily', time: '09:30' }, tz, after)?.toISOString()).toBe('2026-09-27T12:30:00.000Z');
    expect(nextRunAt({ kind: 'daily', time: '07:00' }, tz, after)?.toISOString()).toBe('2026-09-28T10:00:00.000Z');
  });

  it('weekly picks the next listed weekday', () => {
    // 2026-09-27 is a Sunday.
    const r = nextRunAt({ kind: 'weekly', time: '18:00', days: [3] }, tz, new Date('2026-09-27T12:00:00Z'));
    expect(r?.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('handles daylight saving (New York)', () => {
    const ny = 'America/New_York';
    // DST ends 2026-11-01: 09:00 is 13:00Z before and 14:00Z after.
    expect(nextRunAt({ kind: 'daily', time: '09:00' }, ny, new Date('2026-10-31T14:00:00Z'))?.toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(nextRunAt({ kind: 'daily', time: '09:00' }, ny, new Date('2026-10-30T12:00:00Z'))?.toISOString()).toBe('2026-10-30T13:00:00.000Z');
  });

  it('once and interval', () => {
    const at = '2026-10-01T10:00:00Z';
    expect(nextRunAt({ kind: 'once', at }, tz, new Date('2026-09-30T00:00:00Z'))?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(nextRunAt({ kind: 'once', at }, tz, new Date('2026-10-02T00:00:00Z'))).toBeNull();
    const anchor = new Date('2026-09-27T00:00:00Z');
    expect(nextRunAt({ kind: 'interval', everyMinutes: 60 }, tz, new Date('2026-09-27T02:30:00Z'), anchor)?.toISOString()).toBe('2026-09-27T03:00:00.000Z');
  });

  it('input needs exactly one of embed or text, a real timezone and a sane interval', () => {
    const base = { name: 'Daily hi', channelId: GENERAL, schedule: { kind: 'daily', time: '09:00' }, timezone: tz };
    expect(scheduledMessageInputSchema.safeParse({ ...base, content: 'hi' }).success).toBe(true);
    expect(scheduledMessageInputSchema.safeParse(base).success).toBe(false);
    expect(scheduledMessageInputSchema.safeParse({ ...base, content: 'hi', embedId: 'x' }).success).toBe(false);
    expect(scheduledMessageInputSchema.safeParse({ ...base, content: 'hi', timezone: 'Mars/Base' }).success).toBe(false);
    expect(scheduledMessageInputSchema.safeParse({ ...base, content: 'hi', schedule: { kind: 'interval', everyMinutes: 1 } }).success).toBe(false);
  });
});
