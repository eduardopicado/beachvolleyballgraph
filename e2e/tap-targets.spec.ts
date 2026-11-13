/**
 * On a touch screen, everything that can be tapped is big enough to tap.
 *
 * It was not: measured on a phone, 56 of the 60 kinds of control on the site
 * were under 44px. The draw switch was 28px tall, the card's close button
 * 30px, a player's name in a classification 22px and a tournament's name in
 * the card's timeline 18px.
 *
 * Two floors, set in `theme.css` under `pointer: coarse`:
 *
 * - 44px for controls, which is what Apple and WCAG's enhanced level ask.
 * - 32px for a name in a long list. 44px on every line of a 53-team
 *   classification would double the page; 32px is above the 24px WCAG 2.2
 *   asks as its minimum.
 *
 * A link inside a sentence is exempt, as it is in WCAG: its size is the
 * text's. So is the graph, whose nodes are aimed at by the canvas rather than
 * by their own boxes (see `hitTest` in PartnershipGraph.tsx).
 */

import type { Page } from '@playwright/test';
import { test, expect, graph } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

const CONTROL = 44;
const LIST = 32;

/** Names in long lists: the selectors `theme.css` leaves to the 32px floor. */
const LIST_LINKS = [
  '.player-card .events button.name',
  '.tournament-panel .pair button',
  '.tournament-page .pair button',
  '.tournament-page .entries .who button',
  '.tournament-page .entries .who .offsite',
  '.tournament-page .edition a.year',
  '.tournament-index td.what a',
  '.records-page .who a',
].join(', ');

interface Small {
  what: string;
  width: number;
  height: number;
  floor: number;
}

async function tooSmall(page: Page): Promise<Small[]> {
  return page.evaluate(
    ({ CONTROL, LIST, LIST_LINKS }) => {
      const out: Small[] = [];
      const px = (v: string) => (v === 'auto' ? 0 : parseFloat(v));
      for (const el of document.querySelectorAll<HTMLElement>(
        'a[href], button, select, input, [role="option"]',
      )) {
        if (el.closest('svg.graph')) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;

        // A link inside a sentence: sized by the text around it.
        const block = el.closest('p, dd, li, footer');
        const inSentence =
          el.tagName === 'A' &&
          getComputedStyle(el).display === 'inline' &&
          block !== null &&
          (block.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 12;
        if (inSentence) continue;

        // An absolutely placed ::after with negative insets is extra reach:
        // how the 16px help glyph is given a 44px target.
        const after = getComputedStyle(el, '::after');
        const reach =
          after.content !== 'none' && after.position === 'absolute'
            ? { x: -px(after.left) - px(after.right), y: -px(after.top) - px(after.bottom) }
            : { x: 0, y: 0 };
        const width = Math.round(box.width + Math.max(0, reach.x));
        const height = Math.round(box.height + Math.max(0, reach.y));

        const inList = el.matches(LIST_LINKS);
        const floor = inList ? LIST : CONTROL;
        // Width is held only for a control: a link is as wide as its words.
        const narrow = !inList && el.tagName === 'BUTTON' && width < floor;
        if (height < floor || narrow) {
          const path = [el.parentElement, el]
            .filter((e): e is HTMLElement => e !== null)
            .map((e) => e.tagName.toLowerCase() + (e.className ? `.${e.className.replace(/\s+/g, '.')}` : ''))
            .join(' > ');
          out.push({ what: `${path} "${(el.textContent ?? '').trim().slice(0, 24)}"`, width, height, floor });
        }
      }
      // One of each kind is enough to read.
      return [...new Map(out.map((s) => [s.what.replace(/".*"$/, ''), s])).values()];
    },
    { CONTROL, LIST, LIST_LINKS },
  );
}

const top = () => [...graph('BRA', 'W').nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
const slice = () => sliceSlug('Brazil', 'W');

async function openTimeline(page: Page) {
  await page.goto(`./${slice()}/?player=${top().id}`);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.locator('.timeline .season').first().click();
  await expect(page.locator('.events li').first()).toBeVisible();
}

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

  test('the graph page, its filters and its table', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.table-view tbody tr').first()).toBeVisible();
    expect(await tooSmall(page)).toEqual([]);
  });

  test('a player card with a season open, and the tournament panel over it', async ({ page }) => {
    await openTimeline(page);
    expect(await tooSmall(page)).toEqual([]);
    await page.locator('.events li button').first().click();
    await expect(page.locator('.tournament-panel .pair button').first()).toBeVisible();
    expect(await tooSmall(page)).toEqual([]);
  });

  test('the path panel and its suggestions', async ({ page }) => {
    await page.goto(`./${slice()}/?player=${top().id}`);
    await page.getByRole('button', { name: 'Path to a player' }).click();
    await page.locator('.path-panel input').first().fill('a');
    await expect(page.locator('.path-panel .suggestions li').first()).toBeVisible();
    expect(await tooSmall(page)).toEqual([]);
  });

  test('the search results', async ({ page }) => {
    await page.goto(`./${slice()}/`);
    await page.getByPlaceholder('Start typing a name…').fill(top().name.split(' ')[0]!);
    await expect(page.locator('.player-search-results .result').first()).toBeVisible();
    expect(await tooSmall(page)).toEqual([]);
  });

  test('the tournament index, and a tournament page reached from it', async ({ page }) => {
    await page.goto('./tournaments/');
    const first = page.locator('.tournament-index tbody a').first();
    await expect(first).toBeVisible();
    expect(await tooSmall(page)).toEqual([]);
    await first.click();
    await expect(page.locator('.tournament-page h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await tooSmall(page)).toEqual([]);
  });

  test('the records page, the About page and the 404 page', async ({ page }) => {
    await page.goto('./records/');
    await expect(page.locator('.records-page .who a').first()).toBeVisible();
    expect(await tooSmall(page)).toEqual([]);
    for (const path of ['./about/', './404.html']) {
      await page.goto(path);
      expect(await tooSmall(page), path).toEqual([]);
    }
  });
});

test('with a mouse, the controls keep their density', async ({ page }) => {
  // The floors are for fingers. A desktop window, however narrow, is unchanged.
  await page.goto('./');
  const draw = page.locator('.controls .segmented button').first();
  await expect(draw).toBeVisible();
  expect((await draw.boundingBox())!.height).toBeLessThan(40);
});
