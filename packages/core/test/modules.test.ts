import { describe, expect, it } from 'vitest';
import { Perm } from '@aio/permissions';
import { findMatchingRule, matchesTrigger, safeRegexTest, validateRegex, autoresponderInputSchema, type AutoresponderRule } from '../src/autoresponder/index';
import { authorizeRoomControl, clampBitrate, countHumans, planRoomOverwrites, renderRoomName, shouldDeleteRoom } from '../src/tempvc/index';
import { applyPreset, levelFromXp, rewardRolesFor, totalXpForLevel, xpMultiplier, xpToNext } from '../src/leveling/index';
import { levelingSettingsSchema } from '../src/settings/schemas';
import { toCsv, validateAnswers } from '../src/forms/index';
import { parseDuration, reasonRequired, validateReason, AutomodTracker, keywordHit } from '../src/moderation/index';
import { authorizeTicketAction, decideFirstResponder, planTicketOverwrites, ticketChannelName, toChannelName } from '../src/tickets/index';
import { applyOptionClick, applySelection, type PanelRules } from '../src/rolepanels/index';
import { effectiveHoneypotAction, honeypotConfigSchema, honeypotWarningCopy, isExempt, shouldTrigger } from '../src/honeypot/index';
import { composeGreeting } from '../src/welcome/index';

describe('autoresponder match modes', () => {
  it('supports exact, starts/ends with and contains (case-insensitive by default)', () => {
    expect(matchesTrigger('Hello', 'hello', 'exact')).toBe(true);
    expect(matchesTrigger('hello there', 'hello', 'exact')).toBe(false);
    expect(matchesTrigger('Hello there', 'hello', 'starts_with')).toBe(true);
    expect(matchesTrigger('say HELLO', 'hello', 'ends_with')).toBe(true);
    expect(matchesTrigger('I said hello!', 'hello', 'contains')).toBe(true);
    expect(matchesTrigger('Hello', 'hello', 'exact', true)).toBe(false);
  });

  it('supports regex with safeguards against catastrophic patterns', () => {
    expect(matchesTrigger('order #1234', 'order #\\d+', 'regex')).toBe(true);
    expect(validateRegex('(a+)+$').ok).toBe(false);
    expect(validateRegex('(a|aa)+').ok).toBe(false);
    expect(validateRegex('(\\w)\\1').ok).toBe(false);
    expect(validateRegex('x'.repeat(201)).ok).toBe(false);
    expect(validateRegex('[').ok).toBe(false);
    // Even if a slow pattern slipped through, execution is time-boxed.
    const r = safeRegexTest('^(\\w+\\s?)*$', 'a'.repeat(5000) + '!', false);
    expect(r.matched).toBe(false);
  });

  it('respects channel/role scopes and priority', () => {
    const base: AutoresponderRule = { id: '1', enabled: true, trigger: 'hi', matchMode: 'contains', caseSensitive: false, allowedChannelIds: [], blockedChannelIds: [], allowedRoleIds: [], blockedRoleIds: [], priority: 0 };
    const rules = [
      { ...base, id: 'low' },
      { ...base, id: 'high', priority: 5, allowedChannelIds: ['c1'] },
      { ...base, id: 'blocked', priority: 10, blockedRoleIds: ['r1'] },
    ];
    expect(findMatchingRule(rules, { content: 'hi', channelId: 'c1', roleIds: ['r1'] })!.id).toBe('high');
    expect(findMatchingRule(rules, { content: 'hi', channelId: 'c2', roleIds: [] })!.id).toBe('blocked');
    expect(findMatchingRule(rules, { content: 'bye', channelId: 'c2', roleIds: [] })).toBeUndefined();
  });

  it('validates dashboard input', () => {
    expect(autoresponderInputSchema.safeParse({ name: 'x', trigger: '(a+)+', matchMode: 'regex', responses: ['y'] }).success).toBe(false);
    expect(autoresponderInputSchema.safeParse({ name: 'x', trigger: 'hi', responseType: 'text', responses: [] }).success).toBe(false);
    expect(autoresponderInputSchema.safeParse({ name: 'x', trigger: 'hi', responses: ['hello {user.name}'] }).success).toBe(true);
  });
});

describe('temp VC lifecycle', () => {
  const now = new Date('2026-01-01T00:00:10Z');
  const grace = new Date('2026-01-01T00:00:30Z');
  it('does not delete a fresh room before the creator can be moved in', () => {
    expect(shouldDeleteRoom({ humans: 0, graceUntil: grace, now, creatorJoined: false })).toBe(false);
  });
  it('deletes immediately when the last human leaves', () => {
    expect(shouldDeleteRoom({ humans: 0, graceUntil: grace, now, creatorJoined: true })).toBe(true);
    expect(shouldDeleteRoom({ humans: 1, graceUntil: grace, now, creatorJoined: true })).toBe(false);
    expect(shouldDeleteRoom({ humans: 0, graceUntil: grace, now: new Date('2026-01-01T00:01:00Z'), creatorJoined: false })).toBe(true);
  });
  it('ignores bots when counting humans', () => {
    expect(countHumans([{ bot: true }, { bot: true }])).toBe(0);
    expect(countHumans([{ bot: true }, { bot: false }])).toBe(1);
  });
  it('plans overwrites for public/private/friends without permanent bans', () => {
    const base = { guildId: 'g', ownerId: 'o', botId: 'b', locked: false, hidden: false, allowedUserIds: ['f1'] };
    const pub = planRoomOverwrites({ ...base, visibility: 'public' });
    expect(pub.find((o) => o.id === 'g')!.deny).toBe(0n);
    const priv = planRoomOverwrites({ ...base, visibility: 'private' });
    expect(priv.find((o) => o.id === 'g')!.deny & Perm.Connect).toBe(Perm.Connect);
    expect(priv.find((o) => o.id === 'g')!.deny & Perm.ViewChannel).toBe(0n);
    const friends = planRoomOverwrites({ ...base, visibility: 'friends' });
    expect(friends.find((o) => o.id === 'g')!.deny & Perm.ViewChannel).toBe(Perm.ViewChannel);
    expect(friends.find((o) => o.id === 'f1')!.allow & Perm.Connect).toBe(Perm.Connect);
    for (const o of [...pub, ...priv, ...friends].filter((x) => x.type === 1)) expect(o.deny).toBe(0n);
  });
  it('renders names safely and clamps bitrate to the boost tier', () => {
    expect(renderRoomName("{emoji} {user.display_name}'s room", { user: { id: '1', name: 'ada', displayName: 'Ada' } }, '🎮')).toBe("🎮 Ada's room");
    expect(renderRoomName('{unknown}', {})).toBe('Voice room');
    expect(clampBitrate(384000, 0)).toBe(96000);
    expect(clampBitrate(128000, 2)).toBe(128000);
  });
  it('only owners (or staff) manage rooms; transfer target must be present', () => {
    expect(authorizeRoomControl({ actorId: 'x', ownerId: 'o', actorIsStaff: false, action: 'lock' }).ok).toBe(false);
    expect(authorizeRoomControl({ actorId: 'o', ownerId: 'o', actorIsStaff: false, action: 'transfer', targetId: 'n', targetInRoom: false }).ok).toBe(false);
    expect(authorizeRoomControl({ actorId: 'o', ownerId: 'o', actorIsStaff: false, action: 'transfer', targetId: 'n', targetInRoom: true }).ok).toBe(true);
  });
});

describe('leveling', () => {
  const s = levelingSettingsSchema.parse({});
  it('computes levels from XP consistently', () => {
    expect(xpToNext(0, 'quadratic', 1)).toBe(100);
    const total = totalXpForLevel(5, 'quadratic', 1);
    expect(levelFromXp(total, 'quadratic', 1).level).toBe(5);
    expect(levelFromXp(total - 1, 'quadratic', 1).level).toBe(4);
  });
  it('applies presets without touching unrelated settings', () => {
    const c = applyPreset({ ...s, ignoredChannelIds: ['123456789012345678'] }, 'competitive');
    expect(c.formula).toBe('exponential');
    expect(c.ignoredChannelIds).toEqual(['123456789012345678']);
  });
  it('handles ignores, bonuses, staff modes and opt-out', () => {
    const cfg = { ...s, ignoredChannelIds: ['111111111111111111'], bonusRoles: [{ id: '222222222222222222', multiplier: 2 }], staffMode: 'no_xp' as const };
    expect(xpMultiplier(cfg, { channelId: '111111111111111111', roleIds: [], isStaff: false, optedOut: false })).toBe(0);
    expect(xpMultiplier(cfg, { channelId: 'x', roleIds: ['222222222222222222'], isStaff: false, optedOut: false })).toBe(2);
    expect(xpMultiplier(cfg, { channelId: 'x', roleIds: [], isStaff: true, optedOut: false })).toBe(0);
    expect(xpMultiplier(cfg, { channelId: 'x', roleIds: [], isStaff: false, optedOut: true })).toBe(0);
  });
  it('computes role rewards with and without stacking', () => {
    const rewards = [
      { level: 5, roleId: 'r5' },
      { level: 10, roleId: 'r10' },
      { level: 20, roleId: 'r20' },
    ];
    expect(rewardRolesFor(12, rewards, true)).toEqual({ keep: ['r5', 'r10'], remove: [] });
    expect(rewardRolesFor(12, rewards, false)).toEqual({ keep: ['r10'], remove: ['r5', 'r20'] });
  });
});

describe('form answer validation', () => {
  const qs = [
    { id: 'name', type: 'short_text', label: 'Name', required: true, options: [], validation: { maxLength: 10 } },
    { id: 'id', type: 'short_text', label: 'Discord ID', required: false, options: [], validation: { pattern: 'discord_id' } },
    { id: 'pick', type: 'single_choice', label: 'Pick', required: true, options: ['A', 'B'], validation: {} },
    { id: 'many', type: 'multiple_choice', label: 'Many', required: false, options: ['x', 'y', 'z'], validation: { maxSelected: 2 } },
    { id: 'age', type: 'number', label: 'Age', required: false, options: [], validation: { min: 13, integer: true } },
    { id: 'tos', type: 'checkbox', label: 'Agree', required: true, options: [], validation: {} },
    { id: 'sec', type: 'section', label: 'Section', required: false, options: [], validation: {} },
  ] as never[];

  it('accepts valid answers', () => {
    const r = validateAnswers(qs, { name: 'Ada', id: '123456789012345678', pick: 'A', many: ['x'], age: '20', tos: 'on' });
    expect(r).toEqual({ ok: true, values: { name: 'Ada', id: '123456789012345678', pick: 'A', many: ['x'], age: 20, tos: true } });
  });

  it('reports field errors', () => {
    const r = validateAnswers(qs, { name: 'a'.repeat(11), id: 'abc', pick: 'C', many: ['x', 'y', 'z'], age: '12.5' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['age', 'id', 'many', 'name', 'pick', 'tos']);
  });

  it('exports CSV safely (formula injection neutralised)', () => {
    const csv = toCsv([{ id: 'q', label: 'Q', type: 'short_text' } as never], [{ id: 's', status: 'new', createdAt: new Date(0), editedAt: null, answers: [{ questionId: 'q', value: '=HYPERLINK("x")' }] }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('moderation rules', () => {
  it('requires reasons for warn/kick/ban variants only', () => {
    for (const t of ['warn', 'kick', 'ban', 'tempban', 'softban'] as const) {
      expect(reasonRequired(t)).toBe(true);
      expect(validateReason(t, '').ok).toBe(false);
      expect(validateReason(t, '  ').ok).toBe(false);
      expect(validateReason(t, 'spamming links').ok).toBe(true);
    }
    for (const t of ['timeout', 'untimeout', 'unban', 'purge', 'lock', 'voicekick'] as const) {
      expect(reasonRequired(t)).toBe(false);
      expect(validateReason(t, undefined)).toEqual({ ok: true, reason: null });
    }
  });
  it('parses durations', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('1d12h')).toBe(129_600_000);
    expect(parseDuration('2 hours')).toBeNull();
    expect(parseDuration('2hrs')).toBe(7_200_000);
    expect(parseDuration('soon')).toBeNull();
  });
  it('automod is conservative and detects obvious abuse', () => {
    expect(keywordHit('this is BADWORD here', ['badword'])).toBe('badword');
    expect(keywordHit('scunthorpe', ['cunt'])).toBeUndefined();
    let t = 0;
    const tracker = new AutomodTracker(() => t);
    const s = { keywords: [], spam: { enabled: true, maxMessages: 3, perSeconds: 5 }, mentions: { enabled: true, max: 3 }, repeated: { enabled: false, count: 3, withinSeconds: 60 } };
    expect(tracker.check('u', 'a', 5, s)?.rule).toBe('mentions');
    for (let i = 0; i < 3; i++) expect(tracker.check('u2', `m${i}`, 0, s)).toBeUndefined();
    expect(tracker.check('u2', 'm4', 0, s)?.rule).toBe('spam');
    t = 10_000;
    expect(tracker.check('u2', 'm5', 0, s)).toBeUndefined();
  });
});

describe('ticket naming and permissions', () => {
  const ticket = { firstResponderId: null, nameLocked: false, openerId: 'opener', number: 7, status: 'open' as const };
  const base = { ticket, authorId: 'staff1', authorIsStaff: true, authorIsBot: false, authorName: 'Mod One', openerName: 'Ada', handledNameTemplate: '{staff.name}-{user.name}' };

  it('first staff message renames once using the template', () => {
    expect(decideFirstResponder(base)).toEqual({ rename: true, name: 'mod-one-ada' });
  });
  it('later staff (takeover) never rename', () => {
    expect(decideFirstResponder({ ...base, ticket: { ...ticket, firstResponderId: 'staff1', nameLocked: true }, authorId: 'staff2' })).toEqual({ rename: false });
  });
  it('opener, bots and non-staff never trigger the rename', () => {
    expect(decideFirstResponder({ ...base, authorId: 'opener' })).toEqual({ rename: false });
    expect(decideFirstResponder({ ...base, authorIsStaff: false })).toEqual({ rename: false });
    expect(decideFirstResponder({ ...base, authorIsBot: true })).toEqual({ rename: false });
  });
  it('unclaimed channels use waiting-{user}', () => {
    expect(ticketChannelName('waiting-{user.name}', { userName: 'Ada Lovelace', number: 1 })).toBe('waiting-ada-lovelace');
    expect(toChannelName('Ünïcödé Name!!')).toBe('unicode-name');
  });
  it('users can never close or reopen; staff can', () => {
    expect(authorizeTicketAction({ action: 'close', actorIsStaff: false, ticketStatus: 'open' }).ok).toBe(false);
    expect(authorizeTicketAction({ action: 'reopen', actorIsStaff: false, ticketStatus: 'closed' }).ok).toBe(false);
    expect(authorizeTicketAction({ action: 'close', actorIsStaff: true, ticketStatus: 'open' }).ok).toBe(true);
    expect(authorizeTicketAction({ action: 'reopen', actorIsStaff: true, ticketStatus: 'closed' }).ok).toBe(true);
  });
  it('closing revokes opener access, reopening restores it', () => {
    const p = { guildId: 'g', botId: 'b', openerId: 'o', staffRoleIds: ['s'], participantIds: ['p'] };
    const open = planTicketOverwrites({ ...p, status: 'open' });
    const closed = planTicketOverwrites({ ...p, status: 'closed' });
    expect(open.find((o) => o.id === 'o')!.allow & Perm.ViewChannel).toBe(Perm.ViewChannel);
    expect(closed.find((o) => o.id === 'o')!.deny & Perm.ViewChannel).toBe(Perm.ViewChannel);
    expect(closed.find((o) => o.id === 'p')!.deny & Perm.ViewChannel).toBe(Perm.ViewChannel);
    expect(closed.find((o) => o.id === 's')!.allow & Perm.ViewChannel).toBe(Perm.ViewChannel);
    expect(open.find((o) => o.id === 'g')!.deny & Perm.ViewChannel).toBe(Perm.ViewChannel);
  });
});

describe('role panels', () => {
  const options = [
    { roleId: 'red', behavior: 'toggle' as const },
    { roleId: 'blue', behavior: 'toggle' as const },
    { roleId: 'green', behavior: 'toggle' as const },
  ];
  const rules: PanelRules = { exclusive: false, maxRoles: null, requiredRoleIds: [], blockedRoleIds: [] };
  it('exclusive selection swaps roles within the group', () => {
    const r = applyOptionClick({ rules: { ...rules, exclusive: true }, options, clicked: options[1]!, memberRoleIds: ['red'] });
    expect(r).toMatchObject({ ok: true, add: ['blue'], remove: ['red'] });
  });
  it('toggle removes a held role', () => {
    expect(applyOptionClick({ rules, options, clicked: options[0]!, memberRoleIds: ['red'] })).toMatchObject({ ok: true, add: [], remove: ['red'] });
  });
  it('enforces max roles, prerequisites and blocked roles', () => {
    expect(applyOptionClick({ rules: { ...rules, maxRoles: 1 }, options, clicked: options[1]!, memberRoleIds: ['red'] }).ok).toBe(false);
    expect(applyOptionClick({ rules: { ...rules, requiredRoleIds: ['member'] }, options, clicked: options[1]!, memberRoleIds: [] }).ok).toBe(false);
    expect(applyOptionClick({ rules: { ...rules, blockedRoleIds: ['muted'] }, options, clicked: options[1]!, memberRoleIds: ['muted'] }).ok).toBe(false);
  });
  it('select menus replace the member selection for the panel', () => {
    expect(applySelection({ rules, options, selectedRoleIds: ['blue', 'green'], memberRoleIds: ['red', 'other'] })).toMatchObject({ ok: true, add: ['blue', 'green'], remove: ['red'] });
    expect(applySelection({ rules: { ...rules, exclusive: true }, options, selectedRoleIds: ['blue', 'green'], memberRoleIds: [] }).ok).toBe(false);
  });
});

describe('honeypot', () => {
  const base = { userId: 'u', roleIds: ['r'], isBot: false, isAdmin: false, exemptRoleIds: [], exemptUserIds: [] };
  it('exempts staff roles, users, bots and admins', () => {
    expect(isExempt(base)).toBe(false);
    expect(isExempt({ ...base, exemptRoleIds: ['r'] })).toBe(true);
    expect(isExempt({ ...base, exemptUserIds: ['u'] })).toBe(true);
    expect(isExempt({ ...base, isBot: true })).toBe(true);
    expect(isExempt({ ...base, isAdmin: true })).toBe(true);
  });
  it('only triggers in the trap channel when enabled', () => {
    expect(shouldTrigger({ enabled: true, trapChannelId: 'c', messageChannelId: 'c', exempt: false })).toBe(true);
    expect(shouldTrigger({ enabled: false, trapChannelId: 'c', messageChannelId: 'c', exempt: false })).toBe(false);
    expect(shouldTrigger({ enabled: true, trapChannelId: 'c', messageChannelId: 'd', exempt: false })).toBe(false);
    expect(shouldTrigger({ enabled: true, trapChannelId: 'c', messageChannelId: 'c', exempt: true })).toBe(false);
  });
  it('requires explicit confirmation for destructive actions', () => {
    expect(honeypotConfigSchema.safeParse({ channelId: '123456789012345678', action: 'ban' }).success).toBe(false);
    expect(honeypotConfigSchema.safeParse({ channelId: '123456789012345678', action: 'ban', confirmDestructive: true }).success).toBe(true);
    expect(honeypotConfigSchema.safeParse({ channelId: '123456789012345678', action: 'delete_alert' }).success).toBe(true);
  });
  it('warning card describes the action that will actually run', () => {
    expect(effectiveHoneypotAction('softban', null)).toBe('delete_alert');
    expect(effectiveHoneypotAction('softban', 'admin-id')).toBe('softban');
    expect(honeypotWarningCopy('softban')).toMatchObject({ body: expect.stringContaining('**a softban**'), counterLabel: 'Softbans' });
    expect(honeypotWarningCopy('delete_alert').counterLabel).toBe('Caught');
    for (const a of ['delete_alert', 'kick', 'softban', 'ban'] as const) expect(JSON.stringify(honeypotWarningCopy(a))).not.toContain('—');
  });
});

describe('welcome/goodbye composition', () => {
  it('reuses saved embeds with optional plain content', () => {
    const saved = { content: undefined, embeds: [{ title: 'Hi', timestamp: false, fields: [] }], components: [] };
    expect(composeGreeting({ content: 'Welcome {user}!', savedTemplate: saved })?.content).toBe('Welcome {user}!');
    expect(composeGreeting({ content: '', savedTemplate: null })).toBeNull();
  });
});
