/**
 * How the graph frames itself when something other than the reader moves it.
 *
 * **A relayout with a player selected ends with that player in the middle.**

 * "Re-tangle" (and any filter change) builds a new layout and restarts the
 * simulation. The pan-to-selection effect has to wait until the new layout has
 * settled: centring on a half-run simulation puts the player where they were
 * after the warm-up ticks, not where the simulation leaves them, and claiming
 * the view that early also skips the fit the new layout gets when it stops.
 *
 * It did not wait. `settled` was reset by an effect, so the render that
 * started the new layout still read `true` from the old one, and the
 * pan-to-selection effect in that same commit took the view straight away.
 *
 * **A resize re-frames a graph nobody has moved** — and only that. The fit is
 * for the size the canvas had when the simulation stopped; narrowing the window
 * without re-fitting leaves part of the graph past the edge. But once the
 * reader has panned or zoomed, the view is theirs, and a resize that snapped it
 * back would undo what they did.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

test('re-tangling with a player selected centres them once the new layout settles', async ({ page }) => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY)!;
  const node = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
  await page.goto(`./${sliceSlug(entry.name, GENDER)}/?player=${node.id}`);
  await expect(page.locator('.labels .label').first()).toBeVisible({ timeout: 30_000 });

  /** How far the selected player's mark is from the middle of the canvas, in px. */
  const offCentre = async () => {
    const dot = await page.locator(`[data-node="${node.id}"] .dot`).boundingBox();
    const view = await page.locator('.graph-wrap svg').first().boundingBox();
    if (!dot || !view) return Infinity;
    return Math.hypot(
      dot.x + dot.width / 2 - (view.x + view.width / 2),
      dot.y + dot.height / 2 - (view.y + view.height / 2),
    );
  };

  // The shared link's own centring, as a baseline: the same check passes here
  // before the relayout, so a failure below is about the relayout.
  await expect.poll(offCentre, { timeout: 15_000 }).toBeLessThan(2);

  await page.getByRole('button', { name: 'Re-tangle' }).click();
  // Long enough for the restarted simulation to run out; then the player has
  // to be in the middle and stay there.
  await page.waitForTimeout(6_000);
  await expect.poll(offCentre, { timeout: 15_000 }).toBeLessThan(2);
});

test('narrowing the window re-frames a graph the reader has not moved', async ({ page }) => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY)!;
  await page.goto(`./${sliceSlug(entry.name, GENDER)}/`);
  await expect(page.locator('.labels .label').first()).toBeVisible({ timeout: 30_000 });

  /** Marks whose centre lies outside the canvas, with a pixel of slack. */
  const outside = () =>
    page.evaluate(() => {
      const view = document.querySelector('.graph-wrap svg')!.getBoundingClientRect();
      return [...document.querySelectorAll('[data-node] .dot')].filter((dot) => {
        const r = dot.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        return x < view.left - 1 || x > view.right + 1 || y < view.top - 1 || y > view.bottom + 1;
      }).length;
    });

  expect(await outside(), 'the first fit should already hold every node').toBe(0);
  const before = page.viewportSize()!;
  await page.setViewportSize({ width: Math.round(before.width * 0.6), height: before.height });
  await expect.poll(outside, { timeout: 10_000 }).toBe(0);
});

test('narrowing the window leaves a graph the reader has panned where they put it', async ({ page }) => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY)!;
  const node = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
  await page.goto(`./${sliceSlug(entry.name, GENDER)}/`);
  await expect(page.locator('.labels .label').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.graph-wrap').scrollIntoViewIfNeeded();

  // A drag from a corner, which is empty canvas: the graph is fitted inside a
  // margin, so nothing is drawn there.
  const view = (await page.locator('.graph-wrap svg').first().boundingBox())!;
  await page.mouse.move(view.x + 6, view.y + 6);
  await page.mouse.down();
  await page.mouse.move(view.x + 66, view.y + 46, { steps: 5 });
  await page.mouse.up();

  /** The player's mark relative to the canvas's top-left, which is what the view transform decides. */
  const placed = async () => {
    const dot = (await page.locator(`[data-node="${node.id}"] .dot`).boundingBox())!;
    const svg = (await page.locator('.graph-wrap svg').first().boundingBox())!;
    return { x: dot.x - svg.x, y: dot.y - svg.y };
  };
  const panned = await placed();

  const before = page.viewportSize()!;
  await page.setViewportSize({ width: Math.round(before.width * 0.6), height: before.height });
  // Give the resize observer its turn, then the view must not have moved.
  await page.waitForTimeout(500);
  const after = await placed();
  expect(Math.abs(after.x - panned.x)).toBeLessThan(1);
  expect(Math.abs(after.y - panned.y)).toBeLessThan(1);
});
