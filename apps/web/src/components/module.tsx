'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/client';
import { Alert, Badge, Button, PageHeader, PageSkeleton, Toggle } from './ui';
import { useToast } from './providers';

export interface ModuleData<S> {
  enabled: boolean;
  settings: S;
  settingsInvalid: boolean;
  module: { id: string; name: string; description: string; commands: string[]; integrations: string[] };
}

/** Loads a module's settings, tracks unsaved changes and saves them through the validated API. */
export function useModuleSettings<S>(moduleId: string) {
  const { notify, fail } = useToast();
  const [data, setData] = useState<ModuleData<S> | null>(null);
  const [draft, setDraft] = useState<S | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ModuleData<S>>(`/api/modules/${moduleId}`)
      .then((d) => {
        setData(d);
        setDraft(d.settings);
        setErrors({});
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load settings'));
  }, [moduleId]);
  useEffect(load, [load]);

  const dirty = data !== null && draft !== null && JSON.stringify(data.settings) !== JSON.stringify(draft);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await api<ModuleData<S>>(`/api/modules/${moduleId}`, { method: 'PUT', body: { settings: draft } });
      setData((d) => (d ? { ...d, ...res, settings: res.settings } : d));
      setDraft(res.settings);
      setErrors({});
      notify('Settings saved.');
    } catch (e) {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    try {
      await api(`/api/modules/${moduleId}`, { method: 'PUT', body: { enabled } });
      setData((d) => (d ? { ...d, enabled } : d));
      notify(enabled ? 'Module enabled. Its slash commands are being registered.' : 'Module disabled. Its slash commands are being removed.');
    } catch (e) {
      fail(e);
    }
  };

  const update = (patch: Partial<S>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return { data, draft, setDraft, update, dirty, save, saving, errors, setEnabled, reset: () => data && setDraft(data.settings), loadError, reload: load };
}

export function ModuleShell<S>({ title, description, ctl, children, actions }: { title: string; description: ReactNode; ctl: ReturnType<typeof useModuleSettings<S>>; children: ReactNode; actions?: ReactNode }) {
  if (ctl.loadError) return <Alert tone="bad" title="Could not load this module">{ctl.loadError}</Alert>;
  if (!ctl.data || !ctl.draft) return <PageSkeleton />;
  return (
    <div className="pb-24">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <div className="flex h-11 items-center gap-3 rounded-xl border border-line bg-panel pr-3 pl-3.5">
              <Badge tone={ctl.data.enabled ? 'good' : 'neutral'}>{ctl.data.enabled ? 'Enabled' : 'Disabled'}</Badge>
              <Toggle label={<span className="sr-only">Enable {title}</span>} checked={ctl.data.enabled} onChange={ctl.setEnabled} />
            </div>
          </>
        }
      />
      {ctl.data.settingsInvalid && (
        <div className="mb-4">
          <Alert tone="warn" title="Stored settings were invalid">
            Defaults are shown. Review and save to repair them.
          </Alert>
        </div>
      )}
      <div className="space-y-5">{children}</div>
      <SaveBar dirty={ctl.dirty} saving={ctl.saving} onSave={ctl.save} onReset={ctl.reset} errorCount={Object.keys(ctl.errors).length} />
    </div>
  );
}

export function SaveBar({ dirty, saving, onSave, onReset, errorCount = 0 }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; errorCount?: number }) {
  if (!dirty && errorCount === 0) return null;
  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-2xl animate-pop-in rounded-xl border border-line-strong bg-panel/95 shadow-[var(--shadow-pop)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 pr-2.5 pl-4">
        <p className={errorCount ? 'flex items-center gap-2 text-sm text-bad' : 'flex items-center gap-2 text-sm text-muted'} role="status">
          <span className={errorCount ? 'size-2 rounded-full bg-bad' : 'size-2 rounded-full bg-warn'} aria-hidden />
          {errorCount ? `${errorCount} field${errorCount === 1 ? '' : 's'} need attention.` : 'You have unsaved changes.'}
        </p>
        <div className="flex flex-1 justify-end gap-2 sm:flex-none">
          <Button onClick={onReset} disabled={saving}>
            Discard
          </Button>
          <Button variant="primary" onClick={onSave} loading={saving}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Publish a persistent panel through the bot. */
export function usePublish() {
  const { notify, fail } = useToast();
  const [busy, setBusy] = useState(false);
  const publish = async (body: { kind: string; refId?: string; channelId?: string }) => {
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/api/panels/publish', { body });
      notify(r.message);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { publish, busy };
}
