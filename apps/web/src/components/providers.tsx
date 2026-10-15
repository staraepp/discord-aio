'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { cx } from './ui';

// ── Toasts ──

interface Toast {
  id: number;
  tone: 'good' | 'bad';
  text: string;
}

const ToastCtx = createContext<{ notify: (text: string, tone?: 'good' | 'bad') => void; fail: (err: unknown) => void }>({ notify: () => undefined, fail: () => undefined });

export function useToast() {
  return useContext(ToastCtx);
}

// ── Guild resources (channels/roles) ──

export interface GuildRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  isEveryone: boolean;
}
export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  everyoneCanView: boolean;
}
export interface Resources {
  guild: { id: string; name: string; iconUrl: string | null; memberCount: number | null };
  roles: GuildRole[];
  channels: GuildChannel[];
}

const ResourcesCtx = createContext<{ data: Resources | null; error: string | null; reload: () => void }>({ data: null, error: null, reload: () => undefined });

export function useResources() {
  return useContext(ResourcesCtx);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((text: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 8000 : 4000);
  }, []);
  const fail = useCallback((err: unknown) => notify(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.', 'bad'), [notify]);

  const [data, setData] = useState<Resources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((refresh = false) => {
    api<Resources>(`/api/resources${refresh ? '?refresh=1' : ''}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Discord data unavailable'));
  }, []);
  useEffect(() => load(), [load]);

  const toastValue = useMemo(() => ({ notify, fail }), [notify, fail]);
  const resValue = useMemo(() => ({ data, error, reload: () => load(true) }), [data, error, load]);

  return (
    <ToastCtx.Provider value={toastValue}>
      <ResourcesCtx.Provider value={resValue}>
        {children}
        <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-20 z-[60] flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                'pointer-events-auto flex animate-pop-in items-start gap-3 rounded-xl border bg-panel-2 py-3 pr-2 pl-3.5 text-sm shadow-[var(--shadow-pop)]',
                t.tone === 'good' ? 'border-good/35' : 'border-bad/40',
              )}
            >
              {t.tone === 'good' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />}
              <span className="min-w-0 flex-1 leading-relaxed [overflow-wrap:anywhere]">{t.text}</span>
              <button type="button" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="-my-1 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-text" aria-label="Dismiss">
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </ResourcesCtx.Provider>
    </ToastCtx.Provider>
  );
}
