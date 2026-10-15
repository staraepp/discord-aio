'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Badge, Button, Card, Confirm, PageHeader, PageSkeleton, Select, TextArea, TextInput, formatDate } from '@/components/ui';
import { useToast } from '@/components/providers';

type Status = 'new' | 'reviewing' | 'accepted' | 'denied' | 'archived';
interface Sub {
  id: string;
  status: Status;
  adminNotes: string | null;
  createdAt: string;
  editedAt: string | null;
  answers: { questionId: string; value: unknown }[];
}
interface Data {
  form: { id: string; title: string; questions: { id: string; label: string; type: string }[] };
  total: number;
  items: Sub[];
}

const STATUS_TONE: Record<Status, 'accent' | 'warn' | 'good' | 'bad' | 'neutral'> = { new: 'accent', reviewing: 'warn', accepted: 'good', denied: 'bad', archived: 'neutral' };

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (v === null || v === undefined || v === '') return 'none';
  return String(v);
}

export default function ResponsesPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Sub | null>(null);
  const [notes, setNotes] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { notify, fail } = useToast();

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    api<Data>(`/api/forms/${id}/responses?${p}`)
      .then((d) => {
        setData(d);
        setSelected((s) => (s ? (d.items.find((x) => x.id === s.id) ?? null) : null));
      })
      .catch(fail);
  }, [id, page, status, q, fail]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const update = async (sub: Sub, body: { status?: Status; adminNotes?: string | null }) => {
    try {
      await api(`/api/forms/${id}/responses/${sub.id}`, { method: 'PATCH', body });
      notify('Updated.');
      load();
    } catch (e) {
      fail(e);
    }
  };

  if (!data) return <PageSkeleton />;
  const questions = data.form.questions.filter((x) => x.type !== 'section');
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Responses · ${data.form.title}`}
        description="Reviewed only here. Nothing is posted to Discord."
        actions={
          <a href={`/api/forms/${id}/export`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel-2 px-4 text-sm">
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <TextInput label="Search answers" value={q} onChange={(v) => { setQ(v); setPage(0); }} />
        <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[{ value: '', label: 'All' }, ...(['new', 'reviewing', 'accepted', 'denied', 'archived'] as const).map((s) => ({ value: s, label: s }))]} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <Card title={`${data.total} response${data.total === 1 ? '' : 's'}`}>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted">No responses match.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={selected?.id === s.id}
                    onClick={() => {
                      setSelected(s);
                      setNotes(s.adminNotes ?? '');
                    }}
                    className={`w-full py-2 text-left text-sm ${selected?.id === s.id ? 'text-accent' : ''}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{show(s.answers.find((a) => a.questionId === questions[0]?.id)?.value)}</span>
                      <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {formatDate(s.createdAt)}
                      {s.editedAt && ' · edited'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-between">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </Card>
        {selected ? (
          <Card
            title={`Submitted ${formatDate(selected.createdAt)}`}
            description={selected.editedAt ? `Edited ${formatDate(selected.editedAt)}` : undefined}
            actions={
              <>
                <Select label={<span className="sr-only">Status</span>} value={selected.status} onChange={(v) => update(selected, { status: v })} options={(['new', 'reviewing', 'accepted', 'denied', 'archived'] as const).map((s) => ({ value: s, label: s }))} />
                <Button variant="ghost" aria-label="Delete response" onClick={() => setDeleting(true)}>
                  <Trash2 className="size-4" />
                </Button>
              </>
            }
          >
            <dl className="space-y-3">
              {questions.map((qq) => (
                <div key={qq.id}>
                  <dt className="text-xs text-muted">{qq.label}</dt>
                  <dd className="text-sm whitespace-pre-wrap">{show(selected.answers.find((a) => a.questionId === qq.id)?.value)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 space-y-2 border-t border-line pt-4">
              <TextArea label="Private staff notes" hint="Only visible in the dashboard. Not recorded in the audit log." value={notes} onChange={setNotes} maxLength={5000} rows={3} />
              <Button size="sm" onClick={() => update(selected, { adminNotes: notes || null })}>
                Save notes
              </Button>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-muted">Select a response to review it.</p>
          </Card>
        )}
      </div>
      <Confirm
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this response?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/forms/${id}/responses/${selected!.id}`, { method: 'DELETE' });
            setSelected(null);
            notify('Deleted.');
            load();
          } catch (e) {
            fail(e);
          }
          setDeleting(false);
        }}
      >
        This permanently deletes the response and invalidates its edit link.
      </Confirm>
    </div>
  );
}
