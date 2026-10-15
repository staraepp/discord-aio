'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Alert, Badge, Button, Card, Confirm, Empty, Modal, NumberInput, PageHeader, PageSkeleton, Toggle, cx } from '@/components/ui';
import { ChannelPicker, useChannelName } from '@/components/pickers';
import { MessageBodyFields, bodyPreview, type MessageBody } from '@/components/message-body';
import { useToast } from '@/components/providers';

interface Row extends MessageBody {
  id: string;
  channelId: string;
  enabled: boolean;
  delaySeconds: number;
}

interface Form extends MessageBody {
  id?: string;
  channelId: string | undefined;
  enabled: boolean;
  delaySeconds: number;
}

const emptyForm = (): Form => ({ channelId: undefined, embedId: null, content: '', enabled: true, delaySeconds: 15 });

export default function StickyPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [embedNames, setEmbedNames] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const channelName = useChannelName();
  const { notify, fail } = useToast();

  const load = useCallback(() => {
    api<Row[]>('/api/customize/sticky').then(setRows).catch(fail);
    api<{ id: string; name: string }[]>('/api/embeds')
      .then((e) => setEmbedNames(Object.fromEntries(e.map((x) => [x.id, x.name]))))
      .catch(() => undefined);
  }, [fail]);
  useEffect(load, [load]);

  const put = async (id: string | undefined, body: Omit<Form, 'id'>) => api(id ? `/api/customize/sticky/${id}` : '/api/customize/sticky', { method: id ? 'PUT' : 'POST', body: { ...body, content: body.embedId ? null : body.content } });

  const save = async () => {
    if (!form?.channelId) return setError('Choose a channel.');
    setSaving(true);
    setError(null);
    try {
      const { id, ...body } = form;
      await put(id, body);
      notify('Saved. The bot is posting it now.');
      setForm(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues.map((i) => i.message)].join(' ') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!rows) return <PageSkeleton label="Loading sticky messages" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sticky messages"
        description="Keep a message at the bottom of a channel. When people chat, the bot waits for a quiet moment, removes its old copy and posts it again."
        actions={
          <Button variant="primary" onClick={() => setForm(emptyForm())}>
            <Plus className="size-4" /> New sticky
          </Button>
        }
      />
      {rows.length === 0 ? (
        <Empty title="No sticky messages" action={<Button onClick={() => setForm(emptyForm())}>Add one</Button>}>
          Handy for channel rules, how-to reminders or a link people keep asking for.
        </Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Pin className={cx('mt-0.5 size-4 shrink-0', r.enabled ? 'text-accent' : 'text-muted')} aria-hidden />
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      #{channelName(r.channelId)} {!r.enabled && <Badge>Off</Badge>}
                    </p>
                    <p className="truncate text-[13px] text-muted">{bodyPreview(r, r.embedId ? embedNames[r.embedId] : undefined)}</p>
                    <p className="text-xs text-muted">Re-posts {r.delaySeconds}s after the chat goes quiet</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Toggle
                    label={<span className="sr-only">Enable sticky in #{channelName(r.channelId)}</span>}
                    checked={r.enabled}
                    onChange={async (enabled) => {
                      try {
                        await put(r.id, { channelId: r.channelId, embedId: r.embedId, content: r.content, delaySeconds: r.delaySeconds, enabled });
                        load();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  />
                  <Button size="sm" variant="ghost" aria-label={`Edit sticky in #${channelName(r.channelId)}`} onClick={() => setForm({ ...r })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete sticky in #${channelName(r.channelId)}`} onClick={() => setDeleting(r)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        wide
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit sticky message' : 'New sticky message'}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-5">
            {error && <Alert tone="bad">{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <ChannelPicker label="Channel" hint="One sticky per channel." value={form.channelId} onChange={(channelId) => setForm({ ...form, channelId })} />
              <NumberInput label="Wait before re-posting (seconds)" hint="5 to 600. Longer means fewer re-posts in busy chats." value={form.delaySeconds} min={5} max={600} onChange={(v) => setForm({ ...form, delaySeconds: v ?? 15 })} />
            </div>
            <MessageBodyFields value={form} onChange={(b) => setForm({ ...form, ...b })} />
            <Toggle label="On" checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
          </div>
        )}
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remove this sticky message?"
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await api(`/api/customize/sticky/${deleting!.id}`, { method: 'DELETE' });
            notify('Removed. The bot deletes its last copy too.');
            load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        The bot stops re-posting it and deletes its last copy from the channel.
      </Confirm>
    </div>
  );
}
