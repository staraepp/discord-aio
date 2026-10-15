'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Advanced, Alert, Badge, Button, Card, Confirm, Empty, Modal, NumberInput, Select, Spinner, TextArea, TextInput, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { MultiChannelPicker, MultiRolePicker } from '@/components/pickers';
import { ActionsEditor, type ActionSpec } from '@/components/actions-editor';
import { VariableHelp } from '@/components/template-editor';
import { useToast } from '@/components/providers';

type Mode = 'exact' | 'starts_with' | 'ends_with' | 'contains' | 'regex';
type RType = 'text' | 'embed' | 'random' | 'actions_only';

interface Rule {
  id?: string;
  name: string;
  enabled: boolean;
  trigger: string;
  matchMode: Mode;
  caseSensitive: boolean;
  responseType: RType;
  responses: string[];
  embedId: string | null;
  allowedChannelIds: string[];
  blockedChannelIds: string[];
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  cooldownSeconds: number;
  deleteTrigger: boolean;
  deleteResponseAfterSeconds: number | null;
  logUses: boolean;
  priority: number;
  actions: ActionSpec[];
}

const NEW: Rule = {
  name: '',
  enabled: true,
  trigger: '',
  matchMode: 'contains',
  caseSensitive: false,
  responseType: 'text',
  responses: [''],
  embedId: null,
  allowedChannelIds: [],
  blockedChannelIds: [],
  allowedRoleIds: [],
  blockedRoleIds: [],
  cooldownSeconds: 0,
  deleteTrigger: false,
  deleteResponseAfterSeconds: null,
  logUses: false,
  priority: 0,
  actions: [],
};

const MODES: { value: Mode; label: string }[] = [
  { value: 'contains', label: 'Contains the text' },
  { value: 'exact', label: 'Is exactly' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'regex', label: 'Regular expression (advanced)' },
];

export default function AutorespondersPage() {
  const ctl = useModuleSettings<Record<string, never>>('autoresponders');
  const [rules, setRules] = useState<(Rule & { actions: ActionSpec[] })[] | null>(null);
  const [embeds, setEmbeds] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const { notify, fail } = useToast();

  const load = useCallback(() => {
    api<(Omit<Rule, 'actions'> & { actions: { type: string; config: object }[] })[]>('/api/autoresponders')
      .then((rows) => setRules(rows.map((r) => ({ ...r, actions: r.actions.map((a) => ({ type: a.type, ...a.config }) as ActionSpec) }))))
      .catch(fail);
    api<{ id: string; name: string }[]>('/api/embeds').then(setEmbeds).catch(() => undefined);
  }, [fail]);
  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { id, ...body } = draft;
      const clean = { ...body, responses: body.responseType === 'text' || body.responseType === 'random' ? body.responses.filter((r) => r.trim()) : [] };
      await api(id ? `/api/autoresponders/${id}` : '/api/autoresponders', { method: id ? 'PUT' : 'POST', body: clean });
      notify('Autoresponder saved.');
      setDraft(null);
      setErrors({});
      load();
    } catch (e) {
      if (e instanceof ApiError) setErrors(Object.fromEntries(e.issues.map((i) => [i.path.split('.')[0]!, i.message])));
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Rule) => {
    try {
      await api(`/api/autoresponders/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } });
      load();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <ModuleShell
      title="Autoresponders"
      description="Reply automatically when a message matches a trigger. One autoresponder fires per message (highest priority wins). Replies never ping @everyone, @here or roles."
      ctl={ctl}
      actions={
        <Button variant="primary" onClick={() => setDraft({ ...NEW })}>
          <Plus className="size-4" /> New autoresponder
        </Button>
      }
    >
      <Card title="Test a message" description="Check which autoresponder (if any) would respond. Channel and role scopes are ignored in this quick test.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextInput label="Sample message" value={testText} onChange={setTestText} />
          </div>
          <Button
            disabled={!testText.trim()}
            onClick={async () => {
              try {
                const r = await api<{ matched: boolean; rule?: { name: string }; preview?: string | null }>('/api/autoresponders/test', { body: { content: testText } });
                setTestResult(r.matched ? `Matches “${r.rule!.name}”${r.preview ? ` → ${r.preview}` : ''}` : 'No autoresponder matches.');
              } catch (e) {
                fail(e);
              }
            }}
          >
            <FlaskConical className="size-4" /> Test
          </Button>
        </div>
        {testResult && <p className="mt-3 text-sm" role="status">{testResult}</p>}
      </Card>
      {!rules ? (
        <Spinner />
      ) : rules.length === 0 ? (
        <Empty title="No autoresponders yet" action={<Button onClick={() => setDraft({ ...NEW })}>Create one</Button>} />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.name} {!r.enabled && <Badge>off</Badge>} {r.priority !== 0 && <Badge tone="accent">priority {r.priority}</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {MODES.find((m) => m.value === r.matchMode)?.label}: <code>{r.trigger}</code> → {r.responseType.replace('_', ' ')}
                    {r.actions.length > 0 && ` + ${r.actions.length} action(s)`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Toggle label={<span className="sr-only">Enabled</span>} checked={r.enabled} onChange={() => toggle(r)} />
                  <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setDraft({ ...r, responses: r.responses.length ? r.responses : [''] })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
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
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit autoresponder' : 'New autoresponder'}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} error={errors.name} maxLength={80} />
              <Select label="When a message…" value={draft.matchMode} onChange={(matchMode) => setDraft({ ...draft, matchMode })} options={MODES} />
              <div className="md:col-span-2">
                <TextInput label={draft.matchMode === 'regex' ? 'Pattern' : 'Trigger text'} hint={draft.matchMode === 'regex' ? 'Checked for unsafe patterns and run with a strict time limit.' : '“Contains” matches anywhere in the message, including inside longer words. Use a regular expression with \\b for whole words.'} value={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} error={errors.trigger} maxLength={200} />
              </div>
              <Select
                label="Respond with"
                value={draft.responseType}
                onChange={(responseType) => setDraft({ ...draft, responseType })}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'random', label: 'A random text from a list' },
                  { value: 'embed', label: 'A saved embed' },
                  { value: 'actions_only', label: 'Only run actions' },
                ]}
              />
              {draft.responseType === 'embed' && (
                <Select label="Saved embed" error={errors.embedId} value={draft.embedId ?? ''} onChange={(v) => setDraft({ ...draft, embedId: v || null })} options={[{ value: '', label: 'Choose…' }, ...embeds.map((e) => ({ value: e.id, label: e.name }))]} />
              )}
            </div>
            {(draft.responseType === 'text' || draft.responseType === 'random') && (
              <div className="space-y-3">
                {errors.responses && <Alert tone="bad">{errors.responses}</Alert>}
                {draft.responses.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1">
                      <TextArea label={draft.responseType === 'random' ? `Response ${i + 1}` : 'Response'} value={r} onChange={(v) => setDraft({ ...draft, responses: draft.responses.map((x, j) => (j === i ? v : x)) })} rows={2} maxLength={2000} />
                    </div>
                    {draft.responses.length > 1 && (
                      <Button variant="ghost" className="mt-7" aria-label="Remove response" onClick={() => setDraft({ ...draft, responses: draft.responses.filter((_, j) => j !== i) })}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {draft.responseType === 'random' && draft.responses.length < 20 && (
                  <Button size="sm" onClick={() => setDraft({ ...draft, responses: [...draft.responses, ''] })}>
                    <Plus className="size-4" /> Add response
                  </Button>
                )}
                <VariableHelp />
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">Actions {draft.responseType !== 'actions_only' && <span className="text-muted">(optional)</span>}</p>
              {errors.actions && <Alert tone="bad">{errors.actions}</Alert>}
              <ActionsEditor value={draft.actions} onChange={(actions) => setDraft({ ...draft, actions })} embeds={embeds} />
            </div>
            <Advanced title="Where it works, cooldown and priority">
              <div className="grid gap-4 md:grid-cols-2">
                <MultiChannelPicker label="Only in these channels" hint="Empty = everywhere" value={draft.allowedChannelIds} onChange={(allowedChannelIds) => setDraft({ ...draft, allowedChannelIds })} />
                <MultiChannelPicker label="Never in these channels" value={draft.blockedChannelIds} onChange={(blockedChannelIds) => setDraft({ ...draft, blockedChannelIds })} />
                <MultiRolePicker label="Only for these roles" hint="Empty = everyone" value={draft.allowedRoleIds} onChange={(allowedRoleIds) => setDraft({ ...draft, allowedRoleIds })} />
                <MultiRolePicker label="Never for these roles" value={draft.blockedRoleIds} onChange={(blockedRoleIds) => setDraft({ ...draft, blockedRoleIds })} />
                <NumberInput label="Cooldown per channel (seconds)" min={0} max={86400} value={draft.cooldownSeconds} onChange={(v) => setDraft({ ...draft, cooldownSeconds: v ?? 0 })} />
                <NumberInput label="Priority" hint="Higher wins when several match." min={-100} max={100} value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v ?? 0 })} />
                <NumberInput label="Delete reply after (seconds)" hint="Empty = keep" min={1} max={3600} value={draft.deleteResponseAfterSeconds} onChange={(v) => setDraft({ ...draft, deleteResponseAfterSeconds: v })} />
                <div className="space-y-2">
                  <Toggle label="Case sensitive" checked={draft.caseSensitive} onChange={(caseSensitive) => setDraft({ ...draft, caseSensitive })} />
                  <Toggle label="Delete the triggering message" checked={draft.deleteTrigger} onChange={(deleteTrigger) => setDraft({ ...draft, deleteTrigger })} />
                  <Toggle label="Log uses to the audit log" checked={draft.logUses} onChange={(logUses) => setDraft({ ...draft, logUses })} />
                </div>
              </div>
            </Advanced>
          </div>
        )}
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete autoresponder?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/autoresponders/${deleting!.id}`, { method: 'DELETE' });
            notify('Deleted.');
            load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        “{deleting?.name}” will stop responding immediately.
      </Confirm>
    </ModuleShell>
  );
}
