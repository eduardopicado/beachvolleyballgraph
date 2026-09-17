import { describe, it, expect } from 'vitest';
import { buildTimeline, type TimelinePartner } from './timeline';
import type { GraphNode } from '../../../shared/schema';

const node = (id: number, name: string): GraphNode => ({
  id,
  name,
  short: name,
  tournaments: 0,
  first: 0,
  last: 0,
});

/** Seasons without a start offset — ordering then falls back to volume. */
const partner = (id: number, name: string, s: [number, number][]): TimelinePartner => ({
  node: node(id, name),
  s,
});

/** Seasons with one: `[season, tournaments, days from 1 Jan of the last event]`. */
const dated = (id: number, name: string, s: [number, number, number][]): TimelinePartner => ({
  node: node(id, name),
  s,
});

describe('buildTimeline', () => {
  it('groups partnerships by season, newest first', () => {
    const rows = buildTimeline([
      partner(1, 'Early', [
        [2018, 3],
        [2019, 1],
      ]),
      partner(2, 'Late', [[2021, 2]]),
    ]);
    expect(rows.map((r) => r.season)).toEqual([2021, 2019, 2018]);
  });

  it('puts two partners from the same season in one group', () => {
    // The whole point of the view: the partner list renders these as two
    // separate rows with overlapping ranges and no way to see the overlap.
    const rows = buildTimeline([
      dated(1, 'Doherty', [
        [2013, 2, 60],
        [2014, 8, 40],
      ]),
      dated(2, 'Hyden', [[2013, 5, 150]]),
    ]);
    const y2013 = rows.find((r) => r.season === 2013)!;
    // Hyden first: he was the later of the two, and the list runs newest
    // first throughout. Not because he played more — see the tie-break test.
    expect(y2013.partners.map((p) => p.node.name)).toEqual(['Hyden', 'Doherty']);
    expect(y2013.total).toBe(7);
  });

  it('runs partners within a season newest first, like the seasons themselves', () => {
    // Mixed directions were the bug: seasons descending but partners
    // ascending made the reading order jump at every season boundary.
    const rows = buildTimeline([
      dated(1, 'Middle', [[2020, 9, 120]]),
      dated(2, 'Earliest', [[2020, 1, 30]]),
      dated(3, 'Latest', [[2020, 4, 200]]),
    ]);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['Latest', 'Middle', 'Earliest']);
  });

  it('places a partner carried into the next season directly above themselves', () => {
    // The payoff of matching directions: a pairing that starts late in one
    // year and continues into the next reads as one block, not two rows
    // separated by everybody else from the earlier season.
    const rows = buildTimeline([
      dated(1, 'Bourne', [
        [2018, 2, 273],
        [2019, 11, 200],
      ]),
      dated(2, 'Mayer', [[2018, 5, 122]]),
      dated(3, 'Rosenthal', [[2018, 1, 3]]),
    ]);
    expect(rows.map((r) => [r.season, r.partners.map((p) => p.node.name)])).toEqual([
      [2019, ['Bourne']],
      [2018, ['Bourne', 'Mayer', 'Rosenthal']],
    ]);
  });

  it('sorts a season opening in the previous calendar year first', () => {
    // A southern-hemisphere season can open in December. The offset is signed
    // for exactly this: as a day-of-year that December event would be 350-odd
    // and sort last, behind the January events that actually followed it.
    const rows = buildTimeline([
      dated(1, 'January', [[2020, 3, 20]]),
      dated(2, 'PrevDecember', [[2020, 2, -10]]),
    ]);
    // Newest first, so January leads — but the December event must still be
    // understood as *earlier*, which a day-of-year would have got backwards.
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['January', 'PrevDecember']);
  });

  it('falls back to tournament count when a season carries no date', () => {
    const rows = buildTimeline([
      partner(1, 'Fewer', [[2020, 2]]),
      partner(2, 'More', [[2020, 7]]),
    ]);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['More', 'Fewer']);
  });

  it('puts a dated partner ahead of an undated one', () => {
    // Mixed data should not scatter the ones we do know about — and the
    // undated row must not win by being compared as an infinity.
    const rows = buildTimeline([
      partner(1, 'Undated', [[2020, 9]]),
      dated(2, 'Dated', [[2020, 1, 200]]),
    ]);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['Dated', 'Undated']);
  });

  it('merges a partner split across one season into a single row', () => {
    // A plays with A, switches to B, then goes back to A — all in 2013. The
    // year gets two rows, not three: the edge is keyed by the pair, so both
    // spells with A are already one number by the time this sees them.
    //
    // The offset is A's *last* event (day 200, after the return), so A still
    // sorts above B in a newest-first list — right for the resumed spell,
    // and the reason splitting the two apart would need per-tournament data
    // this edge does not carry.
    const rows = buildTimeline([
      dated(1, 'A', [[2013, 3, 200]]), // 1 tournament, then 2 more after the switch
      dated(2, 'B', [[2013, 2, 90]]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partners.map((p) => [p.node.name, p.t])).toEqual([
      ['A', 3],
      ['B', 2],
    ]);
    expect(rows[0]!.total).toBe(5);
  });

  it('breaks a same-day tie by tournaments, then name', () => {
    // Concurrent events do share a start date, so the old volume ordering
    // survives as the tie-break rather than being replaced outright.
    const rows = buildTimeline([
      dated(1, 'Zed', [[2020, 1, 50]]),
      dated(2, 'Abe', [[2020, 1, 50]]),
      dated(3, 'Most', [[2020, 9, 50]]),
    ]);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['Most', 'Abe', 'Zed']);
  });

  it('sums a season total across every partner in it', () => {
    const rows = buildTimeline([partner(1, 'A', [[2020, 4]]), partner(2, 'B', [[2020, 3]])]);
    expect(rows[0]!.total).toBe(7);
  });

  it('leaves gap years out entirely', () => {
    // A player who competed in 2015 and again in 2019 has two rows, not five.
    const rows = buildTimeline([
      partner(1, 'A', [
        [2015, 1],
        [2019, 1],
      ]),
    ]);
    expect(rows.map((r) => r.season)).toEqual([2019, 2015]);
  });

  it('returns nothing when no partner carries season data', () => {
    // Slices published before the field existed. The card reads an empty
    // result as "no timeline to offer" and hides the switch rather than
    // rendering a blank panel.
    expect(buildTimeline([{ node: node(1, 'A') }, { node: node(2, 'B') }])).toEqual([]);
  });

  it('handles a player with no partners at all', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('keeps partners that have season data when others do not', () => {
    const rows = buildTimeline([{ node: node(1, 'NoData') }, partner(2, 'HasData', [[2022, 1]])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partners.map((p) => p.node.name)).toEqual(['HasData']);
  });
});
