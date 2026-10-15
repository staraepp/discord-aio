'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { ArrowRight } from 'lucide-react';
import { Alert, Badge, Card, PageHeader, PageSkeleton, Stat, cx, formatDate } from '@/components/ui';
import { useToast } from '@/components/providers';

interface Overview {
  modules: { id: string; name: string; description: string; route: string; enabled: boolean; integrations: string[] }[];
  bots: { id: string; online: boolean; botTag: string | null; latencyMs: number | null; lastSeen: string }[];
  integrations: { id: string; label: string; state: 'configured' | 'not_configured' | 'invalid'; detail: string }[];
  counts: { openTickets: number; newResponses: number; activeMusic: number; errors24h: number };
  recentAudit: { id: string; module: string; action: string; actorId: string | null; createdAt: string }[];
}

const STATE_TONE = { configured: 'good', not_configured: 'neutral', invalid: 'bad' } as const;

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const { fail } = useToast();
  useEffect(() => {
    api<Overview>('/api/overview').then(setData).catch(fail);
  }, [fail]);
  if (!data) return <PageSkeleton />;
  const main = data.bots.find((b) => b.id === 'main');
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Status of the bot, modules and integrations for this server." />
      {!main?.online && (
        <Alert tone="warn" title="The bot is not connected">
          No recent heartbeat from the main bot. Changes are saved and will apply when it starts. Check that <code>TOKEN</code> is a real bot token and the bot process is running.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Main bot"
          value={
            <span className="flex items-center gap-2">
              <span className={cx('size-2.5 rounded-full', main?.online ? 'bg-good' : 'bg-bad')} aria-hidden />
              {main?.online ? 'Online' : 'Offline'}
            </span>
          } hint={main?.online ? `${main.botTag ?? ''} · ${main.latencyMs ?? '?'} ms` : main ? `Last seen ${formatDate(main.lastSeen)}` : 'Never connected'} />
        <Stat label="Open tickets" value={data.counts.openTickets} />
        <Stat label="New form responses" value={data.counts.newResponses} />
        <Stat label="Active music rooms" value={`${data.counts.activeMusic} / 3`} />
      </div>
      <Card title="Modules" description="Turn modules on or off from their pages. Disabled modules have no slash commands.">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.modules.map((m) => (
            <li key={m.id}>
              <Link
                href={m.route}
                className="group flex h-full flex-col rounded-xl border border-line bg-bg/40 p-4 transition-colors hover:border-accent/50 hover:bg-panel-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{m.name}</span>
                  <Badge tone={m.enabled ? 'good' : 'neutral'}>{m.enabled ? 'On' : 'Off'}</Badge>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{m.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Integrations" description="“Configured” means the settings exist. It is not a live connection test.">
          <ul className="divide-y divide-line">
            {data.integrations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block">{i.label}</span>
                  <span className="block text-xs text-muted">{i.detail}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={STATE_TONE[i.state]}>{i.state === 'configured' ? 'Configured' : i.state === 'invalid' ? 'Invalid' : 'Not configured'}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent changes" actions={
            <Link className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-accent hover:underline" href="/dashboard/audit">
              View all <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }>
          {data.recentAudit.length === 0 ? (
            <p className="text-sm text-muted">No changes yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.recentAudit.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="text-muted">{a.module}</span> · {a.action}
                  </span>
                  <span className="text-xs text-muted">{formatDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
