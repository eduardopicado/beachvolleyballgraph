/**
 * Text has to be readable against what it sits on.
 *
 * Until this test, the grey that carries every label and caption on the site
 * was 3.4:1 on the page at 11px, the link blue 4.2:1, and white on the selected
 * draw 3.6:1 in the dark theme: 2,793 failing text nodes across the 56 views
 * that were measured, none of which anything checked. WCAG AA asks 4.5:1 of
 * text this size.
 *
 * axe-core does the measuring, with only its contrast rule on, over each kind
 * of page in both themes. It resolves the real painted background, washes and
 * tracks included, which a table of token pairs cannot.
 */

import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { test, expect, graph } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

interface Finding {
  target: string;
  ratio: number | undefined;
  fg: string | undefined;
  bg: string | undefined;
}

async function contrastFailures(page: Page): Promise<Finding[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            root: Document,
            options: object,
          ) => Promise<{
            violations: {
              nodes: {
                target: string[];
                any: { data?: { contrastRatio?: number; fgColor?: string; bgColor?: string } }[];
              }[];
            }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] });
    return result.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        target: n.target.join(' '),
        ratio: n.any[0]?.data?.contrastRatio,
        fg: n.any[0]?.data?.fgColor,
        bg: n.any[0]?.data?.bgColor,
      })),
    );
  });
}

const top = () => [...graph('BRA', 'W').nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
const slice = () => sliceSlug('Brazil', 'W');

const views: [string, (page: Page) => Promise<void>][] = [
  ['the home page', async (page) => void (await page.goto('./'))],
  [
    'a player card with its timeline open',
    async (page) => {
      await page.goto(`./${slice()}/?player=${top().id}`);
      await page.getByRole('button', { name: 'Timeline', exact: true }).click();
      await page.locator('.timeline .season').first().click();
      await expect(page.locator('.events li').first()).toBeVisible();
    },
  ],
  [
    'the search results',
    async (page) => {
      await page.goto(`./${slice()}/`);
      await page.getByPlaceholder('Start typing a name…').fill(top().name.split(' ')[0]!);
      await expect(page.locator('.player-search-results .result').first()).toBeVisible();
    },
  ],
  [
    'the tournament index and a tournament page',
    async (page) => {
      await page.goto('./tournaments/');
      const first = page.locator('.tournament-index tbody a').first();
      await expect(first).toBeVisible();
      expect(await contrastFailures(page)).toEqual([]);
      await first.click();
      await expect(page.locator('.tournament-page h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
    },
  ],
  [
    'the records page',
    async (page) => {
      await page.goto('./records/');
      await expect(page.locator('.records-page h2').first()).toBeVisible();
    },
  ],
  ['the About page', async (page) => void (await page.goto('./about/'))],
  ['the 404 page', async (page) => void (await page.goto('./404.html'))],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, open] of views) {
      test(`${name} has no text below 4.5:1`, async ({ page }) => {
        await open(page);
        await page.waitForLoadState('networkidle');
        expect(await contrastFailures(page)).toEqual([]);
      });
    }
  });
}
