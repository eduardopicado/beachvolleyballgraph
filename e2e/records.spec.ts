/**
 * The records page, in a browser, against the published file.
 *
 * `boardsFor` is pinned in unit tests; this checks what only the running page
 * can: that the route mounts at all (a path `App` would otherwise read as a
 * country), that the switch and the URL agree, that a name opens its player,
 * and that the static HTML a crawler keeps holds the same rule the app does —
 * no unconfirmed height, in either.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, manifest } from './fixtures.js';
import { playerPath } from '../shared/slug.js';
import { GENDERS, RECORD_KEYS, RECORD_TITLE, type RecordsFile } from '../shared/schema.js';
import { boardsFor } from '../web/src/lib/records.js';
// The prerenderer's own escaping, so the check cannot drift from what it writes.
import { esc } from '../ingest/prerender.js';

const file = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../web/public/v1/records.json'), 'utf8'),
) as RecordsFile;
const m = manifest();
const nameOf = (code: string) => m.countries.find((c) => c.code === code)?.name ?? code;

/** Every board every row of which is withheld, as `${key} ${gender}` — the ones the page must not draw. */
const allWithheld = GENDERS.flatMap((g) =>
  RECORD_KEYS.filter((k) => {
    const rows = file.categories[k][g].rows;
    return rows.length > 0 && rows.every((r) => 'withheld' in r);
  }).map((k) => ({ key: k, gender: g })),
);

test('opens on the men\'s draw with every board it has something confirmed for', async ({ page }) => {
  await page.goto('/records/');
  await expect(page.locator('h1')).toHaveText('Records');
  await expect(page.locator('.records-page .board')).toHaveCount(boardsFor(file, 'M').length);
  await expect(page.locator('.segmented button[aria-pressed="true"]')).toHaveText('Men');
});

test('the switch moves to the women\'s draw, and the URL moves with it', async ({ page }) => {
  await page.goto('/records/');
  await page.locator('.segmented button', { hasText: 'Women' }).click();
  await expect(page).toHaveURL(/\/records\/\?gender=W$/);
  await expect(page.locator('.records-page .board')).toHaveCount(boardsFor(file, 'W').length);
  const lead = boardsFor(file, 'W')[0]!.rows[0]!;
  await expect(page.locator('.records-page .board').first().locator('li').first()).toContainText(lead.who[0]!.name);

  // And back, with the browser's own button.
  await page.goBack();
  await expect(page.locator('.segmented button[aria-pressed="true"]')).toHaveText('Men');
});

test('a board with nothing confirmed on it is not drawn', async ({ page }) => {
  test.skip(allWithheld.length === 0, 'every height board has at least one confirmed row today');
  for (const { key, gender } of allWithheld) {
    await page.goto(`/records/${gender === 'W' ? '?gender=W' : ''}`);
    await expect(page.locator('.records-page .board').first()).toBeVisible();
    await expect(page.locator('.records-page .board h2', { hasText: new RegExp(`^${RECORD_TITLE[key]}$`) })).toHaveCount(0);
  }
});

test('a partly unconfirmed board keeps its real ranks', async ({ page }) => {
  // Found by scanning: whichever height board has a withheld row between two
  // published ones today. Its drawn ranks must match the file's, gaps and all.
  const found = GENDERS.flatMap((g) => boardsFor(file, g).map((b) => ({ g, b }))).find(({ g, b }) => {
    const rows = file.categories[b.key][g].rows;
    return rows.some((r) => 'withheld' in r) && b.rows.length > 0;
  });
  test.skip(!found, 'no board is partly withheld today');
  const { g, b } = found!;
  await page.goto(`/records/${g === 'W' ? '?gender=W' : ''}`);
  const board = page.locator('.records-page .board', { has: page.locator('h2', { hasText: new RegExp(`^${RECORD_TITLE[b.key]}$`) }) });
  await expect(board.locator('li')).toHaveCount(b.rows.length);
  await expect(board.locator('.rank')).toHaveText(b.rows.map((r) => (r.joint ? `=${r.rank}` : String(r.rank))));
});

test('a name opens that player on their own page', async ({ page }) => {
  const lead = boardsFor(file, 'M')[0]!.rows[0]!.who[0]!;
  await page.goto('/records/');
  await page.locator('.records-page .board').first().locator('li').first().locator('a').first().click();
  await expect(page).toHaveURL(new RegExp(`${playerPath('/', nameOf(lead.federation), 'M', lead.id).replace('?', '\\?')}$`));
  await expect(page.locator('.player-card')).toContainText(lead.name);
});

test('the static page holds every confirmed name and no unconfirmed one', async ({ page }) => {
  // What a crawler keeps: the prerendered document, before any script runs.
  const html = await (await page.request.get('/records/')).text();
  for (const gender of GENDERS) {
    for (const board of boardsFor(file, gender)) {
      for (const row of board.rows) for (const w of row.who) expect(html).toContain(esc(w.name));
    }
  }
  // A withheld row carries no name in the file, so the check is on the boards:
  // one with nothing confirmed must have no heading on the page.
  for (const { key } of allWithheld) {
    const drawnSomewhere = GENDERS.some((g) => boardsFor(file, g).some((b) => b.key === key));
    if (!drawnSomewhere) expect(html).not.toContain(`<h3>${RECORD_TITLE[key]}</h3>`);
  }
});

test('the strip and the footer both lead here', async ({ page }) => {
  // Not the masthead: a third item there scrolls a 390px phone sideways (see
  // layout.spec.ts), and the strip's link sits just below it on the home page.
  await page.goto('/');
  await expect(page.locator('.start-here a.all')).toHaveAttribute('href', '/records/');
  await expect(page.locator('footer a', { hasText: 'Records' })).toHaveAttribute('href', '/records/');
});
