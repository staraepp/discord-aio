'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MessageTemplate } from '@aio/discord-ui';
import { Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Advanced, Alert, Badge, Button, Card, Confirm, Empty, Modal, NumberInput, Select, Spinner, Tabs, TextArea, TextInput, Toggle, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings, usePublish } from '@/components/module';
import { CH, ChannelPicker, MultiRolePicker, useChannelName } from '@/components/pickers';
import { TemplateEditor } from '@/components/template-editor';
import { useToast } from '@/components/providers';

interface TicketSettings {
  logChannelId?: string;
  transcriptChannelId?: string;
  maxOpenPerUser: number;
}
interface TQuestion {
  label: string;
  placeholder?: string;
  style: 'short' | 'paragraph';
  required: boolean;
  maxLength: number;
}
interface TType {
  id?: string;
  label: string;
  emoji: string | null;
  style: 'primary' | 'secondary' | 'success' | 'danger';
  categoryId: string | null;
  staffRoleIds: string[];
  questions: TQuestion[];
  waitingNameTemplate: string;
  handledNameTemplate: string;
  openingMessage: string;
}
interface Panel {
  id?: string;
  name: string;
  template: MessageTemplate;
  types: TType[];
  published?: { channelId: string; messageId: string | null } | null;
}
interface Ticket {
  id: string;
  number: number;
  openerId: string;
  channelId: string;
  status: 'open' | 'closed';
  firstResponderId: string | null;
  handlerId: string | null;
  createdAt: string;
  closedAt: string | null;
  type: { label: string } | null;
  _count: { transcripts: number };
}

const NEW_TYPE: TType = {
  label: 'Support',
  emoji: null,
  style: 'primary',
  categoryId: null,
  staffRoleIds: [],
  questions: [],
  waitingNameTemplate: 'waiting-{user.name}',
  handledNameTemplate: '{staff.name}-{user.name}',
  openingMessage: 'Hi {user}, thanks for reaching out. A staff member will be with you soon.',
};
const NEW_PANEL: Panel = {
  name: 'Support',
  template: { embeds: [{ title: 'Need help?', description: 'Press a button below to open a private ticket with staff.', color: 0x6d5dfc, timestamp: false, fields: [] }], components: [] },
  types: [NEW_TYPE],
};

function TypeEditor({ t, onChange, onRemove }: { t: TType; onChange: (t: TType) => void; onRemove?: () => void }) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-line p-4">
      <legend className="px-1 text-sm font-medium">
        {t.emoji} {t.label}
      </legend>
      <div className="grid gap-4 md:grid-cols-3">
        <TextInput label="Button label" value={t.label} onChange={(label) => onChange({ ...t, label })} maxLength={80} />
        <TextInput label="Emoji" value={t.emoji ?? ''} onChange={(emoji) => onChange({ ...t, emoji: emoji || null })} />
        <Select
          label="Button color"
          value={t.style}
          onChange={(style) => onChange({ ...t, style })}
          options={[
            { value: 'primary', label: 'Blurple' },
            { value: 'secondary', label: 'Grey' },
            { value: 'success', label: 'Green' },
            { value: 'danger', label: 'Red' },
          ]}
        />
        <ChannelPicker label="Category for tickets" types={[CH.category]} value={t.categoryId} onChange={(categoryId) => onChange({ ...t, categoryId: categoryId ?? null })} />
        <div className="md:col-span-2">
          <MultiRolePicker label="Staff roles for this type" hint="Empty = the ticket staff roles from Staff & settings." value={t.staffRoleIds} onChange={(staffRoleIds) => onChange({ ...t, staffRoleIds })} />
        </div>
      </div>
      <TextArea label="Opening message" value={t.openingMessage} onChange={(openingMessage) => onChange({ ...t, openingMessage })} rows={2} maxLength={2000} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Questions asked before opening (max 5)</p>
        {t.questions.map((q, i) => (
          <div key={i} className="grid items-end gap-2 md:grid-cols-[1fr_10rem_auto_auto]">
            <TextInput label={`Question ${i + 1}`} value={q.label} onChange={(label) => onChange({ ...t, questions: t.questions.map((x, j) => (j === i ? { ...x, label } : x)) })} maxLength={45} />
            <Select label="Answer" value={q.style} onChange={(style) => onChange({ ...t, questions: t.questions.map((x, j) => (j === i ? { ...x, style } : x)) })} options={[{ value: 'short', label: 'Short' }, { value: 'paragraph', label: 'Paragraph' }]} />
            <Toggle label="Required" checked={q.required} onChange={(required) => onChange({ ...t, questions: t.questions.map((x, j) => (j === i ? { ...x, required } : x)) })} />
            <Button variant="ghost" aria-label="Remove question" onClick={() => onChange({ ...t, questions: t.questions.filter((_, j) => j !== i) })}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button size="sm" disabled={t.questions.length >= 5} onClick={() => onChange({ ...t, questions: [...t.questions, { label: 'What do you need help with?', style: 'paragraph', required: true, maxLength: 1000 }] })}>
          <Plus className="size-4" /> Add question
        </Button>
      </div>
      <Advanced title="Channel names">
        <p className="text-xs text-muted">The channel starts with the waiting name. When the first staff member sends a message it is renamed once to the handled name. Takeovers never rename it again.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput label="Waiting name" hint="{user.name}, {number}, {type}" value={t.waitingNameTemplate} onChange={(waitingNameTemplate) => onChange({ ...t, waitingNameTemplate })} maxLength={100} />
          <TextInput label="Handled name" hint="{staff.name}, {user.name}, {number}, {type}" value={t.handledNameTemplate} onChange={(handledNameTemplate) => onChange({ ...t, handledNameTemplate })} maxLength={100} />
        </div>
      </Advanced>
      {onRemove && (
        <Button size="sm" variant="danger" onClick={onRemove}>
          <Trash2 className="size-4" /> Remove type
        </Button>
      )}
    </fieldset>
  );
}

function TicketList() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [data, setData] = useState<{ items: Ticket[]; total: number } | null>(null);
  const [transcripts, setTranscripts] = useState<{ ticket: Ticket; items: { id: string; createdAt: string; messageCount: number; content: { authorName: string; content: string; createdAt: string; attachments: string[] }[] }[] } | null>(null);
  const { notify, fail } = useToast();
  const channelName = useChannelName();
  const load = useCallback(() => api<{ items: Ticket[]; total: number }>(`/api/tickets/list?status=${status}`).then(setData).catch(fail), [status, fail]);
  useEffect(() => {
    void load();
  }, [load]);
  const openTranscripts = async (t: Ticket) => {
    try {
      setTranscripts({ ticket: t, items: await api(`/api/tickets/${t.id}/transcripts`) });
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Card title="Tickets" description="Only staff can close or reopen tickets." actions={<Select label={<span className="sr-only">Status</span>} value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />}>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted">No {status} tickets.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {data.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <b>#{t.number}</b> {t.type?.label && <Badge>{t.type.label}</Badge>} {status === 'open' ? `#${channelName(t.channelId)}` : ''}{' '}
                <span className="text-muted">
                  · opened by <span className="font-mono">{t.openerId}</span> · {formatDate(t.createdAt)}
                  {t.handlerId && (
                    <>
                      {' '}
                      · handler <span className="font-mono">{t.handlerId}</span>
                    </>
                  )}
                </span>
              </span>
              <span className="flex gap-1">
                {status === 'open' && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        const r = await api<{ message: string }>(`/api/tickets/${t.id}/transcripts`, { method: 'POST' });
                        notify(r.message);
                        void load();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    Save transcript
                  </Button>
                )}
                <Button size="sm" disabled={t._count.transcripts === 0} onClick={() => openTranscripts(t)}>
                  Transcripts ({t._count.transcripts})
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal wide open={Boolean(transcripts)} onClose={() => setTranscripts(null)} title={`Ticket #${transcripts?.ticket.number ?? ''} transcripts`}>
        {transcripts?.items.map((tr) => (
          <details key={tr.id} className="mb-3 rounded-lg border border-line p-3" open={transcripts.items.length === 1}>
            <summary className="cursor-pointer text-sm">
              {formatDate(tr.createdAt)} · {tr.messageCount} messages
            </summary>
            <ol className="mt-3 space-y-2 text-sm">
              {tr.content.map((m, i) => (
                <li key={i}>
                  <span className="font-medium">{m.authorName}</span> <span className="text-xs text-muted">{formatDate(m.createdAt)}</span>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.attachments.map((a) => (
                    <a key={a} href={a} target="_blank" rel="noopener noreferrer nofollow" className="block text-xs text-accent underline">
                      attachment
                    </a>
                  ))}
                </li>
              ))}
            </ol>
          </details>
        ))}
      </Modal>
    </Card>
  );
}

export default function TicketsPage() {
  const ctl = useModuleSettings<TicketSettings>('tickets');
  const [tab, setTab] = useState<'tickets' | 'panels' | 'settings'>('tickets');
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [draft, setDraft] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishFor, setPublishFor] = useState<Panel | null>(null);
  const [publishChannel, setPublishChannel] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Panel | null>(null);
  const { publish, busy } = usePublish();
  const { notify, fail } = useToast();
  const channelName = useChannelName();

  const load = useCallback(() => api<Panel[]>('/api/tickets/panels').then(setPanels).catch(fail), [fail]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { id, published: _p, ...body } = draft;
      await api(id ? `/api/tickets/panels/${id}` : '/api/tickets/panels', { method: id ? 'PUT' : 'POST', body });
      notify(id && draft.published ? 'Saved. Publish again to update the message in Discord.' : 'Panel saved.');
      setDraft(null);
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues.map((i) => `${i.path}: ${i.message}`)].join(' ') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const s = ctl.draft;
  return (
    <ModuleShell title="Tickets" description="Private support channels. The first staff reply renames the channel once; only staff can close or reopen." ctl={ctl}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'tickets', label: 'Tickets' },
          { id: 'panels', label: 'Panels' },
          { id: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'tickets' && <TicketList />}
      {tab === 'settings' && s && (
        <Card title="Settings">
          <div className="grid gap-5 md:grid-cols-3">
            <ChannelPicker label="Ticket log channel" value={s.logChannelId} onChange={(logChannelId) => ctl.update({ logChannelId })} />
            <ChannelPicker label="Transcript channel" hint="Transcripts are always stored in the dashboard too." value={s.transcriptChannelId} onChange={(transcriptChannelId) => ctl.update({ transcriptChannelId })} />
            <NumberInput label="Open tickets per member" min={1} max={10} value={s.maxOpenPerUser} onChange={(v) => ctl.update({ maxOpenPerUser: v ?? 1 })} />
          </div>
        </Card>
      )}
      {tab === 'panels' && (
        <>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setDraft(structuredClone(NEW_PANEL))}>
              <Plus className="size-4" /> New panel
            </Button>
          </div>
          {!panels ? (
            <Spinner />
          ) : panels.length === 0 ? (
            <Empty title="No ticket panels yet">A panel is a message with buttons members press to open tickets.</Empty>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {panels.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted">
                        {p.types.map((t) => `${t.emoji ?? ''} ${t.label}`).join(' · ')} · {p.published ? `Published in #${channelName(p.published.channelId)}` : 'Not published'}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => { setPublishFor(p); setPublishChannel(p.published?.channelId); }}>
                        <Send className="size-4" /> Publish
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setDraft(structuredClone(p))}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <Modal
        wide
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit ticket panel' : 'New ticket panel'}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save panel
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-5">
            {error && <Alert tone="bad">{error}</Alert>}
            <div className="max-w-sm">
              <TextInput label="Panel name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={80} />
            </div>
            <p className="text-sm font-medium">Panel message</p>
            <TemplateEditor value={draft.template} onChange={(template) => setDraft({ ...draft, template })} maxEmbeds={1} />
            <p className="text-sm font-medium">Ticket types (buttons)</p>
            {draft.types.map((t, i) => (
              <TypeEditor key={t.id ?? i} t={t} onChange={(nt) => setDraft({ ...draft, types: draft.types.map((x, j) => (j === i ? nt : x)) })} onRemove={draft.types.length > 1 ? () => setDraft({ ...draft, types: draft.types.filter((_, j) => j !== i) }) : undefined} />
            ))}
            <Button size="sm" disabled={draft.types.length >= 5} onClick={() => setDraft({ ...draft, types: [...draft.types, { ...NEW_TYPE, label: `Type ${draft.types.length + 1}` }] })}>
              <Plus className="size-4" /> Add ticket type
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(publishFor)}
        onClose={() => setPublishFor(null)}
        title={`Publish “${publishFor?.name ?? ''}”`}
        footer={
          <>
            <Button onClick={() => setPublishFor(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!publishChannel}
              onClick={async () => {
                if (await publish({ kind: 'ticket', refId: publishFor!.id, channelId: publishChannel })) {
                  setPublishFor(null);
                  void load();
                }
              }}
            >
              Publish
            </Button>
          </>
        }
      >
        <ChannelPicker label="Channel" hint="If already published, the existing message is updated (or moved)." value={publishChannel} onChange={setPublishChannel} />
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete ticket panel?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/tickets/panels/${deleting!.id}`, { method: 'DELETE' });
            notify('Panel deleted.');
            void load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        The panel message is removed from Discord. Existing tickets stay open.
      </Confirm>
    </ModuleShell>
  );
}
