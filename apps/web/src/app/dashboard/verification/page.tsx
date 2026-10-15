'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Advanced, Alert, Badge, Button, Card, Confirm, NumberInput, PageSkeleton, Select, Stat, Tabs, TextInput, Toggle, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings, usePublish } from '@/components/module';
import { ChannelPicker, MultiChannelPicker, RolePicker } from '@/components/pickers';
import { useToast } from '@/components/providers';

interface VSettings {
  unverifiedRoleId?: string;
  verifiedRoleId?: string;
  verificationChannelId?: string;
  allowlistChannelIds: string[];
  panelEmbedId?: string;
  logChannelId?: string;
  staffAlertRoleId?: string;
  captchaProvider: 'image' | 'builtin' | 'turnstile';
  tokenTtlMinutes: number;
  logFilters: { joins: boolean; success: boolean; failures: boolean; cooldowns: boolean; accountAge: boolean; resets: boolean };
}
interface MemberState {
  userId: string;
  failuresInCycle: number;
  cyclesFailed: number;
  cooldownUntil: string | null;
  verifiedAt: string | null;
  lastAttemptAt: string | null;
  pendingRoleSync: boolean;
}

function Members() {
  const [filter, setFilter] = useState('');
  const [user, setUser] = useState('');
  const [data, setData] = useState<{ items: MemberState[]; attempts: { id: string; createdAt: string; result: string; failureCount: number }[]; stats: { inCooldown: number; verified7d: number; pendingRoleSync: number } } | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const { notify, fail } = useToast();
  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (filter) p.set('filter', filter);
    if (/^\d{17,20}$/.test(user)) p.set('user', user);
    api<NonNullable<typeof data>>(`/api/verification/members?${p}`).then(setData).catch(fail);
  }, [filter, user, fail]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  if (!data) return <PageSkeleton />;
  const now = Date.now();
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Verified (7 days)" value={data.stats.verified7d} />
        <Stat label="In cooldown now" value={data.stats.inCooldown} hint="Verification-only pause; members are never kicked or timed out." />
        <Stat label="Waiting for role sync" value={data.stats.pendingRoleSync} hint="Applied automatically when the bot is online." />
      </div>
      <Card title="Members">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Select
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: '', label: 'Recent activity' },
              { value: 'cooldown', label: 'In cooldown' },
              { value: 'verified', label: 'Verified' },
              { value: 'pending_sync', label: 'Waiting for role sync' },
            ]}
          />
          <TextInput label="Member ID" value={user} onChange={(v) => setUser(v.trim())} inputMode="numeric" />
        </div>
        {data.items.length === 0 ? (
          <p className="text-sm text-muted">No members match.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.items.map((m) => {
              const cooling = m.cooldownUntil && new Date(m.cooldownUntil).getTime() > now;
              return (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{m.userId}</span>
                    {m.verifiedAt && <Badge tone="good">verified {formatDate(m.verifiedAt)}</Badge>}
                    {cooling && <Badge tone="warn">paused until {formatDate(m.cooldownUntil)}</Badge>}
                    {m.failuresInCycle > 0 && <Badge>{m.failuresInCycle}/3 wrong</Badge>}
                    {m.cyclesFailed > 0 && <Badge>{m.cyclesFailed} cooldown cycle(s)</Badge>}
                    {m.pendingRoleSync && <Badge tone="accent">role sync pending</Badge>}
                  </span>
                  <Button size="sm" onClick={() => setResetting(m.userId)}>
                    Reset
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {data.attempts.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs text-muted uppercase">Recent attempts for this member</p>
            <ul className="space-y-1 text-xs">
              {data.attempts.map((a) => (
                <li key={a.id}>
                  {formatDate(a.createdAt)} · {a.result} · {a.failureCount} wrong answer(s)
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Confirm
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title="Reset verification?"
        confirmLabel="Reset"
        onConfirm={async () => {
          try {
            const r = await api<{ message: string }>('/api/verification/reset', { body: { userId: resetting } });
            notify(r.message.replace(/<@\d+>/g, 'the member'));
            load();
          } catch (e) {
            fail(e);
          }
          setResetting(null);
        }}
      >
        Clears their failures and cooldown, removes Verified and gives back Unverified. They will need to verify again.
      </Confirm>
    </div>
  );
}

export default function VerificationPage() {
  const ctl = useModuleSettings<VSettings>('verification');
  const [tab, setTab] = useState<'setup' | 'members'>('setup');
  const [audit, setAudit] = useState<{ leaking: string[]; unreachable: string[]; roleProblems: string[] } | null>(null);
  const [auditing, setAuditing] = useState(false);
  const { publish, busy } = usePublish();
  const { fail } = useToast();
  const s = ctl.draft;
  return (
    <ModuleShell
      title="Verification"
      description="New members get the Unverified role and can only see the verification channel (plus any allowlisted channels) until they pass a simple CAPTCHA."
      ctl={ctl}
      actions={
        <Button onClick={() => publish({ kind: 'verification' })} loading={busy} disabled={!s?.verificationChannelId}>
          Publish panel
        </Button>
      }
    >
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'setup', label: 'Setup' }, { id: 'members', label: 'Members' }]} />
      {tab === 'members' && <Members />}
      {tab === 'setup' && s && (
        <>
          <Card title="Roles and channels">
            <div className="grid gap-5 md:grid-cols-2">
              <RolePicker label="Unverified role" hint="Given on join. Deny View Channel for this role everywhere except the verification channel." value={s.unverifiedRoleId} onChange={(v) => ctl.update({ unverifiedRoleId: v })} error={ctl.errors.unverifiedRoleId} />
              <RolePicker label="Verified role" hint="Given after passing." value={s.verifiedRoleId} onChange={(v) => ctl.update({ verifiedRoleId: v })} error={ctl.errors.verifiedRoleId} />
              <ChannelPicker label="Verification channel" hint="Where the Verify panel is posted." value={s.verificationChannelId} onChange={(v) => ctl.update({ verificationChannelId: v })} />
              <MultiChannelPicker label="Also visible before verifying" hint="E.g. rules. Keep this list short." value={s.allowlistChannelIds} onChange={(v) => ctl.update({ allowlistChannelIds: v })} />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                loading={auditing}
                onClick={async () => {
                  setAuditing(true);
                  try {
                    setAudit(await api('/api/verification/audit', { method: 'POST' }));
                  } catch (e) {
                    fail(e);
                  } finally {
                    setAuditing(false);
                  }
                }}
              >
                Check what Unverified can see
              </Button>
              <span className="text-xs text-muted">Uses saved settings. Save first if you changed roles.</span>
            </div>
            {audit && (
              <div className="mt-4 space-y-2">
                {audit.roleProblems.map((p) => (
                  <Alert key={p} tone="bad">
                    {p}
                  </Alert>
                ))}
                {audit.leaking.length > 0 ? (
                  <Alert tone="warn" title="Unverified members can see channels outside the allowlist">
                    {audit.leaking.join(', ')}
                  </Alert>
                ) : (
                  <Alert tone="good">Unverified members can only see the verification channel and allowlist.</Alert>
                )}
                {audit.unreachable.length > 0 && (
                  <Alert tone="warn" title="Unverified members cannot see these required channels">
                    {audit.unreachable.join(', ')}
                  </Alert>
                )}
              </div>
            )}
          </Card>
          <Card title="Logs and alerts" description="Accounts younger than three days are flagged to staff but can still verify.">
            <div className="grid gap-5 md:grid-cols-2">
              <ChannelPicker label="Verification log channel" value={s.logChannelId} onChange={(v) => ctl.update({ logChannelId: v })} />
              <RolePicker label="Staff role to ping for new accounts" value={s.staffAlertRoleId} onChange={(v) => ctl.update({ staffAlertRoleId: v })} />
            </div>
            <div className="mt-4 grid gap-1 sm:grid-cols-3">
              {(
                [
                  ['joins', 'Joins'],
                  ['success', 'Successes'],
                  ['failures', 'Wrong answers'],
                  ['cooldowns', 'Cooldowns'],
                  ['accountAge', 'New-account alerts'],
                  ['resets', 'Staff resets'],
                ] as const
              ).map(([k, label]) => (
                <Toggle key={k} label={label} checked={s.logFilters[k]} onChange={(v) => ctl.update({ logFilters: { ...s.logFilters, [k]: v } })} />
              ))}
            </div>
          </Card>
          <Advanced>
            <div className="grid gap-5 md:grid-cols-2">
              <Select
                label="CAPTCHA"
                hint="The picture and text question happen right inside Discord, in a private message with the picture in an embed. Members can always switch to the text question if they can't read the picture. Turnstile opens a web page instead and needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY."
                value={s.captchaProvider}
                onChange={(captchaProvider) => ctl.update({ captchaProvider })}
                options={[
                  { value: 'image', label: 'Picture code (letters and numbers)' },
                  { value: 'builtin', label: 'Text question only (simple math)' },
                  { value: 'turnstile', label: 'Cloudflare Turnstile' },
                ]}
              />
              <NumberInput label="Each check is valid for (minutes)" min={5} max={60} value={s.tokenTtlMinutes} onChange={(v) => ctl.update({ tokenTtlMinutes: v ?? 15 })} />
            </div>
            <p className="text-xs text-muted">After 3 wrong answers verification pauses for 5 minutes, then 15 minutes, 1 hour, and at most 6 hours for later cycles. Members are never kicked or timed out.</p>
          </Advanced>
        </>
      )}
    </ModuleShell>
  );
}
