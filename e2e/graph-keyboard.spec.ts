/**
 * The graph is one tab stop, and the arrow keys move within it.
 *
 * Every node used to take a Tab of its own. On the Brazilian women's graph
 * that was 198 presses between the filters and the table under the graph, in
 * the order the nodes happen to be drawn, which is no order a reader can see.
 * The unit tests in `web/src/lib/graphNav.test.ts` cover which node an arrow
 * picks; this covers that the keys reach it in a real page.
 */

import { test, expect, graph } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';

const slice = () => sliceSlug('Brazil', 'W');
const players = () => graph('BRA', 'W').nodes;

test.beforeEach(async ({ page }) => {
  await page.goto(`./${slice()}/`);
  await expect(page.locator('[data-node]').first()).toBeVisible();
});

test('one node can be tabbed to, however many are drawn', async ({ page }) => {
  expect(players().length, 'a graph this small proves nothing').toBeGreaterThan(50);
  await expect(page.locator('[data-node]')).toHaveCount(players().length);
  await expect(page.locator('[data-node][tabindex="0"]')).toHaveCount(1);
});

test('Tab enters the graph once and leaves it for the zoom buttons', async ({ page }) => {
  await page.getByRole('button', { name: 'Re-tangle' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the player table' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node]:focus')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node]:focus')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeFocused();
});

test('the arrow keys move between players, and Enter opens the one reached', async ({ page }) => {
  const start = page.locator('[data-node][tabindex="0"]');
  await start.focus();
  const from = await start.getAttribute('data-node');

  // One of the four directions has a neighbour, whichever node the stop is on.
  let reached: string | null = from;
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(key);
    reached = await page.locator('[data-node]:focus').getAttribute('data-node');
    if (reached !== from) break;
  }
  expect(reached, 'no arrow key moved the focus').not.toBe(from);

  // The stop travels with the focus, so Tab out and back returns here.
  await expect(page.locator('[data-node][tabindex="0"]')).toHaveAttribute('data-node', reached!);

  await page.keyboard.press('Enter');
  const name = players().find((p) => String(p.id) === reached)!.name;
  await expect(page.locator('.player-card h2, .player-card h3').first()).toContainText(name.split(' ')[0]!);
});

test.describe('with the whole graph on screen', () => {
  // Tall enough that no node is outside the window: moving focus to one that
  // is would scroll it into view, which is the browser doing its job and not
  // what this is about.
  test.use({ viewport: { width: 1280, height: 1400 } });

  test('an arrow key does not scroll the page from inside the graph', async ({ page }) => {
    await page.locator('svg.graph').scrollIntoViewIfNeeded();
    await page.locator('[data-node][tabindex="0"]').focus();
    const before = await page.evaluate(() => window.scrollY);
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    // And at the bottom edge, where the key has nowhere left to go.
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
});

test('the skip link goes to the player table', async ({ page }) => {
  const skip = page.getByRole('link', { name: 'Skip to the player table' });
  await skip.focus();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#all-players$/);
  await page.keyboard.press('Tab');
  // The next stop is inside the table section, past the graph and its buttons.
  expect(await page.evaluate(() => document.activeElement?.closest('#all-players') !== null)).toBe(true);
});
