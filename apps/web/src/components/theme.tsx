'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cx } from './ui';

export type ThemeChoice = 'light' | 'system' | 'dark';

// Keep in sync with THEME_SCRIPT in app/layout.tsx.
const KEY = 'theme';

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

// Same-tab changes don't fire the storage event, so pick() announces them itself.
const CHANGE_EVENT = 'themechange';

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: 'light', label: 'Light theme', Icon: Sun },
  { id: 'system', label: 'Match system theme', Icon: Monitor },
  { id: 'dark', label: 'Dark theme', Icon: Moon },
];

/** Light / system / dark switch. The choice is kept in this browser only. */
export function ThemeToggle({ className }: { className?: string }) {
  // Null on the server: it can't know the saved choice, so nothing is marked selected there.
  const choice = useSyncExternalStore<ThemeChoice | null>(subscribe, stored, () => null);

  // Apply changes made in other tabs, and follow the operating system while "system" is selected.
  useEffect(() => {
    if (!choice) return;
    apply(choice);
    if (choice !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  const pick = (next: ThemeChoice) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice still applies to this page.
    }
    apply(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <div role="radiogroup" aria-label="Theme" className={cx('inline-flex items-center gap-0.5 rounded-full border border-line p-0.5', className)}>
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={choice === id}
          aria-label={label}
          title={label}
          onClick={() => pick(id)}
          className={cx('grid size-7 place-items-center rounded-full transition-colors', choice === id ? 'bg-panel-3 text-text' : 'text-muted hover:text-text')}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
