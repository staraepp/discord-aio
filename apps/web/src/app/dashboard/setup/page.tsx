import { MODULES } from '@aio/core';
import { Perm } from '@aio/permissions';
import { musicIdentities } from '@aio/config';
import { env } from '@/lib/server';
import { integrations } from '@/lib/status';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup checklist' };

const MUSIC_ONLY = ['ViewChannel', 'Connect', 'Speak'] as const;

function inviteUrl(clientId: string | undefined, perms: bigint, withCommands: boolean): string | null {
  if (!clientId) return null;
  const q = new URLSearchParams({ client_id: clientId, permissions: perms.toString(), scope: withCommands ? 'bot applications.commands' : 'bot' });
  const g = env().GUILD_ID;
  if (g) {
    q.set('guild_id', g);
    q.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${q}`;
}

export default async function SetupPage() {
  const session = await getSession();
  if (!session?.isAdmin) redirect('/dashboard');
  const e = env();
  const perms = [...new Set(MODULES.flatMap((m) => m.botPermissions))];
  const bits = perms.reduce((acc, p) => acc | Perm[p], 0n);
  const musicBits = MUSIC_ONLY.reduce((acc, p) => acc | Perm[p], 0n);
  const intents = [...new Set(MODULES.flatMap((m) => m.intents))];
  const redirectUri = e.DISCORD_REDIRECT_URI ?? `${e.PUBLIC_BASE_URL}/api/auth/callback/discord`;
  const optional = musicIdentities(e).filter((i) => !i.isMain);
  const status = integrations();
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm break-all">{value}</dd>
    </div>
  );
  const invite = inviteUrl(e.DISCORD_CLIENT_ID, bits, true);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup checklist</h1>
        <p className="mt-1 text-sm text-muted">What to configure in the Discord Developer Portal and your environment. Values shown here are not secrets.</p>
      </div>
      <section className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
        <h2 className="mb-2 font-semibold">1. Main bot application</h2>
        <dl className="divide-y divide-line">
          {row('Privileged gateway intents', <>Enable <b>Server Members Intent</b> and <b>Message Content Intent</b> under Bot → Privileged Gateway Intents.</>)}
          {row('Intents used', intents.join(', '))}
          {row('Invite permissions', `${perms.join(', ')} (integer ${bits})`)}
          {row('Invite link', invite ? <a className="text-accent underline" href={invite} target="_blank" rel="noopener noreferrer">Invite the main bot</a> : 'Set DISCORD_CLIENT_ID to generate the invite link.')}
          {row('Role position', 'Drag the bot role above every role it should assign (verification, leveling rewards, role panels, autoresponder actions).')}
        </dl>
      </section>
      <section className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
        <h2 className="mb-2 font-semibold">2. Dashboard sign-in (OAuth2)</h2>
        <dl className="divide-y divide-line">
          {row('Redirect URI', <code>{redirectUri}</code>)}
          {row('Scope', 'identify (the dashboard checks admin permission in the server with the bot token)')}
          {row('Environment', 'DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, AUTH_SECRET (32+ random characters), PUBLIC_BASE_URL')}
        </dl>
      </section>
      <section className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
        <h2 className="mb-2 font-semibold">3. Optional music-only players</h2>
        <p className="mb-2 text-sm text-muted">Up to two extra bot applications can play music in parallel (three rooms total). They never register slash commands.</p>
        <dl className="divide-y divide-line">
          {row('Configured', optional.length ? optional.map((o) => `Player #${o.slot}`).join(', ') : 'None, the main bot is the only player.')}
          {row('Invite permissions', `${MUSIC_ONLY.join(', ')} (integer ${musicBits}), scope "bot" only, no intents required beyond Guilds + Voice States`)}
          {optional.map((o) => row(`Invite player #${o.slot}`, o.clientId ? <a className="text-accent underline" href={inviteUrl(o.clientId, musicBits, false)!} target="_blank" rel="noopener noreferrer">Invite</a> : `Set MUSIC_BOT_${o.slot}_CLIENT_ID`))}
        </dl>
      </section>
      <section className="rounded-[var(--radius-card)] border border-line bg-panel p-5">
        <h2 className="mb-2 font-semibold">4. Integrations</h2>
        <ul className="divide-y divide-line text-sm">
          {status.map((s) => (
            <li key={s.id} className="flex justify-between gap-3 py-2">
              <span>{s.label}</span>
              <span className={s.state === 'configured' ? 'text-good' : s.state === 'invalid' ? 'text-bad' : 'text-muted'}>{s.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">“Configured (not live-verified)” only means the variables exist. Live status comes from bot heartbeats on the Overview page.</p>
      </section>
    </div>
  );
}
