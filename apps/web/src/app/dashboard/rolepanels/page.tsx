'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MessageTemplate } from '@aio/discord-ui';
import { ArrowDown, ArrowUp, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { Advanced, Alert, Button, Card, Confirm, Empty, Modal, NumberInput, Select, Spinner, TextInput, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings, usePublish } from '@/components/module';
import { ChannelPicker, MultiRolePicker, RolePicker, useChannelName, useRoleName } from '@/components/pickers';
import { TemplateEditor } from '@/components/template-editor';
import { useToast } from '@/components/providers';

interface Option {
  roleId: string;
  label: string;
  emoji: string | null;
  description: string | null;
  style: 'primary' | 'secondary' | 'success' | 'danger';
  behavior: 'toggle' | 'add' | 'remove';
}
interface Panel {
  id?: string;
  name: string;
  kind: 'button' | 'select' | 'reaction';
  template: MessageTemplate;
  exclusive: boolean;
  maxRoles: number | null;
  requiredRoleIds: string[];
  blockedRoleIds: string[];
  logChannelId: string | null;
  placeholder: string | null;
  options: Option[];
  published?: { channelId: string } | null;
}

const NEW: Panel = {
  name: 'Pick your roles',
  kind: 'button',
  template: { embeds: [{ title: 'Pick your roles', description: 'Press a button to add or remove a role.', color: 0x6d5dfc, timestamp: false, fields: [] }], components: [] },
  exclusive: false,
  maxRoles: null,
  requiredRoleIds: [],
  blockedRoleIds: [],
  logChannelId: null,
  placeholder: null,
  options: [],
};

export default function RolePanelsPage() {
  const ctl = useModuleSettings<Record<string, never>>('rolepanels');
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [draft, setDraft] = useState<Panel | null>(null);
  const [newRole, setNewRole] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishFor, setPublishFor] = useState<Panel | null>(null);
  const [publishChannel, setPublishChannel] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Panel | null>(null);
  const { publish, busy } = usePublish();
  const { notify, fail } = useToast();
  const roleName = useRoleName();
  const channelName = useChannelName();

  const load = useCallback(() => api<Panel[]>('/api/rolepanels').then(setPanels).catch(fail), [fail]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { id, published: _p, ...body } = draft;
      await api(id ? `/api/rolepanels/${id}` : '/api/rolepanels', { method: id ? 'PUT' : 'POST', body });
      notify(draft.published ? 'Saved. Publish again to update the message in Discord.' : 'Panel saved.');
      setDraft(null);
      void load();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues.map((i) => `${i.path}: ${i.message}`)].join(' ') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setOpt = (i: number, patch: Partial<Option>) => draft && setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const moveOpt = (i: number, d: -1 | 1) => {
    if (!draft) return;
    const o = [...draft.options];
    [o[i], o[i + d]] = [o[i + d]!, o[i]!];
    setDraft({ ...draft, options: o });
  };

  return (
    <ModuleShell
      title="Role panels"
      description="Let members pick their own roles with buttons, a menu or reactions. The bot checks role hierarchy before every change."
      ctl={ctl}
      actions={
        <Button variant="primary" onClick={() => setDraft(structuredClone(NEW))}>
          <Plus className="size-4" /> New panel
        </Button>
      }
    >
      {!panels ? (
        <Spinner />
      ) : panels.length === 0 ? (
        <Empty title="No role panels yet" action={<Button onClick={() => setDraft(structuredClone(NEW))}>Create one</Button>} />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {panels.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted">
                    {p.kind} · {p.options.length} role(s){p.exclusive ? ' · pick one' : ''} · {p.published ? `in #${channelName(p.published.channelId)}` : 'not published'}
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
      <Modal
        wide
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit role panel' : 'New role panel'}
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
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Panel name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={80} />
              <Select
                label="Style"
                value={draft.kind}
                onChange={(kind) => setDraft({ ...draft, kind })}
                options={[
                  { value: 'button', label: 'Buttons' },
                  { value: 'select', label: 'Dropdown menu' },
                  { value: 'reaction', label: 'Reactions' },
                ]}
              />
            </div>
            <p className="text-sm font-medium">Message</p>
            <TemplateEditor value={draft.template} onChange={(template) => setDraft({ ...draft, template: { ...template, components: [] } })} maxEmbeds={1} />
            <div className="space-y-3">
              <p className="text-sm font-medium">Roles</p>
              {draft.options.map((o, i) => (
                <div key={o.roleId} className="grid items-end gap-2 rounded-lg border border-line p-3 md:grid-cols-[10rem_1fr_6rem_10rem_auto]">
                  <p className="pb-2 text-sm">@{roleName(o.roleId)}</p>
                  <TextInput label="Label" value={o.label} onChange={(label) => setOpt(i, { label })} maxLength={80} />
                  <TextInput label="Emoji" value={o.emoji ?? ''} onChange={(emoji) => setOpt(i, { emoji: emoji || null })} />
                  <Select
                    label="Behavior"
                    value={o.behavior}
                    onChange={(behavior) => setOpt(i, { behavior })}
                    options={[
                      { value: 'toggle', label: 'Add or remove' },
                      { value: 'add', label: 'Add only' },
                      { value: 'remove', label: 'Remove only' },
                    ]}
                  />
                  <div className="flex">
                    <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => moveOpt(i, -1)}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === draft.options.length - 1} onClick={() => moveOpt(i, 1)}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Remove role" onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {draft.kind === 'select' && (
                    <div className="md:col-span-5">
                      <TextInput label="Description" value={o.description ?? ''} onChange={(d) => setOpt(i, { description: d || null })} maxLength={100} />
                    </div>
                  )}
                  {draft.kind === 'button' && (
                    <div className="md:col-span-2">
                      <Select
                        label="Button color"
                        value={o.style}
                        onChange={(style) => setOpt(i, { style })}
                        options={[
                          { value: 'secondary', label: 'Grey' },
                          { value: 'primary', label: 'Blurple' },
                          { value: 'success', label: 'Green' },
                          { value: 'danger', label: 'Red' },
                        ]}
                      />
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <RolePicker label="Add a role" hint="The bot's highest role must be above it." value={newRole} onChange={setNewRole} />
                </div>
                <Button
                  disabled={!newRole || draft.options.some((o) => o.roleId === newRole) || draft.options.length >= 25}
                  onClick={() => {
                    if (!newRole) return;
                    setDraft({ ...draft, options: [...draft.options, { roleId: newRole, label: roleName(newRole).slice(0, 80), emoji: draft.kind === 'reaction' ? '⭐' : null, description: null, style: 'secondary', behavior: 'toggle' }] });
                    setNewRole(undefined);
                  }}
                >
                  <Plus className="size-4" /> Add
                </Button>
              </div>
            </div>
            <Advanced title="Rules">
              <div className="grid gap-4 md:grid-cols-2">
                <Toggle label="Only one role at a time" description="Picking a role removes the others from this panel." checked={draft.exclusive} onChange={(exclusive) => setDraft({ ...draft, exclusive })} />
                <NumberInput label="Maximum roles from this panel" hint="Empty = no limit" min={1} max={25} value={draft.maxRoles} onChange={(maxRoles) => setDraft({ ...draft, maxRoles })} />
                <MultiRolePicker label="Only members with one of these roles can use it" value={draft.requiredRoleIds} onChange={(requiredRoleIds) => setDraft({ ...draft, requiredRoleIds })} />
                <MultiRolePicker label="Members with these roles cannot use it" value={draft.blockedRoleIds} onChange={(blockedRoleIds) => setDraft({ ...draft, blockedRoleIds })} />
                <ChannelPicker label="Log changes to" value={draft.logChannelId} onChange={(v) => setDraft({ ...draft, logChannelId: v ?? null })} />
                {draft.kind === 'select' && <TextInput label="Menu placeholder" value={draft.placeholder ?? ''} onChange={(v) => setDraft({ ...draft, placeholder: v || null })} maxLength={150} />}
              </div>
            </Advanced>
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
                if (await publish({ kind: 'rolepanel', refId: publishFor!.id, channelId: publishChannel })) {
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
        <ChannelPicker label="Channel" value={publishChannel} onChange={setPublishChannel} />
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete role panel?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/rolepanels/${deleting!.id}`, { method: 'DELETE' });
            notify('Deleted.');
            void load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        The panel message is removed from Discord. Members keep roles they already picked.
      </Confirm>
    </ModuleShell>
  );
}
