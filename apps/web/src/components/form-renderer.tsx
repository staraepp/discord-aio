'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Copy } from 'lucide-react';
import { api, ApiError } from '@/lib/client';

export interface PublicQuestion {
  id: string;
  type: 'section' | 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice' | 'dropdown' | 'checkbox' | 'number' | 'date';
  label: string;
  description: string | null;
  required: boolean;
  options: string[];
}

export interface PublicForm {
  slug: string;
  title: string;
  description: string;
  accentColor: string;
  questions: PublicQuestion[];
}

type Value = string | string[] | boolean | undefined;

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

/** Cloudflare Turnstile widget bound to `cdata`; the token is verified server-side. */
export function Turnstile({ siteKey, cdata, onToken }: { siteKey: string; cdata: string; onToken: (t: string | undefined) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const render = () => {
      if (!ref.current || !window.turnstile || ref.current.childElementCount) return;
      window.turnstile.render(ref.current, { sitekey: siteKey, cData: cdata, callback: (t: string) => onToken(t), 'expired-callback': () => onToken(undefined), theme: 'auto' });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [siteKey, cdata, onToken]);
  return <div ref={ref} />;
}

function QuestionInput({ q, value, onChange, error }: { q: PublicQuestion; value: Value; onChange: (v: Value) => void; error?: string }) {
  const id = useId();
  const describedBy = [q.description ? `${id}-d` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  const base = 'min-h-11 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-base transition-colors hover:border-line-strong focus:border-accent aria-[invalid=true]:border-bad sm:min-h-10 sm:text-sm';
  if (q.type === 'section')
    return (
      <div className="border-t border-line pt-4">
        <h2 className="text-lg font-semibold">{q.label}</h2>
        {q.description && <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{q.description}</p>}
      </div>
    );
  const label = (
    <>
      {q.label} {q.required && <span className="text-bad" aria-hidden>*</span>}
      {q.required && <span className="sr-only">(required)</span>}
    </>
  );
  const help = (
    <>
      {q.description && (
        <p id={`${id}-d`} className="text-xs whitespace-pre-wrap text-muted">
          {q.description}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </>
  );
  if (q.type === 'single_choice' || q.type === 'multiple_choice') {
    const multi = q.type === 'multiple_choice';
    const arr = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2" aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined}>
        <legend className="text-sm font-medium">{label}</legend>
        {help}
        {q.options.map((o) => (
          <label key={o} className="flex min-h-10 items-center gap-3 rounded-lg border border-line px-3 text-sm transition-colors hover:border-line-strong has-[:checked]:border-accent/60 has-[:checked]:bg-accent/[0.06]">
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={q.id}
              checked={multi ? arr.includes(o) : value === o}
              onChange={(e) => onChange(multi ? (e.target.checked ? [...arr, o] : arr.filter((x) => x !== o)) : o)}
              className="size-4 accent-[var(--color-accent)]"
            />
            {o}
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.type === 'checkbox')
    return (
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
          <span>{label}</span>
        </label>
        {help}
      </div>
    );
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {help}
      {q.type === 'long_text' ? (
        <textarea id={id} rows={5} className={base} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined} required={q.required} />
      ) : q.type === 'dropdown' ? (
        <div className="relative">
          <select id={id} className={`${base} appearance-none pr-10`} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined} required={q.required}>
            <option value="">Choose an option</option>
            {q.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      ) : (
        <input
          id={id}
          className={base}
          type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'}
          inputMode={q.type === 'number' ? 'decimal' : undefined}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          required={q.required}
        />
      )}
    </div>
  );
}

/** Public form renderer, also used for the dashboard preview (`preview` disables submission). */
export function FormRenderer({
  form,
  initial,
  editToken,
  preview,
  turnstileSiteKey,
  turnstileCdata,
}: {
  form: PublicForm;
  initial?: Record<string, Value>;
  editToken?: string;
  preview?: boolean;
  turnstileSiteKey?: string | null;
  turnstileCdata?: string;
}) {
  const [values, setValues] = useState<Record<string, Value>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ successMessage: string; editConfirmationText: string | null; editPath: string | null } | null>(null);
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [website, setWebsite] = useState('');
  const [copied, setCopied] = useState(false);

  if (done) {
    const url = done.editPath ? `${window.location.origin}${done.editPath}` : null;
    return (
      <div className="space-y-4 text-center" role="status">
        <CheckCircle2 className="mx-auto size-10" style={{ color: form.accentColor }} aria-hidden />
        <p className="text-lg font-medium whitespace-pre-wrap">{done.successMessage}</p>
        {url && (
          <div className="space-y-2 rounded-xl border border-warn/40 bg-warn/5 p-4 text-left">
            <p className="text-sm whitespace-pre-wrap">{done.editConfirmationText}</p>
            <div className="flex gap-2">
              <input readOnly value={url} className="h-10 flex-1 rounded-lg border border-line bg-bg px-3 text-xs" aria-label="Private edit link" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-3 text-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  setCopied(true);
                }}
              >
                <Copy className="size-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-muted">This link works once: after you save an edit you get a new link.</p>
          </div>
        )}
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview) return;
    setBusy(true);
    setMessage(null);
    try {
      const answers = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
      const r = await api<{ successMessage: string; editConfirmationText: string | null; editPath: string | null }>(
        editToken ? `/api/public/forms/${form.slug}/edit` : `/api/public/forms/${form.slug}`,
        { body: editToken ? { token: editToken, answers } : { answers, website: website || undefined, captcha } },
      );
      if (editToken && r.editPath) window.history.replaceState(null, '', r.editPath);
      setDone(r);
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      setMessage(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {message && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          {message}
        </p>
      )}
      {form.questions.map((q) => (
        <QuestionInput key={q.id} q={q} value={values[q.id]} error={errors[q.id]} onChange={(v) => setValues((s) => ({ ...s, [q.id]: v }))} />
      ))}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {!editToken && turnstileSiteKey && turnstileCdata && !preview && <Turnstile siteKey={turnstileSiteKey} cdata={turnstileCdata} onToken={setCaptcha} />}
      <button type="submit" disabled={busy || preview} className="h-11 w-full rounded-lg px-6 font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto" style={{ background: form.accentColor }}>
        {busy ? 'Sending…' : editToken ? 'Save changes' : 'Submit'}
      </button>
      {preview && <p className="text-xs text-muted">Preview only, submissions are disabled here.</p>}
    </form>
  );
}
