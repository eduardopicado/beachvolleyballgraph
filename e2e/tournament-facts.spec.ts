/**
 * A tournament page reads its own facts from its HTML instead of fetching the
 * whole tournament index and the manifest to find them.
 *
 * Both halves are tested: with the facts, neither file is requested; without
 * them (a page cached from before they existed, or the dev server), the page
 * falls back to the fetch and draws the same thing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import type { TournamentPageFacts } from '../shared/schema.js';

const DIST = path.resolve(import.meta.dirname, '../dist');

function factsOf(slug: string): TournamentPageFacts {
  const html = readFileSync(path.join(DIST, 'tournament', slug, 'index.html'), 'utf8');
  const json = /<script type="application\/json" id="tournament-facts">([^<]*)<\/script>/.exec(html)?.[1];
  if (!json) throw new Error(`no facts on ${slug}`);
  return JSON.parse(json) as TournamentPageFacts;
}

/** A played event with a counterpart draw, and an unplayed one: the two shapes of page. */
const slugs = readdirSync(path.join(DIST, 'tournament'));
const played = slugs.find((s) => {
  const f = factsOf(s);
  return f.played && f.counterpart !== null;
})!;
const upcoming = slugs.find((s) => !factsOf(s).played)!;

/** Every `/v1/` path the page asks for, from the moment it starts. */
function track(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (pathname.includes('/v1/')) asked.push(pathname.slice(pathname.indexOf('/v1/') + 4));
  });
  return asked;
}

for (const [kind, slug, file] of [
  ['a played tournament', played, 'classifications'],
  ['a tournament still to come', upcoming, 'entries'],
] as const) {
  test(`${kind} asks for its own field and neither index`, async ({ page }) => {
    const asked = track(page);
    await page.goto(`./tournament/${slug}/`);
    await expect(page.locator('.tournament-page h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const facts = factsOf(slug);
    expect(asked).toContain(`${file}/${facts.code}.json`);
    expect(asked).not.toContain('tournaments.json');
    expect(asked).not.toContain('manifest.json');
  });
}

test('without the facts, the page fetches the index and draws the same page', async ({ page }) => {
  const main = page.locator('.tournament-page');
  const firstPlayer = main.locator('button', { hasText: /\S/ }).filter({ hasNotText: /^(Men|Women)$/ }).first();

  /** Everything the reader sees, flags included, and where the first name leads. */
  const capture = async () => {
    await expect(main.locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const text = await main.innerText();
    await firstPlayer.click();
    await page.waitForURL((url) => !url.pathname.includes('/tournament/'));
    return { text, leadsTo: new URL(page.url()).pathname + new URL(page.url()).search };
  };

  await page.goto(`./tournament/${played}/`);
  const withFacts = await capture();

  // The same document with the facts element removed.
  await page.route(`**/tournament/${played}/`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<script type="application\/json" id="tournament-facts">[^<]*<\/script>/, '');
    expect(html).not.toContain('tournament-facts');
    await route.fulfill({ response, body: html });
  });
  const asked = track(page);
  await page.goto(`./tournament/${played}/`);
  const withoutFacts = await capture();

  expect(asked).toContain('tournaments.json');
  expect(asked).toContain('manifest.json');
  expect(withoutFacts).toEqual(withFacts);
});
