'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Advanced, Alert, Button, Card, Confirm, Select, Spinner, TextInput, Toggle } from '@/components/ui';
import { ModuleShell, useModuleSettings, usePublish } from '@/components/module';
import { ChannelPicker, MultiRolePicker } from '@/components/pickers';
import { useToast } from '@/components/providers';

type Action = 'delete_alert' | 'kick' | 'softban' | 'ban';
interface Config {
  channelId: string | null;
  action: Action;
  exemptRoleIds: string[];
  exemptUserIds: string[];
  logChannelId: string | null;
  warningEmbedId: string | null;
  deleteMessage: boolean;
}

const DEFAULT: Config = { channelId: null, action: 'delete_alert', exemptRoleIds: [], exemptUserIds: [], logChannelId: null, warningEmbedId: null, deleteMessage: true };
const DESTRUCTIVE = new Set<Action>(['kick', 'softban', 'ban']);
const LABELS: Record<Action, string> = {
  delete_alert: 'Delete the message and alert staff (safe default)',
  kick: 'Kick the member',
  softban: 'Softban (ban + unban to remove recent messages)',
  ban: 'Ban the member',
};

export default function HoneypotPage() {
  const ctl = useModuleSettings<Record<string, never>>('honeypot');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saved, setSaved] = useState<Config | null>(null);
  const [embeds, setEmbeds] = useState<{ id: string; name: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const { publish, busy } = usePublish();
  const { notify, fail } = useToast();

  const load = useCallback(() => {
    api<{ config: Config | null }>('/api/honeypot')
      .then((r) => {
        const c = r.config ? { ...DEFAULT, ...r.config } : DEFAULT;
        setCfg(c);
        setSaved(c);
      })
      .catch(fail);
    api<{ id: string; name: string }[]>('/api/embeds').then(setEmbeds).catch(() => undefined);
  }, [fail]);
  useEffect(load, [load]);

  const doSave = async (confirmDestructive: boolean) => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api('/api/honeypot', { method: 'PUT', body: { ...cfg, confirmDestructive } });
      notify('Honeypot saved.');
      load();
    } catch (e) {
      fail(e instanceof ApiError && e.issues.length ? new Error(e.issues[0]!.message) : e);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  const save = () => {
    if (!cfg) return;
    if (DESTRUCTIVE.has(cfg.action) && cfg.action !== saved?.action) setConfirming(true);
    else void doSave(DESTRUCTIVE.has(cfg.action));
  };

  return (
    <ModuleShell
      title="Honeypot"
      description="An opt-in trap channel for spam bots: real members are told not to post there. You choose exactly what happens when someone does."
      ctl={ctl}
      actions={
        <Button onClick={() => publish({ kind: 'honeypot' })} loading={busy} disabled={!saved?.channelId}>
          Post warning message
        </Button>
      }
    >
      {!cfg ? (
        <Spinner />
      ) : (
        <>
          <Card title="Trap channel">
            <div className="grid gap-5 md:grid-cols-2">
              <ChannelPicker label="Trap channel" hint="Create a dedicated channel. Members should not normally post here." value={cfg.channelId} onChange={(v) => setCfg({ ...cfg, channelId: v ?? null })} />
              <ChannelPicker label="Alert/log channel" value={cfg.logChannelId} onChange={(v) => setCfg({ ...cfg, logChannelId: v ?? null })} />
            </div>
          </Card>
          <Card title="What happens" description="Administrators, staff, bots and exempt roles are never actioned.">
            <Select label="Action" value={cfg.action} onChange={(action) => setCfg({ ...cfg, action })} options={(Object.keys(LABELS) as Action[]).map((a) => ({ value: a, label: LABELS[a] }))} />
            {DESTRUCTIVE.has(cfg.action) && (
              <div className="mt-3">
                <Alert tone="warn" title="Automatic removal">
                  Anyone who posts in the trap channel will be removed without a staff review. Each action is logged as a moderation case with an explanatory reason.
                </Alert>
              </div>
            )}
            <div className="mt-4 space-y-1">
              <Toggle label="Delete the message" checked={cfg.deleteMessage} onChange={(deleteMessage) => setCfg({ ...cfg, deleteMessage })} />
            </div>
          </Card>
          <Advanced title="Exemptions and warning message">
            <div className="grid gap-5 md:grid-cols-2">
              <MultiRolePicker label="Exempt roles" value={cfg.exemptRoleIds} onChange={(exemptRoleIds) => setCfg({ ...cfg, exemptRoleIds })} />
              <TextInput label="Exempt user IDs" hint="Comma separated" value={cfg.exemptUserIds.join(', ')} onChange={(v) => setCfg({ ...cfg, exemptUserIds: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
              <Select label="Warning message" hint="The default is a honey pot card that names the action and counts how many it has caught. Pick a saved embed to use your own design instead." value={cfg.warningEmbedId ?? ''} onChange={(v) => setCfg({ ...cfg, warningEmbedId: v || null })} options={[{ value: '', label: 'Default honey pot card' }, ...embeds.map((e) => ({ value: e.id, label: e.name }))]} />
            </div>
          </Advanced>
          <div className="flex justify-end">
            <Button variant="primary" loading={saving} onClick={save} disabled={JSON.stringify(cfg) === JSON.stringify(saved)}>
              Save honeypot
            </Button>
          </div>
        </>
      )}
      <Confirm open={confirming} onClose={() => setConfirming(false)} onConfirm={() => doSave(true)} busy={saving} title={`Confirm: ${cfg ? LABELS[cfg.action] : ''}`} confirmLabel="I understand, save" phrase="CONFIRM">
        Members who post in the trap channel will be {cfg?.action === 'kick' ? 'kicked' : cfg?.action === 'softban' ? 'softbanned' : 'banned'} automatically. Make sure the channel clearly warns people not to post.
      </Confirm>
    </ModuleShell>
  );
}
