/**
 * Does the page hold together at the widths people actually use?
 *
 * The smoke suite runs at one viewport and structurally cannot catch the class
 * of bug that has actually shipped here — every layout failure this project
 * has had was width-dependent:
 *
 *   - a partner list rendering as literally nothing at 1280x720
 *   - an 11-pixel list for a medallist with a foreign partner
 *   - the "other federations" rows painted straight through the FIVB profile
 *     link, at >= 940px only, which is why a phone never saw it
 *
 * All three were invisible to a suite that only ever looked at one size. So
 * these assert the invariants those bugs broke, at each width where the layout
 * genuinely changes shape.
 *
 * 940px is the two-column breakpoint (App.css). Below it the card is the only
 * thing in its grid row and takes its natural height; at or above it the card
 * is capped to the graph's height, and everything inside has to divide a fixed
 * budget. That boundary is where the bugs lived, so it is sampled from both
 * sides.
 */

import { test, expect, graph, manifest, strandedPlayer } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

const sliceFor = (code: string, gender: string) => {
  const entry = manifest().countries.find((c) => c.code === code);
  if (!entry) throw new Error(`${code} missing from the manifest`);
  return `${sliceSlug(entry.name, gender as 'M' | 'W')}/`;
};

/** The most-active player in the slice: the densest card the data can produce. */
const busiest = () => [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;

/**
 * A list this short is not a list. The CSS floor is 150px; the margin below it
 * absorbs a scrollbar or a sub-pixel rounding without letting through the
 * 0px and 11px cases that prompted this.
 */
const MIN_LIST_HEIGHT = 120;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet portrait', width: 820, height: 1180 },
  { name: 'just below the two-column breakpoint', width: 939, height: 900 },
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'desktop, short', width: 1280, height: 720 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('a player card lays out without overflowing or collapsing', async ({ page }) => {
      await page.goto(`./${slicePath()}?player=${busiest().id}`);
      await expect(page.locator('.player-card')).toBeVisible();

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const list = document.querySelector('.partners > ul') ?? document.querySelector('.timeline');
        return {
          sideways: doc.scrollWidth - doc.clientWidth,
          list: list ? Math.round(list.getBoundingClientRect().height) : null,
        };
      });

      // Nothing may push the document wider than the window. A single
      // unconstrained child — a long player name, a wide table — does this,
      // and on a phone it is the difference between a usable page and one
      // that jiggles sideways.
      expect(m.sideways, 'the page scrolls sideways').toBeLessThanOrEqual(1);

      expect(m.list, 'no partner list rendered at all').not.toBeNull();
      expect(m.list, 'the partner list collapsed').toBeGreaterThanOrEqual(MIN_LIST_HEIGHT);
    });

    test('the away list does not paint over what follows it', async ({ page }) => {
      const target = strandedPlayer();
      expect(target, 'no player in the published data has only away partners').not.toBeNull();
      await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);
      await expect(page.locator('.player-card')).toBeVisible();

      // Measured against the last rendered row, not the section's own box: a
      // box does not grow to contain a child that overflows it, so the box
      // reported a clean gap at every width while the rows were visibly
      // crossing the link.
      const overhang = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.away li')];
        const link = document.querySelector('.profile-link')?.getBoundingClientRect();
        if (!link || rows.length === 0) return null;
        return Math.round(rows[rows.length - 1]!.getBoundingClientRect().bottom - link.top);
      });

      expect(overhang, 'no away rows found to measure').not.toBeNull();
      expect(overhang, 'the away list is painted over the FIVB profile link').toBeLessThanOrEqual(0);
    });
  });
}
