'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Alert, Badge, Card, PageHeader, PageSkeleton, formatDate } from '@/components/ui';

interface Diag {
  db: { ok: boolean; latencyMs: number; error?: string };
  bots: { id: string; online: boolean; botTag: string | null; latencyMs: number | null; lastSeen: string; details: unknown }[];
  integrations: { id: string; label: string; state: string; detail: string }[];
  errors: { id: string; errorId: string; source: string; message: string; createdAt: string }[];
  commands: { status: string; _count: number }[];
  failedCommands: { id: string; type: string; error: string | null; createdAt: string }[];
  identities: { slot: number; label: string; online: boolean; botUserId: string | null; lastError: string | null; updatedAt: string }[];
  node: string;
}

export default function DiagnosticsPage() {
  const [d, setD] = useState<Diag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Diag>('/api/diagnostics').then(setD).catch((e: Error) => setErr(e.message));
  }, []);
  if (err) return <Alert tone="bad" title="Diagnostics unavailable">{err}</Alert>;
  if (!d) return <PageSkeleton />;
  return (
    <div className="space-y-5">
      <PageHeader title="Diagnostics" description="Owner-only. Configuration state and recent errors; secret values are never shown." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Processes">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span>Database</span>
              <Badge tone={d.db.ok ? 'good' : 'bad'}>{d.db.ok ? `OK · ${d.db.latencyMs} ms` : (d.db.error ?? 'Down')}</Badge>
            </li>
            {d.bots.length === 0 && <li className="text-muted">No bot heartbeat has ever been recorded.</li>}
            {d.bots.map((b) => (
              <li key={b.id} className="flex justify-between">
                <span>
                  {b.id} {b.botTag && <span className="text-muted">({b.botTag})</span>}
                </span>
                <Badge tone={b.online ? 'good' : 'bad'}>{b.online ? `Online · ${b.latencyMs ?? '?'} ms` : `Offline since ${formatDate(b.lastSeen)}`}</Badge>
              </li>
            ))}
            <li className="flex justify-between text-muted">
              <span>Web runtime</span>
              <span>Node {d.node}</span>
            </li>
          </ul>
        </Card>
        <Card title="Music player identities">
          {d.identities.length === 0 ? (
            <p className="text-sm text-muted">No music identities have connected yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.identities.map((i) => (
                <li key={i.slot} className="flex justify-between gap-2">
                  <span>
                    #{i.slot} {i.label}
                  </span>
                  <span className="flex items-center gap-2">
                    {i.lastError && <span className="text-xs text-bad">{i.lastError}</span>}
                    <Badge tone={i.online ? 'good' : 'neutral'}>{i.online ? 'Online' : 'Offline'}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Integrations">
          <ul className="space-y-2 text-sm">
            {d.integrations.map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>{i.label}</span>
                <span className="text-right text-xs text-muted">{i.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Dashboard → bot queue">
          <ul className="flex flex-wrap gap-2">
            {d.commands.map((c) => (
              <Badge key={c.status} tone={c.status === 'failed' ? 'bad' : c.status === 'pending' ? 'warn' : 'neutral'}>
                {c.status}: {c._count}
              </Badge>
            ))}
          </ul>
          {d.failedCommands.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {d.failedCommands.map((c) => (
                <li key={c.id}>
                  <span className="text-muted">{formatDate(c.createdAt)}</span> {c.type}: {c.error}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Recent errors" description="Error IDs match what users see in Discord and in the dashboard.">
        {d.errors.length === 0 ? (
          <p className="text-sm text-muted">No errors recorded.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {d.errors.map((e) => (
              <li key={e.id} className="py-2">
                <p>
                  <code className="text-accent">{e.errorId}</code> <span className="text-muted">{e.source}</span> <span className="text-xs text-muted">{formatDate(e.createdAt)}</span>
                </p>
                <p className="text-muted">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
