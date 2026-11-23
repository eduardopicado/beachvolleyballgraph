/**
 * The bar across the top of every page, and the graph page under it.
 *
 * The owner's two complaints this answers: no page had a way to every other
 * section (a tournament page could not reach the records without the graph),
 * and once a bar carried the site's name, the graph page printed it a second
 * time as its title. So: every page kind has the same four links with its own
 * underlined, and none of them names the site more than once.
 */

import { test, expect, manifest } from './fixtures.js';
import { SITE_NAME } from '../shared/site.js';

const LINKS = ['Graph', 'Tournaments', 'Records', 'About'];

/** Path, the section it belongs to, and whether the app (and so the theme switch) runs there. */
const PAGES: [string, string | null, boolean][] = [
  ['/', 'Graph', true],
  ['/brazil-women/', 'Graph', true],
  ['/tournament/gstaad-2019-women/', 'Tournaments', true],
  ['/tournaments/', 'Tournaments', true],
  ['/records/', 'Records', true],
  ['/about/', 'About', false],
  ['/404.html', null, false],
];

test.describe('the site bar', () => {
  for (const [path, current, app] of PAGES) {
    test(`${path}: four sections, ${current ?? 'none'} underlined, the name once`, async ({ page }) => {
      await page.goto(path);
      // On a page the app runs on, wait for its bar to replace the static one.
      if (app) await expect(page.locator('.site-bar .theme-toggle')).toBeVisible();
      else await expect(page.locator('.site-bar .theme-toggle')).toHaveCount(0);

      const nav = page.getByRole('navigation', { name: 'Site' });
      await expect(nav.getByRole('link')).toHaveText(LINKS);
      const marked = nav.locator('a[aria-current="page"]');
      if (current) await expect(marked).toHaveText([current]);
      else await expect(marked).toHaveCount(0);

      await expect(page.locator('.site-bar .brand')).toHaveText(SITE_NAME);
      const text = await page.locator('body').innerText();
      expect(text.split(SITE_NAME).length - 1, 'times the site is named on the page').toBe(1);
    });
  }

  test('the static bar puts its links where the app will draw them, the same one underlined', async ({ browser }) => {
    // The prerendered bar has an empty slot where the theme switch will go.
    // Without it the links would sit 38px further right until the app ran,
    // then jump. And prerender.ts picks the underlined section by its own
    // table, apart from main.tsx's: a tournament page is under Tournaments in
    // both or the underline moves as the page loads.
    const at = async (path: string, javaScriptEnabled: boolean) => {
      const ctx = await browser.newContext({ javaScriptEnabled, viewport: { width: 1366, height: 657 } });
      const page = await ctx.newPage();
      await page.goto(path);
      if (javaScriptEnabled) await expect(page.locator('.site-bar .theme-toggle')).toBeVisible();
      const links = page.locator('.site-bar nav a');
      const xs = await links.evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().left)));
      const current = await page.locator('.site-bar nav a[aria-current="page"]').allTextContents();
      await ctx.close();
      return { xs, current };
    };
    for (const [path, current] of PAGES.filter(([, , app]) => app)) {
      const before = await at(path, false);
      expect(before.xs).toHaveLength(4);
      expect(before.current, `${path} before the app runs`).toEqual([current]);
      expect(await at(path, true), path).toEqual(before);
    }
  });

  test('is one row on a laptop', async ({ page }) => {
    // The phone's two rows cost 44px of a short laptop screen for nothing:
    // the name and all four sections fit beside each other from about 560px.
    await page.setViewportSize({ width: 1366, height: 657 });
    await page.goto('/');
    const bar = await page.locator('.site-bar').boundingBox();
    expect(bar!.height).toBeLessThanOrEqual(57);
    const brand = await page.locator('.site-bar .brand').boundingBox();
    for (const box of await page.locator('.site-bar nav a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().toJSON()))) {
      expect(Math.abs(box.top + box.height / 2 - (brand!.y + brand!.height / 2))).toBeLessThanOrEqual(1);
    }
  });

  test('a tournament page keeps only the step the bar cannot name', async ({ page }) => {
    await page.goto('/tournament/gstaad-2019-women/');
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumb.getByRole('link')).toHaveText(['2019 Women']);
    await expect(crumb.getByRole('link')).toHaveAttribute('href', /\/tournaments\/\?gender=W&season=2019/);
  });
});

test.describe('the graph page under the bar', () => {
  test('is titled with its country and draw, with that slice’s own figures', async ({ page }) => {
    const m = manifest();
    const brazil = m.countries.find((c) => c.code === 'BRA')!;
    const counts = brazil.genders.W!;
    await page.goto('/brazil-women/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brazil women');
    await expect(page.locator('.app .masthead p')).toHaveText(
      `Who has played with whom in FIVB international beach volleyball since ${m.seasons.from}: ` +
        `${counts.nodes.toLocaleString('en-US')} players and ${counts.edges.toLocaleString('en-US')} partnerships.`,
    );
    // The heading that said the same above the graph is gone.
    await expect(page.locator('.graph-section h2')).toHaveCount(0);
  });

  test('follows the country picker', async ({ page }) => {
    const m = manifest();
    const other = m.countries.find((c) => c.code !== 'BRA' && c.genders.M)!;
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brazil men');
    await page.locator('.controls select').selectOption(other.code);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${other.name} men`);
  });
});

for (const width of [390, 320]) {
  test.describe(`the bar on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 700 }, hasTouch: true, isMobile: true });

    for (const path of ['/', '/tournament/gstaad-2019-women/', '/about/']) {
      test(`${path}: every section on screen, on its own row, nothing sideways`, async ({ page }) => {
        await page.goto(path);
        const links = page.locator('.site-bar nav a');
        await expect(links).toHaveCount(4);
        const brand = await page.locator('.site-bar .brand').boundingBox();
        for (const box of await links.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().toJSON()))) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.top, 'below the name, not beside it').toBeGreaterThanOrEqual(brand!.y + brand!.height);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBe(0);
      });
    }

    test('a name too long for the row wraps beside the switch, not off the screen', async ({ page }) => {
      // Fonts differ by machine: the old name fit a 320px row in one test
      // browser and ran 39px past it in CI's. A name longer than any font can
      // fit makes the check the same everywhere.
      await page.goto('/about/');
      await page.locator('.site-bar .brand span:last-child').evaluate((s) => {
        s.textContent = 'Beach Volleyball Partnership Graph of the World';
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      const brand = (await page.locator('.site-bar .brand').boundingBox())!;
      const slot = (await page.locator('.site-bar .tools').boundingBox())!;
      expect(slot.x, 'the switch stays on the name’s row').toBeGreaterThanOrEqual(brand.x + brand.width);
      expect(slot.y).toBeLessThan(brand.y + brand.height);
    });
  });
}
