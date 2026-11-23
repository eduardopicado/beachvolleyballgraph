/**
 * The graph comes before the figures, not after them.
 *
 * It used to sit under the intro, six "Start here" cards, the filters and
 * seven stat tiles. On a phone it began 1,602px down the home page, two and a
 * half screens; on a 1366x657 laptop window none of it was on the first
 * screen. The owner chose "graph first" from the mockup: the filters, then
 * the graph, then the figures and the strip.
 */

import { test, expect } from './fixtures.js';

async function graphTop(page: import('@playwright/test').Page) {
  await expect(page.locator('.graph-wrap')).toBeVisible();
  return page.evaluate(() => {
    const g = document.querySelector('.graph-wrap')!.getBoundingClientRect();
    return { top: Math.round(g.top + window.scrollY), height: Math.round(g.height), screen: window.innerHeight };
  });
}

test('the graph comes before the stat tiles and the Explore strip', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.start-here')).toBeVisible();
  const order = await page.evaluate(() => {
    const at = (s: string) => document.querySelector(s)!;
    const before = (a: string, b: string) =>
      Boolean(at(a).compareDocumentPosition(at(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      tiles: before('.graph-section', '.stat-tiles'),
      strip: before('.graph-section', '.start-here'),
      table: before('.start-here', '.table-section'),
    };
  });
  expect(order).toEqual({ tiles: true, strip: true, table: true });
});

test.describe('on a small laptop window', () => {
  // A 1366x768 screen less the browser's own bars.
  test.use({ viewport: { width: 1366, height: 657 } });

  test('most of the graph is on the first screen', async ({ page }) => {
    await page.goto('./');
    const g = await graphTop(page);
    // Measured: 362 of its 420px. In the old order, none of it.
    expect(g.screen - g.top, 'graph pixels on the first screen').toBeGreaterThanOrEqual(g.height / 2);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test('the graph starts within the second screen', async ({ page }) => {
    await page.goto('./');
    const g = await graphTop(page);
    // Measured: 732px against a 664px screen. In the old order, 1,602px.
    expect(g.top).toBeLessThan(g.screen * 1.5);
  });
});
