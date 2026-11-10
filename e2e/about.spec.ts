/**
 * `/about/`, as built: the figures, the season chart and the legend, each
 * checked against the data it is drawn from.
 *
 * The page's mechanism — a standalone document the app never boots over, the
 * contact address, the way back — is covered in smoke.spec.ts. What is tested
 * here is that the numbers are the archive's and the drawing is to scale.
 */

import { test, expect, manifest, graph, tournamentIndex } from './fixtures.js';
import { DEFAULT_COUNTRY, DEFAULT_GENDER } from '../shared/site.js';
import { MAX_RADIUS } from '../web/src/graph/layout.js';

const n = (v: number) => v.toLocaleString('en-US');

test('leads with the figures the data has', async ({ page }) => {
  await page.goto('./about/');
  const m = manifest();
  const seasons = new Set(
    Object.values(tournamentIndex())
      .filter((row) => row[4] && !m.withoutField?.includes(row[4]))
      .map((row) => row[1]),
  );
  const tiles = page.locator('.about-figures > div');
  await expect(tiles.locator('dt')).toHaveText(['Players', 'Partnerships', 'Tournaments', 'Federations', 'Seasons']);
  await expect(tiles.locator('dd')).toHaveText([
    n(m.totals.players),
    n(m.totals.partnerships),
    n(m.totals.tournaments),
    n(m.countries.length),
    n(seasons.size),
  ]);
});

test('draws a bar per season, the busiest at the chart’s full height', async ({ page }) => {
  await page.goto('./about/');
  const perSeason = new Map<number, number>();
  for (const row of Object.values(tournamentIndex())) perSeason.set(row[1], (perSeason.get(row[1]) ?? 0) + 1);
  const first = Math.min(...perSeason.keys());
  const last = Math.max(...perSeason.keys());

  const bars = page.locator('.season-bars .season');
  await expect(bars).toHaveCount(last - first + 1);

  const peak = Math.max(...perSeason.values());
  const busiestSeason = [...perSeason].find(([, count]) => count === peak)![0];
  const drawn = await page.evaluate((i) => {
    const bars = document.querySelectorAll('.season-bars .season');
    const chart = document.querySelector('.season-bars')!.getBoundingClientRect().height;
    const bar = [...bars[i]!.children].reduce((sum, part) => sum + part.getBoundingClientRect().height, 0);
    return { chart, bar };
  }, busiestSeason - first);
  // The chart's bottom border is the baseline, inside its box.
  expect(Math.abs(drawn.bar - (drawn.chart - 1))).toBeLessThanOrEqual(1);
});

test('draws the legend at the opening graph’s own scale', async ({ page }) => {
  await page.goto('./about/');
  const g = graph(DEFAULT_COUNTRY, DEFAULT_GENDER);
  const busiest = Math.max(...g.nodes.map((node) => node.tournaments));
  const longest = Math.max(...g.edges.map((edge) => edge.t));

  const dots = page.locator('.legend li:has(.dot)');
  await expect(dots.last()).toHaveText(n(busiest));
  // The graph's largest player is drawn at MAX_RADIUS, here as in the graph.
  const box = await dots.last().locator('.dot').boundingBox();
  expect(box?.width).toBeCloseTo(2 * MAX_RADIUS, 0);

  const lines = page.locator('.legend li:has(.line)');
  await expect(lines.last()).toHaveText(n(longest));
  const line = await lines.last().locator('.line').boundingBox();
  expect(line?.height).toBeCloseTo(6, 0);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844, columns: 1 },
  { name: 'desktop', width: 1280, height: 900, columns: 2 },
]) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('lays out without scrolling sideways', async ({ page }) => {
      await page.goto('./about/');
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const cards = [...document.querySelectorAll('.about-cards > section')];
        return {
          sideways: doc.scrollWidth - doc.clientWidth,
          columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
        };
      });
      expect(m.sideways, 'the page scrolls sideways').toBeLessThanOrEqual(1);
      expect(m.columns).toBe(viewport.columns);
    });
  });
}
