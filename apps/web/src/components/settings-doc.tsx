'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { useToast } from './providers';

/**
 * Loads one settings document, tracks unsaved edits and saves it with PUT.
 * `pick` selects the document from the GET response; the rest is returned as `extra`.
 */
export function useSettingsDoc<Doc, Res>(url: string, pick: (res: Res) => Doc) {
  const { notify, fail } = useToast();
  const [res, setRes] = useState<Res | null>(null);
  const [saved, setSaved] = useState<Doc | null>(null);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const pickRef = useRef(pick);
  pickRef.current = pick;
  const load = useCallback(() => {
    api<Res>(url)
      .then((r) => {
        setRes(r);
        setSaved(pickRef.current(r));
        setDraft(pickRef.current(r));
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load settings'));
  }, [url]);
  useEffect(load, [load]);

  const dirty = saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api<Doc>(url, { method: 'PUT', body: draft });
      setSaved(next);
      setDraft(next);
      setErrors({});
      notify('Saved.');
    } catch (e) {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  return { res, draft, setDraft, dirty, saving, save, reset: () => setDraft(saved), errors, loadError };
}
