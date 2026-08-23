/**
 * Aiming at a node with a pointer.
 *
 * The graph is drawn inside a pan/zoom transform, so anything sized in the
 * layout's own units shrinks with the view. That is correct for the marks and
 * wrong for the target you have to hit to select one: measured before this was
 * fixed, the median tap target on a 390px-wide phone showing Brazil's men was
 * 4.6px of radius — 9.2px across, against Apple's 44px minimum and WCAG
 * 2.5.8's 24px, both of which are stated as widths.
 *
 * `layout.test.ts` pins the geometry in isolation. These check the wiring: that
 * a tap near a node really does open that player, that the same tap does not
 * fire after a drag, and that the reach survives the zoom level the reader
 * actually lands on — which is the part unit tests cannot see, because it
 * depends on the fit the graph chooses for a real slice at a real viewport.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';
import { MIN_TAP_RADIUS } from '../web/src/graph/layout.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const pathFor = (code: string, gender: 'M' | 'W') => {
  const entry = manifest().countries.find((c) => c.code === code);
  if (!entry) throw new Error(`${code} missing from the manifest`);
  return `${sliceSlug(entry.name, gender)}/`;
};

/**
 * Wait for the simulation to stop.
 *
 * While it runs, the view transform is written straight to the DOM every tick
 * and React's copy of it is deliberately not updated — re-rendering ~1,500
 * elements at 60fps is the thing that architecture exists to avoid. Labels are
 * chosen once at the end, from the final transform, so the first label
 * appearing in the label layer is the signal that state and DOM agree again. Anything measuring
 * screen geometry has to wait for it or it measures the warm-up.
 */
async function settled(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-node]').first()).toBeVisible();
  await expect(page.locator('.labels .label').first()).toBeVisible({ timeout: 30_000 });
  // At this width the graph starts around y=1200, well below the fold, and
  // `mouse.click` takes viewport coordinates — so without this every click in
  // this file lands outside the window and dispatches nothing at all. That does
  // not fail loudly: a test asserting something did *not* happen passes
  // perfectly while firing no events whatsoever.
  await page.locator('.graph-wrap').scrollIntoViewIfNeeded();
}

/** Centre of a node's mark, in viewport coordinates, once the layout has settled. */
async function nodeCentre(page: import('@playwright/test').Page, id: number) {
  const box = await page.locator(`[data-node="${id}"] .dot`).boundingBox();
  if (!box) throw new Error(`node ${id} has no box`);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Guard the guard: an off-screen point silently swallows the whole gesture.
  const view = page.viewportSize()!;
  expect(centre.y, 'node is off-screen, so the click would dispatch nothing').toBeLessThan(
    view.height,
  );
  expect(centre.y).toBeGreaterThan(0);
  return centre;
}

/**
 * The node with the most empty space around it, and how much.
 *
 * Found by scanning the rendered positions rather than by name or by degree:
 * which player ends up isolated depends on the force layout and on that week's
 * data, and an offset tap only means anything where no other node is nearer.
 * The first version of this aimed 16px off the busiest player and selected a
 * different one — correctly, by the nearest-centre rule it was meant to be
 * testing.
 */
async function loneliestNode(page: import('@playwright/test').Page) {
  const found = await page.evaluate(() => {
    const centres = [...document.querySelectorAll('.node')].map((n) => {
      const dot = n.querySelector('.dot')!.getBoundingClientRect();
      return {
        id: Number((n as SVGGElement).dataset.node),
        x: dot.x + dot.width / 2,
        y: dot.y + dot.height / 2,
        radius: dot.width / 2,
      };
    });
    let best = null as
      | null
      | { id: number; x: number; y: number; clearance: number; away: { x: number; y: number }; radius: number };
    for (const a of centres) {
      let nearest = Infinity;
      let toward = { x: 1, y: 0 };
      for (const b of centres) {
        if (a.id === b.id) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < nearest) {
          nearest = d;
          toward = { x: (b.x - a.x) / (d || 1), y: (b.y - a.y) / (d || 1) };
        }
      }
      if (!best || nearest > best.clearance) {
        best = { ...a, clearance: nearest, away: { x: -toward.x, y: -toward.y }, radius: a.radius };
      }
    }
    return best;
  });
  if (!found) throw new Error('no nodes rendered');
  return found;
}

/** A point on the canvas with no node near it, for testing a tap on nothing. */
async function emptyPoint(page: import('@playwright/test').Page) {
  const found = await page.evaluate(() => {
    const wrap = document.querySelector('.graph-wrap')!.getBoundingClientRect();
    const centres = [...document.querySelectorAll('.node .dot')].map((d) => {
      const r = d.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    // Clamped to the part of the canvas actually on screen. Selecting a player
    // on a phone scrolls the card into view, which leaves most of the graph
    // above the fold — scanning the full element would happily return a point
    // at y=-375, and the click there dispatches nothing at all.
    const top = Math.max(wrap.top, 0) + 10;
    const bottom = Math.min(wrap.bottom, window.innerHeight) - 10;
    // Selecting also pans the graph to centre the player, so which regions are
    // empty changes after the first tap. Scan rather than assume.
    for (let y = top; y < bottom; y += 12) {
      for (let x = wrap.left + 10; x < wrap.right - 10; x += 12) {
        if (centres.every((c) => Math.hypot(c.x - x, c.y - y) > 60)) return { x, y };
      }
    }
    return null;
  });
  if (!found) throw new Error('no empty canvas on screen to tap');
  return found;
}

test.describe('a phone-sized viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a tap short of a node still selects it', async ({ page }) => {
    await page.goto(pathFor(COUNTRY, GENDER));
    await settled(page);

    const target = await loneliestNode(page);
    // Aim short of the node, away from its nearest neighbour so this one really
    // is the closest centre to the tap. The offset clears the painted dot
    // entirely — on empty pixels, well outside the old 4.6px target — and still
    // lands inside the new reach.
    const offset = MIN_TAP_RADIUS - 6;
    expect(offset, 'the tap has to miss the mark to be testing anything').toBeGreaterThan(
      target.radius,
    );
    await nodeCentre(page, target.id); // on-screen guard
    await page.mouse.click(target.x + target.away.x * offset, target.y + target.away.y * offset);

    const card = page.locator('.player-card');
    await expect(card).toBeVisible();
    const name = graph(COUNTRY, GENDER).nodes.find((n) => n.id === target.id)!.name;
    await expect(card.getByRole('heading', { name })).toBeVisible();
  });

  test('a drag pans instead of selecting whatever it ended on', async ({ page }) => {
    await page.goto(pathFor(COUNTRY, GENDER));
    await settled(page);

    const id = (await loneliestNode(page)).id;
    const centre = await nodeCentre(page, id);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    // Well past TAP_SLOP, in steps so the move handler sees the travel.
    for (let i = 1; i <= 6; i++) await page.mouse.move(centre.x - i * 12, centre.y + i * 5);
    await page.mouse.up();

    await expect(page.locator('.player-card')).toHaveCount(0);
    // …because it panned, not because the gesture went nowhere. Without this
    // the assertion above passes just as well when no event was dispatched at
    // all, which is exactly how this test first "passed".
    const after = await nodeCentre(page, id);
    expect(Math.round(after.x - centre.x)).toBe(-72);
    expect(Math.round(after.y - centre.y)).toBe(30);
  });

  test('tapping empty canvas closes the card', async ({ page }) => {
    await page.goto(pathFor(COUNTRY, GENDER));
    await settled(page);

    const centre = await nodeCentre(page, (await loneliestNode(page)).id);
    await page.mouse.click(centre.x, centre.y);
    await expect(page.locator('.player-card')).toBeVisible();

    const nothing = await emptyPoint(page);
    await page.mouse.click(nothing.x, nothing.y);
    await expect(page.locator('.player-card')).toHaveCount(0);
  });
});

test('the reach survives zooming out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathFor(COUNTRY, GENDER));
  await settled(page);

  // Zoom out past the default fit, which is where the old user-space target
  // shrank to nothing. The reach is resolved in screen pixels, so it should not
  // move at all.
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  await zoomOut.click();
  await zoomOut.click();
  await page.waitForTimeout(300);

  const target = await loneliestNode(page);
  const offset = MIN_TAP_RADIUS - 6;
  expect(offset, 'the tap has to miss the mark to be testing anything').toBeGreaterThan(
    target.radius,
  );
  await page.mouse.click(target.x + target.away.x * offset, target.y + target.away.y * offset);

  const name = graph(COUNTRY, GENDER).nodes.find((n) => n.id === target.id)!.name;
  await expect(page.locator('.player-card').getByRole('heading', { name })).toBeVisible();
});
