import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every stylesheet in the app ends up in one file. Vite emits a single CSS
 * bundle, the prerendered pages and the two standalone documents (/about/ and
 * 404.html) all load it, and nothing renders through a portal — so a rule
 * written for one component reaches every element on every page that happens
 * to share its class.
 *
 * That is how a bug got in that nobody saw for weeks. The About page's season
 * chart had `.season` and `.season > span { background: var(--series-1) }`.
 * The player card's timeline year is a `<button class="season">` with a span
 * inside it, so from #208 until #232 every year on every timeline sat on a
 * solid blue block the colour of its own text. Nothing about either file
 * looked wrong on its own.
 *
 * So every component stylesheet is held to one rule: each of its selectors
 * starts at that component's own root class. A rule then cannot match outside
 * the component, whatever another file names its classes, and two components
 * can reuse `.label` or `.season` without reaching into each other.
 *
 * `theme.css` is the one exception: it is the global layer on purpose — the
 * tokens, the element defaults, the focus ring, `.sr-only`.
 */
const ROOTS: Record<string, string[]> = {
  'App.css': ['.app'],
  'StaticPage.css': ['.static-page'],
  'components/Avatar.css': ['.avatar-slot'],
  // `.segmented` is the pill switch; the tournament index and the records page
  // use it outside `.controls`.
  'components/Controls.css': ['.controls', '.segmented'],
  'components/PartnershipGraph.css': ['.graph-wrap'],
  'components/PathPanel.css': ['.path-panel'],
  'components/PlayerCard.css': ['.player-card'],
  // The trigger is the button over the card's photo; the lightbox is the dialog.
  'components/PortraitLightbox.css': ['.portrait-lightbox', '.portrait-trigger'],
  'components/Records.css': ['.records-page'],
  'components/StartHere.css': ['.start-here'],
  'components/StatTiles.css': ['.stat-tiles'],
  'components/TableView.css': ['.table-view'],
  'components/TournamentIndex.css': ['.tournament-index'],
  'components/TournamentPage.css': ['.tournament-page'],
  'components/TournamentPanel.css': ['.tournament-panel'],
  'components/TournamentPhotos.css': ['.photo-strip', '.photo-viewer'],
};

const GLOBAL = new Set(['theme.css']);

const here = import.meta.dirname;
const sheets = [
  ...readdirSync(here).filter((f) => f.endsWith('.css')),
  ...readdirSync(path.join(here, 'components'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => `components/${f}`),
];

/**
 * Every selector in a sheet, comments dropped and lists split at the top level
 * (a comma inside `:is()` or `:has()` does not end a selector). At-rule
 * preludes and keyframe stops are not selectors and are skipped.
 */
function selectors(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1]!.trim();
    if (!prelude || prelude.startsWith('@')) continue;
    if (/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(prelude)) continue;
    let depth = 0;
    let part = '';
    for (const ch of prelude) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(part.trim());
        part = '';
      } else part += ch;
    }
    out.push(part.trim());
  }
  return out;
}

/** True when `selector` starts at `root` — `.app main`, `.app.x`, `.app:hover` — and not at `.app-bar`. */
function startsAt(selector: string, root: string): boolean {
  return selector.startsWith(root) && !/[\w-]/.test(selector.charAt(root.length));
}

describe('stylesheets', () => {
  it('names a root for every sheet but the global one', () => {
    expect(sheets.length).toBeGreaterThan(10);
    expect(sheets.filter((f) => !GLOBAL.has(f) && !(f in ROOTS))).toEqual([]);
    // A root for a sheet that no longer exists is a map nobody is maintaining.
    expect(Object.keys(ROOTS).filter((f) => !sheets.includes(f))).toEqual([]);
  });

  describe.each(Object.entries(ROOTS))('%s', (file, roots) => {
    it('scopes every rule to its root', () => {
      const all = selectors(readFileSync(path.join(here, file), 'utf8'));
      // A parser that found nothing would pass the check below vacuously.
      expect(all.length).toBeGreaterThan(0);
      expect(all.filter((s) => !roots.some((r) => startsAt(s, r)))).toEqual([]);
    });
  });
});

describe('selectors', () => {
  it('reads a selector list inside :is() as one selector', () => {
    expect(selectors('.static-page .t :is(th, td):last-child { x: 1 } .b, .c { y: 2 }')).toEqual([
      '.static-page .t :is(th, td):last-child',
      '.b',
      '.c',
    ]);
  });

  it('skips at-rules and keyframe stops', () => {
    expect(
      selectors('@media (hover: hover) { .a:hover { x: 1 } } @keyframes k { from { o: 0 } 50%, to { o: 1 } }'),
    ).toEqual(['.a:hover']);
  });
});

describe('startsAt', () => {
  it('takes the root followed by a combinator, a class, a state or nothing', () => {
    expect(startsAt('.app main', '.app')).toBe(true);
    expect(startsAt('.static-page.about h1', '.static-page')).toBe(true);
    expect(startsAt('.segmented:hover', '.segmented')).toBe(true);
    expect(startsAt('.app', '.app')).toBe(true);
  });

  it('refuses a longer class that begins with the root', () => {
    expect(startsAt('.app-bar', '.app')).toBe(false);
    expect(startsAt('.tile_x', '.tile')).toBe(false);
    expect(startsAt('main .app', '.app')).toBe(false);
  });
});
