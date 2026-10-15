/**
 * No page claims a season nobody has played.
 *
 * `manifest.seasons.to` is the newest season FIVB has *scheduled* anything in
 * — 2027 when this was written, with nothing played in it — and for months
 * every description on the site read "1987–2027": the home page, all 264
 * country pages, the tournament index, the About page, llms.txt and the
 * structured data search engines read. They say "since 1987" now.
 *
 * Checked on what is served, before any script runs, because the meta
 * description and the structured data are what a search result shows — and
 * then once on the hydrated page, whose footer the app draws itself.
 */

import { test, expect, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

const { from, to } = manifest().seasons;
/** Every way a range ending in the scheduled season has been written on the site. */
const ranges = [`${from}–${to}`, `${from}-${to}`, `${from} and ${to}`, `${from}/${to}`];

const brazil = manifest().countries.find((c) => c.code === 'BRA')!;
const pages = ['/', `/${sliceSlug(brazil.name, 'M')}/`, '/tournaments/', '/about/', '/llms.txt'];

for (const path of pages) {
  test(`${path} says "since ${from}" and names no range ending in ${to}`, async ({ page }) => {
    const res = await page.request.get(path);
    expect(res.status()).toBe(200);
    const body = await res.text();
    for (const range of ranges) expect(body, `"${range}" on ${path}`).not.toContain(range);
    expect(body).toContain(`since ${from}`);
  });
}

test('the hydrated footer says since, too', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('.controls').getByText(/tournaments? since/);
  await expect(footer).toContainText(`since ${from}`);
  for (const range of ranges) await expect(page.locator('body')).not.toContainText(range);
});
