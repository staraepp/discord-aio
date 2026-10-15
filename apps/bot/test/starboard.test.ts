import { describe, expect, it } from 'vitest';
import type { GuildTextBasedChannel } from 'discord.js';
import { sameAudience } from '../src/modules/starboard/index.js';

/** A fake channel where `visible` lists the role ids that can view it. */
function channel(roles: string[], visible: string[]): GuildTextBasedChannel {
  const all = new Map(roles.map((id) => [id, { id }]));
  return {
    guild: { roles: { cache: { every: (fn: (r: { id: string }) => boolean) => [...all.values()].every(fn) } } },
    permissionsFor: (role: { id: string }) => ({ has: () => visible.includes(role.id) }),
  } as unknown as GuildTextBasedChannel;
}

describe('starboard audience check', () => {
  const roles = ['everyone', 'verified', 'staff'];
  it('allows a public message onto a public starboard', () => {
    expect(sameAudience(channel(roles, ['verified', 'staff']), channel(roles, ['verified', 'staff']))).toBe(true);
  });
  it('never copies a staff channel message to a starboard members can read', () => {
    expect(sameAudience(channel(roles, ['staff']), channel(roles, ['verified', 'staff']))).toBe(false);
  });
  it('allows a public message onto a staff-only starboard', () => {
    expect(sameAudience(channel(roles, ['verified', 'staff']), channel(roles, ['staff']))).toBe(true);
  });
});
