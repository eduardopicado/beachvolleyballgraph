import { describe, expect, it } from 'vitest';
import { compareTeammates, parseTeammateBatch, sampleForCheck } from './teammates';

const set = (...ids: number[]) => new Set(ids);

describe('parseTeammateBatch', () => {
  it('reads one teammate set per request, in order', () => {
    const body =
      '<?xml version="1.0" encoding="utf-8" standalone="yes"?>' +
      '<Responses><OK>100619 101452</OK><OK>145124 145125</OK></Responses>';
    expect(parseTeammateBatch(body, 2)).toEqual([set(100619, 101452), set(145124, 145125)]);
  });

  it('treats a player with no partnerships as an answer, not a failure', () => {
    // Both shapes VIS uses for "nobody". Reading either as an error would make
    // the check quietly skip exactly the players most likely to be wrong.
    const body = '<Responses><OK></OK><OK/></Responses>';
    expect(parseTeammateBatch(body, 2)).toEqual([set(), set()]);
  });

  /**
   * The trap this parser exists for.
   *
   * Responses carry no player number — position is the only link back to the
   * request. Drop a failed one instead of leaving a hole and every answer after
   * it is attributed to the wrong player, which does not look like a bug: it
   * looks like a partnership mismatch, on a player that is fine.
   */
  it('keeps an error response in its slot rather than dropping it', () => {
    const body = '<Responses><OK>1 2</OK><BadParameter id="1002">No</BadParameter><OK>7 8</OK></Responses>';
    expect(parseTeammateBatch(body, 3)).toEqual([set(1, 2), null, set(7, 8)]);
  });

  it('pads a short response so later slots cannot shift up', () => {
    const body = '<Responses><OK>1 2</OK></Responses>';
    expect(parseTeammateBatch(body, 3)).toEqual([set(1, 2), null, null]);
  });

  it('never returns more answers than were asked for', () => {
    const body = '<Responses><OK>1</OK><OK>2</OK><OK>3</OK></Responses>';
    expect(parseTeammateBatch(body, 2)).toHaveLength(2);
  });

  it('gives up on a response carrying something that is not a player number', () => {
    // Better to report "no answer" than to compare against half a list and
    // announce a mismatch that is really a parse failure.
    const body = '<Responses><OK>1 2</OK><OK>oops 4</OK></Responses>';
    expect(parseTeammateBatch(body, 2)[1]).toBeNull();
  });
});

describe('compareTeammates', () => {
  it('says nothing when VIS confirms every published partner', () => {
    const ours = new Map([[1, set(2, 3)]]);
    const theirs = new Map([[1, set(2, 3)]]);
    expect(compareTeammates(ours, theirs)).toEqual({
      checked: 1,
      agreed: 1,
      mismatches: [],
      unanswered: 0,
    });
  });

  it('ignores partners VIS has and we do not', () => {
    // The whole point of the one-directional invariant: VIS includes domestic
    // events and never-played entries, so its list is always a superset.
    const ours = new Map([[1, set(2)]]);
    const theirs = new Map([[1, set(2, 3, 4, 5)]]);
    const result = compareTeammates(ours, theirs);
    expect(result.mismatches).toEqual([]);
    expect(result.agreed).toBe(1);
  });

  it('reports a partnership we publish that VIS has no record of', () => {
    const ours = new Map([[1, set(2, 99)]]);
    const theirs = new Map([[1, set(2)]]);
    expect(compareTeammates(ours, theirs).mismatches).toEqual([{ player: 1, missing: [99] }]);
  });

  it('counts an unanswered player apart from an agreeing one', () => {
    // A player VIS declined is not evidence of correctness, and folding the
    // two together would let a run of errors read as a clean check.
    const ours = new Map([
      [1, set(2)],
      [2, set(1)],
    ]);
    const theirs = new Map([
      [1, set(2)],
      [2, null],
    ]);
    const result = compareTeammates(ours, theirs);
    expect(result).toMatchObject({ checked: 1, agreed: 1, unanswered: 1 });
  });

  it('treats a player we publish no partners for as agreeing', () => {
    const ours = new Map<number, Set<number>>();
    const theirs = new Map([[1, set(5, 6)]]);
    expect(compareTeammates(ours, theirs).agreed).toBe(1);
  });

  it('puts the worst offender first', () => {
    const ours = new Map([
      [1, set(9)],
      [2, set(7, 8, 9)],
    ]);
    const theirs = new Map([
      [1, set()],
      [2, set()],
    ]);
    expect(compareTeammates(ours, theirs).mismatches.map((m) => m.player)).toEqual([2, 1]);
  });
});

describe('sampleForCheck', () => {
  const many = (n: number) => {
    const m = new Map<number, Set<number>>();
    for (let i = 0; i < n; i++) m.set(1000 + i, set(...Array.from({ length: i % 7 }, (_, k) => k)));
    return m;
  };

  it('returns everyone when there are fewer players than the sample', () => {
    expect(sampleForCheck(many(5), 300)).toHaveLength(5);
  });

  it('is deterministic, so a failure can be reproduced from the log', () => {
    const players = many(5000);
    expect(sampleForCheck(players, 300)).toEqual(sampleForCheck(players, 300));
  });

  it('never asks for more players than requested', () => {
    expect(sampleForCheck(many(5000), 300).length).toBeLessThanOrEqual(300);
  });

  it('includes the busiest careers, which carry the most edges', () => {
    const players = new Map<number, Set<number>>();
    players.set(1, set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    for (let i = 2; i <= 200; i++) players.set(i, set(1));
    expect(sampleForCheck(players, 10)).toContain(1);
  });

  it('spreads across the whole id range rather than one era', () => {
    // Ids cluster by era, so a contiguous slice would sample one decade and
    // leave the rest permanently unchecked.
    const players = many(5000);
    const picked = sampleForCheck(players, 300);
    const ids = [...players.keys()].sort((a, b) => a - b);
    const midpoint = ids[Math.floor(ids.length / 2)]!;
    expect(picked.some((id) => id < midpoint)).toBe(true);
    expect(picked.some((id) => id > midpoint)).toBe(true);
  });

  it('comes back sorted, so batches and diffs are stable', () => {
    const picked = sampleForCheck(many(5000), 300);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
  });
});
