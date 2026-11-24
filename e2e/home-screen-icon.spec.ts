/**
 * The site's icons: the browser tab's, and the one an iPad or iPhone puts on
 * its Home Screen.
 *
 * Until these tests the tab icon was a 🏐 emoji inlined in index.html, the
 * Home Screen got a tile iOS made up from the page, and /about/ and 404.html
 * had no icon at all: they are written from templates of their own, not from
 * index.html, so the one tag never reached them. Checked in the prerendered
 * HTML, which is what a browser and iOS read, on every page kind — a page kind
 * that loses the tags fails here by name.
 */

import { test, expect } from './fixtures.js';

const PAGES = [
  '/',
  '/brazil-women/',
  '/tournament/gstaad-2019-women/',
  '/tournaments/',
  '/records/',
  '/about/',
  '/404.html',
];

const TAGS = /<link rel="(?:icon|apple-touch-icon)"[^>]*>|<meta name="apple-mobile-web-app-title"[^>]*>/g;

/** Width, height, and whether a PNG can hold transparency at all. */
function png(bytes: Buffer): { width: number; height: number; alpha: boolean } {
  expect(bytes.subarray(0, 8).toString('hex'), 'a PNG').toBe('89504e470d0a1a0a');
  const colourType = bytes[25]!;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    // 4 and 6 carry an alpha channel; any other type gains one from a tRNS chunk.
    alpha: colourType === 4 || colourType === 6 || bytes.includes(Buffer.from('tRNS')),
  };
}

test('every page kind carries the same icon tags, once each', async ({ request }) => {
  const sets = new Map<string, string>();
  for (const path of PAGES) {
    const html = await (await request.get(path)).text();
    const head = html.slice(0, html.indexOf('</head>'));
    const tags = head.match(TAGS) ?? [];
    sets.set(path, tags.join('\n'));

    const count = (re: RegExp) => tags.filter((t) => re.test(t)).length;
    expect(count(/rel="apple-touch-icon"/), `${path}: Home Screen icon`).toBe(1);
    expect(count(/rel="icon"[^>]*type="image\/svg\+xml"/), `${path}: tab icon, SVG`).toBe(1);
    expect(count(/rel="icon"[^>]*sizes="32x32"/), `${path}: tab icon, 32px`).toBe(1);
    expect(count(/apple-mobile-web-app-title" content="BV Partners"/), `${path}: Home Screen name`).toBe(1);
    expect(tags, `${path}: nothing else`).toHaveLength(4);
    // The emoji it replaced, inlined as an SVG data URI.
    expect(head).not.toContain('data:image/svg+xml');
  }
  // One list, written once in index.html; prerender copies it to the rest.
  expect(new Set(sets.values()).size, 'the same tags on every page').toBe(1);
});

test('every icon the tags name is there, and is an image', async ({ request }) => {
  const html = await (await request.get('/about/')).text();
  const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => m[1]!);
  expect(hrefs).toHaveLength(3);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
    // The preview server answers a missing file with the app's page and a
    // 200, so the type is what proves the file is there.
    expect(res.headers()['content-type'], href).toMatch(/^image\/(png|svg\+xml)/);
  }
});

test('the Home Screen icon is 180px square with no transparency', async ({ request }) => {
  // iOS scales a 180px icon for every device, rounds its corners itself, and
  // fills any transparent pixel with black.
  const res = await request.get('/apple-touch-icon.png');
  expect(png(await res.body())).toEqual({ width: 180, height: 180, alpha: false });
});

test('the small tab icon is 32px square', async ({ request }) => {
  const res = await request.get('/favicon-32.png');
  const { width, height } = png(await res.body());
  expect([width, height]).toEqual([32, 32]);
});
