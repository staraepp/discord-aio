'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { api } from '@/lib/client';
import { Badge, Card, Empty, Spinner, Toggle, buttonClass, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { useToast } from '@/components/providers';

interface FormRow {
  id: string;
  title: string;
  slug: string;
  isOpen: boolean;
  allowEdit: boolean;
  updatedAt: string;
  newResponses: number;
  _count: { submissions: number; questions: number };
}

export default function FormsPage() {
  const ctl = useModuleSettings<Record<string, never>>('forms');
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const { fail, notify } = useToast();
  const load = useCallback(() => api<FormRow[]>('/api/forms').then(setForms).catch(fail), [fail]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ModuleShell
      title="Forms"
      description="Public forms anyone can fill in without a Discord login. Responses are reviewed here in the dashboard only. Typed usernames or IDs are not verified identity."
      ctl={ctl}
      actions={
        <Link href="/dashboard/forms/new" className={buttonClass('primary')}>
          <Plus className="size-4" /> New form
        </Link>
      }
    >
      {!forms ? (
        <Spinner />
      ) : forms.length === 0 ? (
        <Empty title="No forms yet" action={<Link className="text-accent underline" href="/dashboard/forms/new">Create a form</Link>}>
          Applications, feedback, event sign-ups. Share a link and review answers here.
        </Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {forms.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {f.title} <Badge tone={f.isOpen ? 'good' : 'neutral'}>{f.isOpen ? 'Open' : 'Closed'}</Badge> {f.newResponses > 0 && <Badge tone="accent">{f.newResponses} new</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    /f/{f.slug} · {f._count.questions} questions · {f._count.submissions} responses · updated {formatDate(f.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    label={<span className="sr-only">Accept responses</span>}
                    checked={f.isOpen}
                    onChange={async (isOpen) => {
                      try {
                        await api(`/api/forms/${f.id}`, { method: 'PATCH', body: { isOpen } });
                        notify(isOpen ? 'Form opened.' : 'Form closed.');
                        void load();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  />
                  <a href={`/f/${f.slug}`} target="_blank" rel="noopener" className="rounded-lg p-2 text-muted hover:text-text" aria-label="Open public form">
                    <ExternalLink className="size-4" />
                  </a>
                  <Link className={buttonClass('secondary', 'sm')} href={`/dashboard/forms/${f.id}/responses`}>
                    Responses
                  </Link>
                  <Link className={buttonClass('secondary', 'sm')} href={`/dashboard/forms/${f.id}`}>
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </ModuleShell>
  );
}
