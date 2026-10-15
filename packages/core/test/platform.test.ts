import { describe, expect, it } from 'vitest';
import {
  checkCanModerate,
  checkRoleAssignable,
  computeBasePermissions,
  computeChannelPermissions,
  canViewChannel,
  isAdmin,
  isMusicStaff,
  isStaff,
  isTicketStaff,
  Perm,
  type Actor,
} from '@aio/permissions';
import { neutraliseMentions, renderTemplate, sampleContext } from '@aio/variables';
import { messageTemplateSchema, parseTimestamp, renderMessageTemplate, renderTimeline, isSafeUrl } from '@aio/discord-ui';
import { redactString } from '@aio/logging';
import { decryptSecret, encryptSecret, generateToken, hashToken, signPayload, verifyPayload } from '../src/crypto/index';
import { runActions, type ActionExecutor } from '../src/actions/index';
import { commandsForEnabledModules, MODULES } from '../src/modules/index';
import { parseModuleSettings } from '../src/settings/index';
import { RateLimiter } from '../src/ratelimit/index';

const cfg = { staffRoleIds: ['900000000000000001'], musicStaffRoleIds: ['900000000000000002'], ticketStaffRoleIds: ['900000000000000003'] };
const member = (roles: string[] = [], permissions = 0n): Actor => ({ userId: '1', roleIds: roles, permissions });

describe('permission service', () => {
  it('treats Administrator and guild owner as admin', () => {
    expect(isAdmin(member([], Perm.Administrator))).toBe(true);
    expect(isAdmin({ ...member(), isGuildOwner: true })).toBe(true);
    expect(isAdmin(member([], Perm.ManageGuild))).toBe(false);
  });

  it('derives staff categories from configured roles without a DJ role', () => {
    expect(isStaff(member(['900000000000000001']), cfg)).toBe(true);
    expect(isStaff(member([]), cfg)).toBe(false);
    expect(isMusicStaff(member(['900000000000000002']), cfg)).toBe(true);
    expect(isTicketStaff(member(['900000000000000003']), cfg)).toBe(true);
    expect(isTicketStaff(member(['900000000000000002']), cfg)).toBe(false);
    expect(isStaff(member([], Perm.ModerateMembers), cfg)).toBe(true);
  });

  it('checks role hierarchy before assigning roles', () => {
    const base = { botHighestPosition: 10, botPermissions: Perm.ManageRoles };
    expect(checkRoleAssignable({ ...base, role: { id: 'r', position: 5 } }).ok).toBe(true);
    expect(checkRoleAssignable({ ...base, role: { id: 'r', position: 10 } }).ok).toBe(false);
    expect(checkRoleAssignable({ ...base, role: { id: 'r', position: 5, managed: true } }).ok).toBe(false);
    expect(checkRoleAssignable({ ...base, botPermissions: 0n, role: { id: 'r', position: 1 } }).ok).toBe(false);
    expect(checkRoleAssignable({ ...base, role: { id: 'r', position: 5 }, actorHighestPosition: 4 }).ok).toBe(false);
  });

  it('checks moderation hierarchy', () => {
    const base = { actorId: 'a', targetId: 't', botId: 'b', actorHighestPosition: 10, targetHighestPosition: 5, botHighestPosition: 20, actorIsOwner: false, targetIsOwner: false };
    expect(checkCanModerate(base).ok).toBe(true);
    expect(checkCanModerate({ ...base, targetHighestPosition: 10 }).ok).toBe(false);
    expect(checkCanModerate({ ...base, targetIsOwner: true }).ok).toBe(false);
    expect(checkCanModerate({ ...base, targetId: 'a' }).ok).toBe(false);
    expect(checkCanModerate({ ...base, botHighestPosition: 5 }).ok).toBe(false);
  });

  it('computes effective channel visibility with overwrites', () => {
    const guildId = '1';
    const roles = [
      { id: guildId, permissions: String(Perm.ViewChannel | Perm.SendMessages) },
      { id: 'unverified', permissions: '0' },
    ];
    const base = computeBasePermissions({ memberRoleIds: ['unverified'], guildId, ownerId: 'o', userId: 'u', roles });
    const hidden = computeChannelPermissions({ base, guildId, userId: 'u', memberRoleIds: ['unverified'], overwrites: [{ id: 'unverified', type: 0, allow: 0n, deny: Perm.ViewChannel }] });
    expect(canViewChannel(hidden)).toBe(false);
    const allowed = computeChannelPermissions({
      base,
      guildId,
      userId: 'u',
      memberRoleIds: ['unverified'],
      overwrites: [
        { id: guildId, type: 0, allow: 0n, deny: Perm.ViewChannel },
        { id: 'unverified', type: 0, allow: Perm.ViewChannel, deny: 0n },
      ],
    });
    expect(canViewChannel(allowed)).toBe(true);
  });
});

describe('variable rendering', () => {
  const ctx = sampleContext();
  it('{user} pings but {user.name} does not', () => {
    const ping = renderTemplate('Welcome {user}!', ctx);
    expect(ping.text).toBe('Welcome <@123456789012345678>!');
    expect(ping.mentionUserIds).toEqual(['123456789012345678']);
    const quiet = renderTemplate('Welcome {user.name}!', ctx);
    expect(quiet.text).toBe('Welcome ada!');
    expect(quiet.mentionUserIds).toEqual([]);
  });

  it('neutralises mass mentions in user-controlled values', () => {
    const r = renderTemplate('{user.name}', { user: { id: '1', name: '@everyone' } });
    expect(r.text).not.toBe('@everyone');
    expect(neutraliseMentions('<@&123456789012345678>')).not.toMatch(/^<@&/);
  });

  it('renders preview mode without raw mention syntax and keeps unknown variables', () => {
    const r = renderTemplate('{user} in {channel} {nope}', ctx, { preview: true });
    expect(r.text).toBe('@Ada in #general {nope}');
    expect(r.unknownVariables).toEqual(['nope']);
  });

  it('never evaluates expressions', () => {
    const r = renderTemplate('{constructor} {__proto__} {process.env}', ctx);
    expect(r.text).toBe('{constructor} {__proto__} {process.env}');
  });
});

describe('message templates', () => {
  it('validates limits and rejects unsafe URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('https://example.com/a.png')).toBe(true);
    const bad = messageTemplateSchema.safeParse({ embeds: [{ title: 'x', imageUrl: 'javascript:1' }] });
    expect(bad.success).toBe(false);
    const empty = messageTemplateSchema.safeParse({ embeds: [] });
    expect(empty.success).toBe(false);
  });

  it('renders variables, allowed mentions and component custom IDs', () => {
    const t = messageTemplateSchema.parse({
      content: 'Hi {user}',
      embeds: [{ title: 'Hello {user.name}', thumbnailUrl: '{user.avatar}', timestamp: true, fields: [] }],
      components: [[{ type: 'button', key: 'go', style: 'primary', label: 'Go' }, { type: 'button', key: 'site', style: 'link', label: 'Site', url: 'https://example.com' }]],
    });
    const r = renderMessageTemplate(t, sampleContext(), { customIdFor: (c) => `tpl:abc:${c.key}` });
    expect(r.content).toBe('Hi <@123456789012345678>');
    expect(r.allowed_mentions).toEqual({ parse: [], users: ['123456789012345678'], roles: [] });
    expect(r.embeds[0]!.title).toBe('Hello ada');
    expect(r.embeds[0]!.thumbnail?.url).toContain('cdn.discordapp.com');
    expect(r.components[0]!.components[0]).toMatchObject({ custom_id: 'tpl:abc:go', style: 1 });
    expect(r.components[0]!.components[1]).toMatchObject({ url: 'https://example.com', style: 5 });
  });

  it('formats timelines and parses seek timestamps', () => {
    expect(parseTimestamp('1:32')).toBe(92_000);
    expect(parseTimestamp('1:02:03')).toBe(3_723_000);
    expect(parseTimestamp('90')).toBe(90_000);
    expect(parseTimestamp('1m30s')).toBe(90_000);
    expect(parseTimestamp('abc')).toBeUndefined();
    const bar = renderTimeline(60_000, 120_000);
    expect(bar.startsWith('1:00 ')).toBe(true);
    expect(bar.endsWith(' 2:00')).toBe(true);
    expect(bar).toContain('●');
  });
});

describe('crypto', () => {
  const keyring = { current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) };
  it('encrypts BYOK secrets with AES-GCM and never stores plaintext', () => {
    const enc = encryptSecret('sk-test-1234567890', keyring);
    expect(enc).not.toContain('sk-test');
    expect(decryptSecret(enc, keyring)).toBe('sk-test-1234567890');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered, keyring)).toThrow();
  });

  it('supports key rotation via versioned keyring', () => {
    const old = { current: 1, keys: new Map([[1, Buffer.alloc(32, 1)]]) };
    const enc = encryptSecret('secret', old);
    const rotated = { current: 2, keys: new Map([[1, Buffer.alloc(32, 1)], [2, Buffer.alloc(32, 2)]]) };
    expect(decryptSecret(enc, rotated)).toBe('secret');
    expect(encryptSecret('x', rotated).startsWith('v2:')).toBe(true);
  });

  it('signs payloads with expiry', () => {
    const s = signPayload('k'.repeat(32), { a: 1 }, 1000, 0);
    expect(verifyPayload('k'.repeat(32), s, 500)).toMatchObject({ a: 1 });
    expect(verifyPayload('k'.repeat(32), s, 2000)).toBeNull();
    expect(verifyPayload('x'.repeat(32), s, 500)).toBeNull();
  });

  it('generates high-entropy tokens and stable hashes', () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(t)).toHaveLength(64);
    expect(hashToken(t)).toBe(hashToken(t));
  });
});

describe('logging redaction', () => {
  it('scrubs token-shaped secrets from strings', () => {
    const fakeBot = ['MTEwODIyMjY5ODQ0MzEyNDc5Nw', 'GxYzAb', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.');
    expect(redactString(`token ${fakeBot} end`)).not.toContain(fakeBot);
    expect(redactString('key AIzaSyA1234567890abcdefghijklmnopqrstuv')).toContain('[REDACTED]');
    expect(redactString('postgres://user:pw@host/db')).toBe('postgres://user:[REDACTED]@host/db');
  });
});

describe('module registry', () => {
  it('contains every required module and no economy', () => {
    const ids = MODULES.map((m) => m.id);
    for (const id of ['music', 'tempvc', 'embeds', 'autoresponders', 'leveling', 'forms', 'moderation', 'tickets', 'welcome', 'verification', 'rolepanels', 'honeypot', 'ai']) expect(ids).toContain(id);
    expect(ids.join()).not.toMatch(/econom/);
  });

  it('only registers commands for enabled modules', () => {
    const cmds = commandsForEnabledModules(new Set(['moderation']));
    expect(cmds.has('warn')).toBe(true);
    expect(cmds.has('play')).toBe(false);
    expect(cmds.has('help')).toBe(true);
  });

  it('falls back to defaults for invalid stored settings', () => {
    const r = parseModuleSettings('music', { panelIntervalSec: 99 });
    expect(r.invalid).toBe(true);
    expect(r.settings.panelIntervalSec).toBe(10);
    expect(parseModuleSettings('music', {}).settings.consecutiveLimit).toBe(5);
  });
});

describe('rate limiter', () => {
  it('limits within a sliding window', () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, () => now);
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(false);
    now = 1001;
    expect(rl.consume('a').allowed).toBe(true);
  });
});

describe('action engine', () => {
  function fakeExec(overrides: Partial<ActionExecutor> = {}) {
    const calls: string[] = [];
    const roles = new Set<string>(['111111111111111111']);
    const exec: ActionExecutor = {
      userId: 'u',
      memberHasRole: (r) => roles.has(r),
      checkRole: async (r) => (r === '999999999999999999' ? { ok: false, reason: 'above bot' } : { ok: true }),
      addRole: async (r) => void (roles.add(r), calls.push(`add:${r}`)),
      removeRole: async (r) => void (roles.delete(r), calls.push(`remove:${r}`)),
      send: async (m) => (calls.push(`send:${m.content}`), 'm1'),
      sendSavedEmbed: async () => 'm2',
      dm: async () => false,
      deleteTrigger: async () => void calls.push('delete'),
      deleteMessageLater: (id, s) => void calls.push(`later:${id}:${s}`),
      react: async (e) => void calls.push(`react:${e}`),
      log: async (t) => void calls.push(`log:${t}`),
      canSendTo: () => true,
      ...overrides,
    };
    return { exec, calls };
  }

  it('runs actions in order with hierarchy checks', async () => {
    const { exec, calls } = fakeExec();
    const results = await runActions(
      [
        { type: 'send_text', text: 'hi {user.name}' },
        { type: 'toggle_role', roleId: '111111111111111111' },
        { type: 'add_role', roleId: '999999999999999999' },
        { type: 'delete_response_after', seconds: 5 },
        { type: 'dm_user', text: 'x' },
      ],
      exec,
      sampleContext(),
      'test',
    );
    expect(calls).toEqual(['send:hi ada', 'remove:111111111111111111', 'later:m1:5']);
    expect(results.map((r) => r.ok)).toEqual([true, true, false, true, false]);
    expect(results[2]!.detail).toBe('above bot');
  });
});
