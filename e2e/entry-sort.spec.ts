/**
 * Sorting an entry list by its column headers.
 *
 * The list opens in FIVB's order and "#" is each team's place in it; the
 * headers re-sort by team, country, entry or technical points, and "#" keeps
 * the place. What can go wrong is quiet: a header that sorts the wrong way, or
 * a "#" that renumbers, still renders a complete, plausible list. So each
 * test reads the whole column back and checks its order.
 *
 * The lists published today carry no points (FIVB fills them in at the
 * registration deadline), so the file is served with points added, in FIVB's
 * order for entry and deliberately out of it for technical points. The teams,
 * names and federations are the published ones.
 */

import { test, expect } from './fixtures.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tournamentSlugs, TOURNAMENT_PREFIX } from '../shared/slug.js';
import type { EntriesFile, Gender, TournamentsFile } from '../shared/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');

/**
 * The published entry list with the most teams, found by scanning. With
 * `bare`, only lists FIVB has not yet given points to.
 */
function subject(bare = false): { code: string; slug: string; entries: EntriesFile } | null {
  const dir = path.join(DATA, 'entries');
  if (!existsSync(dir)) return null;
  const tournaments = Object.values(
    (JSON.parse(readFileSync(path.join(DATA, 'tournaments.json'), 'utf8')) as TournamentsFile)
      .tournaments,
  ).filter((row): row is NonNullable<typeof row> => row !== null);
  // Over every tournament, as the prerenderer does: the suffix on a clash
  // depends on the whole set.
  const slugs = tournamentSlugs(tournaments, (t) => ({
    name: t[0] as string,
    season: t[1] as number,
    gender: t[8] as Gender,
    code: t[4] as string,
  }));
  const byCode = new Map<string, string>();
  for (const [t, slug] of slugs) byCode.set(t[4] as string, slug);

  let best: { code: string; slug: string; entries: EntriesFile } | null = null;
  for (const file of readdirSync(dir)) {
    const code = /^(.+)\.json$/.exec(file)?.[1];
    const slug = code && byCode.get(code);
    if (!code || !slug) continue;
    const entries = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as EntriesFile;
    if (entries.teams.length < 5) continue;
    if (bare && entries.teams.some((t) => t[3] !== null)) continue;
    if (!best || entries.teams.length > best.entries.teams.length) best = { code, slug, entries };
  }
  return best;
}

const found = subject();

/** The list with points: entry falling down FIVB's order, tech a fixed shuffle of it. */
function withPoints(entries: EntriesFile): EntriesFile {
  const n = entries.teams.length;
  return {
    ...entries,
    teams: entries.teams.map((t, i) => {
      const copy = [...t] as typeof t;
      copy[3] = (n - i) * 10;
      copy[4] = ((i * 7) % n) * 3;
      return copy;
    }),
  };
}

const column = (page: import('@playwright/test').Page, n: number) =>
  page.locator(`.entries table:not(.gone) tbody tr td:nth-child(${n})`).allInnerTexts();
const header = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.entries table:not(.gone) thead th', { has: page.getByRole('button', { name, exact: true }) });

test.describe('sorting an entry list', () => {
  test.skip(!found, 'no published entry list has five teams');

  test.beforeEach(async ({ page }) => {
    const { code, slug, entries } = found!;
    await page.route(`**/v1/entries/${code}.json`, (route) => route.fulfill({ json: withPoints(entries) }));
    await page.goto(`./${TOURNAMENT_PREFIX}/${slug}/`);
    await expect(page.locator('.entries table:not(.gone) tbody tr')).toHaveCount(entries.teams.length);
  });

  test('opens in FIVB order, numbered by it', async ({ page }) => {
    const n = found!.entries.teams.length;
    expect(await column(page, 1)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
    await expect(header(page, 'Entry')).toHaveAttribute('aria-sort', 'descending');
    await expect(header(page, 'Fed.')).toHaveAttribute('aria-sort', 'none');
  });

  test('sorts by country A–Z, then Z–A, keeping each team’s place', async ({ page }) => {
    const fedOf = (cell: string) => cell.trim().split(/\s+/).pop()!;
    const collate = new Intl.Collator('en', { sensitivity: 'base' });

    await page.getByRole('button', { name: 'Fed.', exact: true }).click();
    await expect(header(page, 'Fed.')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header(page, 'Entry')).toHaveAttribute('aria-sort', 'none');
    const feds = (await column(page, 3)).map(fedOf);
    expect(feds).toEqual([...feds].sort(collate.compare));

    // "#" did not renumber: it is the same set of places, now out of order,
    // and within one country they still run in FIVB's order.
    const at = (await column(page, 1)).map(Number);
    expect([...at].sort((a, b) => a - b)).toEqual(at.map((_, i) => i + 1));
    expect(at).not.toEqual(at.map((_, i) => i + 1));
    for (let i = 1; i < at.length; i++) {
      if (feds[i] === feds[i - 1]) expect(at[i]).toBeGreaterThan(at[i - 1]!);
    }

    await page.getByRole('button', { name: 'Fed.', exact: true }).click();
    await expect(header(page, 'Fed.')).toHaveAttribute('aria-sort', 'descending');
    const back = (await column(page, 3)).map(fedOf);
    expect(back).toEqual([...back].sort(collate.compare).reverse());
  });

  test('sorts by technical points high to low', async ({ page }) => {
    await page.getByRole('button', { name: 'Tech', exact: true }).click();
    const tech = (await column(page, 5)).map(Number);
    expect(tech).toEqual([...tech].sort((a, b) => b - a));
  });

  test('sorts by the first player’s name A–Z, and back to FIVB order from Entry', async ({ page }) => {
    const collate = new Intl.Collator('en', { sensitivity: 'base' });
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    const first = (await column(page, 2)).map((cell) => cell.split(' / ')[0]!.trim());
    expect(first).toEqual([...first].sort(collate.compare));

    await page.getByRole('button', { name: 'Entry', exact: true }).click();
    const n = found!.entries.teams.length;
    expect(await column(page, 1)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
  });
});

/*
 * A list FIVB has not given points to yet opens by country, with no "#": the
 * file's order is player ids, which is no order a reader could use. Tested on
 * the published file itself, nothing added.
 */
const bare = subject(true);

test.describe('an entry list with no points yet', () => {
  test.skip(!bare, 'every published entry list has points');

  test('opens by country with no "#", and the points columns do not sort', async ({ page }) => {
    const { slug, entries } = bare!;
    await page.goto(`./${TOURNAMENT_PREFIX}/${slug}/`);
    const table = page.locator('.entries table:not(.gone)');
    await expect(table.locator('tbody tr')).toHaveCount(entries.teams.length);

    // No "#": four headers, the first of them the team. (Fed. also carries its ▴.)
    await expect(table.locator('thead th')).toHaveText([/^Team/, /^Fed\./, 'Entry', 'Tech']);
    await expect(header(page, 'Fed.')).toHaveAttribute('aria-sort', 'ascending');
    await expect(table.getByRole('button', { name: 'Entry', exact: true })).toHaveCount(0);
    await expect(table.getByRole('button', { name: 'Tech', exact: true })).toHaveCount(0);

    // Country is now column 2, and within a country the rows run by name.
    const collate = new Intl.Collator('en', { sensitivity: 'base' });
    const feds = (await column(page, 2)).map((cell) => cell.trim().split(/\s+/).pop()!);
    expect(feds).toEqual([...feds].sort(collate.compare));
    const first = (await column(page, 1)).map((cell) => cell.split(' / ')[0]!.trim());
    for (let i = 1; i < feds.length; i++) {
      if (feds[i] === feds[i - 1]) expect(collate.compare(first[i - 1]!, first[i]!)).toBeLessThanOrEqual(0);
    }
  });
});
