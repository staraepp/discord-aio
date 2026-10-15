'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { api } from '@/lib/client';
import { cx } from '@/components/ui';
import { buildNav, findActive, NavProvider, useNavPosition, type NavModule, type NavSection } from '@/components/nav';
import { useResources } from '@/components/providers';
import { ThemeToggle } from '@/components/theme';
import { SearchButton } from './search';
import { OnThisPage } from './toc';

interface ShellUser {
  name: string;
  avatar: string | null;
  id: string;
  isOwner: boolean;
}

/**
 * GitBook-like dashboard frame: a sticky top bar with search, a quiet sidebar, a centred reading
 * column with Previous/Next links, and an "On this page" outline on wide screens.
 */
export function DashboardShell({ modules, user, adminAccess, children }: { modules: NavModule[]; user: ShellUser; adminAccess: boolean; children: ReactNode }) {
  const sections = useMemo(() => buildNav({ modules, adminAccess, isOwner: user.isOwner }), [modules, adminAccess, user.isOwner]);
  const [drawer, setDrawer] = useState(false);

  // Mobile drawer: close on Escape and keep the page behind it from scrolling.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  return (
    <NavProvider sections={sections}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-panel focus:p-2 focus:shadow-[var(--shadow-pop)]">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-2 px-3 md:gap-4 md:px-6">
          <button
            type="button"
            onClick={() => setDrawer(!drawer)}
            aria-expanded={drawer}
            aria-controls="sidebar"
            aria-label={drawer ? 'Close navigation' : 'Open navigation'}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-panel-2 hover:text-text md:hidden"
          >
            {drawer ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
          <Brand />
          <div className="hidden min-w-0 flex-1 justify-center sm:flex">
            <SearchButton />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:ml-0 sm:gap-3">
            <div className="sm:hidden">
              <SearchButton compact />
            </div>
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[90rem] md:px-6">
        {drawer && <div className="fixed inset-0 top-16 z-30 animate-fade-in bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />}
        <nav
          id="sidebar"
          aria-label="Dashboard"
          className={cx(
            'fixed top-16 bottom-0 left-0 z-30 w-[min(18rem,85vw)] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-line bg-bg px-3 pt-4 pb-6',
            'md:sticky md:z-auto md:flex md:h-[calc(100dvh-4rem)] md:w-64 md:animate-none md:border-r-0 md:bg-transparent md:px-0 md:pt-8 md:pr-6 md:[scrollbar-width:none] md:hover:[scrollbar-width:thin]',
            drawer ? 'flex animate-slide-in' : 'hidden',
          )}
        >
          <SidebarLinks sections={sections} onNavigate={() => setDrawer(false)} />
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-line px-3 pt-4 sm:hidden">
            <span className="text-sm text-muted">Theme</span>
            <ThemeToggle />
          </div>
        </nav>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 pt-8 pb-16 outline-none sm:px-6 md:px-10 md:pt-10 lg:px-14">
          <div className="mx-auto max-w-4xl">
            {children}
            <PageFooter />
          </div>
        </main>

        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-56 shrink-0 overflow-y-auto py-10 pl-2 min-[1400px]:block">
          <OnThisPage />
        </aside>
      </div>
    </NavProvider>
  );
}

function Brand() {
  const { data } = useResources();
  const guild = data?.guild;
  return (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2 md:w-64 md:shrink-0">
      {guild?.iconUrl ? (
        <img src={guild.iconUrl} alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white">
          <Bot className="size-[18px]" aria-hidden />
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15px] font-semibold">{guild?.name ?? 'Server Dashboard'}</span>
        <span className="block truncate text-xs text-muted">Bot dashboard</span>
      </span>
    </Link>
  );
}

function SidebarLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate: () => void }) {
  const path = usePathname();
  const active = findActive(sections, path)?.item.href;
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <div key={s.title ?? 'top'}>
          {s.title && <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{s.title}</p>}
          <ul className="space-y-px">
            {s.items.map((item) => {
              const on = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={on ? 'page' : undefined}
                    className={cx(
                      'group flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-[14px] transition-colors md:min-h-8',
                      on ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-panel-2 hover:text-text',
                    )}
                  >
                    <item.Icon className={cx('size-4 shrink-0', on ? 'text-accent' : 'text-muted/80 group-hover:text-text')} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.enabled !== undefined && (
                      <>
                        <span className={cx('size-1.5 shrink-0 rounded-full', item.enabled ? 'bg-good' : 'bg-line-strong')} aria-hidden />
                        <span className="sr-only">{item.enabled ? '(on)' : '(off)'}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const avatar = user.avatar && user.id !== '0' ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.name}`}
        className="grid size-10 place-items-center rounded-full transition-colors hover:bg-panel-2"
      >
        {avatar ? (
          <img src={avatar} alt="" width={30} height={30} className="size-[30px] rounded-full" />
        ) : (
          <span className="grid size-[30px] place-items-center rounded-full bg-panel-3 text-xs font-semibold text-muted uppercase" aria-hidden>
            {user.name.slice(0, 1)}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-50 w-56 animate-pop-in rounded-xl border border-line bg-panel p-1.5 shadow-[var(--shadow-pop)]">
          <p className="truncate px-2.5 pt-1.5 pb-2 text-sm font-medium" role="none">
            {user.name}
            <span className="block text-xs font-normal text-muted">Signed in with Discord</span>
          </p>
          <button
            type="button"
            role="menuitem"
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-bad/10 hover:text-bad"
            onClick={async () => {
              await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
              window.location.href = '/login';
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** GitBook's Previous / Next cards at the bottom of every page. */
function PageFooter() {
  const pos = useNavPosition();
  if (!pos || (!pos.prev && !pos.next)) return null;
  const card = 'group flex min-h-16 flex-1 items-center gap-3 rounded-xl border border-line px-4 py-3 transition-colors hover:border-accent/60';
  return (
    <nav aria-label="Previous and next pages" className="mt-16 flex flex-col gap-3 sm:flex-row">
      {pos.prev ? (
        <Link href={pos.prev.href} className={card}>
          <ChevronLeft className="size-4 shrink-0 text-muted group-hover:text-accent" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs text-muted">Previous</span>
            <span className="block truncate font-medium group-hover:text-accent">{pos.prev.label}</span>
          </span>
        </Link>
      ) : (
        <span className="hidden flex-1 sm:block" />
      )}
      {pos.next ? (
        <Link href={pos.next.href} className={cx(card, 'justify-end text-right')}>
          <span className="min-w-0">
            <span className="block text-xs text-muted">Next</span>
            <span className="block truncate font-medium group-hover:text-accent">{pos.next.label}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted group-hover:text-accent" aria-hidden />
        </Link>
      ) : (
        <span className="hidden flex-1 sm:block" />
      )}
    </nav>
  );
}
