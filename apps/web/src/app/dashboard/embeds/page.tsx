'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageTemplate } from '@aio/discord-ui';
import { Copy, FileClock, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Alert, Button, Card, Confirm, Empty, Modal, PageHeader, Spinner, TextInput, formatDate } from '@/components/ui';
import { EMPTY_TEMPLATE, TemplateEditor } from '@/components/template-editor';
import { ActionsEditor, type ActionSpec } from '@/components/actions-editor';
import { ChannelPicker } from '@/components/pickers';
import { useToast } from '@/components/providers';

interface SavedEmbed {
  id: string;
  name: string;
  template: MessageTemplate;
  componentActions: Record<string, ActionSpec[]>;
  updatedAt: string;
}

type Draft = Omit<SavedEmbed, 'id' | 'updatedAt'> & { id?: string };

/** Server-side autosaved draft (shared with the `/embed` editor in Discord). */
interface StoredDraft {
  id: string;
  embedId: string | null;
  name: string;
  template: MessageTemplate;
  componentActions: Record<string, ActionSpec[]>;
  updatedAt: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const AUTOSAVE_MS = 1200;

export default function EmbedsPage() {
  const [items, setItems] = useState<SavedEmbed[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendFor, setSendFor] = useState<SavedEmbed | null>(null);
  const [sendChannel, setSendChannel] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState<SavedEmbed | null>(null);
  const [drafts, setDrafts] = useState<StoredDraft[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const { notify, fail } = useToast();

  const load = useCallback(() => api<SavedEmbed[]>('/api/embeds').then(setItems).catch(fail), [fail]);
  const loadDrafts = useCallback(() => api<StoredDraft[]>('/api/embeds/drafts').then(setDrafts).catch(() => undefined), []);
  useEffect(() => {
    void load();
    void loadDrafts();
  }, [load, loadDrafts]);

  // Autosave the open editor so a closed tab or modal never loses work.
  const draftIdRef = useRef<string | undefined>(undefined);
  draftIdRef.current = draftId;
  const persist = useCallback(async (d: Draft) => {
    setSaveState('saving');
    try {
      const r = await api<{ id: string }>('/api/embeds/drafts', { body: { id: draftIdRef.current, draft: { embedId: d.id ?? null, name: d.name, template: d.template, componentActions: d.componentActions } } });
      draftIdRef.current = r.id;
      setDraftId(r.id);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, []);
  useEffect(() => {
    if (!draft || !dirty) return;
    const t = setTimeout(() => void persist(draft), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, dirty, persist]);

  const open = (d: Draft, fromDraft?: string) => {
    setDraft(d);
    setDraftId(fromDraft);
    setDirty(false);
    setSaveState(fromDraft ? 'saved' : 'idle');
    setError(null);
  };
  const edit = (d: Draft) => {
    setDraft(d);
    setDirty(true);
  };
  const close = async () => {
    // Flush pending edits before closing; the draft stays listed for later.
    if (draft && dirty && saveState !== 'saved') await persist(draft);
    if (dirty) notify('Draft kept. Pick it up under Unsaved drafts.');
    setDraft(null);
    setDraftId(undefined);
    void loadDrafts();
  };
  const discardDraft = async (id: string) => {
    try {
      await api(`/api/embeds/drafts/${id}`, { method: 'DELETE' });
      setDrafts((all) => all.filter((d) => d.id !== id));
    } catch (e) {
      fail(e);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { id, ...body } = draft;
      await api(id ? `/api/embeds/${id}` : '/api/embeds', { method: id ? 'PUT' : 'POST', body });
      if (draftIdRef.current) await api(`/api/embeds/drafts/${draftIdRef.current}`, { method: 'DELETE' }).catch(() => undefined);
      notify('Saved embed.');
      setDraft(null);
      setDraftId(undefined);
      setDirty(false);
      void load();
      void loadDrafts();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues.map((i) => `${i.path}: ${i.message}`)].join(' ') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const keys = draft ? draft.template.components.flat().filter((c) => c.type === 'select' || c.style !== 'link') : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Embeds"
        description="Reusable messages for panels, welcome/goodbye, autoresponders and announcements. Buttons and menus can run safe actions."
        actions={
          <Button variant="primary" onClick={() => open({ name: '', template: EMPTY_TEMPLATE, componentActions: {} })}>
            <Plus className="size-4" /> New embed
          </Button>
        }
      />
      {drafts.length > 0 && (
        <Card title="Unsaved drafts" description="Autosaved from here and from /embed in Discord. Kept for 30 days.">
          <ul className="divide-y divide-line">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileClock className="size-4 shrink-0 text-warn" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.name || 'Untitled draft'}</p>
                    <p className="text-xs text-muted">
                      {d.embedId ? 'Changes to a saved embed' : 'New embed'} · edited {formatDate(d.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="primary" onClick={() => open({ id: d.embedId ?? undefined, name: d.name, template: d.template, componentActions: d.componentActions ?? {} }, d.id)}>
                    Continue
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Discard draft ${d.name || 'Untitled'}`} onClick={() => void discardDraft(d.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty title="No saved embeds yet" action={<Button onClick={() => open({ name: '', template: EMPTY_TEMPLATE, componentActions: {} })}>Create your first embed</Button>}>
          Build a message once and reuse it anywhere a message can be customised.
        </Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{e.name}</p>
                  <p className="text-xs text-muted">
                    {e.template.embeds[0]?.title ?? e.template.content?.slice(0, 60) ?? 'Untitled'} · updated {formatDate(e.updatedAt)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setSendFor(e)}>
                    <Send className="size-4" /> Send
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${e.name}`} onClick={() => open({ id: e.id, name: e.name, template: e.template, componentActions: e.componentActions ?? {} })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Duplicate ${e.name}`} onClick={() => open({ name: `${e.name} copy`.slice(0, 60), template: e.template, componentActions: e.componentActions ?? {} })}>
                    <Copy className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${e.name}`} onClick={() => setDeleting(e)}>
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
        open={Boolean(draft)}
        onClose={() => void close()}
        title={draft?.id ? `Edit “${draft.name}”` : 'New embed'}
        footer={
          <>
            <span className="mr-auto text-xs text-muted" role="status" aria-live="polite">
              {saveState === 'saving' ? 'Saving draft…' : saveState === 'saved' ? 'Draft autosaved' : saveState === 'error' ? 'Couldn\'t autosave, keep this open' : ''}
            </span>
            <Button onClick={() => void close()}>Close</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-5">
            {error && <Alert tone="bad">{error}</Alert>}
            <div className="max-w-sm">
              <TextInput label="Name" hint="Used to pick this embed elsewhere." value={draft.name} onChange={(name) => edit({ ...draft, name })} maxLength={60} />
            </div>
            <TemplateEditor value={draft.template} onChange={(template) => edit({ ...draft, template })} allowComponents />
            {keys.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm font-medium">What the buttons and menus do</p>
                {keys.map((c) => (
                  <fieldset key={c.key} className="rounded-xl border border-line p-3">
                    <legend className="px-1 text-sm">{c.type === 'button' ? `Button “${c.label ?? c.emoji ?? c.key}”` : `Menu “${c.placeholder ?? c.key}”`}</legend>
                    <ActionsEditor
                      value={draft.componentActions[c.key] ?? []}
                      max={5}
                      allowTriggerActions={false}
                      embeds={(items ?? []).filter((x) => x.id !== draft.id)}
                      onChange={(actions) => edit({ ...draft, componentActions: { ...draft.componentActions, [c.key]: actions } })}
                    />
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(sendFor)}
        onClose={() => setSendFor(null)}
        title={`Send “${sendFor?.name ?? ''}”`}
        footer={
          <>
            <Button onClick={() => setSendFor(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={sending}
              disabled={!sendChannel}
              onClick={async () => {
                setSending(true);
                try {
                  const r = await api<{ message: string }>(`/api/embeds/${sendFor!.id}/send`, { body: { channelId: sendChannel } });
                  notify(r.message);
                  setSendFor(null);
                } catch (e) {
                  fail(e);
                } finally {
                  setSending(false);
                }
              }}
            >
              Send
            </Button>
          </>
        }
      >
        <ChannelPicker label="Channel" value={sendChannel} onChange={setSendChannel} />
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete saved embed?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/embeds/${deleting!.id}`, { method: 'DELETE' });
            notify('Deleted.');
            void load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        Messages already sent stay in Discord, but their buttons will stop working. Modules that reference this embed fall back to their defaults.
      </Confirm>
    </div>
  );
}
