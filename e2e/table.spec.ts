/**
 * The sortable "All players" table.
 *
 * Sorting is the kind of thing that breaks without looking broken: a
 * comparator with its direction flipped still renders a full table of real
 * players in a plausible order. Nothing throws, nothing is missing, and the
 * only way to notice is to know what the order should have been.
 *
 * `lib/table.test.ts` pins the comparator; this pins the wiring around it —
 * that the header a reader clicks is the column that sorts, that the arrow and
 * `aria-sort` describe the order actually on screen, and that the table is the
 * accessible twin of the graph rather than a second, differently-filtered view
 * of the data.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import type { SortKey, TableRow } from '../web/src/lib/table.js';
import { sliceSlug } from '../shared/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

/**
 * The published slice as the table sees it: nodes plus their partner counts.
 * `topPartner` is left null — it is never a sort key, so it cannot change the
 * order these tests are checking.
 */
function rowsFromData(): TableRow[] {
  const g = graph(COUNTRY, GENDER);
  const degree = new Map<number, number>();
  for (const e of g.edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  return g.nodes.map((n) => ({ ...n, partners: degree.get(n.id) ?? 0, topPartner: null }));
}

/**
 * The order the table is supposed to be in, written out here rather than
 * imported from `lib/table.ts`.
 *
 * Deliberate duplication: calling the production comparator to produce the
 * expected order would make these tests agree with any comparator at all,
 * including a broken one. This states the intended order independently, so a
 * change to the real one has to be a change someone meant to make.
 */
function expectedOrder(rows: TableRow[], key: SortKey, desc: boolean): string[] {
  const dir = desc ? -1 : 1;
  return [...rows]
    .sort((a, b) => {
      if (key === 'name') return dir * a.name.localeCompare(b.name);
      if (key === 'last') return dir * (a.last - b.last || a.first - b.first);
      // Numeric columns tie-break A–Z, in both directions.
      return dir * (a[key] - b[key]) || a.name.localeCompare(b.name);
    })
    .map((r) => r.name);
}

/** Column header cells, by the label a reader clicks. */
const header = (page: import('@playwright/test').Page, label: string) =>
  page.locator('.table-view th', { has: page.getByRole('button', { name: label, exact: true }) });

const column = (page: import('@playwright/test').Page, index: number) =>
  page.locator(`.table-view tbody tr td:nth-child(${index})`);

test('opens on the busiest careers, and says so in aria-sort', async ({ page }) => {
  await page.goto(`./${slicePath()}`);
  const expected = expectedOrder(rowsFromData(), 'tournaments', true);

  await expect(header(page, 'Tournaments')).toHaveAttribute('aria-sort', 'descending');
  // Only the sorted column is marked: two columns claiming to be the sort is
  // a contradiction a screen reader has no way to resolve.
  await expect(page.locator('.table-view th[aria-sort="descending"]')).toHaveCount(1);
  await expect(page.locator('.table-view th[aria-sort="none"]')).toHaveCount(3);

  // The full order, not just the first row: a first row that happens to be
  // right is exactly what a broken tie-break looks like.
  await expect(column(page, 1)).toHaveText(expected);
});

test('clicking a column sorts by it, and clicking again reverses it', async ({ page }) => {
  await page.goto(`./${slicePath()}`);
  const rows = rowsFromData();

  await header(page, 'Player').getByRole('button').click();
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'ascending');
  await expect(column(page, 1)).toHaveText(expectedOrder(rows, 'name', false));

  await header(page, 'Player').getByRole('button').click();
  await expect(header(page, 'Player')).toHaveAttribute('aria-sort', 'descending');
  await expect(column(page, 1)).toHaveText(expectedOrder(rows, 'name', true));
});

test('every column sorts by the values in its own cells', async ({ page }) => {
  // The failure this rules out is a column header wired to the wrong key —
  // invisible unless you compare the order against the numbers displayed.
  await page.goto(`./${slicePath()}`);

  for (const [label, index] of [
    ['Tournaments', 2],
    ['Partners', 3],
  ] as const) {
    const seen = new Set<string>();
    // Two clicks, whichever direction each lands on — "Tournaments" is
    // already the sort column on load, so the first click reverses it rather
    // than starting it. What is asserted is that the cells match whatever
    // direction the header claims, both times.
    for (let click = 0; click < 2; click++) {
      await header(page, label).getByRole('button').click();
      const dir = await header(page, label).getAttribute('aria-sort');
      seen.add(dir ?? 'none');

      const values = (await column(page, index).allInnerTexts()).map(Number);
      const expected = [...values].sort((a, b) => (dir === 'descending' ? b - a : a - b));
      expect(values, `${label} does not match its own aria-sort=${dir}`).toEqual(expected);
    }
    expect(seen, `${label} did not reverse on the second click`).toEqual(
      new Set(['ascending', 'descending']),
    );
  }
});

test('the arrow points the way the column is actually sorted', async ({ page }) => {
  // aria-sort is for screen readers; the arrow is what everyone else reads.
  // They are set from the same state, and have to stay saying the same thing.
  await page.goto(`./${slicePath()}`);
  const button = header(page, 'Partners').getByRole('button');

  await button.click();
  await expect(button.locator('.arrow')).toHaveText('▾');
  await expect(header(page, 'Partners')).toHaveAttribute('aria-sort', 'descending');

  await button.click();
  await expect(button.locator('.arrow')).toHaveText('▴');
  await expect(header(page, 'Partners')).toHaveAttribute('aria-sort', 'ascending');

  // The arrow belongs to the sorted column alone.
  await expect(page.locator('.table-view th .arrow', { hasText: /[▾▴]/ })).toHaveCount(1);
});

test('sorting reorders the table without changing what is in it', async ({ page }) => {
  const total = graph(COUNTRY, GENDER).nodes.length;
  await page.goto(`./${slicePath()}`);

  await header(page, 'Seasons').getByRole('button').click();
  await expect(page.locator('.table-view tbody tr')).toHaveCount(total);
  // Sorting is a view concern. If it ever shortened the table it would be
  // filtering, and the count above the table would stop matching it.
  await expect(page.locator('.table-section .section-head .muted')).toContainText(
    total.toLocaleString('en-US'),
  );
});

test('a sorted row still opens the player it names', async ({ page }) => {
  // The rows are re-keyed on every sort; a selection wired to the index
  // rather than the id would open the wrong player after one click.
  await page.goto(`./${slicePath()}`);
  await header(page, 'Player').getByRole('button').click();

  const row = page.locator('.table-view tbody tr').nth(3);
  const name = (await row.locator('td').first().innerText()).trim();
  await row.click();

  await expect(page.locator('.player-card h2')).toHaveText(name);
  await expect(row).toHaveClass(/is-selected/);
});
