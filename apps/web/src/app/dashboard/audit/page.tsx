'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Button, Card, Modal, PageHeader, Select, Spinner, formatDate } from '@/components/ui';
import { useToast } from '@/components/providers';

interface Entry {
  id: string;
  module: string;
  action: string;
  actorId: string | null;
  actorType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  createdAt: string;
}

const MODULES = ['', 'dashboard', 'music', 'tempvc', 'embeds', 'autoresponders', 'leveling', 'forms', 'moderation', 'tickets', 'welcome', 'verification', 'rolepanels', 'honeypot', 'ai'];

export default function AuditPage() {
  const [module, setModule] = useState('');
  const [items, setItems] = useState<Entry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<Entry | null>(null);
  const { fail } = useToast();
  const load = useCallback(
    (append: string | null) => {
      const q = new URLSearchParams();
      if (module) q.set('module', module);
      if (append) q.set('cursor', append);
      api<{ items: Entry[]; nextCursor: string | null }>(`/api/audit?${q}`)
        .then((r) => {
          setItems((prev) => (append && prev ? [...prev, ...r.items] : r.items));
          setCursor(r.nextCursor);
        })
        .catch(fail);
    },
    [module, fail],
  );
  useEffect(() => load(null), [load]);
  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" description="Every dashboard and staff configuration change. Secrets and private notes are never recorded." />
      <div className="max-w-xs">
        <Select label="Module" value={module} onChange={setModule} options={MODULES.map((m) => ({ value: m, label: m || 'All modules' }))} />
      </div>
      <Card>
        {!items ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Module</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-4 whitespace-nowrap text-muted">{formatDate(e.createdAt)}</td>
                    <td className="py-2 pr-4">{e.module}</td>
                    <td className="py-2 pr-4">{e.action}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.actorId ?? e.actorType}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.targetId ?? 'none'}</td>
                    <td className="py-2 text-right">
                      {(e.before != null || e.after != null || e.meta != null) && (
                        <Button size="sm" variant="ghost" onClick={() => setOpen(e)}>
                          Details
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <div className="mt-4">
            <Button onClick={() => load(cursor)}>Load more</Button>
          </div>
        )}
      </Card>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `${open.module} · ${open.action}` : ''} wide>
        {open && (
          <div className="grid gap-4 md:grid-cols-2">
            {(['before', 'after', 'meta'] as const).map((k) =>
              open[k] != null ? (
                <div key={k} className={k === 'meta' ? 'md:col-span-2' : ''}>
                  <p className="mb-1 text-xs text-muted uppercase">{k}</p>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-bg p-3 text-xs">{JSON.stringify(open[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
