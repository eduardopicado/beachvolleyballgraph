/**
 * The withdrawn block at the foot of an entry list, at phone width.
 *
 * It used to be a wrapping flex row with `margin-left: auto` on the reason,
 * which reads as a right-hand column only while every row fits on one line. On
 * a 390px screen two long names never fit beside a flag, so the row wrapped and
 * the reason was flung to the right edge of whichever line it landed on —
 * sitting under a team it did not belong to. Nothing failed; it just quietly
 * said the wrong thing about who had pulled out and why.
 *
 * These run at 390px because that is the only width where it was ever wrong.
 * The desktop layout looked correct throughout.
 */

import { test, expect, manifest } from './fixtures.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tournamentSlugs, TOURNAMENT_PREFIX } from '../web/src/lib/slug.js';
import type { EntriesFile, Gender, TournamentsFile } from '../web/src/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');

/**
 * An event with withdrawals, found by scanning rather than named.
 *
 * Which tournaments have an entry list at all is a moving window — they are
 * written for events that have not been played yet — so a hard-coded code
 * turns this into a test that fails the week that event is played. Picks the
 * one with the most withdrawn teams, since that is the row most likely to
 * carry a name long enough to wrap.
 */
function subject(): { slug: string; withdrawn: EntriesFile['withdrawn'] } | null {
  const dir = path.join(DATA, 'entries');
  if (!existsSync(dir)) return null;

  const tournaments = Object.values(
    (JSON.parse(readFileSync(path.join(DATA, 'tournaments.json'), 'utf8')) as TournamentsFile)
      .tournaments,
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  // Built over every tournament, exactly as the prerenderer does it: the
  // disambiguating suffix depends on the whole set, so a slug computed over a
  // subset can name an address that was never written.
  const slugs = tournamentSlugs(tournaments, (t) => ({
    name: t[0] as string,
    season: t[1] as number,
    gender: t[8] as Gender,
    code: t[4] as string,
  }));
  const byCode = new Map<string, string>();
  for (const [t, slug] of slugs) byCode.set(t[4] as string, slug);

  let best: { slug: string; withdrawn: EntriesFile['withdrawn'] } | null = null;
  for (const file of readdirSync(dir)) {
    const code = /^(.+)\.json$/.exec(file)?.[1];
    const slug = code && byCode.get(code);
    if (!slug) continue;
    const entries = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as EntriesFile;
    const gone = entries.withdrawn ?? [];
    if (!gone.length) continue;
    if (!best || gone.length > (best.withdrawn ?? []).length) best = { slug, withdrawn: gone };
  }
  return best;
}

const found = subject();

test.describe('withdrawn teams on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(!found, 'no published entry list currently has a withdrawn team');

  test('every reason sits on its own team’s row', async ({ page }) => {
    const { slug, withdrawn } = found!;
    await page.goto(`./${TOURNAMENT_PREFIX}/${slug}/`);

    const rows = page.locator('.entries .gone tbody tr');
    await expect(rows).toHaveCount((withdrawn ?? []).length);

    // The bug in one measurement: the reason's box has to overlap, vertically,
    // the box of the names it describes. When the reason wrapped onto its own
    // line these did not intersect at all.
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const who = await row.locator('.who').boundingBox();
      const why = await row.locator('.why').boundingBox();
      expect(who, 'row has no team cell').not.toBeNull();
      expect(why, 'row has no reason cell').not.toBeNull();
      const overlap =
        Math.min(who!.y + who!.height, why!.y + why!.height) - Math.max(who!.y, why!.y);
      expect(overlap, `reason ${i} is on a different line from its team`).toBeGreaterThan(0);
    }
  });

  test('the page does not scroll sideways', async ({ page }) => {
    // Two of the three columns are `white-space: nowrap`, which is what keeps
    // the flag and the reason whole — and is exactly how a table starts
    // forcing the page wider than the screen. The names column is the one that
    // may wrap, and this is the assertion that says so.
    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    await expect(page.locator('.entries .gone').first()).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, 'the page overflows its own width').toBeLessThanOrEqual(clientWidth);
  });

  test('a medical withdrawal still reads as a certificate to a screen reader', async ({ page }) => {
    // The visible label is shortened to fit the narrowest column on the page;
    // the full phrase is what FIVB calls it and what this said before, so it
    // has to survive somewhere.
    const medical = (found!.withdrawn ?? []).some((t) => t[5] === 'medical');
    test.skip(!medical, 'this event has no medical withdrawal');

    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    const cell = page.locator('.entries .gone .why', { hasText: 'Medical' }).first();
    await expect(cell).toHaveText(/Medical certificate/);
  });
});

test('the withdrawn block is a real table, not a list wearing one', async ({ page }) => {
  test.skip(!found, 'no published entry list currently has a withdrawn team');
  await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
  // Named rather than implied: `margin-left: auto` on a flex child is what
  // produced the bug, and a future tidy-up could reintroduce it without any
  // geometric assertion above catching it on a desktop-width run.
  await expect(page.locator('.entries table.gone')).toHaveCount(1);
  await expect(page.locator('.entries .gone caption')).toContainText('withdrawn');
});
