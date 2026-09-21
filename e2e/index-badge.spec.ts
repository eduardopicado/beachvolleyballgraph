/**
 * What the tournament index says about an event with no result yet.
 *
 * The tag used to read "Upcoming", which is a claim about time that the date
 * column beside it already makes, and makes better. It is driven by whether a
 * classification exists, not by the calendar, so it stayed on through the
 * three days BPT Futures Corigliano Rossano was actually being played, and
 * through the lag before FIVB published placements. Naming the page's
 * contents instead is true for the whole of that window.
 *
 * Asserted against `manifest.withoutField`, which is the same set the ingest
 * and the prerenderer both key on — so this cannot pass by agreeing with the
 * component's own idea of which rows have a result.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, tournamentIndex } from './fixtures.js';
import { readTournament } from '../web/src/lib/tournamentMeta.js';
import { buildIndex } from '../web/src/lib/tournamentIndex.js';
import { INDEX_PREFIX } from '../web/src/lib/indexRoute.js';
import type { Gender } from '../shared/schema.js';

const CLASSIFIED = new Set(
  readdirSync(path.resolve(import.meta.dirname, '../web/public/v1/classifications')).map((f) =>
    f.replace(/\.json$/, ''),
  ),
);

/**
 * A season and draw the index will actually draw both branches of the tag on.
 *
 * Found by scanning rather than hard-coded: which season holds an undecided
 * event changes every time the archive is rebuilt, and a hard-coded one is
 * entirely played by the following year.
 *
 * Asked of `buildIndex` rather than of the files directly, because most
 * tournaments with no classification are **not** shown at all — they are
 * cancellations and postponements years old, which the index drops. Counting
 * files would pick 2004 and land on a page with no tag on it.
 */
function seasonShowingBoth(): { season: number; gender: Gender } | null {
  const rows = buildIndex(tournamentIndex(), (code) => CLASSIFIED.has(code));
  const bySeason = new Map<string, { season: number; gender: Gender; awaiting: number; played: number }>();
  for (const row of rows) {
    const key = `${row.season}-${row.gender}`;
    const seen = bySeason.get(key) ?? { season: row.season, gender: row.gender, awaiting: 0, played: 0 };
    if (row.played) seen.played++;
    else seen.awaiting++;
    bySeason.set(key, seen);
  }
  for (const seen of bySeason.values()) {
    if (seen.awaiting > 0 && seen.played > 0) return { season: seen.season, gender: seen.gender };
  }
  return null;
}

test('an event with no result is tagged by what its page holds, not by when it is', async ({ page }) => {
  const found = seasonShowingBoth();
  test.skip(!found, 'no season currently holds both a played and an undecided event');
  if (!found) return;

  await page.goto(`./${INDEX_PREFIX}/?season=${found.season}${found.gender === 'W' ? '&gender=W' : ''}`);
  await expect(page.locator('.tournament-index table')).toBeVisible();

  // The claim about time is gone from the page entirely, tag and tally alike.
  await expect(page.locator('.tournament-index')).not.toContainText('Upcoming');
  await expect(page.locator('.tournament-index')).not.toContainText('still to play');

  const tagged = page.locator('.tournament-index td.what .entries');
  const count = await tagged.count();
  expect(count, 'this season has an undecided event, so a tag should be drawn').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await expect(tagged.nth(i)).toHaveText('Entry list');

  // And exactly the rows the published data says: every tagged row is one
  // with no classification file, and no row that has one carries a tag.
  const rows = page.locator('.tournament-index tbody tr');
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  let tags = 0;
  for (let i = 0; i < total; i++) {
    const row = rows.nth(i);
    const name = (await row.locator('td.what a').innerText()).trim();
    const hasTag = (await row.locator('td.what .entries').count()) > 0;
    if (hasTag) tags++;
    // The name is the join back to the data: a row is undecided exactly when
    // its tournament has no classification published.
    const codes = Object.values(tournamentIndex())
      .map(readTournament)
      .filter((t) => t.name === name && t.season === found.season && t.gender === found.gender)
      .map((t) => t.code!);
    if (codes.length !== 1) continue; // two draws of one name; not this test's business
    expect(hasTag, `${name}: tag drawn on a row whose result is published`).toBe(!CLASSIFIED.has(codes[0]!));
  }
  expect(tags).toBe(count);
});

test('the tally counts what is awaiting a result rather than what is still to play', async ({ page }) => {
  const found = seasonShowingBoth();
  test.skip(!found, 'no season currently holds both a played and an undecided event');
  if (!found) return;

  await page.goto(`./${INDEX_PREFIX}/?season=${found.season}${found.gender === 'W' ? '&gender=W' : ''}`);
  const tally = page.locator('.tournament-index p.tally');
  await expect(tally).toBeVisible();
  // The count itself is the component's, but that it is phrased as a statement
  // about results rather than about the future is the point of the change.
  await expect(tally).toContainText('awaiting results');
  const shown = await page.locator('.tournament-index td.what .entries').count();
  await expect(tally).toContainText(`${shown} awaiting results`);
});

test('the prerendered description counts played and awaiting against the data', async ({ page }) => {
  /*
   * The call site, not the sentence.
   *
   * `indexDescription` is unit-tested, and that was not enough: the bug was
   * in what `main()` passed it — `indexRows.length - addressable.length`,
   * where `addressable` is an alias for `indexRows`. A helper tested in
   * isolation is happy with any two numbers, so restoring that subtraction
   * leaves every unit test green. This reads the number off the served page
   * and checks it against the classification files.
   *
   * The raw document rather than the DOM: this is what a crawler is given,
   * and React has replaced the body by the time the page has mounted.
   */
  const rows = buildIndex(tournamentIndex(), (code) => CLASSIFIED.has(code));
  const played = rows.filter((r) => r.played).length;
  const awaiting = rows.length - played;

  const response = await page.request.get(`./${INDEX_PREFIX}/`);
  expect(response.ok()).toBe(true);
  const html = await response.text();
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
  expect(description, 'the index has no meta description').toBeTruthy();

  const n = (value: number) => value.toLocaleString('en-US');
  expect(description).toContain(`${n(played)} played`);
  if (awaiting > 0) expect(description).toContain(`${n(awaiting)} awaiting results`);
  else expect(description).not.toContain('awaiting results');

  // The total is the one both numbers have to add up to, and the shape the
  // bug hid behind: played alone equalled it, so nothing looked wrong.
  expect(played + awaiting).toBe(rows.length);
  if (awaiting > 0) expect(description).not.toContain(`${n(rows.length)} played`);
});

test('a season that is entirely played carries no tag at all', async ({ page }) => {
  // The other branch, and the ordinary case: nothing should mark a row whose
  // result is published. 2019 is long finished and large.
  const has2019 = Object.values(tournamentIndex())
    .map(readTournament)
    .some((t) => t.season === 2019 && t.gender === 'M');
  test.skip(!has2019, 'the archive has no 2019 men’s season');

  await page.goto(`./${INDEX_PREFIX}/?season=2019`);
  await expect(page.locator('.tournament-index table')).toBeVisible();
  await expect(page.locator('.tournament-index td.what .entries')).toHaveCount(0);
  await expect(page.locator('.tournament-index p.tally')).not.toContainText('awaiting');
});
