import { describe, expect, it } from 'vitest';
import { MAIN_STATUSES, MUSIC_STATUSES, pickStatus } from '../src/runtime/status';

const ALLOWED_EMOJI = new Set(['😭', '🥹', '🥺', '😔', '😛', '😣', '😨', '🫩']);

describe('bot statuses', () => {
  it('follow the server copy rules', () => {
    for (const line of [...MAIN_STATUSES, ...MUSIC_STATUSES]) {
      expect(line).not.toContain('—');
      expect(line.length).toBeLessThanOrEqual(40);
      for (const emoji of line.match(/\p{Extended_Pictographic}/gu) ?? []) expect(ALLOWED_EMOJI.has(emoji)).toBe(true);
    }
  });

  it('never repeats the same line twice in a row', () => {
    let prev: string | null = null;
    for (let i = 0; i < 200; i++) {
      const next = pickStatus(MAIN_STATUSES, prev);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});
