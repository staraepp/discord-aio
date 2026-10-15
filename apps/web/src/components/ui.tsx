'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Hash, Info, Loader2, X, XCircle } from 'lucide-react';
import { useNavPosition } from './nav';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={cx(buttonClass(variant, size), 'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0', className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** "Look in this server" → "look-in-this-server", for heading anchors. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  // Text titles get an anchor, so sections can be linked and listed under "On this page".
  const anchor = typeof title === 'string' ? slugify(title) : undefined;
  return (
    <section className={cx('rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:p-6', className)}>
      {(title || actions) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 id={anchor} className="group/h relative text-[17px] leading-6 font-semibold tracking-tight">
                {title}
                {anchor && (
                  <a href={`#${anchor}`} className="ml-1.5 inline-flex align-middle text-muted opacity-0 transition-opacity group-hover/h:opacity-100 focus-visible:opacity-100" aria-label={`Link to ${title}`}>
                    <Hash className="size-4" aria-hidden />
                  </a>
                )}
              </h2>
            )}
            {description && <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** GitBook-style page title: section label, large heading and a lead paragraph. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  const section = useNavPosition()?.section?.title;
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1 basis-80">
        {section && <p className="mb-2 text-sm font-semibold text-accent">{section}</p>}
        <h1 className="text-[28px] leading-tight font-bold tracking-tight sm:text-[34px]">{title}</h1>
        {description && <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted sm:text-[17px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Ids of the hint/error text of a field, for aria-describedby on the control. */
export function fieldDescribedBy(id: string, hint?: unknown, error?: unknown): string | undefined {
  return [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  // Hint sits between label and control so people read what a setting does before choosing.
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={htmlFor} className="text-sm leading-5 font-semibold text-text">
          {label}
        </label>
        {hint && (
          <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-[13px] leading-snug text-muted">
            {hint}
          </p>
        )}
      </div>
      {children}
      {error && (
        <p id={htmlFor ? `${htmlFor}-err` : undefined} className="flex items-start gap-1.5 text-[13px] text-bad" role="alert">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

// 16px text on phones prevents iOS zoom-on-focus; 14px from the sm breakpoint up.
const inputCls =
  'h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-text transition-colors placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-bad sm:h-10 sm:text-sm';

export function TextInput({ label, hint, error, value, onChange, className, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { label: ReactNode; hint?: ReactNode; error?: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input id={id} aria-describedby={fieldDescribedBy(id, hint, error)} {...rest} value={value} aria-invalid={Boolean(error) || undefined} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, className)} />
    </Field>
  );
}

export function NumberInput({ label, hint, error, value, onChange, min, max, step }: { label: ReactNode; hint?: ReactNode; error?: string; value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; step?: number }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={fieldDescribedBy(id, hint, error)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputCls}
      />
    </Field>
  );
}

export function TextArea({ label, hint, error, value, onChange, rows = 4, maxLength, placeholder }: { label: ReactNode; hint?: ReactNode; error?: string; value: string; onChange: (v: string) => void; rows?: number; maxLength?: number; placeholder?: string }) {
  const id = useId();
  const shownHint = hint ?? (maxLength ? `${value.length}/${maxLength}` : undefined);
  return (
    <Field label={label} hint={shownHint} error={error} htmlFor={id}>
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={fieldDescribedBy(id, shownHint, error)}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputCls, 'h-auto min-h-24 py-2.5 leading-relaxed sm:h-auto')}
      />
    </Field>
  );
}

export function Select<T extends string>({ label, hint, error, value, onChange, options }: { label: ReactNode; hint?: ReactNode; error?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <div className="relative">
        <select id={id} value={value} aria-describedby={fieldDescribedBy(id, hint, error)} aria-invalid={Boolean(error) || undefined} onChange={(e) => onChange(e.target.value as T)} className={cx(inputCls, 'appearance-none pr-10')}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </Field>
  );
}

export function Toggle({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm leading-5 font-semibold">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="mt-0.5 text-[13px] leading-snug text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-brand bg-brand' : 'border-line-strong bg-panel-2 hover:border-muted/60',
        )}
      >
        <span className={cx('absolute top-[3px] left-[3px] size-4 rounded-full shadow-sm transition-transform duration-200 ease-[var(--ease-out)]', checked ? 'translate-x-5 bg-white' : 'bg-muted')} />
      </button>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-panel-2 text-muted border-line-strong',
    good: 'bg-good/10 text-good border-good/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    bad: 'bg-bad/10 text-bad border-bad/30',
    accent: 'bg-accent/10 text-accent border-accent/30',
  };
  return <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap', tones[tone])}>{children}</span>;
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: ReactNode; children?: ReactNode }) {
  const map = {
    info: { cls: 'border-accent/30 bg-accent/[0.06]', Icon: Info, color: 'text-accent' },
    warn: { cls: 'border-warn/35 bg-warn/[0.07]', Icon: AlertTriangle, color: 'text-warn' },
    bad: { cls: 'border-bad/35 bg-bad/[0.07]', Icon: XCircle, color: 'text-bad' },
    good: { cls: 'border-good/30 bg-good/[0.06]', Icon: CheckCircle2, color: 'text-good' },
  }[tone];
  return (
    <div className={cx('flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed', map.cls)} role={tone === 'bad' ? 'alert' : 'status'}>
      <map.Icon className={cx('mt-0.5 size-4 shrink-0', map.color)} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium text-text">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** Advanced options are collapsed by default. */
export function Advanced({ title = 'Advanced options', children, defaultOpen = false }: { title?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-panel-2"
      >
        {title}
        <ChevronDown className={cx('size-4 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={id} className="animate-fade-in space-y-4 border-t border-line p-4">
          {children}
        </div>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-shimmer rounded-lg bg-panel-2', className)} aria-hidden />;
}

/** Placeholder with the shape of a module page, so content doesn't jump in when it loads. */
export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <div className="mb-8">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-3 h-9 w-64" />
        <Skeleton className="mt-4 h-5 w-full max-w-xl" />
      </div>
      <div className="space-y-5">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-line bg-panel p-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className={cx(
        'm-auto w-[calc(100%-1.5rem)] animate-pop-in rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-[var(--shadow-pop)] backdrop:animate-fade-in backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        wide ? 'max-w-4xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[min(88dvh,56rem)] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
            <h2 id={titleId} className="min-w-0 truncate font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-panel-2 hover:text-text" aria-label="Close">
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-panel-2/40 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation dialog for destructive actions. Optional typed confirmation phrase. */
export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', phrase, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel?: string; phrase?: string; busy?: boolean }) {
  const [typed, setTyped] = useState('');
  return (
    <Modal
      open={open}
      onClose={() => {
        setTyped('');
        onClose();
      }}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={phrase !== undefined && typed !== phrase} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {children}
        {phrase && <TextInput label={`Type ${phrase} to confirm`} value={typed} onChange={setTyped} autoComplete="off" />}
      </div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length]!;
    onChange(target.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)?.focus();
  };
  return (
    <div ref={listRef} role="tablist" onKeyDown={onKeyDown} className="mb-5 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          data-tab={t.id}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
            value === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:border-line-strong hover:text-text',
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'none';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Class names for links styled as buttons (avoids nesting <button> inside <a>). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md'): string {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-white shadow-sm hover:bg-brand-strong',
    secondary: 'border border-line-strong bg-panel text-text shadow-[0_1px_0_rgb(0_0_0/0.03)] hover:bg-panel-2',
    danger: 'border border-bad/45 bg-bad/15 text-bad hover:bg-bad/25',
    ghost: 'text-muted hover:bg-panel-2 hover:text-text',
  };
  return cx(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 select-none active:translate-y-px',
    size === 'sm' ? 'h-9 px-3 text-sm sm:h-8' : 'h-11 px-4 text-sm sm:h-10',
    styles[variant],
  );
}
