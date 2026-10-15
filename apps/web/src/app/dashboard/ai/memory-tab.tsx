'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Pin, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Badge, Button, Card, Confirm, Modal, Select, Spinner, TextArea, TextInput, Toggle, formatDate } from '@/components/ui';
import { useToast } from '@/components/providers';
import type { AiSettings } from './types';

type Status = 'proposed' | 'learned' | 'pinned' | 'archived' | 'superseded';
type Kind = 'vocabulary' | 'project' | 'decision' | 'term' | 'inside_joke' | 'fact';
interface Memory {
  id: string;
  kind: Kind;
  title: string;
  content: string;
  confidence: number;
  status: Status;
  provenance: string;
  createdBy: string;
  updatedAt: string;
  sources: { messageId: string; channelId: string; jumpUrl: string }[];
}

const TONE: Record<Status, 'accent' | 'good' | 'warn' | 'neutral'> = { proposed: 'warn', learned: 'good', pinned: 'accent', archived: 'neutral', superseded: 'neutral' };
const KINDS: { value: Kind; label: string }[] = [
  { value: 'fact', label: 'Fact' },
  { value: 'term', label: 'Term' },
  { value: 'vocabulary', label: 'Vocabulary' },
  { value: 'project', label: 'Project' },
  { value: 'decision', label: 'Decision' },
  { value: 'inside_joke', label: 'Inside joke' },
];

export function MemoryTab({ s, update }: { s: AiSettings; update: (p: Partial<AiSettings>) => void }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Memory[] | null>(null);
  const [editing, setEditing] = useState<Partial<Memory> | null>(null);
  const [forget, setForget] = useState<Memory | null>(null);
  const [purge, setPurge] = useState(false);
  const [purgePinned, setPurgePinned] = useState(false);
  const { notify, fail } = useToast();
  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    api<Memory[]>(`/api/ai/memories?${p}`).then(setItems).catch(fail);
  }, [status, q, fail]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const patch = async (m: Memory, body: Partial<Pick<Memory, 'status' | 'title' | 'content' | 'kind'>>) => {
    try {
      await api(`/api/ai/memories/${m.id}`, { method: 'PATCH', body });
      load();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <Card title="Learning" description="Memories are short facts the helper learns from context channels marked “learn”. Each keeps links to its sources.">
        <div className="grid gap-2 md:grid-cols-2">
          <Toggle label="Auto-learn" description="Confident memories become active right away. Off = everything waits for review." checked={s.learning.autoLearn} onChange={(autoLearn) => update({ learning: { ...s.learning, autoLearn } })} />
          <Toggle label="Pause learning" checked={s.learning.paused} onChange={(paused) => update({ learning: { ...s.learning, paused } })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={async () => {
              try {
                const r = await api<{ message: string }>('/api/ai/learn', { method: 'POST' });
                notify(r.message);
              } catch (e) {
                fail(e);
              }
            }}
          >
            Learn now
          </Button>
          <Button size="sm" onClick={() => setEditing({ kind: 'fact', title: '', content: '' })}>
            <Plus className="size-4" /> Write a memory
          </Button>
          <Button size="sm" variant="danger" onClick={() => setPurge(true)}>
            Purge memories
          </Button>
        </div>
      </Card>
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem]">
          <TextInput label="Search" value={q} onChange={setQ} />
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Current' },
              { value: 'proposed', label: 'Needs review' },
              { value: 'learned', label: 'Learned' },
              { value: 'pinned', label: 'Pinned' },
              { value: 'archived', label: 'Archived' },
              { value: 'superseded', label: 'Edited (history)' },
            ]}
          />
        </div>
        {!items ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No memories.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((m) => (
              <li key={m.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">
                    {m.title} <Badge tone={TONE[m.status]}>{m.status}</Badge> <Badge>{m.kind.replace('_', ' ')}</Badge>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {m.status === 'proposed' && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => patch(m, { status: 'learned' })}>
                          Approve
                        </Button>
                        <Button size="sm" onClick={() => patch(m, { status: 'archived' })}>
                          Reject
                        </Button>
                      </>
                    )}
                    {(m.status === 'learned' || m.status === 'archived') && (
                      <Button size="sm" onClick={() => patch(m, { status: 'pinned' })}>
                        <Pin className="size-4" /> Pin
                      </Button>
                    )}
                    {m.status === 'pinned' && (
                      <Button size="sm" onClick={() => patch(m, { status: 'learned' })}>
                        Unpin
                      </Button>
                    )}
                    {m.status !== 'superseded' && (
                      <Button size="sm" onClick={() => setEditing(m)}>
                        Edit
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label="Forget memory" onClick={() => setForget(m)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap text-muted">{m.content}</p>
                <p className="flex flex-wrap gap-2 text-xs text-muted">
                  {formatDate(m.updatedAt)} · {m.provenance || (m.createdBy === 'ai' ? 'learned automatically' : 'written by staff')}
                  {m.sources.map((src, i) => (
                    <a key={src.messageId} href={src.jumpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent">
                      source {i + 1} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit memory' : 'New memory'}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!editing?.title?.trim() || !editing?.content?.trim()}
              onClick={async () => {
                try {
                  if (editing!.id) await api(`/api/ai/memories/${editing!.id}`, { method: 'PATCH', body: { title: editing!.title, content: editing!.content, kind: editing!.kind } });
                  else await api('/api/ai/memories', { body: { title: editing!.title, content: editing!.content, kind: editing!.kind } });
                  notify('Memory saved.');
                  setEditing(null);
                  load();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <TextInput label="Title" value={editing.title ?? ''} onChange={(title) => setEditing({ ...editing, title })} maxLength={200} />
            <Select label="Kind" value={editing.kind ?? 'fact'} onChange={(kind) => setEditing({ ...editing, kind })} options={KINDS} />
            <TextArea label="Content" value={editing.content ?? ''} onChange={(content) => setEditing({ ...editing, content })} maxLength={2000} rows={4} />
            {editing.id && (editing.status === 'learned' || editing.status === 'pinned') && <p className="text-xs text-muted">Editing keeps the previous version in history.</p>}
          </div>
        )}
      </Modal>
      <Confirm
        open={Boolean(forget)}
        onClose={() => setForget(null)}
        title="Forget this memory?"
        confirmLabel="Forget"
        onConfirm={async () => {
          try {
            await api(`/api/ai/memories/${forget!.id}`, { method: 'DELETE' });
            notify('Forgotten.');
            load();
          } catch (e) {
            fail(e);
          }
          setForget(null);
        }}
      >
        “{forget?.title}” is permanently deleted.
      </Confirm>
      <Confirm
        open={purge}
        onClose={() => setPurge(false)}
        title="Purge memories?"
        confirmLabel="Purge"
        phrase="PURGE"
        onConfirm={async () => {
          try {
            const r = await api<{ count: number }>('/api/ai/memories/purge', { body: { includePinned: purgePinned, confirm: 'PURGE' } });
            notify(`Deleted ${r.count} memories.`);
            load();
          } catch (e) {
            fail(e);
          }
          setPurge(false);
        }}
      >
        <p>Deletes all learned and proposed memories. Stored channel messages are not affected.</p>
        <Toggle label="Also delete pinned memories" checked={purgePinned} onChange={setPurgePinned} />
      </Confirm>
    </>
  );
}
