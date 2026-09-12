import { describe, expect, it } from 'vitest';
import { readEntry, type EntryTeam, type WithdrawnTeam } from '../schema';

/**
 * `readEntry` is the one place that knows how many elements an entry row has,
 * and the tuple already has three arities — so it is the one place a stale
 * published tree can break the page.
 */
describe('readEntry', () => {
  it('reads a full row', () => {
    const team: EntryTeam = [1, 2, 'ITA', 1178, 2240];
    expect(readEntry(team)).toEqual({
      a: 1,
      b: 2,
      federation: 'ITA',
      entry: 1178,
      tech: 2240,
      route: null,
    });
  });

  it('reads the entry route when there is one', () => {
    const team: EntryTeam = [1, 2, 'ITA', 302, 362, 'WC'];
    expect(readEntry(team).route).toBe('WC');
  });

  it('reads a three-element row from a tree published before the points existed', () => {
    // The shape the ingest wrote for one week, and the reason this function
    // exists rather than a destructure: a page built against the new schema
    // meets the old tree at least once, every time a field is added.
    const team = [1, 2, 'ITA'] as EntryTeam;
    expect(readEntry(team)).toEqual({
      a: 1,
      b: 2,
      federation: 'ITA',
      entry: null,
      tech: null,
      route: null,
    });
  });

  it('keeps a null apart from a zero', () => {
    // Repek/Pribanic entered Corigliano Rossano with no points at all, and
    // Schmidt/Schmidt with zero. "No ranking yet" and "ranked, at nothing"
    // are different statements and the table draws them differently.
    expect(readEntry([1, 2, 'CRO', null, null]).entry).toBe(null);
    expect(readEntry([3, 4, 'SUI', 0, 0]).entry).toBe(0);
  });

  it('does not mistake a withdrawal reason for an entry route', () => {
    // Both live in the sixth slot, and a withdrawn team rendered with a "WC"
    // badge would be a lie about how they got in.
    const gone: WithdrawnTeam = [1, 2, 'ESP', 780, 1360, 'withdrawn'];
    expect(readEntry(gone).route).toBe(null);
    expect(readEntry([3, 4, 'CZE', 582, 1296, 'medical'] as WithdrawnTeam).route).toBe(null);
  });

  it('accepts every route FIVB uses', () => {
    for (const route of ['WC', 'QWC', 'CS', 'OV'] as const) {
      expect(readEntry([1, 2, 'ITA', 100, 200, route]).route).toBe(route);
    }
  });
});
