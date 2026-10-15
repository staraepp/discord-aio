'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlignLeft } from 'lucide-react';
import { cx } from '@/components/ui';

interface Heading {
  id: string;
  text: string;
}

const same = (a: Heading[], b: Heading[]) => a.length === b.length && a.every((h, i) => h.id === b[i]!.id && h.text === b[i]!.text);

/**
 * GitBook-style "On this page": the section headings (card titles) of the current page.
 * Pages load their data after rendering, so the list follows changes to the page.
 */
export function OnThisPage() {
  const path = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    let frame = 0;
    const collect = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = [...main.querySelectorAll<HTMLElement>('h2[id]')]
          // Headings inside dialogs and collapsed sections aren't part of the page outline.
          .filter((h) => !h.closest('dialog') && h.offsetParent !== null)
          .map((h) => ({ id: h.id, text: h.textContent?.trim() ?? '' }))
          .filter((h) => h.text);
        setHeadings((prev) => (same(prev, found) ? prev : found));
      });
    };
    collect();
    const mo = new MutationObserver(collect);
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [path]);

  // The active heading is the last one scrolled past the top of the reading area.
  useEffect(() => {
    if (headings.length === 0) return;
    const onScroll = () => {
      let current = headings[0]!.id;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top < 140) current = h.id;
      }
      setActive(current);
    };
    const first = requestAnimationFrame(onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener('scroll', onScroll);
    };
  }, [headings]);

  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-text">
        <AlignLeft className="size-3.5 text-muted" aria-hidden />
        On this page
      </p>
      <ul className="space-y-0.5 border-l border-line">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              aria-current={active === h.id ? 'location' : undefined}
              className={cx(
                '-ml-px block border-l py-1 pl-3 leading-snug transition-colors',
                active === h.id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:border-line-strong hover:text-text',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
