'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { describeSchedule, nextRunAt, zonedTimeToUtc, type Schedule } from '@aio/core/customize';
import { api, ApiError } from '@/lib/client';
import { Alert, Badge, Button, Card, Confirm, Empty, Modal, NumberInput, PageHeader, PageSkeleton, Select, TextInput, Toggle, cx, formatDate } from '@/components/ui';
import { ChannelPicker, useChannelName } from '@/components/pickers';
import { MessageBodyFields, bodyPreview, type MessageBody } from '@/components/message-body';
import { useToast } from '@/components/providers';

interface Row extends MessageBody {
  id: string;
  name: string;
  channelId: string;
  schedule: Schedule;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  runCount: number;
}

type Kind = Schedule['kind'];
interface Form extends MessageBody {
  id?: string;
  name: string;
  channelId: string | undefined;
  timezone: string;
  enabled: boolean;
  kind: Kind;
  time: string;
  days: number[];
  onceLocal: string;
  every: number;
  unit: 'minutes' | 'hours';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function emptyForm(): Form {
  return { name: '', channelId: undefined, embedId: null, content: '', timezone: browserTz(), enabled: true, kind: 'daily', time: '09:00', days: [1], onceLocal: '', every: 1, unit: 'hours' };
}

/** "2026-10-01T09:30" in `tz` → ISO string. */
function localToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return zonedTimeToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz).toISOString();
}

function isoToLocal(iso: string, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function toSchedule(f: Form): Schedule | null {
  switch (f.kind) {
    case 'once': {
      const at = localToIso(f.onceLocal, f.timezone);
      return at ? { kind: 'once', at } : null;
    }
    case 'daily':
      return { kind: 'daily', time: f.time };
    case 'weekly':
      return { kind: 'weekly', time: f.time, days: [...f.days].sort() };
    case 'interval':
      return { kind: 'interval', everyMinutes: f.unit === 'hours' ? f.every * 60 : f.every };
  }
}

function toForm(r: Row): Form {
  const s = r.schedule;
  const base = { ...emptyForm(), id: r.id, name: r.name, channelId: r.channelId, embedId: r.embedId, content: r.content, timezone: r.timezone, enabled: r.enabled, kind: s.kind };
  if (s.kind === 'once') return { ...base, onceLocal: isoToLocal(s.at, r.timezone) };
  if (s.kind === 'daily') return { ...base, time: s.time };
  if (s.kind === 'weekly') return { ...base, time: s.time, days: s.days };
  return { ...base, every: s.everyMinutes % 60 === 0 ? s.everyMinutes / 60 : s.everyMinutes, unit: s.everyMinutes % 60 === 0 ? 'hours' : 'minutes' };
}

export default function ScheduledPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [embedNames, setEmbedNames] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const channelName = useChannelName();
  const { notify, fail } = useToast();
  const timezones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [browserTz()]), []);

  const load = useCallback(() => {
    api<Row[]>('/api/customize/scheduled').then(setRows).catch(fail);
    api<{ id: string; name: string }[]>('/api/embeds')
      .then((e) => setEmbedNames(Object.fromEntries(e.map((x) => [x.id, x.name]))))
      .catch(() => undefined);
  }, [fail]);
  useEffect(load, [load]);

  const schedule = form ? toSchedule(form) : null;
  const preview = form && schedule ? nextRunAt(schedule, form.timezone, new Date()) : null;

  const save = async () => {
    if (!form || !form.channelId) return setError('Choose a channel.');
    if (!schedule) return setError('Pick a date and time.');
    setSaving(true);
    setError(null);
    try {
      const body = { name: form.name, channelId: form.channelId, embedId: form.embedId, content: form.embedId ? null : form.content, schedule, timezone: form.timezone, enabled: form.enabled };
      await api(form.id ? `/api/customize/scheduled/${form.id}` : '/api/customize/scheduled', { method: form.id ? 'PUT' : 'POST', body });
      notify('Saved.');
      setForm(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues.map((i) => i.message)].join(' ') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Row, enabled: boolean) => {
    const f = toForm(r);
    try {
      await api(`/api/customize/scheduled/${r.id}`, { method: 'PUT', body: { name: f.name, channelId: f.channelId, embedId: r.embedId, content: r.embedId ? null : r.content, schedule: r.schedule, timezone: r.timezone, enabled } });
      load();
    } catch (e) {
      fail(e);
    }
  };

  const sendNow = async (r: Row) => {
    try {
      notify((await api<{ message: string }>(`/api/customize/scheduled/${r.id}/send`, { body: {} })).message);
      load();
    } catch (e) {
      fail(e);
    }
  };

  if (!rows) return <PageSkeleton label="Loading scheduled messages" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scheduled messages"
        description="Post a saved embed or a text message on a schedule: once, daily, on chosen weekdays, or every few hours."
        actions={
          <Button variant="primary" onClick={() => setForm(emptyForm())}>
            <Plus className="size-4" /> New schedule
          </Button>
        }
      />
      {rows.length === 0 ? (
        <Empty title="Nothing scheduled yet" action={<Button onClick={() => setForm(emptyForm())}>Schedule a message</Button>}>
          Good for daily reminders, weekly events or announcements you want to go out at a set time.
        </Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <CalendarClock className={cx('mt-0.5 size-4 shrink-0', r.enabled ? 'text-accent' : 'text-muted')} aria-hidden />
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {r.name} {!r.enabled && <Badge>Off</Badge>}
                    </p>
                    <p className="text-[13px] text-muted">
                      {describeSchedule(r.schedule, r.timezone)} ({r.timezone}) in #{channelName(r.channelId)}
                    </p>
                    <p className="truncate text-[13px] text-muted">{bodyPreview(r, r.embedId ? embedNames[r.embedId] : undefined)}</p>
                    <p className="text-xs text-muted">
                      {r.enabled && r.nextRunAt ? `Next: ${formatDate(r.nextRunAt)}` : 'Not scheduled'} · sent {r.runCount} time{r.runCount === 1 ? '' : 's'}
                    </p>
                    {r.lastError && <p className="text-[13px] text-bad">{r.lastError}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Toggle label={<span className="sr-only">Enable {r.name}</span>} checked={r.enabled} onChange={(v) => void toggle(r, v)} />
                  <Button size="sm" onClick={() => void sendNow(r)}>
                    <Send className="size-4" /> Send now
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setForm(toForm(r))}>
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
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit “${form.name}”` : 'New scheduled message'}
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
              <TextInput label="Name" hint="Only you see this." value={form.name} maxLength={60} onChange={(name) => setForm({ ...form, name })} />
              <ChannelPicker label="Channel" value={form.channelId} onChange={(channelId) => setForm({ ...form, channelId })} />
            </div>
            <MessageBodyFields value={form} onChange={(b) => setForm({ ...form, ...b })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select<Kind>
                label="When"
                value={form.kind}
                onChange={(kind) => setForm({ ...form, kind })}
                options={[
                  { value: 'once', label: 'Once' },
                  { value: 'daily', label: 'Every day' },
                  { value: 'weekly', label: 'On certain weekdays' },
                  { value: 'interval', label: 'Every few minutes or hours' },
                ]}
              />
              <Select label="Timezone" hint="Times follow this zone, including daylight saving." value={form.timezone} onChange={(timezone) => setForm({ ...form, timezone })} options={timezones.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
            </div>
            {form.kind === 'once' && (
              <label className="flex max-w-xs flex-col gap-1.5">
                <span className="text-sm font-semibold">Date and time</span>
                <input type="datetime-local" value={form.onceLocal} onChange={(e) => setForm({ ...form, onceLocal: e.target.value })} className="h-11 rounded-lg border border-line bg-bg px-3 text-base hover:border-line-strong focus:border-accent sm:h-10 sm:text-sm" />
              </label>
            )}
            {(form.kind === 'daily' || form.kind === 'weekly') && (
              <label className="flex max-w-[10rem] flex-col gap-1.5">
                <span className="text-sm font-semibold">Time</span>
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="h-11 rounded-lg border border-line bg-bg px-3 text-base hover:border-line-strong focus:border-accent sm:h-10 sm:text-sm" />
              </label>
            )}
            {form.kind === 'weekly' && (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-semibold">Days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((label, i) => {
                    const on = form.days.includes(i);
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setForm({ ...form, days: on ? form.days.filter((x) => x !== i) : [...form.days, i] })}
                        className={cx('h-9 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors', on ? 'border-brand bg-brand text-white' : 'border-line text-muted hover:border-line-strong hover:text-text')}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {form.kind === 'interval' && (
              <div className="grid max-w-md gap-4 sm:grid-cols-2">
                <NumberInput label="Every" value={form.every} min={1} onChange={(v) => setForm({ ...form, every: v ?? 1 })} hint={form.unit === 'minutes' ? 'At least 10 minutes.' : undefined} />
                <Select<'minutes' | 'hours'> label="Unit" value={form.unit} onChange={(unit) => setForm({ ...form, unit })} options={[{ value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }]} />
              </div>
            )}
            <Toggle label="On" description="Turn off to pause without deleting." checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
            <p className="text-[13px] text-muted" role="status">
              {preview ? `First post: ${preview.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} (your time)` : form.kind === 'once' ? 'Pick a date and time in the future.' : ''}
            </p>
          </div>
        )}
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this schedule?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api(`/api/customize/scheduled/${deleting!.id}`, { method: 'DELETE' });
            notify('Deleted.');
            load();
          } catch (e) {
            fail(e);
          }
          setDeleting(null);
        }}
      >
        Messages it already sent stay in Discord.
      </Confirm>
    </div>
  );
}
