/**
 * The bar across the top of every page: the site's name, its four sections,
 * and (where there is script to run it) the theme switch.
 *
 * Before it, each page had its own way out and none had all of them: the
 * graph linked to Tournaments from its masthead and to Records and About only
 * from its footer, and every other page had a breadcrumb back to the graph and
 * nothing else. A reader on a tournament page could not reach the records
 * without going through the graph.
 *
 * Two renderers draw it — `SiteBar.tsx` for pages the app mounts on, and
 * `siteBarHtml` below for the documents prerender.ts writes, which are both
 * the whole page on /about/ and 404.html and the first paint of every other
 * page until the app replaces it. They build the same markup from this one
 * list, and `siteNav.test.ts` holds them to it, so the bar does not change
 * shape at the moment the app takes over.
 */

import { SITE_NAME } from '../../../shared/site';
import { indexPath } from './indexRoute';
import { recordsPagePath } from './recordsRoute';

export type Section = 'graph' | 'tournaments' | 'records' | 'about';

export const SECTIONS: readonly { key: Section; label: string; href: (base: string) => string }[] = [
  { key: 'graph', label: 'Graph', href: (base) => base },
  { key: 'tournaments', label: 'Tournaments', href: indexPath },
  { key: 'records', label: 'Records', href: recordsPagePath },
  // A standalone document prerender.ts writes; no route of the app's own.
  { key: 'about', label: 'About', href: (base) => `${base}about/` },
];

/**
 * The mark beside the name: two players and the line between them, in the
 * graph's own two colours (a player, and the one selected). Drawn here as a
 * string so both renderers inline the same SVG; its fills are classes, not
 * attributes, so they follow the theme's tokens.
 */
export const MARK_SVG =
  '<svg class="mark" width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" focusable="false">' +
  '<line x1="6" y1="10" x2="16" y2="6"></line>' +
  '<circle class="a" cx="6" cy="10" r="4.5"></circle>' +
  '<circle class="b" cx="16" cy="6" r="4.5"></circle>' +
  '</svg>';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The bar as static HTML. `current` is the section this page belongs to, or
 * null for a page that belongs to none (the 404). The right-hand slot is
 * empty: a prerendered document has no script to switch a theme with. It is
 * still there, and holds its width in SiteBar.css, so the links sit where the
 * app will draw them.
 *
 * The SVG sits in a span because React can only inline a string inside an
 * element of its own; the static copy carries the same span to match.
 */
export function siteBarHtml(base: string, current: Section | null): string {
  const links = SECTIONS.map(
    (s) =>
      `<a href="${esc(s.href(base))}"${s.key === current ? ' aria-current="page"' : ''}>${esc(s.label)}</a>`,
  ).join('');
  return (
    `<header class="site-bar"><div class="in">` +
    `<a class="brand" href="${esc(base)}"><span class="mark-slot">${MARK_SVG}</span><span>${esc(SITE_NAME)}</span></a>` +
    `<nav aria-label="Site">${links}</nav>` +
    `<span class="tools"></span>` +
    `</div></header>`
  );
}
