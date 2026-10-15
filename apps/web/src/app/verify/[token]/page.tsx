import { lookupAttempt } from '@aio/core/verification';
import { getModuleState } from '@aio/core';
import { db, guildId } from '@/lib/server';
import { turnstileSiteKey } from '@/lib/captcha';
import { newBuiltinChallenge, verificationMode } from '@/lib/verification';
import { PublicShell } from '@/app/public-shell';
import { VerifyForm } from './verify-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verify', referrer: 'no-referrer' as const };

const MESSAGES = {
  invalid: 'This verification link is not valid. Go back to Discord and press Verify to get a new one.',
  expired: 'This verification link has expired. Go back to Discord and press Verify to get a new one.',
  used: 'This verification link was already used. Go back to Discord and press Verify to get a new one.',
  cooldown: 'Verification is paused for your account for a little while. You have not been removed from the server, so just try again a bit later.',
};

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupAttempt(db(), token);
  const { settings } = await getModuleState(db(), guildId(), 'verification');
  if (!found.ok) {
    return (
      <PublicShell title="Verification">
        <p role="alert" className="rounded-lg border border-line bg-panel-2 p-4">
          {MESSAGES[found.reason]}
        </p>
      </PublicShell>
    );
  }
  const mode = await verificationMode();
  const prompt = mode === 'turnstile' ? null : await newBuiltinChallenge(found.attempt.id, mode);
  return (
    <PublicShell title="Verify you're human" description="Complete the check below to get access to the server.">
      {settings.captchaProvider === 'turnstile' && mode !== 'turnstile' && (
        <p className="text-xs text-muted">The configured CAPTCHA service is unavailable, so a picture check is used instead.</p>
      )}
      <VerifyForm token={token} mode={mode} prompt={prompt} siteKey={mode === 'turnstile' ? turnstileSiteKey() : null} cdata={found.attempt.id} />
    </PublicShell>
  );
}
