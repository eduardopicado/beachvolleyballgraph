/**
 * FIVB's tournament photographs: absent from a build without the switch, and
 * working in a build with it.
 *
 * Which half runs depends on what was built. `ingest/photos.ts` creates
 * `dist/v1/photos/` only under `TOURNAMENT_PHOTOS=1`, so CI — which builds
 * without it — checks that nothing shipped, and a local flagged build checks
 * the strip itself.
 *
 * The first half is the one that matters until FIVB answers. The photographs
 * are theirs, and "hidden" is not the bar: a reader of the bundle must not be
 * able to find the strip, its stylesheet or the address of a photo file,
 * because none of them may be in it at all.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import type { TournamentPageFacts } from '../shared/schema.js';

const DIST = path.resolve(import.meta.dirname, '../dist');
const flagged = existsSync(path.join(DIST, 'v1', 'photos'));

function factsOf(slug: string): TournamentPageFacts {
  const html = readFileSync(path.join(DIST, 'tournament', slug, 'index.html'), 'utf8');
  const json = /<script type="application\/json" id="tournament-facts">([^<]*)<\/script>/.exec(html)?.[1];
  if (!json) throw new Error(`no facts on ${slug}`);
  return JSON.parse(json) as TournamentPageFacts;
}

const slugs = readdirSync(path.join(DIST, 'tournament'));

test.describe('a build without the switch', () => {
  test.skip(flagged, 'built with TOURNAMENT_PHOTOS=1');

  test('ships no photo code, style or address', () => {
    const assets = readdirSync(path.join(DIST, 'assets'));
    expect(assets.filter((f) => /photo/i.test(f))).toEqual([]);
    for (const file of assets.filter((f) => /\.(js|css)$/.test(f))) {
      const text = readFileSync(path.join(DIST, 'assets', file), 'utf8');
      // The photo file's address, the image service's photo form (the
      // portrait form, `GetImage?Type=Player`, is a different feature), and
      // the strip's own class names.
      for (const needle of ['/photos/', 'GetImage?No=', 'photo-strip', 'photo-viewer']) {
        expect(text.includes(needle), `${needle} in ${file}`).toBe(false);
      }
    }
  });

  test('tells no page it has photographs', () => {
    for (const slug of slugs) expect(factsOf(slug), slug).not.toHaveProperty('photos');
  });

  test('draws no strip', async ({ page }) => {
    const played = slugs.find((s) => factsOf(s).played)!;
    await page.goto(`./tournament/${played}/`);
    await expect(page.locator('.tournament-page h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.photo-strip')).toHaveCount(0);
  });
});

test.describe('a build with the switch', () => {
  test.skip(!flagged, 'built without TOURNAMENT_PHOTOS=1');

  const withPhotos = slugs.find((s) => (factsOf(s).photos ?? 0) > 1);
  const without = slugs.find((s) => !factsOf(s).photos);

  test('shows the strip, and the viewer opens, steps and closes', async ({ page }) => {
    test.skip(!withPhotos, 'no tournament with photographs');
    const { photos: count } = factsOf(withPhotos!);
    await page.goto(`./tournament/${withPhotos}/`);

    const strip = page.locator('.photo-strip');
    await expect(strip.locator('li button')).toHaveCount(count!);
    await expect(strip.locator('.photo-credit')).toContainText(count!.toLocaleString('en-US'));
    // Between the heading and the results.
    const order = await page.evaluate(() => {
      const header = document.querySelector('.tournament-page > header')!;
      return header.nextElementSibling?.classList.contains('photo-strip');
    });
    expect(order).toBe(true);

    const first = strip.locator('li button').first();
    await first.click();
    const viewer = page.getByRole('dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.photo-meta')).toContainText(`1 of ${count}`);
    await expect(viewer.getByRole('button', { name: 'Close photograph' })).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(viewer.locator('.photo-meta')).toContainText(`2 of ${count}`);
    await page.keyboard.press('ArrowLeft');
    await expect(viewer.locator('.photo-meta')).toContainText(`1 of ${count}`);
    await expect(viewer.getByRole('button', { name: '← Previous' })).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(first).toBeFocused();

    // A click beside the photograph is backdrop.
    await first.click();
    await page.mouse.click(4, 4);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a page without photographs never asks for a file', async ({ page }) => {
    test.skip(!without, 'every tournament has photographs');
    const asked: string[] = [];
    page.on('request', (r) => r.url().includes('/photos/') && asked.push(r.url()));
    await page.goto(`./tournament/${without}/`);
    await expect(page.locator('.tournament-page h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(asked).toEqual([]);
    await expect(page.locator('.photo-strip')).toHaveCount(0);
  });
});
