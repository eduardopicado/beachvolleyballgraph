/**
 * The page both hosts serve, with a 404, for an address the site does not
 * have: `404.html`, written by ingest/prerender.ts.
 *
 * Opened by its own name here because `vite preview` answers an unknown path
 * with index.html, as Cloudflare Pages did before this file existed; the
 * status and the fallback are the hosts' business. What is tested is that the
 * page is itself — not the app — and that its ways back go where they say.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, manifest } from './fixtures.js';
import type { RecordsFile } from '../shared/schema.js';

const records = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../web/public/v1/records.json'), 'utf8'),
) as RecordsFile;

test('offers three ways back in, with the figures the data has', async ({ page, baseURL }) => {
  await page.goto('./404.html');
  await expect(page.getByRole('heading', { name: 'Nothing at this address', level: 1 })).toBeVisible();

  const base = new URL('./', baseURL).pathname;
  const m = manifest();
  const ways = page.locator('.ways-back a');
  await expect(ways).toHaveCount(3);
  const expected = [
    [base, m.totals.players, 'The partnership graph'],
    [`${base}tournaments/`, m.totals.tournaments, 'Tournaments'],
    [`${base}records/`, Object.keys(records.categories).length, 'Records'],
  ] as const;
  for (const [i, [href, figure, name]] of expected.entries()) {
    const way = ways.nth(i);
    await expect(way).toHaveAttribute('href', href);
    await expect(way.locator('.figure')).toHaveText(figure.toLocaleString('en-US'));
    await expect(way.locator('.name')).toHaveText(name);
  }
  await expect(page.getByRole('link', { name: 'about this project' })).toHaveAttribute('href', `${base}about/`);
  // Styled by the app's stylesheet: the cards are a grid, not three links in a row of text.
  await expect(page.locator('.ways-back')).toHaveCSS('display', 'grid');
});

test('names the address that was asked for', async ({ page, baseURL }) => {
  await page.goto('./404.html');
  await expect(page.locator('.lede code')).toHaveText(`${new URL('./', baseURL).pathname}404.html`);
});

test('is a standalone document, not the app', async ({ page }) => {
  await page.goto('./404.html');
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  await expect(page.locator('#root')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('still reads, and still offers the ways back', async ({ page }) => {
    await page.goto('./404.html');
    await expect(page.locator('.lede').first()).toContainText('There is no page at this address.');
    await expect(page.locator('.ways-back a')).toHaveCount(3);
  });
});
