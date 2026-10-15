import { describe, expect, it } from 'vitest';
import { MODULES } from '@aio/core';
import { allCommands, validateCommandOwnership } from '../src/commands/registry';

describe('slash command registry', () => {
  const commands = allCommands();
  const names = commands.map((c) => c.data.name);

  it('every command belongs to the module that declares it', () => {
    expect(validateCommandOwnership()).toEqual([]);
  });

  it('has no duplicate command names', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('implements every command declared by the module registry', () => {
    const declared = MODULES.flatMap((m) => m.commands);
    expect(declared.filter((n) => !names.includes(n))).toEqual([]);
  });

  it('contains none of the excluded features', () => {
    const banned = ['balance', 'daily', 'shop', 'economy', 'profile', 'achievements', 'voteskip', 'dj', 'autoplay', 'blacklist', 'vpn', 'shard', 'cluster'];
    expect(names.filter((n) => banned.includes(n))).toEqual([]);
  });

  it('keeps Discord limits for names and descriptions', () => {
    for (const c of commands) {
      expect(c.data.name).toMatch(/^[\w-]{1,32}$/);
      expect(c.data.description.length).toBeLessThanOrEqual(100);
    }
  });
});
