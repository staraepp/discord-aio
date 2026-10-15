'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/client';
import { Advanced, Alert, Badge, Button, Card, Confirm, Modal, NumberInput, Select, Spinner, Tabs, TextArea, TextInput, Toggle, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker, MultiRolePicker } from '@/components/pickers';
import { useToast } from '@/components/providers';

interface ModSettings {
  modLogChannelId?: string;
  dmOnAction: boolean;
  automod: {
    enabled: boolean;
    alertChannelId?: string;
    exemptRoleIds: string[];
    keywords: string[];
    spam: { enabled: boolean; maxMessages: number; perSeconds: number };
    mentions: { enabled: boolean; max: number };
    repeated: { enabled: boolean; count: number; withinSeconds: number };
  };
}
interface Case {
  id: string;
  caseNumber: number;
  type: string;
  targetId: string | null;
  moderatorId: string;
  reason: string | null;
  evidence: string | null;
  durationMs: number | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
  edits: { id: string; field: string; oldValue: string | null; newValue: string | null; editorId: string; createdAt: string }[];
}

const TYPES = ['', 'warn', 'timeout', 'untimeout', 'kick', 'voicekick', 'ban', 'tempban', 'softban', 'unban', 'purge', 'slowmode', 'lock', 'unlock', 'lockdown', 'honeypot', 'automod'];
const REASON_REQUIRED = new Set(['warn', 'kick', 'ban', 'tempban', 'softban']);

function Cases() {
  const [type, setType] = useState('');
  const [target, setTarget] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: Case[]; total: number; warnCount: number | null } | null>(null);
  const [editing, setEditing] = useState<Case | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [deleting, setDeleting] = useState<Case | null>(null);
  const [notes, setNotes] = useState<{ id: string; content: string; authorId: string; createdAt: string }[] | null>(null);
  const { notify, fail } = useToast();

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (type) p.set('type', type);
    if (/^\d{17,20}$/.test(target)) p.set('target', target);
    api<{ items: Case[]; total: number; warnCount: number | null }>(`/api/moderation/cases?${p}`).then(setData).catch(fail);
    if (/^\d{17,20}$/.test(target)) api<typeof notes>(`/api/moderation/notes?target=${target}`).then(setNotes).catch(() => setNotes(null));
    else setNotes(null);
  }, [type, target, page, fail]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Type" value={type} onChange={(v) => { setType(v); setPage(0); }} options={TYPES.map((t) => ({ value: t, label: t || 'All types' }))} />
        <TextInput label="Member ID" hint="Shows their cases, warning count and notes." value={target} onChange={(v) => { setTarget(v.trim()); setPage(0); }} inputMode="numeric" />
      </div>
      {data?.warnCount !== null && data?.warnCount !== undefined && (
        <Alert tone="info" title={`Active warnings: ${data.warnCount}`}>Warnings never trigger automatic punishments. Staff decide what happens next.</Alert>
      )}
      <Card>
        {!data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted">No cases.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr>
                  <th className="py-2 pr-3">#</th>
                  <th className="pr-3">Type</th>
                  <th className="pr-3">Member</th>
                  <th className="pr-3">Moderator</th>
                  <th className="pr-3">Reason</th>
                  <th className="pr-3">When</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="py-2 pr-3">{c.caseNumber}</td>
                    <td className="pr-3">
                      <Badge tone={c.type.includes('ban') ? 'bad' : c.type === 'warn' ? 'warn' : 'neutral'}>{c.type}</Badge>
                      {c.expiresAt && <p className="text-xs text-muted">until {formatDate(c.expiresAt)}</p>}
                    </td>
                    <td className="pr-3 font-mono text-xs">{c.targetId ?? 'none'}</td>
                    <td className="pr-3 font-mono text-xs">{c.moderatorId}</td>
                    <td className="max-w-xs pr-3">
                      {c.reason ?? <span className="text-muted">none</span>}
                      {c.evidence && <p className="text-xs text-muted">Evidence: {c.evidence}</p>}
                      {c.edits.length > 0 && <p className="text-xs text-muted">edited {c.edits.length}×</p>}
                    </td>
                    <td className="pr-3 text-xs whitespace-nowrap text-muted">{formatDate(c.createdAt)}</td>
                    <td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" aria-label={`Edit case ${c.caseNumber}`} onClick={() => { setEditing(c); setReason(c.reason ?? ''); setEvidence(c.evidence ?? ''); }}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete case ${c.caseNumber}`} onClick={() => setDeleting(c)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 50 && (
          <div className="mt-3 flex justify-between">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </Card>
      {notes && (
        <Card title="Staff notes" description="Private to staff. Never shown to the member.">
          {notes.length === 0 ? (
            <p className="text-sm text-muted">No notes. Add notes with /note in Discord.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {notes.map((n) => (
                <li key={n.id} className="py-2">
                  <p className="whitespace-pre-wrap">{n.content}</p>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{n.authorId}</span> · {formatDate(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit case #${editing?.caseNumber ?? ''}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={editing ? REASON_REQUIRED.has(editing.type) && !reason.trim() : true}
              onClick={async () => {
                try {
                  await api(`/api/moderation/cases/${editing!.caseNumber}`, { method: 'PATCH', body: { ...(reason.trim() ? { reason: reason.trim() } : {}), evidence: evidence.trim() || null } });
                  notify('Case updated.');
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
        <div className="space-y-4">
          <TextArea label={`Reason${editing && REASON_REQUIRED.has(editing.type) ? ' (required)' : ''}`} value={reason} onChange={setReason} maxLength={1000} rows={3} />
          <TextInput label="Evidence (link or note)" value={evidence} onChange={setEvidence} maxLength={1000} />
          {editing && editing.edits.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted uppercase">Edit history</p>
              <ul className="space-y-1 text-xs">
                {editing.edits.map((e) => (
                  <li key={e.id}>
                    {formatDate(e.createdAt)} · {e.field}: “{e.oldValue ?? 'none'}” → “{e.newValue ?? 'none'}” by <span className="font-mono">{e.editorId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete case #${deleting?.caseNumber ?? ''}?`}
        confirmLabel="Delete case"
        onConfirm={async () => {
          try {
            await api(`/api/moderation/cases/${deleting!.caseNumber}`, { method: 'DELETE' });
            notify('Case deleted.');
            load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        The case is hidden and no longer counts toward warnings. The deletion is recorded in the audit log. A deleted tempban still lifts on schedule.
      </Confirm>
    </>
  );
}

export default function ModerationPage() {
  const ctl = useModuleSettings<ModSettings>('moderation');
  const [tab, setTab] = useState<'cases' | 'settings'>('cases');
  const s = ctl.draft;
  const am = s?.automod;
  const setAm = (patch: Partial<ModSettings['automod']>) => s && ctl.update({ automod: { ...s.automod, ...patch } });
  return (
    <ModuleShell title="Moderation" description="Staff-driven moderation with cases, reasons and history. Warns, kicks and bans always require a reason. Nothing escalates automatically." ctl={ctl}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'cases', label: 'Cases' }, { id: 'settings', label: 'Settings' }]} />
      {tab === 'cases' && <Cases />}
      {tab === 'settings' && s && am && (
        <>
          <Card title="Logging">
            <div className="grid gap-5 md:grid-cols-2">
              <ChannelPicker label="Moderation log channel" value={s.modLogChannelId} onChange={(modLogChannelId) => ctl.update({ modLogChannelId })} />
              <Toggle label="DM members about actions" description="Tell members when they are warned, timed out, kicked or banned (if their DMs are open)." checked={s.dmOnAction} onChange={(dmOnAction) => ctl.update({ dmOnAction })} />
            </div>
          </Card>
          <Card title="Automod alerts" description="Automod only deletes the offending message and alerts staff. It never warns, times out, kicks or bans on its own.">
            <Toggle label="Enable automod" checked={am.enabled} onChange={(enabled) => setAm({ enabled })} />
            {am.enabled && (
              <div className="mt-4 space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <ChannelPicker label="Alert channel" value={am.alertChannelId} onChange={(alertChannelId) => setAm({ alertChannelId })} />
                  <MultiRolePicker label="Exempt roles" value={am.exemptRoleIds} onChange={(exemptRoleIds) => setAm({ exemptRoleIds })} />
                </div>
                <TextArea label="Blocked words (one per line)" value={am.keywords.join('\n')} onChange={(v) => setAm({ keywords: v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 500) })} rows={4} />
                <Advanced title="Spam, mentions and repeats">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Toggle label="Message spam" checked={am.spam.enabled} onChange={(enabled) => setAm({ spam: { ...am.spam, enabled } })} />
                      <NumberInput label="Max messages" min={3} max={30} value={am.spam.maxMessages} onChange={(v) => setAm({ spam: { ...am.spam, maxMessages: v ?? 6 } })} />
                      <NumberInput label="Within seconds" min={2} max={60} value={am.spam.perSeconds} onChange={(v) => setAm({ spam: { ...am.spam, perSeconds: v ?? 5 } })} />
                    </div>
                    <div className="space-y-2">
                      <Toggle label="Mass mentions" checked={am.mentions.enabled} onChange={(enabled) => setAm({ mentions: { ...am.mentions, enabled } })} />
                      <NumberInput label="Max mentions per message" min={2} max={50} value={am.mentions.max} onChange={(v) => setAm({ mentions: { ...am.mentions, max: v ?? 6 } })} />
                    </div>
                    <div className="space-y-2">
                      <Toggle label="Repeated messages" checked={am.repeated.enabled} onChange={(enabled) => setAm({ repeated: { ...am.repeated, enabled } })} />
                      <NumberInput label="Same message count" min={2} max={20} value={am.repeated.count} onChange={(v) => setAm({ repeated: { ...am.repeated, count: v ?? 3 } })} />
                      <NumberInput label="Within seconds" min={5} max={600} value={am.repeated.withinSeconds} onChange={(v) => setAm({ repeated: { ...am.repeated, withinSeconds: v ?? 60 } })} />
                    </div>
                  </div>
                </Advanced>
              </div>
            )}
          </Card>
        </>
      )}
    </ModuleShell>
  );
}
