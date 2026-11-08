/**
 * Choosing a country whose graph does not arrive, once another is on screen.
 *
 * The full-page "Data unavailable" panel only covers a first load with
 * nothing to show. After one slice had loaded, a failed switch left the
 * previous slice's graph, figures and table on screen, undimmed, under the
 * new country's heading, and said nothing at all.
 */

import { test, expect, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';
import { DEFAULT_COUNTRY, DEFAULT_GENDER } from '../shared/site.js';

test('a failed switch says so, and shows nothing from the country before', async ({ page, jsErrors }) => {
  const m = manifest();
  const home = m.countries.find((c) => c.code === DEFAULT_COUNTRY)!;
  const other = m.countries.find((c) => c.code !== DEFAULT_COUNTRY && c.genders[DEFAULT_GENDER])!;
  // A network failure, not a 404: the guard in fixtures.ts rightly treats a
  // missing data file as a fault in the build.
  await page.route(`**/v1/graphs/${other.code}-${DEFAULT_GENDER}.json`, (route) => route.abort());

  await page.goto(`./${sliceSlug(home.name, DEFAULT_GENDER)}/`);
  await expect(page.locator('svg.graph')).toBeVisible();

  await page.locator('.controls select').selectOption(other.code);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(`Could not load ${other.name} ${DEFAULT_GENDER === 'M' ? 'men' : 'women'}`);
  await expect(page.locator('svg.graph')).toHaveCount(0);
  await expect(page.locator('.table-section')).toHaveCount(0);
  // The controls stay, so the reader can choose again.
  await page.locator('.controls select').selectOption(home.code);
  await expect(page.locator('svg.graph')).toBeVisible();
  await expect(alert).toHaveCount(0);

  // The browser reports the aborted request as a console error, which is the
  // failure this test made on purpose.
  const expected = 'console.error: Failed to load resource: net::ERR_FAILED';
  jsErrors.splice(0, jsErrors.length, ...jsErrors.filter((e) => e !== expected));
});
