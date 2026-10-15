'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  AlarmClock,
  BarChart3,
  Bot,
  CalendarClock,
  ClipboardList,
  FileText,
  Gauge,
  Gift,
  Hand,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareReply,
  Send,
  Music,
  PanelsTopLeft,
  Pin,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  SlashSquare,
  Sparkles,
  Star,
  Tags,
  TrendingUp,
  UserRoundPen,
  Volume2,
  Wrench,
} from 'lucide-react';

/** One dashboard page, as shown in the sidebar, search, page headers and Previous/Next links. */
export interface NavItem {
  href: string;
  label: string;
  Icon: typeof Music;
  /** Shown in search results. */
  description?: string;
  /** Modules only: whether the module is switched on. */
  enabled?: boolean;
}

export interface NavSection {
  title: string | null;
  items: NavItem[];
}

export interface NavModule {
  id: string;
  name: string;
  route: string;
  description: string;
  enabled: boolean;
}

const MODULE_ICONS: Record<string, typeof Music> = {
  music: Music,
  tempvc: Volume2,
  embeds: PanelsTopLeft,
  autoresponders: MessageSquareReply,
  leveling: TrendingUp,
  forms: FileText,
  moderation: Shield,
  tickets: LifeBuoy,
  welcome: Hand,
  verification: ShieldCheck,
  rolepanels: Tags,
  honeypot: Bot,
  ai: Sparkles,
  giveaways: Gift,
  polls: BarChart3,
  reminders: AlarmClock,
  starboard: Star,
};

export function buildNav({ modules, adminAccess, isOwner }: { modules: NavModule[]; adminAccess: boolean; isOwner: boolean }): NavSection[] {
  const sections: NavSection[] = [];
  if (adminAccess) {
    sections.push({ title: null, items: [{ href: '/dashboard', label: 'Overview', Icon: LayoutDashboard, description: 'Bot status, modules and recent changes.' }] });
    sections.push({ title: 'Modules', items: modules.map((m) => ({ href: m.route, label: m.name, Icon: MODULE_ICONS[m.id] ?? Wrench, description: m.description, enabled: m.enabled })) });
    sections.push({
      title: 'Customize',
      items: [
        { href: '/dashboard/commands', label: 'Commands & prefix', Icon: SlashSquare, description: 'Prefix, aliases, cooldowns and where each command works.' },
        { href: '/dashboard/profile', label: 'Bot profile', Icon: UserRoundPen, description: 'Nickname, avatar, statuses and reworded replies.' },
        { href: '/dashboard/scheduled', label: 'Scheduled messages', Icon: CalendarClock, description: 'Messages the bot posts on a schedule.' },
        { href: '/dashboard/sticky', label: 'Sticky messages', Icon: Pin, description: 'Messages kept at the bottom of a channel.' },
        { href: '/dashboard/dm', label: 'Direct messages', Icon: Send, description: 'DM a member from the bot, as text or a saved embed.' },
      ],
    });
  }
  const server: NavItem[] = [];
  if (adminAccess) {
    server.push({ href: '/dashboard/settings', label: 'Staff & settings', Icon: Settings, description: 'Staff roles and server-wide settings.' });
    server.push({ href: '/dashboard/audit', label: 'Audit log', Icon: ScrollText, description: 'Every change made from the dashboard.' });
  }
  if (isOwner) server.push({ href: '/dashboard/diagnostics', label: 'Diagnostics', Icon: Gauge, description: 'Owner-only health details.' });
  if (adminAccess) server.push({ href: '/dashboard/setup', label: 'Setup checklist', Icon: ClipboardList, description: 'What is configured and what is left.' });
  if (server.length) sections.push({ title: 'Server', items: server });
  return sections;
}

/** The item a path belongs to: exact match first, then the longest prefix (for sub-pages). */
export function findActive(sections: NavSection[], path: string): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const hit = item.href === '/dashboard' ? path === '/dashboard' : path === item.href || path.startsWith(`${item.href}/`);
      if (hit && (!best || item.href.length > best.item.href.length)) best = { section, item };
    }
  }
  return best;
}

const NavCtx = createContext<NavSection[] | null>(null);

export function NavProvider({ sections, children }: { sections: NavSection[]; children: ReactNode }) {
  return <NavCtx.Provider value={sections}>{children}</NavCtx.Provider>;
}

export function useNav(): NavSection[] | null {
  return useContext(NavCtx);
}

/** Where the current page sits in the navigation, plus its neighbours for Previous/Next. */
export function useNavPosition() {
  const sections = useNav();
  const path = usePathname();
  return useMemo(() => {
    if (!sections) return null;
    const active = findActive(sections, path);
    const flat = sections.flatMap((s) => s.items);
    const i = active ? flat.indexOf(active.item) : -1;
    return {
      section: active?.section ?? null,
      item: active?.item ?? null,
      prev: i > 0 ? flat[i - 1]! : null,
      next: i >= 0 && i < flat.length - 1 ? flat[i + 1]! : null,
    };
  }, [sections, path]);
}
