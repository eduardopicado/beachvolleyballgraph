/**
 * Entrant names on an entry list, and where each one goes.
 *
 * Two kinds of link in one column. A player published on this site opens their
 * card here; anyone else opens their FIVB profile in a new tab. The split is
 * `elsewhere` in the entries file — a correction list over the guess
 * "team federation + event gender" — and the thing worth testing is that the
 * page agrees with that file rather than with an assumption about it.
 *
 * The second kind is not a fallback for nobodies. Measured against VIS, Oguz
 * Degirmenci has twenty tournaments on record and one of them is in this
 * site's set; the other nineteen are national and zonal tours this project
 * excludes by tier. So an outbound link is the only honest thing to put on
 * that name, and a test that let it silently become plain text would be
 * letting the page assert something false about a real career.
 */

import { test, expect, manifest } from './fixtures.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tournamentSlugs, TOURNAMENT_PREFIX } from '../web/src/lib/slug.js';
import { fieldPlayerSlice, playerProfileUrl } from '../web/src/schema.js';
import type { EntriesFile, Gender, TournamentsFile } from '../web/src/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');

/**
 * A published entry list that contains both kinds of name.
 *
 * Scanned, not named: which events have an entry list is a moving window, and
 * an event with no unlinkable entrant would make half of this file vacuous.
 */
function subject(): { slug: string; entries: EntriesFile } | null {
  const dir = path.join(DATA, 'entries');
  if (!existsSync(dir)) return null;

  const tournaments = Object.values(
    (JSON.parse(readFileSync(path.join(DATA, 'tournaments.json'), 'utf8')) as TournamentsFile)
      .tournaments,
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  const slugs = tournamentSlugs(tournaments, (t) => ({
    name: t[0] as string,
    season: t[1] as number,
    gender: t[8] as Gender,
    code: t[4] as string,
  }));
  const byCode = new Map<string, string>();
  for (const [t, slug] of slugs) byCode.set(t[4] as string, slug);

  let best: { slug: string; entries: EntriesFile; offsite: number } | null = null;
  for (const file of readdirSync(dir)) {
    const code = /^(.+)\.json$/.exec(file)?.[1];
    const slug = code && byCode.get(code);
    if (!slug) continue;
    const entries = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as EntriesFile;
    if (!entries.teams.length) continue;
    const offsite = Object.values(entries.elsewhere ?? {}).filter((v) => v === null).length;
    if (!offsite) continue;
    if (!best || offsite > best.offsite) best = { slug, entries, offsite };
  }
  return best;
}

const found = subject();

test.describe('entrant names', () => {
  test.skip(!found, 'no published entry list currently mixes both kinds of name');

  test('each name links where the published file says it should', async ({ page }) => {
    const { slug, entries } = found!;
    await page.goto(`./${TOURNAMENT_PREFIX}/${slug}/`);
    await expect(page.locator('.entries tbody tr').first()).toBeVisible();

    let opensHere = 0;
    let opensFivb = 0;
    for (const team of entries.teams) {
      const [a, b, federation] = team;
      for (const id of [a, b]) {
        const label = entries.players[id];
        if (!label) continue;
        const cell = page.locator('.entries .who', { hasText: label }).first();
        if (fieldPlayerSlice(entries, id, federation as string)) {
          // A page here: a button, because selecting a player is navigation
          // inside the app rather than a document to fetch.
          await expect(cell.locator(`button:text-is("${label}")`)).toHaveCount(1);
          opensHere++;
        } else {
          const link = cell.locator(`a[href="${playerProfileUrl(id)}"]`);
          await expect(link).toHaveCount(1);
          await expect(link).toHaveAttribute('target', '_blank');
          // Without `noopener` the opened tab can reach back through
          // `window.opener`; the player card's own FIVB link sets both.
          await expect(link).toHaveAttribute('rel', /noopener/);
          opensFivb++;
        }
      }
    }

    // Both branches have to have run, or this file proves only one of them.
    expect(opensHere, 'no entrant opened a page on this site').toBeGreaterThan(0);
    expect(opensFivb, 'no entrant linked out to FIVB').toBeGreaterThan(0);
  });

  test('no entrant name is left as plain text', async ({ page }) => {
    // The regression this guards is the quiet one: a name that stops being a
    // link still renders, still reads correctly, and simply stops going
    // anywhere.
    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    // The prerendered page carries a summary line, not the table — the entry
    // list is rendered on hydration. Counting before it arrives finds nothing
    // and passes every per-row assertion below vacuously.
    await expect(page.locator('.entries tbody tr').first()).toBeVisible();

    const cells = page.locator('.entries tbody .who');
    const count = await cells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const cell = cells.nth(i);
      const links = await cell.locator('button, a').count();
      expect(links, `row ${i} has ${links} links, expected two names`).toBe(2);
    }
  });

  test('an outbound name says so to a screen reader', async ({ page }) => {
    // The arrow is the only visible signal that the next click leaves the
    // site, and an arrow is not available to everyone.
    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    const link = page.locator('.entries .who a.offsite').first();
    await expect(link).toHaveText(/FIVB profile, opens in a new tab/);
  });
});
