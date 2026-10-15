import { redirect } from 'next/navigation';
import { Bot } from 'lucide-react';
import { env } from '@/lib/server';
import { devLoginAllowed, getSession } from '@/lib/session';
import { DevLoginButton } from './dev-login';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  invalid_state: 'The sign-in attempt expired or was tampered with. Please try again.',
  not_admin: 'Your Discord account does not have Administrator permission in the configured server.',
  oauth_failed: 'Discord sign-in failed. Please try again.',
  oauth_not_configured: 'Discord OAuth is not configured yet (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).',
  rate_limited: 'Too many sign-in attempts. Please wait a few minutes.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const session = await getSession().catch(() => null);
  if (session?.isAdmin) redirect('/dashboard');
  const e = env();
  const oauthReady = Boolean(e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET && e.AUTH_SECRET);
  const loginHref = `/api/auth/login${next?.startsWith('/dashboard') ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(50rem_28rem_at_50%_-8rem,rgb(88_101_242/0.10),transparent)] p-4 sm:p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-[var(--shadow-pop)] sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-brand text-white">
          <Bot className="size-6" aria-hidden />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Server dashboard</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">Sign in with Discord. Only administrators of the configured server can manage it.</p>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm leading-relaxed">
            {ERRORS[error] ?? 'Sign-in failed.'}
          </p>
        )}
        {!oauthReady && (
          <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm leading-relaxed">
            Not configured: set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and AUTH_SECRET in <code>.env</code>, then restart.
          </p>
        )}
        <a
          href={oauthReady ? loginHref : undefined}
          aria-disabled={!oauthReady}
          className="mt-6 flex h-11 items-center justify-center rounded-lg bg-brand font-medium text-white shadow-sm transition-colors hover:bg-brand-strong aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          Sign in with Discord
        </a>
        {devLoginAllowed() && <DevLoginButton />}
      </div>
    </main>
  );
}
