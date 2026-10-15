'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Badge, Button, Card, Empty, NumberInput, Select, Spinner, TextArea, TextInput, formatDate } from '@/components/ui';
import { ModuleShell, useModuleSettings } from '@/components/module';
import { ChannelPicker, RolePicker, useChannelName } from '@/components/pickers';
import { useToast } from '@/components/providers';

interface GiveawaySettings {
  pingRoleId?: string;
  maxDurationDays: number;
}

interface GiveawayRow {
  id: string;
  channelId: string;
  prize: string;
  winnerCount: number;
  endsAt: string;
  endedAt: string | null;
  winnerIds: string[];
  entries: number;
}

type Unit = 'm' | 'h' | 'd';
const UNIT_MS: Record<Unit, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const EMPTY = { channelId: '', prize: '', description: '', winnerCount: 1, requiredRoleId: '', amount: 1, unit: 'd' as Unit };

function NewGiveaway({ maxDays, onStarted }: { maxDays: number; onStarted: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { notify, fail } = useToast();
  const durationMs = f.amount * UNIT_MS[f.unit];
  const tooLong = durationMs > maxDays * UNIT_MS.d;

  const start = async () => {
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/api/giveaways', {
        body: { channelId: f.channelId, prize: f.prize, description: f.description || null, winnerCount: f.winnerCount, requiredRoleId: f.requiredRoleId || null, durationMs },
      });
      notify(r.message);
      setF(EMPTY);
      setErrors({});
      onStarted();
    } catch (e) {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Start a giveaway" description="The bot posts it with an Enter button and draws the winners at random when time is up.">
      <div className="grid gap-5 md:grid-cols-2">
        <TextInput label="Prize" value={f.prize} onChange={(prize) => setF({ ...f, prize })} maxLength={200} error={errors.prize} placeholder="Discord Nitro" />
        <ChannelPicker label="Channel" value={f.channelId} onChange={(v) => setF({ ...f, channelId: v ?? '' })} error={errors.channelId} />
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Runs for" value={f.amount} min={1} onChange={(v) => setF({ ...f, amount: Math.max(1, Math.round(v ?? 1)) })} error={tooLong ? `At most ${maxDays} days` : errors.durationMs} />
          <Select<Unit> label="Unit" value={f.unit} onChange={(unit) => setF({ ...f, unit })} options={[{ value: 'm', label: 'Minutes' }, { value: 'h', label: 'Hours' }, { value: 'd', label: 'Days' }]} />
        </div>
        <NumberInput label="Winners" value={f.winnerCount} min={1} max={20} onChange={(v) => setF({ ...f, winnerCount: Math.min(20, Math.max(1, Math.round(v ?? 1))) })} error={errors.winnerCount} />
        <RolePicker label="Who can enter" hint="Leave empty to let everyone enter." value={f.requiredRoleId || undefined} onChange={(v) => setF({ ...f, requiredRoleId: v ?? '' })} />
        <TextArea label="Details" hint="Optional. Shown on the giveaway." value={f.description} onChange={(description) => setF({ ...f, description })} rows={2} maxLength={1000} />
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" loading={busy} disabled={!f.prize.trim() || !f.channelId || tooLong} onClick={start}>
          Start giveaway
        </Button>
      </div>
    </Card>
  );
}

function GiveawayList({ rows, reload, canStart }: { rows: GiveawayRow[]; reload: () => void; canStart: boolean }) {
  const channelName = useChannelName();
  const [busy, setBusy] = useState<string | null>(null);
  const { notify, fail } = useToast();
  const act = async (id: string, action: 'end' | 'reroll') => {
    setBusy(`${id}:${action}`);
    try {
      const r = await api<{ message: string }>(`/api/giveaways/${id}`, { body: action === 'reroll' ? { action, count: 1 } : { action } });
      notify(r.message);
      reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  if (rows.length === 0) return <Empty title="No giveaways yet">{canStart ? <>Start one above, or with <code>/giveaway start</code> in Discord.</> : 'Turn the module on to start one here or with /giveaway start in Discord.'}</Empty>;
  return (
    <Card title="Giveaways">
      <ul className="divide-y divide-line">
        {rows.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {g.prize} <Badge tone={g.endedAt ? 'neutral' : 'good'}>{g.endedAt ? 'Ended' : 'Running'}</Badge>
              </p>
              <p className="text-xs text-muted">
                #{channelName(g.channelId)} · {g.entries} entered · {g.winnerCount} winner{g.winnerCount === 1 ? '' : 's'} · {g.endedAt ? `ended ${formatDate(g.endedAt)}` : `ends ${formatDate(g.endsAt)}`}
                {g.endedAt ? ` · ${g.winnerIds.length ? `${g.winnerIds.length} drawn` : 'no winners'}` : ''}
              </p>
            </div>
            {g.endedAt ? (
              <Button size="sm" loading={busy === `${g.id}:reroll`} onClick={() => act(g.id, 'reroll')}>
                Pick another winner
              </Button>
            ) : (
              <Button size="sm" loading={busy === `${g.id}:end`} onClick={() => act(g.id, 'end')}>
                End now
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function GiveawaysPage() {
  const ctl = useModuleSettings<GiveawaySettings>('giveaways');
  const [rows, setRows] = useState<GiveawayRow[] | null>(null);
  const { fail } = useToast();
  const load = useCallback(() => void api<GiveawayRow[]>('/api/giveaways').then(setRows).catch(fail), [fail]);
  useEffect(load, [load]);
  const s = ctl.draft;
  return (
    <ModuleShell title="Giveaways" description="Run giveaways with an Enter button. Winners are drawn fairly at random from members who are still in the server." ctl={ctl}>
      {s && ctl.data?.enabled && <NewGiveaway maxDays={ctl.data.settings.maxDurationDays} onStarted={load} />}
      {rows ? <GiveawayList rows={rows} reload={load} canStart={Boolean(ctl.data?.enabled)} /> : <Spinner />}
      {s && (
        <Card title="Settings">
          <div className="grid gap-5 md:grid-cols-2">
            <RolePicker label="Ping when a giveaway starts" hint="Optional. Leave empty to post without a ping." value={s.pingRoleId} onChange={(pingRoleId) => ctl.update({ pingRoleId })} error={ctl.errors.pingRoleId} />
            <NumberInput label="Longest giveaway (days)" value={s.maxDurationDays} min={1} max={60} onChange={(v) => ctl.update({ maxDurationDays: v ?? 30 })} error={ctl.errors.maxDurationDays} />
          </div>
        </Card>
      )}
    </ModuleShell>
  );
}
