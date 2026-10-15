'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import { useNav, type NavItem } from '@/components/nav';
import { cx } from '@/components/ui';

function matches(item: NavItem, section: string | null, q: string): boolean {
  const hay = `${item.label} ${section ?? ''} ${item.description ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * The search box in the header. Opens with a click, Ctrl/⌘ K or "/". The compact (phone) button
 * only opens on click: the header renders both, and two dialogs must never open at once.
 */
export function SearchButton({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState<boolean | null>(null);

  useEffect(() => {
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [compact]);

  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} aria-label="Search pages" className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:bg-panel-2 hover:text-text">
          <Search className="size-[18px]" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          onPointerEnter={() => mac === null && setMac(/Mac|iPhone|iPad/.test(navigator.platform))}
          onFocus={() => mac === null && setMac(/Mac|iPhone|iPad/.test(navigator.platform))}
          className="flex h-10 w-full max-w-md items-center gap-2.5 rounded-lg border border-line bg-panel-2/60 px-3 text-sm text-muted transition-colors hover:border-line-strong hover:text-text"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 text-left">Search pages</span>
          <kbd className="rounded border border-line bg-bg px-1.5 py-px font-sans text-[11px] font-medium text-muted" aria-hidden>
            {mac === false ? 'Ctrl K' : '⌘K'}
          </kbd>
        </button>
      )}
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const sections = useNav();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    ref.current?.showModal();
    // autoFocus runs before the dialog opens, so focus the box once it is open.
    input.current?.focus();
  }, []);

  const groups = useMemo(() => {
    let start = 0;
    return (sections ?? [])
      .map((s) => ({ title: s.title, items: s.items.filter((i) => matches(i, s.title, q)) }))
      .filter((g) => g.items.length > 0)
      .map((g) => {
        const withStart = { ...g, start };
        start += g.items.length;
        return withStart;
      });
  }, [sections, q]);
  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  const go = (item: NavItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (current + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % Math.max(flat.length, 1);
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[current]);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Search pages"
      className="mx-auto mt-[12vh] w-[calc(100%-1.5rem)] max-w-xl animate-pop-in overflow-hidden rounded-xl border border-line-strong bg-panel p-0 text-text shadow-[var(--shadow-pop)] backdrop:animate-fade-in backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat.length ? `${listId}-${current}` : undefined}
          aria-autocomplete="list"
          aria-label="Search pages"
          placeholder="Search pages…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/80 focus-visible:outline-none"
        />
        <kbd className="rounded border border-line px-1.5 py-px text-[11px] text-muted" aria-hidden>
          Esc
        </kbd>
      </div>
      <div id={listId} role="listbox" aria-label="Pages" className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain p-2">
        {flat.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">No pages match “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.title ?? 'top'} role="group" aria-label={g.title ?? 'Pages'} className="pb-1">
            {g.title && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{g.title}</p>}
            {g.items.map((item, n) => {
              const i = g.start + n;
              return (
                <div
                  key={item.href}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  onPointerMove={() => i !== current && setActive(i)}
                  onClick={() => go(item)}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5', i === current ? 'bg-accent/10' : '')}
                >
                  <item.Icon className={cx('size-4 shrink-0', i === current ? 'text-accent' : 'text-muted')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-sm font-medium', i === current && 'text-accent')}>{item.label}</span>
                    {item.description && <span className="block truncate text-xs text-muted">{item.description}</span>}
                  </span>
                  {i === current && <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </dialog>
  );
}
