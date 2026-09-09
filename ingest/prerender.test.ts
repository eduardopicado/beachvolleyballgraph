import { describe, expect, it } from 'vitest';
import { emptyTally, esc, jsonLd, llmsTxt, tallySlice } from './prerender.js';
import type { GraphFile, Manifest } from '../web/src/schema.js';

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
