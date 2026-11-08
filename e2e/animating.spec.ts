/**
 * The graph while its layout is still moving.
 *
 * For the first few seconds after it loads, and after a filter change or a
 * re-tangle, the layout animates and the auto-fit writes each framing straight
 * to the DOM, leaving React's own copy of the view where it was before. The
 * hit test, the tooltip and pan and zoom read that copy, so a tap on a visible
 * player landed against the identity view and opened nobody, and zooming
 * snapped the graph back to a 1:1 view of a corner of it.
 *
 * Every other pointer test waits for the layout to settle (see `settled` in
 * pointer.spec.ts), which is why none of them saw it. These pause the page's
 * clock mid-animation instead.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import type { Page } from '@playwright/test';
import { sliceSlug } from '../shared/slug.js';
import { DEFAULT_COUNTRY, DEFAULT_GENDER } from '../shared/site.js';

/** Load the default graph and stop its clock a moment into the animation. */
async function pausedMidAnimation(page: Page) {
  await page.clock.install();
  const country = manifest().countries.find((c) => c.code === DEFAULT_COUNTRY)!;
  await page.goto(`./${sliceSlug(country.name, DEFAULT_GENDER)}/`);
  await expect(page.locator('[data-node]').first()).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 400);
  await page.locator('.graph-wrap').scrollIntoViewIfNeeded();
  // Guard the guard: labels are picked when the layout stops, so none yet
  // means it is still moving, and the test is testing what it says.
  await expect(page.locator('.labels .label')).toHaveCount(0);
}

/** The scale of the view group as drawn. */
async function drawnScale(page: Page) {
  const attr = await page.locator('svg.graph > g[transform]').first().getAttribute('transform');
  const k = /scale\(([\d.e-]+)\)/.exec(attr ?? '')?.[1];
  if (!k) throw new Error(`no scale in ${attr}`);
  return Number(k);
}

test('a tap on a player opens them while the layout is still moving', async ({ page }) => {
  await pausedMidAnimation(page);
  const busiest = [...graph(DEFAULT_COUNTRY, DEFAULT_GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
  // The framing is a real one, not the identity: otherwise a stale view would
  // hit-test correctly by accident and this would test nothing.
  expect(await drawnScale(page)).not.toBe(1);

  const box = (await page.locator(`[data-node="${busiest.id}"] .dot`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.player-card').getByRole('heading', { name: busiest.name })).toBeVisible();
});

test('zooming in while the layout moves zooms the view on screen', async ({ page }) => {
  await pausedMidAnimation(page);
  const before = await drawnScale(page);
  expect(before).not.toBe(1);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => drawnScale(page)).toBeCloseTo(before * 1.35, 3);
});
