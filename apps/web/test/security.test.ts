import { describe, expect, it } from 'vitest';
import { csrfProblem } from '../src/lib/csrf';
import { assignableRoleIdsFromActions, collectIds } from '../src/lib/ids';
import { pickClientIp } from '../src/lib/client-ip';

const base = { host: 'dash.example.com', expectedOrigin: 'https://dash.example.com', csrfHeader: '1' };

describe('CSRF guard', () => {
  it('allows safe methods without checks', () => {
    expect(csrfProblem({ ...base, method: 'GET', origin: null, csrfHeader: null })).toBeNull();
  });
  it('allows same-origin mutations with the custom header', () => {
    expect(csrfProblem({ ...base, method: 'POST', origin: 'https://dash.example.com' })).toBeNull();
  });
  it('blocks missing or foreign origins', () => {
    expect(csrfProblem({ ...base, method: 'POST', origin: null })).toMatch(/Cross-site/);
    expect(csrfProblem({ ...base, method: 'PUT', origin: 'https://evil.example' })).toMatch(/Cross-site/);
    expect(csrfProblem({ ...base, method: 'DELETE', origin: 'not a url' })).toMatch(/Cross-site/);
  });
  it('blocks lookalike subdomains', () => {
    expect(csrfProblem({ ...base, method: 'POST', origin: 'https://dash.example.com.evil.io' })).toMatch(/Cross-site/);
  });
  it('requires the custom header even from the same origin (form posts cannot set it)', () => {
    expect(csrfProblem({ ...base, method: 'POST', origin: 'https://dash.example.com', csrfHeader: null })).toMatch(/CSRF header/);
  });
});

describe('client-supplied Discord ID collection', () => {
  it('classifies nested role and channel IDs by key name', () => {
    const ids = collectIds({
      verifiedRoleId: '111111111111111111',
      allowlistChannelIds: ['222222222222222222'],
      bonusChannels: [{ id: '333333333333333333', multiplier: 2 }],
      bonusRoles: [{ id: '444444444444444444', multiplier: 2 }],
      categoryIds: ['555555555555555555'],
      note: '666666666666666666',
    });
    expect(ids.roles.sort()).toEqual(['111111111111111111', '444444444444444444']);
    expect(ids.channels.sort()).toEqual(['222222222222222222', '333333333333333333', '555555555555555555']);
  });
  it('only treats role-mutating actions as assignable', () => {
    expect(
      assignableRoleIdsFromActions([
        { type: 'add_role', roleId: '1' },
        { type: 'toggle_role', roleId: '2' },
        { type: 'send_text' },
      ]),
    ).toEqual(['1', '2']);
  });
});

describe('client IP for rate limits', () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it('behind Cloudflare Tunnel, trusts only CF-Connecting-IP', () => {
    expect(pickClientIp(headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }), 'cloudflare')).toBe('203.0.113.9');
    expect(pickClientIp(headers({ 'x-forwarded-for': '1.1.1.1' }), 'cloudflare')).toBe('unknown');
  });

  it('never uses the client-supplied first X-Forwarded-For entry', () => {
    expect(pickClientIp(headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }), 'none')).toBe('198.51.100.4');
    expect(pickClientIp(headers({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }), 'none')).toBe('198.51.100.7');
    expect(pickClientIp(headers({}), 'none')).toBe('unknown');
  });
});
