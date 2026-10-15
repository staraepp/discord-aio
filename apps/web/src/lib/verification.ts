import 'server-only';
import { getModuleState } from '@aio/core';
import { issueChallenge, pngDataUri, type ChallengeKind, type ChallengePrompt } from '@aio/core/verification';
import { db, guildId } from './server';
import { authSecret } from './session';
import { turnstileSiteKey } from './captcha';

export type VerificationMode = 'turnstile' | ChallengeKind;

/** Turnstile only when selected and configured; otherwise the picture code, or the text question if chosen. */
export async function verificationMode(): Promise<VerificationMode> {
  const { settings } = await getModuleState(db(), guildId(), 'verification');
  if (settings.captchaProvider === 'turnstile') return turnstileSiteKey() ? 'turnstile' : 'image';
  return settings.captchaProvider === 'builtin' ? 'math' : 'image';
}

/** Issues a fresh built-in challenge, replacing any previous one. Only an HMAC of the answer is stored. */
export async function newBuiltinChallenge(attemptId: string, kind: ChallengeKind): Promise<ChallengePrompt> {
  const c = await issueChallenge(db(), authSecret(), attemptId, kind);
  return c.kind === 'image' ? { kind: 'image', image: pngDataUri(c.png!) } : { kind: 'math', text: c.text! };
}
