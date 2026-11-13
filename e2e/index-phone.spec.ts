/**
 * The tournament index fits a phone.
 *
 * It did not: at 390px the table measured 453px, so the page scrolled
 * sideways, "Country" was cut off and "Level" sat off the screen. Hiding the
 * country's name had already been done for exactly this, but the column's
 * heading held it 81px wide regardless.
 *
 * Walked back through nine seasons and both draws, because what overflows is
 * the longest name of the season on screen, and that changes with every step.
 */

import { test, expect } from './fixtures.js';

for (const width of [390, 360]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 780 } });

    test('every column of the index is on the screen', async ({ page }) => {
      await page.goto('./tournaments/');
      const rows = page.locator('.tournament-index tbody tr');
      await expect(rows.first()).toBeVisible();

      for (const draw of ['Men', 'Women']) {
        await page.getByRole('button', { name: draw, exact: true }).click();
        for (let step = 0; step < 9; step++) {
          await expect(rows.first()).toBeVisible();
          const m = await page.evaluate(() => {
            const doc = document.documentElement;
            const level = document.querySelector('.tournament-index thead th:last-child')!;
            return {
              season: document.querySelector<HTMLInputElement>('.tournament-index .year')?.value,
              sideways: doc.scrollWidth - doc.clientWidth,
              levelRight: Math.round(level.getBoundingClientRect().right),
              width: doc.clientWidth,
            };
          });
          expect(m.sideways, `${draw} ${m.season} scrolls sideways`).toBeLessThanOrEqual(1);
          expect(m.levelRight, `Level is off the screen in ${draw} ${m.season}`).toBeLessThanOrEqual(m.width);
          await page.getByRole('button', { name: 'Previous season' }).click();
        }
      }
    });

    test('the country column still has a heading to read out', async ({ page }) => {
      await page.goto('./tournaments/');
      await expect(page.getByRole('columnheader', { name: 'Country' })).toHaveCount(1);
    });
  });
}
