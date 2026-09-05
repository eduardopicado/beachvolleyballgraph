/**
 * A tournament's final classification, against the data it was built from.
 *
 * The classification is published by a *different* path through the ingest
 * than the timeline that opens it — the timeline reads `results/`, keyed by
 * player, and the panel reads `classifications/`, keyed by tournament. Both
 * are built in the same loop precisely so they cannot disagree, and that is
 * the thing worth pinning: a filter applied to one and not the other produces
 * a page where a player's own card says they finished 5th and the
 * classification it opens does not list them at all.
 *
 * So these assert agreement rather than appearance: the panel shows what the
 * published file holds, the file holds the player whose card opened it, and it
 * holds them at the placement their own timeline claims.
 */

import { test, expect, classification, graph, manifest, results, tournamentIndex } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

/**
 * A player from this slice with a real career, and one tournament of theirs
 * that has a published code — picked from the data rather than hardcoded, so
 * this keeps working as the archive grows.
 */
function subject() {
  const tournaments = tournamentIndex();
  const sliceResults = results(COUNTRY, GENDER);
  const nodes = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments);
  for (const node of nodes) {
    for (const [no, , rank] of sliceResults.players[node.id] ?? []) {
      const meta = tournaments[no];
      const code = meta && meta.length > 4 ? meta[4] : null;
      // A shared placement, so the grouping below has something to group.
      if (code && rank > 3) return { node, code, rank, season: meta[1], name: meta[0] };
    }
  }
  throw new Error('no player in this slice has a coded tournament');
}

test.describe('a tournament’s final classification', () => {
  test('holds exactly the teams the per-player results hold, archive-wide', () => {
    /*
     * The load-bearing test, and the only one here that cannot pass by
     * agreeing with itself.
     *
     * Every assertion below this one compares the panel against the
     * classification file, so a fault in the *file* moves both together and
     * goes unnoticed — dropping §3's never-played rule from the collector
     * inflates the archive from 64,059 teams to 103,801 and every one of them
     * still passes. This compares the two files that are built from the same
     * rows by different routes: `results/`, keyed by player, and
     * `classifications/`, keyed by tournament. They can only agree if the same
     * filters reached both.
     *
     * Whole archive rather than a sample: it is JSON already on disk, it runs
     * in about a second, and a sample would let a fault hide in whichever
     * tournaments it missed.
     */
    const fromResults = new Map<number, Set<string>>();
    for (const country of manifest().countries) {
      for (const gender of Object.keys(country.genders) as ('M' | 'W')[]) {
        for (const [id, entries] of Object.entries(results(country.code, gender).players)) {
          for (const [no, partner] of entries) {
            const self = Number(id);
            let field = fromResults.get(no);
            if (!field) fromResults.set(no, (field = new Set()));
            field.add([self, partner].sort((x, y) => x - y).join(':'));
          }
        }
      }
    }

    const tournaments = tournamentIndex();
    const mismatched: string[] = [];
    let checked = 0;
    let teams = 0;
    for (const [no, expected] of fromResults) {
      const meta = tournaments[no];
      const code = meta && meta.length > 4 ? meta[4] : null;
      if (!code) continue;
      const actual = new Set(
        classification(code).teams.map(([, a, b]) => [a, b].sort((x, y) => x - y).join(':')),
      );
      checked++;
      teams += actual.size;
      if (actual.size !== expected.size) {
        mismatched.push(`${code}: file has ${actual.size} teams, results have ${expected.size}`);
        continue;
      }
      for (const team of expected) {
        if (!actual.has(team)) mismatched.push(`${code}: results hold team ${team}, the file does not`);
      }
    }

    // Vacuity guard: all of the above passes trivially on nothing.
    expect(checked).toBeGreaterThan(1_500);
    expect(teams).toBeGreaterThan(60_000);
    expect(mismatched.slice(0, 10)).toEqual([]);
  });

  test('the published file holds the player whose card opens it, at their own placement', () => {
    // No browser needed: this is the two files agreeing, which is the
    // invariant everything on screen rests on. If it ever fails, the panel is
    // wrong before it renders.
    const { node, code, rank } = subject();
    const file = classification(code);
    const mine = file.teams.filter(([, a, b]) => a === node.id || b === node.id);
    expect(mine, `${node.name} is missing from ${code}`).not.toHaveLength(0);
    expect(mine.map(([r]) => r)).toContain(rank);
    // And the file can name everyone it lists — a classification with an
    // unnameable team is the one thing this panel cannot render.
    for (const [, a, b] of file.teams) {
      expect(file.players[a], `${code} cannot name player ${a}`).toBeTruthy();
      expect(file.players[b], `${code} cannot name player ${b}`).toBeTruthy();
    }
  });

  test('opens from the timeline and shows every team the file holds', async ({ page }) => {
    const { node, code, name } = subject();
    const file = classification(code);

    await page.goto(`./${slicePath()}?player=${node.id}`);
    await expect(page.locator('.player-card')).toBeVisible();
    await page.getByRole('button', { name: 'Timeline' }).click();

    // Open seasons until the event turns up: which season it sits in is data,
    // not something to hardcode.
    const trigger = page.locator('.events button.name', { hasText: name }).first();
    for (const season of await page.locator('.timeline .season').all()) {
      await season.click();
      if (await trigger.count()) break;
    }
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.locator('.tournament-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');

    // Every team in the file, and no more. The panel scrolls, so this counts
    // the DOM rather than what happens to be on screen.
    await expect(panel.locator('.team')).toHaveCount(file.teams.length);
    await expect(panel.locator('.tournament-panel .band, .band')).toHaveCount(
      new Set(file.teams.map(([rank]) => rank)).size,
    );

    // The reader's own team is marked, so they can find the row they came from
    // in a field that can run past a hundred teams.
    await expect(panel.locator('.team.is-mine')).not.toHaveCount(0);
  });

  test('groups a shared placement instead of listing it as separate finishes', async ({ page }) => {
    // Quirks §5/§15: eight teams finish 9th. Rendering one row each would
    // invent an order FIVB does not publish. Only meaningful on a field that
    // actually shares a placement, so pick one that does.
    const tournaments = tournamentIndex();
    const sliceResults = results(COUNTRY, GENDER);
    const nodes = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments);
    let found: { id: number; code: string; name: string } | null = null;
    outer: for (const node of nodes) {
      for (const [no] of sliceResults.players[node.id] ?? []) {
        const meta = tournaments[no];
        const code = meta && meta.length > 4 ? meta[4] : null;
        if (!code) continue;
        const file = classification(code);
        const ranks = file.teams.map(([r]) => r);
        if (new Set(ranks).size < ranks.length) {
          found = { id: node.id, code, name: meta[0] };
          break outer;
        }
      }
    }
    expect(found, 'no tournament in this slice shares a placement').not.toBeNull();
    const file = classification(found!.code);

    await page.goto(`./${slicePath()}?player=${found!.id}`);
    await page.getByRole('button', { name: 'Timeline' }).click();
    const trigger = page.locator('.events button.name', { hasText: found!.name }).first();
    for (const season of await page.locator('.timeline .season').all()) {
      await season.click();
      if (await trigger.count()) break;
    }
    await trigger.click();

    const panel = page.locator('.tournament-panel');
    await expect(panel).toBeVisible();
    const bands = await panel.locator('.band').count();
    const teams = await panel.locator('.team').count();
    expect(bands).toBeLessThan(teams);
    expect(bands).toBe(new Set(file.teams.map(([r]) => r)).size);
  });

  test('Escape closes the classification and leaves the card', async ({ page }) => {
    const { node, name } = subject();
    await page.goto(`./${slicePath()}?player=${node.id}`);
    await page.getByRole('button', { name: 'Timeline' }).click();
    const trigger = page.locator('.events button.name', { hasText: name }).first();
    for (const season of await page.locator('.timeline .season').all()) {
      await season.click();
      if (await trigger.count()) break;
    }
    await trigger.click();
    await expect(page.locator('.tournament-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.tournament-panel')).toHaveCount(0);
    // One press, one thing closed — the card listens for Escape too.
    await expect(page.locator('.player-card')).toBeVisible();
  });

  test('a name in the field opens that player', async ({ page }) => {
    const { node, code, name } = subject();
    const file = classification(code);

    await page.goto(`./${slicePath()}?player=${node.id}`);
    await page.getByRole('button', { name: 'Timeline' }).click();
    const trigger = page.locator('.events button.name', { hasText: name }).first();
    for (const season of await page.locator('.timeline .season').all()) {
      await season.click();
      if (await trigger.count()) break;
    }
    await trigger.click();

    const panel = page.locator('.tournament-panel');
    await expect(panel).toBeVisible();
    // Somebody else in the same slice, so there is a card to open.
    const inSlice = new Set(graph(COUNTRY, GENDER).nodes.map((n) => n.id));
    const other = file.teams
      .flatMap(([, a, b]) => [a, b])
      .find((id) => id !== node.id && inSlice.has(id));
    test.skip(other === undefined, 'no other player from this slice in the field');

    await panel.locator('.pair button', { hasText: file.players[other!] }).first().click();
    await expect(page.locator('.tournament-panel')).toHaveCount(0);
    await expect(page.locator('.player-card h2')).toHaveText(file.players[other!]!);
  });
});
