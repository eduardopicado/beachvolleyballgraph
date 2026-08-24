/**
 * The "min. events together" control.
 *
 * It is the only control that changes what the graph, the stats, the table and
 * the player card each contain, and it carries a rule that is not obvious from
 * the label: dropping an edge also drops any player left with no partnership
 * at all. `lib/filter.test.ts` pins that rule in isolation; these check that
 * every part of the page is actually reading the same filtered slice, which is
 * the way this breaks in practice — one panel updates and another does not.
 *
 * Numbers are computed from the published JSON rather than written down, so
 * they survive the weekly refresh.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import { filterByStrength } from '../web/src/lib/filter.js';
import { sliceSlug } from '../web/src/lib/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const pathFor = (code: string, gender: string) => {
  const entry = manifest().countries.find((c) => c.code === code);
  if (!entry) throw new Error(`${code} missing from the manifest`);
  return `${sliceSlug(entry.name, gender as 'M' | 'W')}/`;
};

/** The segmented button for a threshold: "All", "2+", "3+"… */
const threshold = (page: import('@playwright/test').Page, n: number) =>
  page.getByRole('group', { name: 'Min. events together' }).getByRole('button', {
    name: n === 1 ? 'All' : `${n}+`,
    exact: true,
  });

test('raising the threshold hides exactly what the data says it should', async ({ page }) => {
  const g = graph(COUNTRY, GENDER);
  const expected = filterByStrength(g.nodes, g.edges, 3);
  // A threshold that changes nothing would let a no-op filter pass.
  expect(expected.nodes.length, 'the 3+ threshold hides nobody in this slice').toBeLessThan(
    g.nodes.length,
  );

  await page.goto(`./${pathFor(COUNTRY, GENDER)}`);
  await expect(page.locator('.table-view tbody tr')).toHaveCount(g.nodes.length);

  await threshold(page, 3).click();
  await expect(threshold(page, 3)).toHaveAttribute('aria-pressed', 'true');

  // Every surface that reads the slice, checked against the same number: the
  // headline tile, the table, and the graph itself.
  await expect(page.locator('.table-view tbody tr')).toHaveCount(expected.nodes.length);
  await expect(page.locator('.tile.is-hero .value')).toHaveText(
    expected.nodes.length.toLocaleString('en-US'),
  );
  await expect(page.locator('[data-node]')).toHaveCount(expected.nodes.length);
  await expect(page.locator('svg.graph line')).toHaveCount(expected.edges.length);
});

test('the legend accounts for every player it removed', async ({ page }) => {
  const g = graph(COUNTRY, GENDER);
  const hidden = g.nodes.length - filterByStrength(g.nodes, g.edges, 2).nodes.length;
  expect(hidden).toBeGreaterThan(0);

  await page.goto(`./${pathFor(COUNTRY, GENDER)}`);
  // Nothing is filtered yet, so there is nothing to explain.
  await expect(page.locator('.key.filtered')).toHaveCount(0);

  await threshold(page, 2).click();
  // The count is the whole point of the line: a graph that has silently lost
  // a third of its players looks like a graph, not like a filtered one.
  await expect(page.locator('.key.filtered')).toContainText(hidden.toLocaleString('en-US'));
  await expect(page.locator('.key.filtered')).toContainText('2+ events together');
});

test('a threshold nothing reaches explains itself instead of drawing nothing', async ({ page }) => {
  // Small federations mostly have one-off pairings, so 10+ empties them
  // completely — the state where an empty <svg> and a broken page look alike.
  const small = manifest().countries.find((c) => {
    const counts = c.genders.M;
    if (!counts || counts.nodes < 2 || counts.nodes > 40) return false;
    return graph(c.code, 'M').edges.every((e) => e.t < 10);
  });
  expect(small, 'no small slice is emptied by the 10+ threshold').toBeTruthy();

  await page.goto(`./${pathFor(small!.code, 'M')}`);
  await threshold(page, 10).click();

  await expect(page.locator('.graph-empty')).toContainText('No partnership here reaches 10');
  await expect(page.locator('[data-node]')).toHaveCount(0);
  await expect(page.locator('.table-view .empty')).toBeVisible();
});

test('searching for a hidden player reveals them and says so', async ({ page }) => {
  const g = graph(COUNTRY, GENDER);
  const visible = new Set(filterByStrength(g.nodes, g.edges, 10).nodes.map((n) => n.id));
  // Someone the threshold hides, picked as the busiest such player so the
  // search box ranks them first for their own name.
  const hiddenPlayer = [...g.nodes]
    .filter((n) => !visible.has(n.id))
    .sort((a, b) => b.tournaments - a.tournaments)[0];
  expect(hiddenPlayer, 'the 10+ threshold hides nobody in this slice').toBeTruthy();

  await page.goto(`./${pathFor(COUNTRY, GENDER)}`);
  await threshold(page, 10).click();
  await expect(page.locator('.table-view tbody tr')).toHaveCount(visible.size);

  const input = page.getByPlaceholder('Start typing a name…');
  await input.click();
  await input.fill(hiddenPlayer!.name);
  await expect(page.locator('.player-search-results .result').first()).toBeVisible();
  await input.press('Enter');

  // Searching the *visible* set would have answered "no players match" for
  // someone who is in this country's data and merely filtered out —
  // indistinguishable from a typo. So the player opens...
  await expect(page.locator('.player-card h2')).toHaveText(hiddenPlayer!.name);
  // ...and the threshold drops back to All, with the control moving to match,
  // so the reader can see why the graph just refilled.
  await expect(threshold(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(threshold(page, 10)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.table-view tbody tr')).toHaveCount(g.nodes.length);
});

test('the player card lists only partnerships the threshold kept', async ({ page }) => {
  const g = graph(COUNTRY, GENDER);
  const kept = filterByStrength(g.nodes, g.edges, 5);
  // A player whose partner list the threshold actually thins.
  const target = kept.nodes.find((n) => {
    const all = g.edges.filter((e) => e.a === n.id || e.b === n.id).length;
    return all > kept.edges.filter((e) => e.a === n.id || e.b === n.id).length;
  });
  expect(target, 'the 5+ threshold thins nobody’s partner list').toBeTruthy();

  await page.goto(`./${pathFor(COUNTRY, GENDER)}?min=5&player=${target!.id}`);
  const card = page.locator('.player-card');
  await expect(card).toBeVisible();

  const expectedRows = kept.edges.filter((e) => e.a === target!.id || e.b === target!.id).length;
  await expect(card.locator('.partners > ul > li')).toHaveCount(expectedRows);

  // The vitals describe the player, not the filtered graph: a career total
  // that moved with the slider would be reporting a different fact.
  await expect(
    card.locator('.vitals div', { has: page.getByText('Tournaments', { exact: true }) }).locator('dd'),
  ).toHaveText(String(target!.tournaments));
});
