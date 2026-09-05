/**
 * The player card's portrait, in the three states it can actually be in.
 *
 * FIVB has no photo on file for a large share of the archive, so "missing" is
 * the ordinary case here rather than the edge one — and because the image is
 * fetched from a third party at read time, "not here yet" is a state a reader
 * spends real seconds in. The component used to model both as "not failed",
 * which drew an empty circle over a live zoom-in trigger: no initials at the
 * zoom levels where the browser deferred the request, and a lightbox that
 * opened onto a portrait that does not exist.
 *
 * Each state is driven by stubbing FIVB's host, so this asserts the card's
 * behaviour rather than the archive's contents — which player has a photo is
 * upstream data and changes without notice.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';
import { initials } from '../web/src/lib/format.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

/** The slice's busiest player — any published one would do. */
function subject() {
  const node = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0];
  if (!node) throw new Error(`${COUNTRY}-${GENDER} has no players`);
  return node;
}

/** FIVB's portrait host, stubbed per test over the fixture's blanket route. */
const PHOTOS = '**://sharp.fivb.com/**';

test.describe('the card’s portrait', () => {
  test('shows initials, and nothing to enlarge, when there is no photo on file', async ({
    page,
  }) => {
    const node = subject();
    await page.route(PHOTOS, (route) => route.fulfill({ status: 404, body: '' }));

    await page.goto(`./${slicePath()}?player=${node.id}`);
    const photo = page.locator('.player-photo');
    await expect(photo).toHaveClass(/is-fallback/);
    await expect(photo).toHaveText(initials(node.name));

    // The whole bug in one assertion: a circle with no portrait behind it must
    // not offer to show one larger.
    await expect(photo.locator('.portrait-trigger')).toHaveCount(0);
    await photo.click();
    await expect(page.locator('.portrait-lightbox')).toHaveCount(0);
  });

  test('shows initials while the portrait is still in flight', async ({ page }) => {
    const node = subject();
    // Held open for the length of the test: this is the state a reader on a
    // slow connection sees, and — because a lazily-loaded image below the fold
    // never starts — the state a deferred portrait stays in permanently.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(PHOTOS, async (route) => {
      await held;
      await route.fulfill({ status: 404, body: '' });
    });

    await page.goto(`./${slicePath()}?player=${node.id}`);
    const photo = page.locator('.player-photo');
    await expect(photo).toHaveText(initials(node.name));
    await expect(photo.locator('.portrait-trigger')).toHaveCount(0);
    release();
  });

  test('enlarges a portrait that loaded, and drops the initials once it has', async ({ page }) => {
    const node = subject();
    // The fixture already serves a stub image for this host, so the portrait
    // loads exactly as a real one does.
    await page.goto(`./${slicePath()}?player=${node.id}`);

    const photo = page.locator('.player-photo');
    const trigger = photo.locator('.portrait-trigger');
    await expect(trigger).toHaveCount(1);
    // The photo covers the initials, so they stop being drawn at all — a
    // loaded circle is a photo and nothing else.
    await expect(photo).toHaveText('');
    await expect(photo).not.toHaveClass(/is-fallback/);

    await trigger.click();
    await expect(page.locator('.portrait-lightbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.portrait-lightbox')).toHaveCount(0);
  });

  test('fetches the card’s portrait rather than deferring it', async ({ page }) => {
    // `loading="lazy"` on the one image the reader just asked for is latency
    // for nothing, and on a card that opens below the fold it is a request the
    // browser may never make.
    const node = subject();
    await page.goto(`./${slicePath()}?player=${node.id}`);
    await expect(page.locator('.player-card')).toBeVisible();
    await expect(page.locator('.player-photo img')).toHaveAttribute('loading', 'eager');
  });
});
