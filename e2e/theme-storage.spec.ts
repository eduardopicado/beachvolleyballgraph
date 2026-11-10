/**
 * The graph page with site data blocked.
 *
 * Chrome with cookies blocked, and some embedded browsers, throw a
 * `SecurityError` on merely reading `window.localStorage`. The theme toggle
 * read it while the app rendered, so on those browsers the whole page went
 * blank. Reproduced here by making the property throw before any script runs.
 */

import { test, expect, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';
import { DEFAULT_COUNTRY, DEFAULT_GENDER } from '../shared/site.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
});

test('the graph page still draws, and the theme still switches for the visit', async ({ page }) => {
  const country = manifest().countries.find((c) => c.code === DEFAULT_COUNTRY)!;
  await page.goto(`./${sliceSlug(country.name, DEFAULT_GENDER)}/`);
  await expect(page.locator('svg.graph')).toBeVisible();

  const toggle = page.locator('.theme-toggle');
  await expect(toggle).toHaveAttribute('title', 'System theme');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
