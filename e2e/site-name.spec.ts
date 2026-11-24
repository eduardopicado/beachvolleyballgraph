/**
 * The site's name, on every kind of page.
 *
 * It is written in two places per page: the static HTML prerender.ts writes,
 * which is what a crawler indexes and a link preview shows, and the title the
 * app sets once it runs, which is what the tab says. Before the rename to
 * "Beach Volleyball Partners" seven of those copies were string literals, and a rename
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
 * Pages the app mounts on, and the tab title it sets once running. Every one
 * names the site in its link-preview tags too; tournament pages were the
 * exception until they were given the tags (see link-previews.spec.ts).
 */
const APP_PAGES: [string, string][] = [
  // The app opens on Brazil men at the root and titles the tab as it titles
  // that slice anywhere else; the prerendered home title, checked in the
  // static HTML below, is what search results and link previews read.
  ['/', `Brazil Men — ${SITE_NAME}`],
  ['/brazil-women/', `Brazil Women — ${SITE_NAME}`],
  ['/tournament/gstaad-2019-women/', `Gstaad 2019 — ${SITE_NAME}`],
  ['/tournaments/', `Tournaments — ${SITE_NAME}`],
  ['/records/', `Records — Men — ${SITE_NAME}`],
];

/** Documents with no app: what prerender.ts writes is all there is. */
const STATIC_PAGES = ['/about/', '/404.html'];

test.describe('the site name', () => {
  for (const [path, title] of APP_PAGES) {
    test(`${path} carries it, before and after the app runs`, async ({ page, request }) => {
      const html = await (await request.get(path)).text();
      expect(html, 'static <title>').toMatch(new RegExp(`<title>[^<]*${SITE_NAME}</title>|<title>${SITE_NAME} —`));
      expect(html, 'link previews').toContain(`<meta property="og:site_name" content="${SITE_NAME}"/>`);
      expect(html).not.toContain(OLD_NAME);

      await page.goto(path);
      // The title the app settles on, every page alike. This used to accept
      // home's prerendered title instead, which only held when the check ran
      // before the app replaced it: a race, lost 2 times in 10 under load.
      await expect(page).toHaveTitle(title);
      await expect(page.locator('body')).not.toContainText(OLD_NAME);
    });
  }

  for (const path of STATIC_PAGES) {
    test(`${path} carries it`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).toMatch(new RegExp(`<title>[^<]* — ${SITE_NAME}</title>`));
      // The bar's link home, the one place these pages name the site.
      expect(html).toContain(`<span>${SITE_NAME}</span></a>`);
      expect(html).not.toContain(OLD_NAME);
    });
  }

  test('llms.txt is headed with it', async ({ request }) => {
    const text = await (await request.get('/llms.txt')).text();
    expect(text.split('\n')[0]).toBe(`# ${SITE_NAME}`);
    expect(text).not.toContain(OLD_NAME);
  });
});
