'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Alert, Badge, Button, Card, Confirm, Modal, NumberInput, Spinner, Toggle, formatDate } from '@/components/ui';
import { CH, ChannelPicker } from '@/components/pickers';
import { useResources, useToast } from '@/components/providers';

interface ChannelConfig {
  channelId: string;
  channelName: string;
  collect: boolean;
  searchable: boolean;
  attachments: boolean;
  learnMemory: boolean;
  historyDepth: number;
  citationPriority: number;
  isPrivate: boolean;
  privateConfirmedAt: string | null;
  lastBackfillAt: string | null;
  indexedMessages: number;
}

type Editable = Pick<ChannelConfig, 'collect' | 'searchable' | 'attachments' | 'learnMemory' | 'historyDepth' | 'citationPriority'> & { channelId: string; confirmPrivate?: boolean };

const DEFAULTS: Omit<Editable, 'channelId'> = { collect: true, searchable: true, attachments: false, learnMemory: false, historyDepth: 0, citationPriority: 0 };

export function ContextTab({ acknowledged, onAcknowledge }: { acknowledged: boolean; onAcknowledge: () => void }) {
  const [items, setItems] = useState<ChannelConfig[] | null>(null);
  const [editing, setEditing] = useState<(Editable & { isNew?: boolean; isPrivate?: boolean }) | null>(null);
  const [forgetting, setForgetting] = useState<ChannelConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const { notify, fail } = useToast();
  const { data } = useResources();
  const load = useCallback(() => api<ChannelConfig[]>('/api/ai/channels').then(setItems).catch(fail), [fail]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      const { channelId, isNew: _n, isPrivate: _p, ...body } = editing;
      await api(`/api/ai/channels/${channelId}`, { method: 'PUT', body });
      notify('Channel saved.');
      setEditing(null);
      setNeedsConfirm(false);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.issues.some((i) => i.path === 'confirmPrivate')) setNeedsConfirm(true);
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  if (!acknowledged) {
    return (
      <Card title="Before indexing anything">
        <div className="space-y-3 text-sm">
          <p>The AI helper stores copies of messages from the channels you choose so it can answer questions and cite sources. Consider telling your members, for example in your rules channel.</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Only channels listed here are read. Everything else is ignored.</li>
            <li>Answers only cite channels the asking member can currently see, so hidden staff channels never leak.</li>
            <li>Deleted or edited Discord messages are removed or re-checked, and memories that relied on them are withdrawn.</li>
            <li>You can remove a channel at any time; its stored messages are deleted immediately.</li>
          </ul>
          <Button variant="primary" onClick={onAcknowledge}>
            I understand, continue (remember to save)
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Context channels"
        description="The AI can read only these channels. Private channels need explicit confirmation and are only cited to members who can see them."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing({ channelId: '', ...DEFAULTS, isNew: true })}>
            <Plus className="size-4" /> Add channel
          </Button>
        }
      >
        {!items ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No channels yet. The helper will answer only from pinned memories until you add some.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.channelId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {c.isPrivate && <Lock className="size-3.5 text-warn" aria-label="private channel" />}#{c.channelName || c.channelId}
                    {!c.collect && <Badge>paused</Badge>}
                    {c.learnMemory && <Badge tone="accent">learns</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {c.indexedMessages.toLocaleString()} messages stored{c.historyDepth > 0 && ` · imports last ${c.historyDepth}`}
                    {c.lastBackfillAt && ` · imported ${formatDate(c.lastBackfillAt)}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    disabled={c.historyDepth === 0}
                    title={c.historyDepth === 0 ? 'Set a history depth first' : undefined}
                    onClick={async () => {
                      try {
                        const r = await api<{ message: string }>(`/api/ai/channels/${c.channelId}/reindex`, { method: 'POST' });
                        notify(r.message);
                        void load();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <RefreshCw className="size-4" /> Import history
                  </Button>
                  <Button size="sm" onClick={() => setEditing({ ...c, isPrivate: c.isPrivate })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Forget #${c.channelName}`} onClick={() => setForgetting(c)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setError(null);
          setNeedsConfirm(false);
        }}
        title={editing?.isNew ? 'Add context channel' : `#${items?.find((i) => i.channelId === editing?.channelId)?.channelName ?? ''}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" disabled={!editing?.channelId || (needsConfirm && !editing.confirmPrivate)} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {error && <Alert tone={needsConfirm ? 'warn' : 'bad'}>{error}</Alert>}
            {editing.isNew && <ChannelPicker label="Channel" types={[CH.text, CH.announcement, CH.forum, CH.voice]} value={editing.channelId || undefined} onChange={(v) => setEditing({ ...editing, channelId: v ?? '' })} />}
            {editing.isNew && data && editing.channelId && !data.channels.find((c) => c.id === editing.channelId)?.everyoneCanView && (
              <Alert tone="warn" title="This channel is hidden from @everyone">Answers citing it will only be shown to members who can see it.</Alert>
            )}
            {needsConfirm && <Toggle label="I confirm the AI may use this private channel" checked={Boolean(editing.confirmPrivate)} onChange={(confirmPrivate) => setEditing({ ...editing, confirmPrivate })} />}
            <Toggle label="Collect new messages" checked={editing.collect} onChange={(collect) => setEditing({ ...editing, collect })} />
            <Toggle label="Use in answers" checked={editing.searchable} onChange={(searchable) => setEditing({ ...editing, searchable })} />
            <Toggle label="Learn memories from this channel" description="Recurring terms, projects and decisions. Proposed memories need review unless auto-learn is on." checked={editing.learnMemory} onChange={(learnMemory) => setEditing({ ...editing, learnMemory })} />
            <Toggle label="Store attachment details" checked={editing.attachments} onChange={(attachments) => setEditing({ ...editing, attachments })} />
            <NumberInput label="Import older messages" hint="How many past messages to import with “Import history” (0–5000)." min={0} max={5000} value={editing.historyDepth} onChange={(v) => setEditing({ ...editing, historyDepth: v ?? 0 })} />
            <NumberInput label="Citation priority" hint="Higher = preferred as a source (-10 to 10)." min={-10} max={10} value={editing.citationPriority} onChange={(v) => setEditing({ ...editing, citationPriority: v ?? 0 })} />
          </div>
        )}
      </Modal>
      <Confirm
        open={Boolean(forgetting)}
        onClose={() => setForgetting(null)}
        title={`Forget #${forgetting?.channelName ?? ''}?`}
        confirmLabel="Forget channel"
        onConfirm={async () => {
          try {
            const r = await api<{ deleted: number }>(`/api/ai/channels/${forgetting!.channelId}`, { method: 'DELETE' });
            notify(`Removed. Deleted ${r.deleted} stored messages.`);
            void load();
          } catch (e) {
            fail(e);
          }
          setForgetting(null);
        }}
      >
        Stops reading the channel and deletes every stored message, summary and memory link from it. Memories that only came from this channel are archived.
      </Confirm>
    </>
  );
}
