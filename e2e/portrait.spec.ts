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

  test('opens on the card’s own portrait, then sharpens to the large one', async ({ page }) => {
    /*
     * The point of the whole arrangement: the dialog must never be an empty
     * box while FIVB is answering. The 200px is already in cache — it is the
     * picture the reader clicked — so it is drawn immediately, and the 600px
     * fades over it on arrival.
     *
     * The large request is held open rather than stubbed, because "what is on
     * screen while it is still in flight" is the entire assertion; answer it
     * and there is nothing left to observe.
     */
    const node = subject();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.goto(`./${slicePath()}?player=${node.id}`);
    await page.route(/width=600/, async (route) => {
      await held;
      await route.fallback();
    });

    await page.locator('.player-photo .portrait-trigger').click();
    const lightbox = page.locator('.portrait-lightbox');
    await expect(lightbox).toBeVisible();

    // In flight: the small one is up, at the full width of the box, and the
    // large one is present but not yet shown.
    const shot = lightbox.locator('.portrait-shot');
    await expect(shot).toHaveCount(1);
    await expect(shot).not.toHaveClass(/is-sharp/);
    const placeholder = lightbox.locator('.portrait-lo');
    await expect(placeholder).toHaveAttribute('src', /width=200/);
    const box = await placeholder.boundingBox();
    expect(box, 'the placeholder should be laid out').not.toBeNull();
    expect(box!.width, 'it should fill the box the large one will take').toBeGreaterThan(200);

    // Let FIVB answer.
    release!();
    await expect(shot).toHaveClass(/is-sharp/);
    await expect(lightbox.locator('.portrait-hi')).toHaveAttribute('src', /width=600/);
  });

  test('keeps the card’s own portrait when the large one fails on its own', async ({ page }) => {
    /*
     * The card asks FIVB for 200px and the lightbox for 600 — a second request,
     * which can fail where the first did not. This used to fall back to
     * initials, which threw away a portrait that was on screen and working:
     * the 200px is in cache before the dialog can open, because the trigger is
     * only offered once it has loaded. So the placeholder simply stays, and a
     * reader gets a soft photograph rather than two letters.
     */
    const node = subject();
    await page.goto(`./${slicePath()}?player=${node.id}`);
    // Only the large request fails, so the card's portrait still loads and the
    // trigger is still offered.
    await page.route(/width=600/, (route) => route.fulfill({ status: 404, body: '' }));
    await page.locator('.player-photo .portrait-trigger').click();

    const lightbox = page.locator('.portrait-lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('figcaption')).toContainText(node.name);
    await expect(lightbox.locator('.portrait-missing')).toHaveCount(0);

    // The 200px, left in place and now carrying the description the failed
    // one would have carried.
    const kept = lightbox.locator('.portrait-lo');
    await expect(kept).toHaveCount(1);
    await expect(kept).toHaveAttribute('src', /width=200/);
    await expect(kept).toHaveAttribute('alt', new RegExp(node.name.split(' ')[0]!));
  });

  test('falls back to initials only when both widths fail', async ({ page }) => {
    /*
     * The state the initials exist for, and the only way to reach it. The
     * trigger is offered only once the card's 200px has loaded, and the dialog
     * asks for that same URL — so ordinarily it is served from cache and cannot
     * fail, whatever the network is doing. Both widths only fail together if
     * that cache entry has gone *and* the network has too.
     *
     * So the cache is cleared rather than simulated. Routing the host to 404
     * on its own does not reproduce this: the second request never leaves the
     * browser, the placeholder loads from cache, and the test passes or fails
     * on cache timing — which is exactly how the first version of it passed
     * here and failed on CI.
     *
     * The card's own portrait survives the clear because its element stays
     * mounted with the same `src`; only the dialog, unmounted and remounted,
     * asks again.
     */
    const node = subject();
    await page.goto(`./${slicePath()}?player=${node.id}`);
    await page.locator('.player-photo .portrait-trigger').click();
    const lightbox = page.locator('.portrait-lightbox');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.portrait-lo')).toHaveCount(1);

    await page.route(PHOTOS, (route) => route.fulfill({ status: 404, body: '' }));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');

    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await page.locator('.player-photo .portrait-trigger').click();

    await expect(lightbox.locator('.portrait-missing')).toHaveText(initials(node.name));
    await expect(lightbox.locator('figcaption')).toContainText(node.name);
  });

  test('closes on a click just outside the photo, not only far from it', async ({ page }) => {
    /*
     * The backdrop closes the dialog and the figure deliberately does not, so
     * everything turns on where the figure's box actually ends. Sized by its
     * contents, it took the portrait's *intrinsic* width — 600px, what FIVB
     * was asked for — while the photo rendered at the 420px cap, leaving 90px
     * either side that looked like backdrop and swallowed the click. On a
     * short landscape window it was 174px.
     *
     * The stub has to be larger than that cap or the bug cannot exist: with a
     * small image the figure hugs it and the strip is zero, which is how this
     * went unnoticed. 600x800 is the shape FIVB actually returns.
     */
    const node = subject();
    await page.route(PHOTOS, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#456"/></svg>',
      }),
    );

    await page.goto(`./${slicePath()}?player=${node.id}`);
    await page.locator('.player-photo .portrait-trigger').click();
    const lightbox = page.locator('.portrait-lightbox');
    await expect(lightbox).toBeVisible();

    // The box the two widths share, which is what the figure now hugs.
    const photo = await lightbox.locator('.portrait-shot').boundingBox();
    expect(photo, 'the portrait should be laid out').not.toBeNull();

    // Eight pixels past the photo's edge, level with its middle: unmistakably
    // outside the picture, and the first place a reader tries.
    await page.mouse.click(photo!.x - 8, photo!.y + photo!.height / 2);
    await expect(lightbox).toHaveCount(0);
  });

  test('closes on the caption and the dark beside it, but not on the photo', async ({ page }) => {
    /*
     * The sibling above fixed the strip beside the *photo*. The caption sits
     * below it inside the same figure, and guarding the figure rather than the
     * picture left the player's name — and the gap around it — swallowing the
     * click as well. Nothing there is worth protecting: the caption is text
     * nobody clicks for its own sake, so it belongs to the backdrop.
     *
     * Both directions are asserted here because the guard moved rather than
     * went away. Widen it back onto the figure and the caption stops closing;
     * drop it from the picture and the photo starts closing — a reader who
     * clicks the portrait to look closer would dismiss it instead.
     */
    const node = subject();
    await page.route(PHOTOS, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#456"/></svg>',
      }),
    );

    await page.goto(`./${slicePath()}?player=${node.id}`);
    await page.locator('.player-photo .portrait-trigger').click();
    const lightbox = page.locator('.portrait-lightbox');
    await expect(lightbox).toBeVisible();

    // The picture keeps its guard: clicking the thing you opened to look at
    // must not take it away.
    await lightbox.locator('.portrait-shot').click();
    await expect(lightbox).toBeVisible();

    // The name itself.
    await lightbox.locator('figcaption strong').click();
    await expect(lightbox).toHaveCount(0);

    // And the dark immediately beside it. The figure is the photo's full
    // width and the caption is centred and narrower, so a click at the
    // figure's edge level with the caption lands on the figure itself — the
    // element that used to hold the guard, and the exact strip that read as
    // backdrop and did nothing.
    await page.locator('.player-photo .portrait-trigger').click();
    await expect(lightbox).toBeVisible();
    const figure = await lightbox.locator('figure').boundingBox();
    const caption = await lightbox.locator('figcaption').boundingBox();
    expect(figure, 'the figure should be laid out').not.toBeNull();
    expect(caption, 'the caption should be laid out').not.toBeNull();
    expect(caption!.width, 'the caption must be narrower than the figure for this to test anything')
      .toBeLessThan(figure!.width - 8);
    await page.mouse.click(figure!.x + 2, caption!.y + caption!.height / 2);
    await expect(lightbox).toHaveCount(0);
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
