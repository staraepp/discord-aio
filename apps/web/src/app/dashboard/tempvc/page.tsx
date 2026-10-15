'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Advanced, Badge, Button, Card, Confirm, Modal, NumberInput, Select, TextInput, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings, usePublish } from '@/components/module';
import { CH, ChannelPicker, MultiChannelPicker, useChannelName } from '@/components/pickers';
import { useToast } from '@/components/providers';

interface TempSettings {
  panelChannelId?: string;
  categoryIds: string[];
  defaultNameTemplate: string;
  defaultUserLimit: number;
  graceSeconds: number;
  panelEmbedId?: string;
}
interface Preset {
  id?: string;
  name: string;
  emoji: string | null;
  nameTemplate: string;
  userLimit: number;
  bitrate: number | null;
  visibility: 'public' | 'private' | 'friends';
  position: number;
}
interface Room {
  channelId: string;
  ownerId: string;
  visibility: string;
  locked: boolean;
  hidden: boolean;
  createdAt: string;
}

const EMPTY: Preset = { name: '', emoji: '', nameTemplate: "{user.display_name}'s room", userLimit: 0, bitrate: null, visibility: 'public', position: 0 };

export default function TempVcPage() {
  const ctl = useModuleSettings<TempSettings>('tempvc');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [deleting, setDeleting] = useState<Preset | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { notify, fail } = useToast();
  const { publish, busy } = usePublish();
  const channelName = useChannelName();

  const load = useCallback(() => {
    api<Preset[]>('/api/tempvc/presets').then(setPresets).catch(fail);
    api<Room[]>('/api/tempvc/rooms').then(setRooms).catch(fail);
  }, [fail]);
  useEffect(load, [load]);

  const savePreset = async () => {
    if (!editing) return;
    try {
      const { id, ...body } = editing;
      await api(id ? `/api/tempvc/presets/${id}` : '/api/tempvc/presets', { method: id ? 'PUT' : 'POST', body });
      notify('Preset saved.');
      setEditing(null);
      setErrors({});
      load();
    } catch (e) {
      const issues = (e as { issues?: { path: string; message: string }[] }).issues ?? [];
      setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      fail(e);
    }
  };

  const s = ctl.draft;
  return (
    <ModuleShell
      title="Temporary voice channels"
      description="Members create their own rooms from a panel. Rooms are deleted only after the last person leaves (with a short grace period). Room owners control name, limit, lock, visibility and who may join."
      ctl={ctl}
      actions={
        <Button onClick={() => publish({ kind: 'tempvc' })} loading={busy} disabled={!s?.panelChannelId}>
          Publish panel
        </Button>
      }
    >
      {s && (
        <Card title="Setup">
          <div className="grid gap-5 md:grid-cols-2">
            <ChannelPicker label="Panel channel" hint="Where the create-a-room panel is posted." value={s.panelChannelId} onChange={(v) => ctl.update({ panelChannelId: v })} />
            <MultiChannelPicker label="Categories for new rooms" hint="Rooms go into the first category with space." types={[CH.category]} value={s.categoryIds} onChange={(v) => ctl.update({ categoryIds: v })} />
            <TextInput label="Default room name" hint="Variables: {user.display_name}, {user.name}" value={s.defaultNameTemplate} onChange={(v) => ctl.update({ defaultNameTemplate: v })} error={ctl.errors.defaultNameTemplate} maxLength={100} />
            <NumberInput label="Default user limit" hint="0 = unlimited" min={0} max={99} value={s.defaultUserLimit} onChange={(v) => ctl.update({ defaultUserLimit: v ?? 0 })} />
          </div>
          <div className="mt-5">
            <Advanced>
              <NumberInput label="Grace period (seconds)" hint="A new room is kept at least this long so its creator can join." min={10} max={300} value={s.graceSeconds} onChange={(v) => ctl.update({ graceSeconds: v ?? 30 })} />
            </Advanced>
          </div>
        </Card>
      )}
      <Card
        title="Room presets"
        description="Shown when members press Presets on the panel. Each preset sets a name template, limit, bitrate and visibility. Private rooms only admit people the owner allows; there are no persistent room bans."
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing({ ...EMPTY, position: presets.length })} disabled={presets.length >= 20}>
            <Plus className="size-4" /> New preset
          </Button>
        }
      >
        {presets.length === 0 ? (
          <p className="text-sm text-muted">No presets yet. The panel still offers Public, Private, Friends-only and Custom rooms using the defaults above.</p>
        ) : (
          <ul className="divide-y divide-line">
            {presets.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {p.emoji} <span className="font-medium">{p.name}</span> <span className="text-muted">· {p.nameTemplate} · limit {p.userLimit || '∞'}</span> <Badge>{p.visibility}</Badge>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Active rooms">
        {rooms.length === 0 ? (
          <p className="text-sm text-muted">No temporary rooms right now.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {rooms.map((r) => (
              <li key={r.channelId} className="flex justify-between py-2">
                <span>
                  {channelName(r.channelId)} <span className="text-muted">· owner <span className="font-mono">{r.ownerId}</span></span> {r.locked && <Badge>locked</Badge>} {r.hidden && <Badge>hidden</Badge>}
                </span>
                <span className="text-xs text-muted">{formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit preset' : 'New preset'}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={savePreset}>
              Save preset
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Name" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} error={errors.name} maxLength={40} />
            <TextInput label="Emoji" value={editing.emoji ?? ''} onChange={(emoji) => setEditing({ ...editing, emoji: emoji || null })} />
            <div className="sm:col-span-2">
              <TextInput label="Room name template" hint="{emoji}, {user.display_name}, {user.name}" value={editing.nameTemplate} onChange={(nameTemplate) => setEditing({ ...editing, nameTemplate })} error={errors.nameTemplate} />
            </div>
            <NumberInput label="User limit" hint="0 = unlimited" min={0} max={99} value={editing.userLimit} onChange={(v) => setEditing({ ...editing, userLimit: v ?? 0 })} />
            <Select
              label="Visibility"
              value={editing.visibility}
              onChange={(visibility) => setEditing({ ...editing, visibility })}
              options={[
                { value: 'public', label: 'Public: anyone can join' },
                { value: 'private', label: 'Private: only allowed members' },
                { value: 'friends', label: 'Visible, join by permission' },
              ]}
            />
            <NumberInput label="Bitrate (bps, optional)" hint="Clamped to your server boost level." min={8000} max={384000} value={editing.bitrate} onChange={(bitrate) => setEditing({ ...editing, bitrate })} />
            <NumberInput label="Order" min={0} max={100} value={editing.position} onChange={(v) => setEditing({ ...editing, position: v ?? 0 })} />
          </div>
        )}
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete preset?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/tempvc/presets/${deleting!.id}`, { method: 'DELETE' });
            notify('Preset deleted.');
            load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        Existing rooms are not affected.
      </Confirm>
    </ModuleShell>
  );
}
