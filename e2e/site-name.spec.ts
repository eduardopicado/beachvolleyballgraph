/**
 * The site's name, on every kind of page.
 *
 * It is written in two places per page: the static HTML prerender.ts writes,
 * which is what a crawler indexes and a link preview shows, and the title the
 * app sets once it runs, which is what the tab says. Before the rename to
 * "Beach Partners" seven of those copies were string literals, and a rename
 * that missed one would leave a page announcing a site that no longer exists
 * under that name — on the one page kind nobody happened to open.
 *
 * Every page kind is here, so a copy that stops reading `SITE_NAME` fails by
 * name rather than going unnoticed.
 */

import { test, expect } from './fixtures.js';
import { SITE_NAME } from '../shared/site.js';

const OLD_NAME = 'Beach Volleyball Partnership Graph';

/**
 * Pages the app mounts on, the tab title it sets once running, and whether
 * the static page has link-preview tags at all: tournament pages are written
 * without any (no og:title either), so there is no site name to check there.
 */
const APP_PAGES: [string, string, boolean][] = [
  ['/', SITE_NAME, true],
  ['/brazil-women/', `Brazil Women — ${SITE_NAME}`, true],
  ['/tournament/gstaad-2019-women/', `Gstaad 2019 — ${SITE_NAME}`, false],
  ['/tournaments/', `Tournaments — ${SITE_NAME}`, true],
  ['/records/', `Records — Men — ${SITE_NAME}`, true],
];

/** Documents with no app: what prerender.ts writes is all there is. */
const STATIC_PAGES = ['/about/', '/404.html'];

test.describe('the site name', () => {
  for (const [path, title, previews] of APP_PAGES) {
    test(`${path} carries it, before and after the app runs`, async ({ page, request }) => {
      const html = await (await request.get(path)).text();
      expect(html, 'static <title>').toMatch(new RegExp(`<title>[^<]*${SITE_NAME}</title>|<title>${SITE_NAME} —`));
      if (previews) expect(html, 'link previews').toContain(`<meta property="og:site_name" content="${SITE_NAME}"/>`);
      else expect(html).not.toContain('og:site_name');
      expect(html).not.toContain(OLD_NAME);

      await page.goto(path);
      // Home keeps its long prerendered title; every other page's tab ends
      // with the name, after whatever that page is about.
      if (path === '/') await expect(page).toHaveTitle(new RegExp(`^${SITE_NAME} — `));
      else await expect(page).toHaveTitle(title);
      await expect(page.locator('body')).not.toContainText(OLD_NAME);
    });
  }

  for (const path of STATIC_PAGES) {
    test(`${path} carries it`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).toMatch(new RegExp(`<title>[^<]* — ${SITE_NAME}</title>`));
      expect(html).toContain(`>${SITE_NAME}</a>`);
      expect(html).not.toContain(OLD_NAME);
    });
  }

  test('llms.txt is headed with it', async ({ request }) => {
    const text = await (await request.get('/llms.txt')).text();
    expect(text.split('\n')[0]).toBe(`# ${SITE_NAME}`);
    expect(text).not.toContain(OLD_NAME);
  });
});
