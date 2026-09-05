/**
 * Post-build step: turn the single-page app into a set of real, indexable pages.
 *
 * A client-rendered SPA with everything behind `?country=BRA` gives crawlers one
 * URL and an empty `<div id="root">`. Every graph already exists as JSON at
 * build time, so instead we emit one static HTML document per country x gender
 * containing the actual player table, per-page metadata and structured data.
 *
 * React replaces the static markup on mount, so it is not a second
 * implementation to maintain — it is the same data, rendered once at build time
 * for readers who do not run JavaScript (crawlers, previews, text browsers).
 */

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Gender, GraphFile, Manifest } from '../web/src/schema.js';
import { GENDER_LABEL, GENDERS } from '../web/src/schema.js';
import { sliceSlug } from '../web/src/lib/slug.js';
import { CONTACT_EMAIL, SITE_NAME, SOURCE_NAME, SOURCE_URL } from '../web/src/site.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'web/public/v1');

/** Public origin, needed for canonical URLs, Open Graph and the sitemap. */
const SITE_URL = (process.env.SITE_URL ?? 'https://example.invalid').replace(/\/+$/, '');
const BASE = process.env.BASE_PATH ?? '/';

/** Cap on players embedded in structured data; the table itself is complete. */
const JSONLD_MAX = 50;

/**
 * Escape text for HTML. Player names come from an upstream database and reach
 * both element content and quoted attribute values, so `"` must be escaped too.
 */
export const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const abs = (p: string) => `${SITE_URL}${p}`;

/** "54.2%" — one decimal, and never NaN on an empty dataset. */
const pct = (n: number, of: number) => `${of > 0 ? ((100 * n) / of).toFixed(1) : '0.0'}%`;

interface Page {
  slug: string;
  url: string;
  title: string;
  description: string;
  head: string;
  body: string;
}

function seasonSpan(a: number, b: number) {
  return a === b ? String(a) : `${a}\u2013${b}`;
}

/** Shared <head> block: canonical, Open Graph, Twitter, robots. */
function headFor(url: string, title: string, description: string): string {
  const image = abs(`${BASE}og.png`);
  return [
    `<link rel="canonical" href="${esc(url)}"/>`,
    `<meta name="description" content="${esc(description)}"/>`,
    `<meta name="robots" content="index,follow,max-image-preview:large"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="Beach Volleyball Partnership Graph"/>`,
    `<meta property="og:title" content="${esc(title)}"/>`,
    `<meta property="og:description" content="${esc(description)}"/>`,
    `<meta property="og:url" content="${esc(url)}"/>`,
    `<meta property="og:image" content="${esc(image)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${esc(title)}"/>`,
    `<meta name="twitter:description" content="${esc(description)}"/>`,
    `<meta name="twitter:image" content="${esc(image)}"/>`,
  ].join('');
}

export function jsonLd(data: unknown): string {
  // No user-controlled markup can escape: JSON.stringify plus a guard on the
  // one sequence that could close the script element early.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function sliceBody(graph: GraphFile, manifest: Manifest, others: { name: string; href: string }[]): string {
  const partners = new Map<number, { count: number; top: string; topT: number }>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    for (const [self, other] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      const entry = partners.get(self) ?? { count: 0, top: '', topT: 0 };
      entry.count++;
      if (e.t > entry.topT) {
        entry.topT = e.t;
        entry.top = byId.get(other)?.name ?? '';
      }
      partners.set(self, entry);
    }
  }

  // The JSON on disk is ordered by id — an immutable key, so a value change
  // week to week doesn't reorder the whole array and blow up its diff (see
  // `sliceByCountryAndGender`). The interactive app re-sorts for display
  // itself (`TableView`'s sortable columns), and this static fallback page
  // needs the same: most-active-first is the useful order for a reader who
  // has no JS and no sort control to reach for.
  const rows = [...graph.nodes]
    .sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name))
    .map((n) => {
      const p = partners.get(n.id);
      return `<tr><th scope="row">${esc(n.name)}</th><td>${n.tournaments}</td><td>${p?.count ?? 0}</td><td>${seasonSpan(n.first, n.last)}</td><td>${esc(p?.top ?? '—')}</td></tr>`;
    })
    .join('');

  const gender = GENDER_LABEL[graph.gender].toLowerCase();
  const nav = others
    .map((o) => `<li><a href="${esc(o.href)}">${esc(o.name)}</a></li>`)
    .join('');

  return `<main>
<h1>Beach Volleyball Partnership Graph</h1>
<p>Who has played with whom in FIVB international beach volleyball — the World Tour, Beach Pro Tour, World Championships and Olympic Games.</p>
<h2>${esc(graph.countryName)} · ${esc(GENDER_LABEL[graph.gender])}</h2>
<p>${graph.nodes.length} ${gender}'s players from ${esc(graph.countryName)} have entered FIVB international beach volleyball, forming ${graph.edges.length} partnerships across ${manifest.totals.tournaments} tournaments between ${manifest.seasons.from} and ${manifest.seasons.to}.</p>
<table>
<caption>${esc(graph.countryName)} ${esc(GENDER_LABEL[graph.gender])} — players, tournaments entered, distinct partners and seasons active</caption>
<thead><tr><th scope="col">Player</th><th scope="col">Tournaments</th><th scope="col">Partners</th><th scope="col">Seasons</th><th scope="col">Most frequent partner</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<nav aria-label="Other countries"><h2>Browse other countries</h2><ul>${nav}</ul></nav>
${staticFooter()}
</main>`;
}

/** Players with at least this many tournaments count as established regulars. */
export const REGULAR_MIN_TOURNAMENTS = 10;

/**
 * Running tallies behind the "how to read the numbers" section of llms.txt.
 *
 * These used to be three numbers written into the prose by hand. They are
 * claims about the published data, stated to language models as fact, and
 * nothing tied them to the data they described — so every correction to the
 * dataset (the Type-15 reclassification, the Rank-0 exclusion) silently
 * falsified them. Accumulating them from the graphs the prerenderer is
 * already reading costs one pass and cannot drift.
 */
export interface ShapeTally {
  players: number;
  onePartner: number;
  oneTournament: number;
  regulars: number;
  regularPartnerSum: number;
}

export const emptyTally = (): ShapeTally => ({
  players: 0,
  onePartner: 0,
  oneTournament: 0,
  regulars: 0,
  regularPartnerSum: 0,
});

/** Fold one country x gender slice into the running totals. */
export function tallySlice(graph: GraphFile, into: ShapeTally): void {
  const degree = new Map<number, number>();
  for (const e of graph.edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  for (const n of graph.nodes) {
    const d = degree.get(n.id) ?? 0;
    into.players++;
    if (d === 1) into.onePartner++;
    if (n.tournaments === 1) into.oneTournament++;
    if (n.tournaments >= REGULAR_MIN_TOURNAMENTS) {
      into.regulars++;
      into.regularPartnerSum += d;
    }
  }
}

/**
 * Footer for the prerendered markup.
 *
 * React's own footer (App.tsx) replaces this the moment the app mounts, so
 * the two say the same thing on purpose. This is the copy a crawler, a link
 * preview, or a reader without JavaScript sees — which, for the two audiences
 * a contact address actually exists for (FIVB, and anyone wanting to talk
 * about the project), is the version most likely to be read.
 */
function staticFooter(): string {
  return `<footer>
<p>Source: <a href="${esc(SOURCE_URL)}">${esc(SOURCE_NAME)}</a>. Not affiliated with or endorsed by the FIVB.</p>
<p>Questions, corrections or partnership enquiries: <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a> · <a href="${esc(`${BASE}about/`)}">About this project</a></p>
<p>© 2026 Eduardo Picado. All rights reserved.</p>
</footer>`;
}

/**
 * `/llms.txt` — a plain-markdown briefing for language models, per llmstxt.org.
 *
 * The point is to answer the questions a model would otherwise get wrong by
 * guessing: what the numbers mean, what is deliberately excluded, and where the
 * raw JSON lives so it can be read directly instead of scraped out of HTML.
 */
export function llmsTxt(
  manifest: Manifest,
  slices: { name: string; gender: Gender; href: string }[],
  shape: ShapeTally,
): string {
  const tiers = Object.entries(manifest.tiers)
    .sort((a, b) => b[1] - a[1])
    .map(([tier, n]) => `- ${tier}: ${n.toLocaleString('en-US')} tournaments`)
    .join('\n');

  const pages = slices
    .map((s) => `- [${s.name} ${GENDER_LABEL[s.gender]}](${abs(s.href)})`)
    .join('\n');

  return `# Beach Volleyball Partnership Graph

> Who has played with whom in FIVB international beach volleyball. ${manifest.totals.players.toLocaleString('en-US')} players and ${manifest.totals.partnerships.toLocaleString('en-US')} partnerships drawn from ${manifest.totals.tournaments.toLocaleString('en-US')} tournaments between ${manifest.seasons.from} and ${manifest.seasons.to}, sliced by country and gender. Source data is the official FIVB VIS Web Service; the whole dataset is rebuilt weekly.

Data as of ${manifest.generatedAt}.

## What is counted

Only FIVB-organised international competition:

${tiers}

Continental tours and championships (CEV, AVC, NORCECA, CSV, CAVB), national
tours, snow volleyball, multi-sport games and King of the Court are excluded.

## How to read the numbers

- A partnership edge is weighted by the number of distinct tournaments a pair entered together. A pair entering both the qualification and the main draw of one event counts once.
- A player's tournament count is their own entries, not their partner count. Node size in the graph encodes this.
- A player's country is their current FIVB federation. No federation history is kept.
- Medal counts are three separate tallies and are never merged: the Olympic Games, the FIVB World Championships, and podiums across the tour (World Tour plus Beach Pro Tour, levels mixed, age-group events excluded). Both members of a winning pair each carry the medal.
- Both players must represent the same federation for a partnership to appear, so cross-national pairs (about 1% of the total) are in no country's graph.
- The dataset is dominated by one-off entrants: ${pct(shape.onePartner, shape.players)} of players have exactly one partner and ${pct(shape.oneTournament, shape.players)} entered exactly one tournament. Restricted to players with ${REGULAR_MIN_TOURNAMENTS} or more tournaments the mean is ${(shape.regularPartnerSum / Math.max(shape.regulars, 1)).toFixed(1)} partners. Use the "min. events together" filter, or the \`min\` query parameter, to exclude one-off pairings.

## Data (JSON, prefer these over scraping the pages)

- [Manifest](${abs(`${BASE}v1/manifest.json`)}): every published country, node and edge counts, tier breakdown, freshness.
- [Graph file](${abs(`${BASE}v1/graphs/BRA-M.json`)}): \`/v1/graphs/{FEDERATION}-{M|W}.json\` — \`nodes\` (id, name, short, tournaments, first, last) and \`edges\` (\`a\`, \`b\` player ids, \`t\` tournaments together, \`f\`/\`l\` first and last season, \`s\` per-season breakdown as \`[season, tournaments, days from 1 January to the pair's last event that season]\` — the last optional).
- [Player detail](${abs(`${BASE}v1/players/BRA-M.json`)}): \`/v1/players/{FEDERATION}-{M|W}.json\` — date of birth, height, weight, \`olympics\`/\`worldChamps\`/\`tour\` podium counts (gold, silver, bronze; the tour tally is the World Tour and Beach Pro Tour with levels mixed and age-group events excluded), and \`away\`: partners from another federation, which the graph excludes.
- [Search index](${abs(`${BASE}v1/search.json`)}): every published player as \`[id, name, tournaments]\`, grouped by \`FEDERATION-{M|W}\` — the quickest way to resolve a name to a player id and a country.
- [Tournament index](${abs(`${BASE}v1/tournaments.json`)}): every qualifying tournament by FIVB number, as \`[name, season, tier, days from 1 January to the main draw's first day, FIVB tournament code, level]\`. The date offset may be null and the code is FIVB's own identifier for the event (\`WBUS2026\` is the 2026 women's Busan tournament) — the stable key to join this data to another source. \`level\` is what FIVB called the event's rung at the time — "Grand Slam", "4-star", "Elite16" — present on the 1,552 tour events and absent on the Olympics, the World Championships and the age-group championships, which have no level below their tier. It is a label, not a rank: the hierarchy was renumbered from Open/Challenger/Satellite to 1-to-5-star to Elite16/Challenge/Futures and no mapping across those eras survives, so a 2005 Grand Slam cannot be ordered against a 2019 4-star.
- [Results](${abs(`${BASE}v1/results/BRA-M.json`)}): \`/v1/results/{FEDERATION}-{M|W}.json\` — \`players\`, keyed by player id, each holding every tournament they entered as \`[tournament number, partner id, rank]\`, most recent first. \`names\` covers partners with no node in that slice. \`rank\` is FIVB's own placement and is shared rather than unique: eight teams finish 9th, and negative values are eliminations before the main draw (\`<= -25\` in qualification, \`-2\` on a confederation quota).

Federation codes are FIVB three-letter codes (BRA, USA, GER), not ISO country codes.

## Pages

${pages}
`;
}

/**
 * `/about/` — who runs this, where the data comes from, how to make contact.
 *
 * Emitted as a standalone document rather than through the SPA template, and
 * that is the whole trick: every other page here is prerendered markup that
 * React *replaces* on mount. Reuse the template and the app would boot on
 * `/about/`, fail to match the path to any country slice, fall back to the
 * default country and swap this text for the Brazil graph. Shipping the same
 * stylesheet without the module script keeps the page looking like the site
 * while leaving the markup as the final word.
 */
function aboutPage(manifest: Manifest, styleHref: string | null): string {
  const url = abs(`${BASE}about/`);
  const title = `About — ${SITE_NAME}`;
  const description = `Where the data behind ${SITE_NAME} comes from, how the numbers are counted, and how to get in touch.`;
  const style = styleHref ? `<link rel="stylesheet" href="${esc(styleHref)}"/>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
${style}
${headFor(url, title, description)}
</head>
<body>
<div class="app">
<main>
<h1>About</h1>

<p><strong>${esc(SITE_NAME)}</strong> maps who has played with whom in FIVB international beach volleyball. Each node is a player; each edge is a partnership, weighted by the tournaments the pair entered together. Currently ${manifest.totals.players.toLocaleString('en-US')} players and ${manifest.totals.partnerships.toLocaleString('en-US')} partnerships across ${manifest.totals.tournaments.toLocaleString('en-US')} tournaments, ${manifest.seasons.from}–${manifest.seasons.to}.</p>

<h2>Data</h2>

<p>Every figure comes from the <a href="${esc(SOURCE_URL)}">${esc(SOURCE_NAME)}</a> and is rebuilt weekly. Nothing is hand-edited, so a number that looks wrong is either what VIS returns or a bug in how this site reads it.</p>

<p>Player photographs are FIVB's as well, and none are stored here — your browser fetches each one from FIVB's image service as you open a player. Most players have no photo on file, and those show initials instead.</p>

<p>Not affiliated with or endorsed by the FIVB.</p>

<h2>Counting rules</h2>

<ul>
<li>FIVB-organised international competition only: World Tour, Beach Pro Tour, World Championships, Olympic Games, age-group World Championships. Continental and national tours, snow volleyball and multi-sport games are excluded.</li>
<li>A pair entering both the qualification and the main draw of one event counts once.</li>
<li>Teams that registered but never played are not counted.</li>
<li>A player's country is their current FIVB federation; no history is kept. Both players must share a federation for a partnership to appear.</li>
</ul>

<h2>Contact</h2>

<p><a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a> — corrections, questions, media and partnership enquiries.</p>

<p>For a wrong number, a link to the page and what you expected to see is the fastest route to a fix.</p>

<h2>Copyright</h2>

<p>© 2026 Eduardo Picado. All rights reserved.</p>

<p><a href="${esc(BASE)}">← Back to the graph</a></p>
</main>
</div>
</body>
</html>
`;
}

async function main() {
  if (!existsSync(DIST)) throw new Error('dist/ missing — run `vite build` first');
  if (!existsSync(DATA)) throw new Error('web/public/v1 missing — run `npm run ingest` first');
  if (SITE_URL.includes('example.invalid')) {
    console.warn('  ! SITE_URL is unset; canonical URLs and the sitemap will be placeholders.');
  }

  const template = await readFile(path.join(DIST, 'index.html'), 'utf8');
  const manifest: Manifest = JSON.parse(await readFile(path.join(DATA, 'manifest.json'), 'utf8'));

  // Every published slice, in a stable order.
  const slices: { code: string; name: string; gender: Gender; slug: string; href: string }[] = [];
  for (const country of manifest.countries) {
    for (const gender of GENDERS) {
      if (!country.genders[gender]) continue;
      const slug = sliceSlug(country.name, gender);
      slices.push({ code: country.code, name: country.name, gender, slug, href: `${BASE}${slug}/` });
    }
  }

  const clashes = new Map<string, number>();
  for (const s of slices) clashes.set(s.slug, (clashes.get(s.slug) ?? 0) + 1);
  const duplicated = [...clashes].filter(([, n]) => n > 1);
  if (duplicated.length) {
    throw new Error(`Slug collision would make pages unreachable: ${duplicated.map(([s]) => s).join(', ')}`);
  }

  const pages: Page[] = [];
  const shape = emptyTally();

  // --- one page per slice --------------------------------------------------
  for (const slice of slices) {
    const graph: GraphFile = JSON.parse(
      await readFile(path.join(DATA, 'graphs', `${slice.code}-${slice.gender}.json`), 'utf8'),
    );
    tallySlice(graph, shape);
    const url = abs(slice.href);
    const label = GENDER_LABEL[slice.gender];
    const title = `${slice.name} ${label} — Beach Volleyball Partnership Graph`;
    const description = `Every ${label.toLowerCase()}'s beach volleyball player from ${slice.name} who has competed on the FIVB World Tour, Beach Pro Tour, World Championships or Olympic Games — ${graph.nodes.length} players and ${graph.edges.length} partnerships, ${manifest.seasons.from}–${manifest.seasons.to}.`;

    // Sibling links: the other gender for this country, then a rotating
    // window of other countries starting just after this one.
    //
    // Taking `slices.slice(0, 24)` instead — the same alphabetical head on
    // every page — meant Algeria collected an inbound link from all 263
    // other pages while 30 slices got none at all, reachable only from the
    // home page. Rotating spreads inbound links evenly at no cost, and it is
    // what the "nearby countries" this comment always claimed actually
    // requires.
    const here = slices.indexOf(slice);
    const rotated = [...slices.slice(here + 1), ...slices.slice(0, here)];
    const others = [
      ...slices.filter((s) => s.code === slice.code && s.gender !== slice.gender),
      ...rotated.filter((s) => s.code !== slice.code).slice(0, 24),
    ].map((s) => ({ name: `${s.name} ${GENDER_LABEL[s.gender]}`, href: s.href }));

    const top = [...graph.nodes].sort((a, b) => b.tournaments - a.tournaments).slice(0, JSONLD_MAX);
    const head =
      headFor(url, title, description) +
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebPage',
            '@id': url,
            url,
            name: title,
            description,
            isPartOf: { '@id': abs(BASE) },
            dateModified: manifest.generatedAt,
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: abs(BASE) },
              { '@type': 'ListItem', position: 2, name: `${slice.name} ${label}`, item: url },
            ],
          },
          {
            '@type': 'ItemList',
            name: `${slice.name} ${label} beach volleyball players`,
            numberOfItems: graph.nodes.length,
            itemListElement: top.map((n, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              item: {
                '@type': 'Person',
                name: n.name,
                nationality: slice.name,
                jobTitle: 'Beach volleyball player',
              },
            })),
          },
        ],
      });

    pages.push({
      slug: slice.slug,
      url: slice.href,
      title,
      description,
      head,
      body: sliceBody(graph, manifest, others),
    });
  }

  // --- home page -----------------------------------------------------------
  const homeUrl = abs(BASE);
  const homeTitle = 'Beach Volleyball Partnership Graph — who has played with whom on the FIVB tour';
  const homeDescription = `Explore ${manifest.totals.players.toLocaleString('en-US')} beach volleyball players and ${manifest.totals.partnerships.toLocaleString('en-US')} partnerships from ${manifest.totals.tournaments.toLocaleString('en-US')} FIVB international tournaments, ${manifest.seasons.from}–${manifest.seasons.to}. Pick a country and gender to see the partnership graph.`;
  const homeBody = `<main>
<h1>Beach Volleyball Partnership Graph</h1>
<p>${esc(homeDescription)}</p>
<h2>Countries</h2>
<ul>${slices.map((s) => `<li><a href="${esc(s.href)}">${esc(s.name)} ${esc(GENDER_LABEL[s.gender])}</a></li>`).join('')}</ul>
</main>`;

  pages.push({
    slug: '',
    url: BASE,
    title: homeTitle,
    description: homeDescription,
    head:
      headFor(homeUrl, homeTitle, homeDescription) +
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': homeUrl,
            url: homeUrl,
            name: 'Beach Volleyball Partnership Graph',
            description: homeDescription,
          },
          {
            '@type': 'Dataset',
            name: 'FIVB international beach volleyball partnerships',
            description: homeDescription,
            url: homeUrl,
            dateModified: manifest.generatedAt,
            license: 'https://www.fivb.org/VisSDK/VisWebService/',
            creator: { '@type': 'Organization', name: 'FIVB', url: 'https://www.fivb.com/' },
            temporalCoverage: `${manifest.seasons.from}/${manifest.seasons.to}`,
            keywords: ['beach volleyball', 'FIVB', 'Beach Pro Tour', 'partnerships', 'network graph'],
          },
        ],
      }),
    body: homeBody,
  });

  // --- write ---------------------------------------------------------------
  for (const page of pages) {
    // Function replacements, not string ones. A string replacement expands
    // `$&`, `$\``, `$'` and `$1` inside the *replacement*, and the text being
    // spliced in here is built from upstream player and country names —
    // `esc()` handles the HTML metacharacters but has no reason to touch `$`.
    // A name containing "$`" would splice in the entire preceding document
    // instead of itself. No name in the current archive has one, so this is
    // hardening rather than a live fix, but the failure mode is silent
    // corruption of a published page and the guard costs nothing.
    let html = template;
    html = html.replace('</head>', () => `${page.head}</head>`);
    html = html.replace('<div id="root"></div>', () => `<div id="root">${page.body}</div>`);
    // The static <title> in index.html is generic; each page overrides it.
    html = html.replace(/<title>.*?<\/title>/, () => `<title>${esc(page.title)}</title>`);

    const dir = page.slug ? path.join(DIST, page.slug) : DIST;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), html);
  }

  // --- about ---------------------------------------------------------------
  // Borrow the hashed stylesheet Vite emitted for the app, so the page picks
  // up the same theme without a second CSS pipeline. Missing is survivable —
  // the page is plain semantic HTML and stays readable unstyled — so this
  // degrades rather than failing the build.
  const styleHref = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(template)?.[1] ?? null;
  if (!styleHref) console.warn('  ! no stylesheet found in index.html; /about/ will be unstyled');
  await mkdir(path.join(DIST, 'about'), { recursive: true });
  await writeFile(path.join(DIST, 'about', 'index.html'), aboutPage(manifest, styleHref));

  // --- sitemap & robots ----------------------------------------------------
  const lastmod = manifest.generatedAt.slice(0, 10);
  // Home is 1.0, country pages 0.8, About 0.3 — a real page worth indexing,
  // but not something to rank ahead of the data it explains.
  const sitemapEntries: { url: string; priority: string }[] = [
    ...pages.map((p) => ({ url: p.url, priority: p.slug ? '0.8' : '1.0' })),
    { url: `${BASE}about/`, priority: '0.3' },
  ];
  const urls = sitemapEntries
    .map(
      ({ url, priority }) =>
        `  <url><loc>${esc(abs(url))}</loc><lastmod>${lastmod}</lastmod>` +
        `<changefreq>weekly</changefreq><priority>${priority}</priority></url>`,
    )
    .join('\n');
  await writeFile(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );

  await writeFile(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${abs(`${BASE}sitemap.xml`)}\n`,
  );

  await writeFile(path.join(DIST, 'llms.txt'), llmsTxt(manifest, slices, shape));

  // Social preview image.
  const screenshot = path.join(ROOT, 'docs/screenshot.png');
  if (existsSync(screenshot)) await copyFile(screenshot, path.join(DIST, 'og.png'));

  console.log(
    `prerendered ${pages.length} pages (${slices.length} slices + home), sitemap.xml, robots.txt and llms.txt`,
  );
}

// Only run when invoked as a script, so tests can import the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Prerender failed:', err);
    process.exit(1);
  });
}
