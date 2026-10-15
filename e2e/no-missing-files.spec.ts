/**
 * A tournament page asks only for the data files that event has.
 *
 * A played event has a classification and no entry list; one still to be
 * decided has an entry list and no classification. The entry-list pages were
 * also asking for a classification — a 404 on the live site, every time,
 * logged in the reader's console.
 *
 * The browser suite never noticed because `vite preview` answers a missing file
 * with the app's own index.html and a 200, so a request that 404s on GitHub
 * Pages looks like success here. So this asserts on the requests made, not on
 * how they were answered.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, tournamentIndex } from './fixtures.js';
import { buildIndex } from '../web/src/lib/tournamentIndex.js';
import { TOURNAMENT_PREFIX } from '../shared/slug.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');
const files = (dir: string) => new Set(readdirSync(path.join(DATA, dir)).map((f) => f.replace(/\.json$/, '')));
const CLASSIFIED = files('classifications');
const ENTRIES = files('entries');

const rows = buildIndex(tournamentIndex(), (code) => CLASSIFIED.has(code));
const upcoming = rows.find((r) => !r.played && ENTRIES.has(r.code));
const played = rows.find((r) => r.played && CLASSIFIED.has(r.code));

/** Every `/v1/` data file the page asked for, as `dir/name`. */
async function requested(page: import('@playwright/test').Page, url: string): Promise<string[]> {
  const asked: string[] = [];
  page.on('request', (r) => {
    const m = /\/v1\/([a-z]+)\/([^/?]+)\.json/.exec(r.url());
    if (m) asked.push(`${m[1]}/${m[2]}`);
  });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  return asked;
}

test('an event still to be decided asks for its entry list and not for a classification', async ({ page }) => {
  test.skip(!upcoming, 'no published event is awaiting its result');
  const asked = await requested(page, `/${TOURNAMENT_PREFIX}/${upcoming!.slug}/`);
  await expect(page.locator('h1')).toContainText(upcoming!.name);
  expect(asked).toContain(`entries/${upcoming!.code}`);
  expect(asked.filter((f) => f.startsWith('classifications/'))).toEqual([]);
});

test('a played event asks for its classification and not for an entry list', async ({ page }) => {
  test.skip(!played, 'no published event has a result');
  const asked = await requested(page, `/${TOURNAMENT_PREFIX}/${played!.slug}/`);
  expect(asked).toContain(`classifications/${played!.code}`);
  expect(asked.filter((f) => f.startsWith('entries/'))).toEqual([]);
});
