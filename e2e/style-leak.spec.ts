/**
 * The About page's stylesheet must not reach the app.
 *
 * StaticPage.css ships inside the app's own CSS bundle, and while its season
 * chart used a bare `.season` the app's own `.season` elements took its styles:
 * every year on a player card's timeline sat on a solid block of the blue it is
 * written in, so the column read as a stack of empty bars; and the year in a
 * tournament page's title was turned into a flex column and pushed onto a line
 * of its own. `web/src/stylesheetScope.test.ts` guards every sheet; this
 * guards what a reader actually saw.
 */

import { test, expect, graph } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

test('a timeline year is drawn on the card, not under a block of its own colour', async ({ page }) => {
  // The busiest player of the opening slice: a long timeline, opened by URL.
  const { nodes } = graph('BRA', 'W');
  const top = [...nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
  await page.goto(`./${sliceSlug('Brazil', 'W')}/?player=${top.id}`);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();

  const season = page.locator('.player-card .timeline .season').first();
  await expect(season.locator('.year')).toHaveText(/^\d{4}$/);
  // Nothing between the year and the card paints a background of its own.
  const painted = await season.evaluate((button) =>
    [button, ...button.querySelectorAll('*')]
      .map((el) => getComputedStyle(el).backgroundColor)
      .filter((bg) => bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'),
  );
  expect(painted).toEqual([]);
});

test('a tournament title keeps its year on the same line', async ({ page }) => {
  // A title whose name does not carry its year, so the year is a span of its
  // own. Itapema 2026 keeps its page after it is played; if a rename ever puts
  // the year in the name, the test says so rather than passing on nothing.
  await page.goto('./tournament/beach-elite-itapema-2026-women/');
  const year = page.locator('.tournament-page h1 .season');
  test.skip((await year.count()) === 0, 'this title carries its own year');
  await expect(year).toHaveCSS('display', 'inline');
});
