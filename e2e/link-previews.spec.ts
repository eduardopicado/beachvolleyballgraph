/**
 * What a link to each kind of page shows when it is pasted somewhere.
 *
 * A chat app, a social network or a search engine fetches the page and reads
 * its head — never the app, which it does not run — so these are checked in
 * the prerendered HTML. The tags come in sets that have to agree: a preview
 * whose og:url is not the canonical address splits the page's shares across
 * two URLs, and a card whose title differs from the tab's reads as another
 * page.
 *
 * Written when the 1,626 tournament pages turned out to carry none of it: a
 * title and structured data, but no canonical, no description and no preview
 * tags, so a shared tournament got a bare title or just its URL. Every page
 * kind is listed so the next one written without them fails here by name.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, tournamentIndex } from './fixtures.js';
import { buildIndex } from '../web/src/lib/tournamentIndex.js';
import { TOURNAMENT_PREFIX } from '../shared/slug.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');
const CLASSIFIED = new Set(readdirSync(path.join(DATA, 'classifications')).map((f) => f.replace(/\.json$/, '')));
const ENTRIES = new Set(readdirSync(path.join(DATA, 'entries')).map((f) => f.replace(/\.json$/, '')));
const rows = buildIndex(tournamentIndex(), (code) => CLASSIFIED.has(code));
const played = rows.find((r) => r.played && CLASSIFIED.has(r.code));
const upcoming = rows.find((r) => !r.played && ENTRIES.has(r.code));

const PAGES: [string, string | undefined][] = [
  ['home', '/'],
  ['a country', '/brazil-women/'],
  ['a played tournament', played && `/${TOURNAMENT_PREFIX}/${played.slug}/`],
  ['a tournament still to be played', upcoming && `/${TOURNAMENT_PREFIX}/${upcoming.slug}/`],
  ['the tournament index', '/tournaments/'],
  ['the records', '/records/'],
  ['About', '/about/'],
];

/** Every value of one tag, so a duplicate shows up as well as a gap. */
function all(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => m[1]!);
}

for (const [kind, path_] of PAGES) {
  test(`${kind} carries a full, consistent set of preview tags`, async ({ request }) => {
    test.skip(!path_, `no ${kind} in the published data`);
    const html = await (await request.get(path_!)).text();
    const head = html.slice(0, html.indexOf('</head>'));

    const one = (name: string, re: RegExp) => {
      const values = all(head, re);
      expect(values, `${name}, exactly once`).toHaveLength(1);
      expect(values[0], `${name}, not empty`).not.toBe('');
      return values[0]!;
    };
    const prop = (p: string) => one(p, new RegExp(`<meta property="${p}" content="([^"]*)"`, 'g'));
    const name = (n: string) => one(n, new RegExp(`<meta name="${n}" content="([^"]*)"`, 'g'));

    const title = one('<title>', /<title>([^<]*)<\/title>/g);
    const canonical = one('canonical', /<link rel="canonical" href="([^"]*)"/g);
    const description = name('description');

    expect(new URL(canonical).pathname, 'canonical is this page').toBe(path_);
    expect(prop('og:url'), 'og:url is the canonical address').toBe(canonical);
    expect(prop('og:title')).toBe(title);
    expect(name('twitter:title')).toBe(title);
    expect(prop('og:description')).toBe(description);
    expect(name('twitter:description')).toBe(description);
    expect(prop('og:type')).toBe('website');
    prop('og:site_name');
    expect(name('twitter:card')).toBe('summary_large_image');

    const image = prop('og:image');
    expect(name('twitter:image')).toBe(image);
    // The card's picture has to be there to fetch — and be a picture: the
    // preview server answers a missing file with the app's page and a 200.
    const picture = await request.get(new URL(image).pathname);
    expect(picture.status()).toBe(200);
    expect(picture.headers()['content-type']).toMatch(/^image\//);
  });
}
