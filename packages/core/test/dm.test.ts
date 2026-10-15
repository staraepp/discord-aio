import { describe, expect, it } from 'vitest';
import { directMessageInputSchema, dmFailureMessage, linkButtonsOnly } from '../src/customize/dm';

const USER = '123456789012345678';

describe('direct message input', () => {
  it('accepts plain text or a saved embed, but not both or neither', () => {
    expect(directMessageInputSchema.safeParse({ userId: USER, content: 'hi {user.name}' }).success).toBe(true);
    expect(directMessageInputSchema.safeParse({ userId: USER, embedId: 'abc' }).success).toBe(true);
    expect(directMessageInputSchema.safeParse({ userId: USER, embedId: 'abc', content: 'hi' }).success).toBe(false);
    expect(directMessageInputSchema.safeParse({ userId: USER, content: '   ' }).success).toBe(false);
  });
  it('needs a real user id', () => {
    expect(directMessageInputSchema.safeParse({ userId: 'everyone', content: 'hi' }).success).toBe(false);
  });
});

describe('dm failures', () => {
  it('explains closed DMs', () => {
    expect(dmFailureMessage(50007)).toMatch(/DMs are closed/);
    expect(dmFailureMessage(undefined)).toMatch(/refused/);
  });
});

describe('dm components', () => {
  it('keeps only link buttons', () => {
    const rows = linkButtonsOnly([
      { type: 1, components: [{ type: 2, style: 5, label: 'Site', url: 'https://example.com' } as never, { type: 2, style: 1, label: 'Role', custom_id: 'x' } as never] },
      { type: 1, components: [{ type: 3, custom_id: 'menu', options: [] } as never] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.components).toHaveLength(1);
  });
});
