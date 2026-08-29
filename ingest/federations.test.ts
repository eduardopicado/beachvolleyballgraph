import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { federationSpans, PLACEHOLDER_FEDERATIONS, resolveFederation } from './federations';
import type { PlayersFile } from '../web/src/schema.js';

/** How often each code appears on the pair's *other* entries that season. */
const season = (counts: Record<string, number>) => new Map(Object.entries(counts));

describe('resolveFederation', () => {
  it('passes a single code straight through', () => {
    expect(resolveFederation(['BRA'], season({}))).toEqual({ code: 'BRA', why: 'only' });
  });

  it('normalises case and whitespace', () => {
    expect(resolveFederation([' bra '], season({}))?.code).toBe('BRA');
  });

  it('treats repeats of one code as no conflict at all', () => {
    // The 176 duplicate entries that agree — qualification and main draw, or an
    // entry withdrawn and re-made. Nothing to decide.
    expect(resolveFederation(['BRA', 'BRA'], season({}))).toEqual({ code: 'BRA', why: 'only' });
  });

  it('never lets a placeholder beat a real federation', () => {
    for (const placeholder of PLACEHOLDER_FEDERATIONS) {
      if (!placeholder) continue;
      expect(resolveFederation([placeholder, 'NOR'], season({}))).toEqual({
        code: 'NOR',
        why: 'placeholder',
      });
    }
  });

  it('has nothing to say when every code is a placeholder', () => {
    // Better to omit the federation than to tell a reader a pair represented
    // "ZZZ".
    expect(resolveFederation(['ZZZ'], season({}))).toBeNull();
    expect(resolveFederation(['ZZZ', 'FIV'], season({}))).toBeNull();
  });

  it('has nothing to say when there is no code', () => {
    expect(resolveFederation([], season({}))).toBeNull();
    expect(resolveFederation(['', '  '], season({}))).toBeNull();
  });

  /**
   * The case this whole file exists for.
   *
   * Taiana Lima has exactly two non-Brazilian rows in the archive: 2010 Gstaad
   * and 2010 Stare Jablonki, both tagged AZE, both duplicates of BRA rows for
   * the same events, both partnered with Vivian Cunha — who moved to
   * Azerbaijan in *2015*. Those AZE rows carry higher team ids than Vivian's
   * genuine 2015 Azerbaijani entries, so they were written afterwards and
   * reached back onto old events.
   *
   * Every other 2010 entry for both women says BRA. The season decides it, and
   * a legend stays Brazilian.
   */
  it('lets the pair’s own season overrule a retroactive edit', () => {
    expect(resolveFederation(['BRA', 'AZE'], season({ BRA: 6, AZE: 0 }))).toEqual({
      code: 'BRA',
      why: 'season-majority',
    });
  });

  it('follows the season the other way too, so it is not just a BRA rule', () => {
    expect(resolveFederation(['BRA', 'AZE'], season({ BRA: 0, AZE: 7 }))).toEqual({
      code: 'AZE',
      why: 'season-majority',
    });
  });

  it('admits when it is guessing', () => {
    // Two real codes and no season evidence either way. Deciding silently is
    // how a legend ends up filed under the wrong country.
    const result = resolveFederation(['AZE', 'BRA'], season({}));
    expect(result?.why).toBe('arbitrary');
  });

  it('guesses the same way every time, so a rebuild is reproducible', () => {
    const a = resolveFederation(['VEN', 'ARG'], season({}));
    const b = resolveFederation(['ARG', 'VEN'], season({}));
    expect(a).toEqual(b);
  });

  it('reports a dropped placeholder as a decision, not as silence', () => {
    // The 2008 Phuket row: ZZZ against NOR. Real answer, but somebody should
    // know the data was ambiguous.
    expect(resolveFederation(['ZZZ', 'NOR'], season({}))?.why).toBe('placeholder');
    expect(resolveFederation(['NOR'], season({}))?.why).toBe('only');
  });
});

describe('federationSpans', () => {
  it('reads oldest season first, whatever order they arrived in', () => {
    const spans = federationSpans(new Map([[2013, 'QAT'], [2005, 'BRA'], [2010, 'BRA']]));
    expect(spans).toEqual([
      [2005, 'BRA'],
      [2010, 'BRA'],
      [2013, 'QAT'],
    ]);
  });

  it('is empty when a partnership carried no usable code', () => {
    expect(federationSpans(new Map())).toEqual([]);
  });
});

/**
 * What the published data actually says, rather than what the rule does in the
 * abstract.
 *
 * Two published away partnerships describe themselves with a federation that
 * is not the partner's current one, and both are the Solberg/Tiago shape: a
 * partnership from before somebody transferred. If that number moves, either
 * FIVB corrected something or we broke something, and either is worth looking
 * at rather than finding out from a screenshot.
 */
describe('the published away rows', () => {
  const files = readdirSync(new URL('../web/public/v1/players', import.meta.url));
  const rows: { self: string; partner: string; fed: string; at: [number, string][] }[] = [];
  for (const f of files) {
    const file = JSON.parse(
      readFileSync(new URL(`../web/public/v1/players/${f}`, import.meta.url), 'utf8'),
    ) as PlayersFile;
    for (const p of file.players) {
      for (const a of p.away ?? []) {
        if (a.at) rows.push({ self: p.name, partner: a.name, fed: a.fed, at: a.at });
      }
    }
  }

  it('all carry the federation the pair actually represented', () => {
    // Vacuity guard: if the field stopped being published this would pass on
    // an empty list.
    //
    // Was 200, and the fall to 111 is the point rather than a regression. The
    // field used to be emitted from the team code alone, which on a mixed pair
    // is player 1's and says nothing true about the other player. A span is
    // now kept only where *both* players are independently recorded in that
    // federation, so 110 rows stopped claiming one — including every row on
    // Gisi Gavio's card, where nothing in the data establishes her federation
    // at all.
    expect(rows.length).toBeGreaterThan(90);
  });

  /**
   * Every published span agrees with the partner's own record.
   *
   * The assertion the whole corroboration exists for: a span survives only if
   * the player it describes was independently in that federation at the time.
   * Before it, Gisi Gavio's card said her five Italian partners represented
   * Brazil, and 31 of 110 flag pairs asserted a transfer that never happened.
   */
  it('claims nothing about Gisi Gavio in either direction', () => {
    // She is listed first on all fifteen of her rows, never listed second, and
    // never partnered a Brazilian — so the BRA on every one of them is there
    // because she was player 1, and nothing independent says what federation
    // she held. Not "she was Brazilian" and not "she was Italian": unknown, and
    // the published data must say so by saying nothing.
    expect(rows.filter((r) => r.self.includes('Gisi') || r.partner.includes('Gisi'))).toEqual([]);
  });

  it('never describes a partnership with a placeholder', () => {
    const bad = rows.filter((r) => r.at.some(([, fed]) => PLACEHOLDER_FEDERATIONS.has(fed)));
    expect(bad).toEqual([]);
  });

  it('reads oldest season first on every row', () => {
    const unsorted = rows.filter((r) =>
      r.at.some(([season], i) => i > 0 && season < r.at[i - 1]![0]),
    );
    expect(unsorted).toEqual([]);
  });

  /**
   * The case that made all of this necessary. Taiana Lima is Brazilian and
   * never played for Azerbaijan; her partner Vivian Cunha moved there in 2015,
   * and VIS carries AZE rows for two 2010 events that were written years
   * afterwards. Before the fix those rows were the only ones the ingest kept,
   * because the Brazilian originals have a blank Rank and are filtered as
   * "did not play".
   */
  it('keeps Taiana Lima Brazilian', () => {
    const hers = rows.filter((r) => r.self.includes('Taiana Lima'));
    expect(hers.length).toBeGreaterThan(0);
    for (const row of hers) {
      for (const [season, fed] of row.at) {
        expect(fed, `${row.self} with ${row.partner} in ${season}`).toBe('BRA');
      }
    }
  });

  it('says Solberg and Tiago were Brazilians in 2005, not Qataris', () => {
    const row = rows.find((r) => r.self.includes('Pedro Solberg') && r.partner.includes('Tiago'));
    expect(row, 'the partnership this whole change is about is missing').toBeTruthy();
    expect(row!.fed).toBe('QAT'); // where Tiago is today, and where the row links to
    expect(row!.at).toEqual([[2005, 'BRA']]); // what was true at the time
  });
});
