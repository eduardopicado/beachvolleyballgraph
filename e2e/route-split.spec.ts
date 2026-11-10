/**
 * Each page type downloads its own code, and the code it needs is already on
 * its way before the entry asks for it.
 *
 * The first half is the point of the split: a tournament page used to fetch
 * the whole graph — force layout, table, player card — to draw a list of
 * teams. The second half is what the split costs if the prerenderer forgets
 * it: `main.tsx` only imports a page once it has read the address, so a page
 * chunk nobody preloaded starts downloading a round trip late.
 *
 * The stylesheet is deliberately not split (see vite.config.ts), so every page
 * still carries exactly one.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';

const DIST = path.resolve(import.meta.dirname, '../dist');
const tournament = readdirSync(path.join(DIST, 'tournament'))[0]!;

const PAGES = [
  { name: 'the graph', url: './', chunk: 'App' },
  { name: 'a tournament', url: `./tournament/${tournament}/`, chunk: 'TournamentRoute' },
  { name: 'the tournament index', url: './tournaments/', chunk: 'TournamentIndexRoute' },
  { name: 'the records page', url: './records/', chunk: 'RecordsRoute' },
] as const;

const CHUNKS: readonly string[] = PAGES.map((p) => p.chunk);
const chunkOf = (url: string) => /\/assets\/([A-Za-z]+)-[\w-]+\.js$/.exec(url)?.[1] ?? null;

for (const page of PAGES) {
  test(`${page.name} downloads its own page and no other`, async ({ page: tab }) => {
    const pages = new Set<string>();
    tab.on('request', (r) => {
      const chunk = chunkOf(r.url());
      if (chunk && CHUNKS.includes(chunk)) pages.add(chunk);
    });
    await tab.goto(page.url);
    await tab.waitForLoadState('networkidle');
    expect([...pages]).toEqual([page.chunk]);
  });
}

test.describe('the static head', () => {
  // What the HTML says before any script runs.
  test.use({ javaScriptEnabled: false });

  for (const page of PAGES) {
    test(`${page.name} preloads its chunk and carries one stylesheet`, async ({ page: tab }) => {
      await tab.goto(page.url);
      await expect(tab.locator(`link[rel="modulepreload"][href*="/assets/${page.chunk}-"]`)).toHaveCount(1);
      // No other page's chunk rides along.
      for (const other of CHUNKS.filter((c) => c !== page.chunk)) {
        await expect(tab.locator(`link[rel="modulepreload"][href*="/assets/${other}-"]`)).toHaveCount(0);
      }
      await expect(tab.locator('link[rel="stylesheet"]')).toHaveCount(1);
    });
  }
});
