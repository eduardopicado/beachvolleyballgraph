/**
 * Flags on Windows, where Chrome and Edge draw "BR" instead of a flag.
 *
 * The polyfill decides by drawing to a canvas: colour emoji drawn identically
 * in white and black is a colour font at work; a flag that comes back in the
 * fill colour is two letters. No browser this suite runs in behaves like
 * Windows, so the decision is staged here by answering that probe — the same
 * single point the polyfill itself reads — once as Windows would and once as
 * a browser that draws flags natively.
 */

import { test, expect } from './fixtures.js';

const FONT = 'Twemoji Country Flags';

/**
 * Answer the polyfill's canvas probe: colour emoji always, flags only if
 * `flags`. Runs in the page, so it takes its argument the way
 * `addInitScript` passes one rather than closing over it.
 */
function stageEmojiSupport({ flags }: { flags: boolean }) {
  let lastText = '';
  let lastFill = '';
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number) {
    lastText = text;
    lastFill = String(this.fillStyle);
    return fillText.call(this, text, x, y);
  };
  CanvasRenderingContext2D.prototype.getImageData = function () {
    // Regional indicators start at U+1F1E6; anything else is the smiley.
    const isFlag = (lastText.codePointAt(0) ?? 0) >= 0x1f1e6 && (lastText.codePointAt(0) ?? 0) <= 0x1f1ff;
    const colour = !isFlag || flags;
    const px = colour ? [230, 180, 20, 255] : lastFill === '#ffffff' ? [255, 255, 255, 255] : [0, 0, 0, 255];
    return { data: new Uint8ClampedArray(px), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
  };
}

test('a browser that cannot draw flags gets the flag font, from this site', async ({ page }) => {
  await page.addInitScript(stageEmojiSupport, { flags: false });
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (/\.woff2(\?|$)/.test(r.url())) fontRequests.push(r.url());
  });

  await page.goto('/');
  await expect(page.locator('.controls select').first()).toBeVisible();

  const injected = await page.evaluate(
    (font) => [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').find((t) => t.includes(font)) ?? '',
    FONT,
  );
  expect(injected, 'the polyfill injected no @font-face').toContain('@font-face');
  // Only the flag code points, so the face takes no ordinary letter from the system font.
  expect(injected).toContain('unicode-range: U+1F1E6-1F1FF');

  // The face actually loads, from our own origin and not the package's CDN default.
  const loaded = await page.evaluate((font) => document.fonts.load(`16px "${font}"`, '\u{1F1E7}\u{1F1F7}').then((f) => f.length), FONT);
  expect(loaded).toBeGreaterThan(0);
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) {
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    expect(url).not.toContain('jsdelivr');
  }
});

test('a browser that draws flags itself downloads nothing extra', async ({ page }) => {
  await page.addInitScript(stageEmojiSupport, { flags: true });
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (/\.woff2(\?|$)/.test(r.url())) fontRequests.push(r.url());
  });

  await page.goto('/');
  await expect(page.locator('.controls select').first()).toBeVisible();

  const injected = await page.evaluate(
    (font) => [...document.querySelectorAll('style')].some((s) => (s.textContent ?? '').includes(font)),
    FONT,
  );
  expect(injected).toBe(false);
  expect(fontRequests).toEqual([]);
});

test('every text on the site, the country picker included, asks for the flag font first', async ({ page }) => {
  await page.goto('/');
  const select = page.locator('.controls select').first();
  await expect(select).toBeVisible();
  // The picker is the one place a native control draws the flags, and form
  // controls do not inherit a font unless told to (theme.css does).
  for (const target of [page.locator('body'), select]) {
    const family = await target.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family.split(',')[0]!.replace(/["']/g, '').trim()).toBe(FONT);
  }
});
