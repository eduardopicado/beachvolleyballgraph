/**
 * The bar across the top of every page the app mounts on. Its markup and its
 * links come from `lib/siteNav.ts`, which also writes the same bar into the
 * prerendered documents; see there for why there is one.
 *
 * Every link is a full page load: each section is its own prerendered page
 * and mounts its own root (see main.tsx), so there is no client-side route to
 * push.
 */

import { SITE_NAME } from '../../../shared/site';
import { MARK_SVG, SECTIONS, type Section } from '../lib/siteNav';
import { ThemeToggle } from './ThemeToggle';
import './SiteBar.css';

export function SiteBar({ current, base }: { current: Section | null; base: string }) {
  return (
    <header className="site-bar">
      <div className="in">
        <a className="brand" href={base}>
          {/* A fixed string of our own, not data: the same SVG the static bar inlines. */}
          <span className="mark-slot" dangerouslySetInnerHTML={{ __html: MARK_SVG }} />
          <span>{SITE_NAME}</span>
        </a>
        <nav aria-label="Site">
          {SECTIONS.map((s) => (
            <a key={s.key} href={s.href(base)} aria-current={s.key === current ? 'page' : undefined}>
              {s.label}
            </a>
          ))}
        </nav>
        <span className="tools">
          <ThemeToggle />
        </span>
      </div>
    </header>
  );
}
