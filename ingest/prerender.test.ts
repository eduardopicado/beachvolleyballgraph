import { describe, expect, it } from 'vitest';
import { emptyTally, esc, indexDescription, jsonLd, llmsTxt, notFoundPage, routeChunks, tallySlice, tournamentFacts, factsScript } from './prerender.js';
import type { GraphFile, Manifest } from '../shared/schema.js';

const manifest: Manifest = {
  generatedAt: '2026-08-03T00:00:00.000Z',
  sourceVersion: '1',
  seasons: { from: 1987, to: 2026 },
  totals: { tournaments: 2163, players: 15628, partnerships: 18900 },
  tiers: { 'FIVB World Tour': 1517, 'Olympic Games': 22 },
  countries: [],
  withoutField: [],
};

describe('esc', () => {
  it('escapes the characters that break out of element content', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes, since names are also written into attributes', () => {
    // Real FIVB data: José Marco "Zé Marco" Nóbrega Ferreira da Silva.
    expect(esc('José Marco "Zé Marco"')).toBe('José Marco &quot;Zé Marco&quot;');
    expect(esc("O'Brien")).toBe('O&#39;Brien');
  });

  it('escapes ampersands first so entities are not double-broken', () => {
    expect(esc('A & <B>')).toBe('A &amp; &lt;B&gt;');
    expect(esc('&amp;')).toBe('&amp;amp;');
  });

  it('leaves ordinary text and accents untouched', () => {
    expect(esc('Anders Berntsen Mol')).toBe('Anders Berntsen Mol');
    expect(esc('Ágatha Bednarczuk')).toBe('Ágatha Bednarczuk');
  });
});

const graph = (nodes: GraphFile['nodes'], edges: GraphFile['edges']): GraphFile => ({
  country: 'BRA',
  countryName: 'Brazil',
  gender: 'M',
  nodes,
  edges,
});

const node = (id: number, tournaments: number) => ({
  id,
  name: `Player ${id}`,
  short: `P${id}`,
  tournaments,
  first: 2000,
  last: 2010,
});

const edge = (a: number, b: number) => ({ a, b, t: 1, f: 2000, l: 2000 });

describe('tallySlice', () => {
  it('counts one-partner and one-tournament players', () => {
    const tally = emptyTally();
    // Edges 1-2, 3-2, 3-4 give degrees: 1->1, 2->2, 3->2, 4->1.
    tallySlice(
      graph([node(1, 1), node(2, 5), node(3, 5), node(4, 5)], [edge(1, 2), edge(3, 2), edge(3, 4)]),
      tally,
    );
    expect(tally.players).toBe(4);
    expect(tally.onePartner).toBe(2); // players 1 and 4
    expect(tally.oneTournament).toBe(1); // only player 1, the rest have 5
  });

  it('averages partners over established players only', () => {
    const tally = emptyTally();
    // Two regulars (>=10 tournaments) with 1 partner each, plus a one-off
    // player who must not drag the regulars' mean down.
    tallySlice(graph([node(1, 20), node(2, 20), node(3, 1)], [edge(1, 2)]), tally);
    expect(tally.regulars).toBe(2);
    expect(tally.regularPartnerSum).toBe(2);
    expect(tally.regularPartnerSum / tally.regulars).toBe(1);
  });

  it('accumulates across slices rather than replacing', () => {
    const tally = emptyTally();
    tallySlice(graph([node(1, 1), node(2, 1)], [edge(1, 2)]), tally);
    tallySlice(graph([node(3, 1), node(4, 1)], [edge(3, 4)]), tally);
    expect(tally.players).toBe(4);
    expect(tally.onePartner).toBe(4);
  });
});

describe('indexDescription', () => {
  const seasons = { from: 1987, to: 2027 };

  it('counts the played rows and the ones still awaiting a result separately', () => {
    // The bug this exists for. The count was written as
    // `indexRows.length - addressable.length`, and `addressable` is an alias
    // for `indexRows` — so it was always 0, the clause never appeared once,
    // and all 1,616 rows were called played on a day when six were not.
    expect(indexDescription(1610, 6, seasons)).toBe(
      'Every FIVB international beach volleyball tournament by season and draw — ' +
        '1,610 played since 1987, and 6 awaiting results.',
    );
  });

  it('drops the clause rather than saying "and 0 awaiting results"', () => {
    expect(indexDescription(1616, 0, seasons)).toBe(
      'Every FIVB international beach volleyball tournament by season and draw — ' +
        '1,616 played since 1987.',
    );
  });

  it('groups thousands on both numbers', () => {
    // The awaiting count is small today and need not stay that way: a January
    // rebuild sees a whole season published and unplayed.
    expect(indexDescription(1610, 1200, seasons)).toContain('1,610 played');
    expect(indexDescription(1610, 1200, seasons)).toContain('1,200 awaiting results');
  });

  it('names where the archive starts and never its newest scheduled season', () => {
    // `to` is a season FIVB has published events into, not one anybody has
    // played: "1987–2027" was on every page while 2027 held nothing but a
    // calendar.
    const text = indexDescription(1610, 6, seasons);
    expect(text).toContain('since 1987');
    expect(text).not.toContain('2027');
  });

  it('says nothing about the future, because the same rows cover an event being played', () => {
    // "Still to come" was wrong for a tournament under way and for one whose
    // placements FIVB had not written yet. Matches the index's own tag.
    const text = indexDescription(1610, 6, seasons);
    expect(text).not.toContain('still to come');
    expect(text).not.toContain('upcoming');
  });
});

describe('llmsTxt', () => {
  const slices = [
    { name: 'Brazil', gender: 'M' as const, href: '/brazil-men/' },
    { name: 'Norway', gender: 'W' as const, href: '/norway-women/' },
  ];
  const shape = { players: 1000, onePartner: 542, oneTournament: 394, regulars: 100, regularPartnerSum: 500 };

  it('opens with the llmstxt.org shape: an H1 then a blockquote summary', () => {
    const lines = llmsTxt(manifest, slices, shape).split('\n');
    expect(lines[0]).toBe('# Beach Volleyball Partnership Graph');
    expect(lines.find((l) => l.startsWith('>'))).toBeTruthy();
  });

  it('states the totals and the tier breakdown', () => {
    const txt = llmsTxt(manifest, slices, shape);
    expect(txt).toContain('15,628 players');
    expect(txt).toContain('18,900 partnerships');
    expect(txt).toContain('FIVB World Tour: 1,517 tournaments');
  });

  it('links every published page and the raw JSON endpoints', () => {
    const txt = llmsTxt(manifest, slices, shape);
    expect(txt).toContain('[Brazil Men](');
    expect(txt).toContain('[Norway Women](');
    expect(txt).toContain('/v1/manifest.json');
  });

  it('spells out the counting rules a model would otherwise guess wrong', () => {
    const txt = llmsTxt(manifest, slices, shape);
    expect(txt).toMatch(/counts once/);
    expect(txt).toMatch(/not their partner count/);
    expect(txt).toMatch(/same federation/);
  });

  it('reports the dataset shape from the tally, not hardcoded prose', () => {
    // These three numbers were literals in the template until they silently
    // went stale behind two dataset corrections. They must track the input.
    const txt = llmsTxt(manifest, slices, shape);
    expect(txt).toContain('54.2% of players have exactly one partner');
    expect(txt).toContain('39.4% entered exactly one tournament');
    expect(txt).toContain('the mean is 5.0 partners');

    const doubled = llmsTxt(manifest, slices, { ...shape, onePartner: 100 });
    expect(doubled).toContain('10.0% of players have exactly one partner');
  });

  it('does not divide by zero on an empty dataset', () => {
    const txt = llmsTxt(manifest, slices, emptyTally());
    expect(txt).toContain('0.0% of players');
    expect(txt).not.toMatch(/NaN/);
  });
});

describe('jsonLd', () => {
  it('cannot be closed early by a crafted string', () => {
    const html = jsonLd({ name: '</script><img onerror=alert(1)>' });
    expect(html).not.toContain('</script><img');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('stays valid JSON after escaping', () => {
    const html = jsonLd({ name: 'a < b', n: 1 });
    const body = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(body)).toEqual({ name: 'a < b', n: 1 });
  });
});

describe('routeChunks', () => {
  // The shape Vite writes: the entry, two page chunks, and a chunk the two share.
  const viteManifest = {
    'index.html': { file: 'assets/index-E.js', isEntry: true },
    'src/App.tsx': { file: 'assets/App-A.js', imports: ['index.html', '_shared-S.js'] },
    'src/TournamentRoute.tsx': { file: 'assets/T-T.js', imports: ['index.html', '_shared-S.js'] },
    '_shared-S.js': { file: 'assets/shared-S.js', imports: ['index.html'] },
  };

  it('lists the page chunk and the chunks it imports', () => {
    expect(routeChunks(viteManifest, 'src/TournamentRoute.tsx')).toEqual(['assets/T-T.js', 'assets/shared-S.js']);
  });

  it('leaves out the entry, which the template already loads', () => {
    expect(routeChunks(viteManifest, 'src/App.tsx')).not.toContain('assets/index-E.js');
  });

  it('refuses a page Vite did not build as a chunk of its own', () => {
    expect(() => routeChunks(viteManifest, 'src/RecordsRoute.tsx')).toThrow('no entry for src/RecordsRoute.tsx');
  });
});

describe('tournamentFacts', () => {
  const row = {
    slug: 'gstaad-2024-women',
    code: 'WGST2024',
    name: 'Gstaad',
    season: 2024,
    gender: 'W' as const,
    tier: 'beach-pro-tour' as const,
    group: 'tour' as never,
    level: 'Elite16',
    country: 'CH',
    start: new Date(Date.UTC(2024, 6, 9)),
    end: new Date(Date.UTC(2024, 6, 14)),
    played: true,
  };
  const countries = [
    { code: 'BRA', name: 'Brazil', iso2: 'BR', genders: {} },
    { code: 'NED', name: 'Netherlands', iso2: 'NL', genders: {} },
    { code: 'USA', name: 'United States', iso2: 'US', genders: {} },
  ];

  it('carries the countries the field flags and the ones its names link to', () => {
    const facts = tournamentFacts(
      row,
      { ...row, gender: 'M', slug: 'gstaad-2024-men' },
      // XXX has no published slice: no flag, no page, so not carried.
      { federations: ['USA', 'BRA', 'XXX', 'BRA'], elsewhere: { '101': 'NED-W', '102': null } },
      countries,
    );
    expect(facts.federations).toEqual({
      BRA: ['Brazil', 'BR'],
      NED: ['Netherlands', 'NL'],
      USA: ['United States', 'US'],
    });
    expect(facts.counterpart).toEqual({ gender: 'M', slug: 'gstaad-2024-men' });
    expect(facts.start).toBe('2024-07-09');
    expect(facts.end).toBe('2024-07-14');
    expect(facts).not.toHaveProperty('group');
  });

  it('has no counterpart, and no countries, for a lone draw with no field yet', () => {
    const facts = tournamentFacts({ ...row, played: false, start: null, end: null }, null, null, countries);
    expect(facts).toMatchObject({ counterpart: null, federations: {}, start: null, end: null, played: false });
  });

  it('names a photo count only when there are photographs', () => {
    expect(tournamentFacts(row, null, null, countries, 412).photos).toBe(412);
    expect(tournamentFacts(row, null, null, countries, 1).photos).toBe(1);
    // Zero is every page of a build without the switch: no key at all, so
    // the public facts do not mention photographs.
    expect(tournamentFacts(row, null, null, countries, 0)).not.toHaveProperty('photos');
    expect(tournamentFacts(row, null, null, countries)).not.toHaveProperty('photos');
  });

  it('cannot close its own script element', () => {
    const facts = tournamentFacts({ ...row, name: '</script><script>alert(1)' }, null, null, countries);
    const html = factsScript(facts);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(html.replace(/^<script[^>]*>|<\/script>$/g, '')).name).toBe('</script><script>alert(1)');
  });
});

describe('notFoundPage', () => {
  const html = notFoundPage(manifest, 13, '/assets/style-abc.css');

  it('gives the three ways back in, with the figures the data has', () => {
    const ways = [...html.matchAll(/<a href="([^"]*)"><span class="figure">([^<]*)<\/span><span class="unit">([^<]*)</g)].map(
      (m) => [m[1], m[2], m[3]],
    );
    expect(ways).toEqual([
      ['/', '15,628', 'players'],
      ['/tournaments/', '2,163', 'tournaments'],
      ['/records/', '13', 'records'],
    ]);
    expect(html).toContain('Every event since 1987');
    expect(html).toContain('<a href="/about/">about this project</a>');
  });

  it('is kept out of search, and is not the app', () => {
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('id="root"');
    expect(html).not.toContain('rel="canonical"');
  });

  it('names the missing path as text, never as markup', () => {
    // The path is whatever a stranger typed or linked; it must not reach the
    // page as HTML.
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(script).toContain('textContent = path');
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('borrows the stylesheet when there is one, and reads without it', () => {
    expect(html).toContain('<link rel="stylesheet" href="/assets/style-abc.css"/>');
    expect(notFoundPage(manifest, 13, null)).not.toContain('rel="stylesheet"');
  });
});
