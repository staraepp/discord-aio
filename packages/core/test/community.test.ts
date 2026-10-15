import { describe, expect, it } from 'vitest';
import { emojiMatches, parsePollAnswers, pickWinners, starboardAction } from '../src/community/index';
import { starboardSettingsSchema } from '../src/settings/schemas';

describe('giveaway winners', () => {
  it('picks distinct winners, never more than the entrants', () => {
    const users = ['a', 'b', 'c', 'd', 'e'];
    const w = pickWinners(users, 3);
    expect(new Set(w).size).toBe(3);
    expect(w.every((u) => users.includes(u))).toBe(true);
    expect(pickWinners(['a', 'a', 'b'], 5).sort()).toEqual(['a', 'b']);
    expect(pickWinners([], 2)).toEqual([]);
  });

  it('gives every entrant the same chance', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 8000; i++) counts[pickWinners(['a', 'b', 'c', 'd'], 1)[0]!]!++;
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(1700); // about 2000 each
  });
});

describe('starboard', () => {
  it('matches unicode stars with or without the variation selector, and custom emojis by id', () => {
    expect(emojiMatches('⭐', { id: null, name: '⭐' })).toBe(true);
    expect(emojiMatches('⭐️', { id: null, name: '⭐' })).toBe(true);
    expect(emojiMatches('⭐', { id: null, name: '🌟' })).toBe(false);
    expect(emojiMatches('<:gold:123456789012345678>', { id: '123456789012345678', name: 'gold' })).toBe(true);
    expect(emojiMatches('123456789012345678', { id: '123456789012345678', name: 'whatever' })).toBe(true);
    expect(emojiMatches('<:gold:123456789012345678>', { id: null, name: 'gold' })).toBe(false);
  });

  it('posts at the threshold, updates above it and removes the copy below it', () => {
    expect(starboardAction({ stars: 3, threshold: 3, hasCopy: false })).toBe('create');
    expect(starboardAction({ stars: 7, threshold: 3, hasCopy: true })).toBe('update');
    expect(starboardAction({ stars: 2, threshold: 3, hasCopy: true })).toBe('delete');
    expect(starboardAction({ stars: 1, threshold: 3, hasCopy: false })).toBe('none');
  });

  it('accepts one emoji or a custom emoji and rejects text', () => {
    expect(starboardSettingsSchema.parse({}).emoji).toBe('⭐');
    expect(starboardSettingsSchema.safeParse({ emoji: '🥹' }).success).toBe(true);
    expect(starboardSettingsSchema.safeParse({ emoji: '<a:spin:123456789012345678>' }).success).toBe(true);
    expect(starboardSettingsSchema.safeParse({ emoji: 'star' }).success).toBe(false);
    expect(starboardSettingsSchema.safeParse({ emoji: '⭐ ⭐' }).success).toBe(false);
  });
});

describe('poll answers', () => {
  it('splits on | or new lines, trims and drops duplicates', () => {
    expect(parsePollAnswers('Pizza | Tacos |pizza| Sushi ')).toEqual({ ok: true, answers: ['Pizza', 'Tacos', 'Sushi'] });
    expect(parsePollAnswers('Yes\nNo')).toEqual({ ok: true, answers: ['Yes', 'No'] });
  });

  it("explains what's wrong", () => {
    expect(parsePollAnswers('Only one')).toMatchObject({ ok: false });
    expect(parsePollAnswers(Array.from({ length: 11 }, (_, i) => `a${i}`).join('|'))).toMatchObject({ ok: false });
    expect(parsePollAnswers(`short | ${'x'.repeat(60)}`)).toMatchObject({ ok: false });
  });
});
