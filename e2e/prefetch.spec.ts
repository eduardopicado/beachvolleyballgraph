/**
 * Starting a portrait on hover, before the reader clicks.
 *
 * `lib/prefetchPortrait.test.ts` pins the module in isolation — one request per
 * player, card width, low priority. What it cannot see is whether anything
 * calls it, and whether the URL it warms is the URL the card then asks for.
 * Both are the whole point: a prefetch of a width the card never requests is a
 * second download dressed as an optimisation, and it would pass every unit
 * test in the file.
 *
 * So these assert against the real page, and the last assertion in each test
 * compares the hovered URL with the `src` the card actually renders rather
 * than with a constant. `Avatar`'s width is a prop at the call site; nothing
 * else would notice it changing.
 *
 * The fixture stubs FIVB's host, so what is measured here is which requests
 * the page *makes*, never how long they take.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

/** Portrait requests as they are made, in order. */
function watchPortraits(page: import('@playwright/test').Page) {
  const urls: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'image' && req.url().includes('sharp.fivb.com'))
      urls.push(req.url());
  });
  return urls;
}

/** Requests naming one player, whichever width they asked for. */
const forPlayer = (urls: readonly string[], id: number) =>
  urls.filter((u) => u.includes(`No=${id}&`));

/**
 * Wait for the simulation to stop and bring the canvas on screen.
 *
 * Same reasoning as `pointer.spec.ts`: geometry measured mid-run measures the
 * warm-up, and a pointer moved to a point below the fold dispatches nothing —
 * which reads exactly like a prefetch that did not fire.
 */
async function settled(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-node]').first()).toBeVisible();
  await expect(page.locator('.labels .label').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('.graph-wrap').scrollIntoViewIfNeeded();
}

/** The busiest player in the slice — biggest mark, so the surest to hover. */
function subject() {
  const node = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0];
  if (!node) throw new Error(`${COUNTRY}-${GENDER} has no players`);
  return node;
}

async function nodeCentre(page: import('@playwright/test').Page, id: number) {
  const box = await page.locator(`[data-node="${id}"] .dot`).boundingBox();
  if (!box) throw new Error(`node ${id} has no box`);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const view = page.viewportSize()!;
  expect(centre.y, 'node is off-screen, so the hover would dispatch nothing').toBeLessThan(
    view.height,
  );
  expect(centre.y).toBeGreaterThan(0);
  return centre;
}

test('hovering a node starts that player’s portrait before the click', async ({ page }) => {
  const node = subject();
  const urls = watchPortraits(page);
  await page.goto(`./${slicePath()}`);
  await settled(page);

  const centre = await nodeCentre(page, node.id);
  expect(forPlayer(urls, node.id), 'nothing should have asked for this player yet').toHaveLength(0);

  // Two moves: the first can land before the handler is listening, and the hit
  // test runs on movement rather than on arrival.
  await page.mouse.move(centre.x - 3, centre.y - 3);
  await page.mouse.move(centre.x, centre.y);
  await expect
    .poll(() => forPlayer(urls, node.id).length, {
      message: 'hover started no portrait',
    })
    .toBe(1);
  const prefetched = forPlayer(urls, node.id)[0]!;

  await page.mouse.click(centre.x, centre.y);
  const photo = page.locator('.player-card .player-photo img');
  await expect(photo).toHaveAttribute('src', prefetched);
});

test('hovering a table row starts it too', async ({ page }) => {
  const urls = watchPortraits(page);
  await page.goto(`./${slicePath()}`);
  await expect(page.locator('.table-view tbody tr').first()).toBeVisible();

  const row = page.locator('.table-view tbody tr').first();
  const name = (await row.locator('td').first().innerText()).trim();
  const id = graph(COUNTRY, GENDER).nodes.find((n) => n.name === name)?.id;
  expect(id, `no published player named ${name}`).toBeDefined();

  expect(forPlayer(urls, id!)).toHaveLength(0);
  await row.hover();
  await expect.poll(() => forPlayer(urls, id!).length).toBe(1);
  const prefetched = forPlayer(urls, id!)[0]!;

  await row.click();
  await expect(page.locator('.player-card .player-photo img')).toHaveAttribute('src', prefetched);
});

test('tabbing onto a row starts it, where there is no hover at all', async ({ page }) => {
  const urls = watchPortraits(page);
  await page.goto(`./${slicePath()}`);
  await expect(page.locator('.table-view tbody tr').first()).toBeVisible();

  const row = page.locator('.table-view tbody tr').first();
  const name = (await row.locator('td').first().innerText()).trim();
  const id = graph(COUNTRY, GENDER).nodes.find((n) => n.name === name)?.id;
  expect(id, `no published player named ${name}`).toBeDefined();

  // `focus()` rather than tabbing from the top of the page: how many stops
  // separate the header from the first row is a fact about the whole layout,
  // and this is testing the row's own handler.
  await row.focus();
  await expect.poll(() => forPlayer(urls, id!).length).toBe(1);
  await row.press('Enter');
  await expect(page.locator('.player-card .player-photo img')).toHaveAttribute(
    'src',
    forPlayer(urls, id!)[0]!,
  );
});

test('crossing the same node again does not ask again', async ({ page }) => {
  const node = subject();
  const urls = watchPortraits(page);
  await page.goto(`./${slicePath()}`);
  await settled(page);

  const centre = await nodeCentre(page, node.id);
  for (let pass = 0; pass < 3; pass++) {
    await page.mouse.move(centre.x - 3, centre.y - 3);
    await page.mouse.move(centre.x, centre.y);
    // Off the node and back on, which is what a pointer crossing a dense
    // cluster does several times a second.
    await page.mouse.move(centre.x + 160, centre.y + 120);
  }

  await expect.poll(() => forPlayer(urls, node.id).length).toBe(1);
});

test('sweeping across the graph starts only where the pointer stops', async ({ page }) => {
  // The reason the dwell exists. USA-W is the largest slice at 423 players, and
  // before the dwell a pointer dragged across a graph asked for every node it
  // passed over — measured at 5.8 KB expected per node (52.5% of players have
  // no photo and 404 at nothing, the rest average 12.3 KB), so 2.4 MB against
  // the 611 KB the page loads in total.
  const urls = watchPortraits(page);
  await page.goto(`./${slicePath()}`);
  await settled(page);

  const box = (await page.locator('.graph-wrap').boundingBox())!;
  const y = box.y + box.height / 2;
  // Straight across the middle at roughly a real drag speed: 30 moves, no
  // pause anywhere. Whatever it crosses, it never stops on.
  for (let i = 0; i <= 30; i++) {
    await page.mouse.move(box.x + 4 + (i * (box.width - 8)) / 30, y);
  }
  // Off the canvas, so nothing is left mid-dwell when the assertion runs.
  await page.mouse.move(box.x + box.width / 2, box.y - 40);

  // Not `toBe(0)`: the sweep can legitimately end a frame on a node and rest
  // there while the loop awaits the next move. The claim is that a sweep costs
  // a handful of requests rather than one per node crossed.
  const crossed = await page.locator('[data-node]').count();
  expect(urls.length, `swept a graph of ${crossed} nodes`).toBeLessThan(5);
});
