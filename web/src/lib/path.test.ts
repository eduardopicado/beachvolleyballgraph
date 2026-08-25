import { describe, expect, it } from 'vitest';
import {
  findPath,
  indexPartnerships,
  pairKey,
  pathEdgeKeys,
  pathNodeIds,
  reach,
} from './path';
import type { GraphEdge, GraphNode } from '../schema';

const node = (id: number, tournaments = 10): GraphNode => ({
  id,
  name: `Player ${id}`,
  short: `P${id}`,
  tournaments,
  first: 2010,
  last: 2020,
});

const edge = (a: number, b: number, t = 1, f = 2010, l = 2020): GraphEdge => ({ a, b, t, f, l });

/** A chain 1-2-3-4, plus 5-6 off on their own island. */
const chain = () =>
  indexPartnerships(
    [node(1), node(2), node(3), node(4), node(5), node(6)],
    [edge(1, 2, 40), edge(2, 3, 9), edge(3, 4, 67), edge(5, 6, 2)],
  );

const ids = (r: ReturnType<typeof findPath>) =>
  r?.kind === 'path' ? r.links.map((l) => l.node.id) : null;

describe('findPath', () => {
  it('walks the chain between two players', () => {
    expect(ids(findPath(chain(), 1, 4))).toEqual([1, 2, 3, 4]);
  });

  it('works in both directions', () => {
    expect(ids(findPath(chain(), 4, 1))).toEqual([4, 3, 2, 1]);
  });

  it('returns the shortest chain when more than one exists', () => {
    // 1-2-3-4 the long way, 1-4 directly. Breadth-first has to find the short one.
    const index = indexPartnerships(
      [node(1), node(2), node(3), node(4)],
      [edge(1, 2), edge(2, 3), edge(3, 4), edge(1, 4)],
    );
    expect(ids(findPath(index, 1, 4))).toEqual([1, 4]);
  });

  it('carries what each pair actually did, not just who they are', () => {
    // The chain is a claim, and the counts are what make it checkable.
    const result = findPath(chain(), 1, 4);
    expect(result?.kind).toBe('path');
    if (result?.kind !== 'path') return;
    expect(result.links.slice(1).map((l) => l.t)).toEqual([40, 9, 67]);
    expect(result.links[1]!.f).toBe(2010);
    expect(result.links[1]!.l).toBe(2020);
  });

  it('reports the thinnest partnership on the chain', () => {
    // A route through a pair who played once is a far weaker claim than one
    // through a career partnership, and nothing else on the row says so.
    const result = findPath(chain(), 1, 4);
    expect(result?.kind === 'path' && result.weakest).toBe(9);
  });

  it('gives the first player no incoming partnership to describe', () => {
    const result = findPath(chain(), 1, 4);
    expect(result?.kind === 'path' && result.links[0]!.t).toBe(0);
  });

  it('says the two are unconnected rather than pretending to fail', () => {
    // The common answer, not the error: measured on the published archive,
    // most pairs have no chain at all.
    const result = findPath(chain(), 1, 5);
    expect(result?.kind).toBe('unconnected');
    if (result?.kind !== 'unconnected') return;
    expect(result.fromReach).toBe(4); // 1-2-3-4
    expect(result.toReach).toBe(2); // 5-6
  });

  it('returns null when a player is not in this slice at all', () => {
    // Different from unconnected: there is nothing to say about them here.
    expect(findPath(chain(), 1, 99)).toBeNull();
    expect(findPath(chain(), 99, 1)).toBeNull();
  });

  it('handles a player asked about themselves', () => {
    const result = findPath(chain(), 3, 3);
    expect(ids(result)).toEqual([3]);
  });

  it('handles a player with no partners at all', () => {
    const index = indexPartnerships([node(1), node(2)], []);
    const result = findPath(index, 1, 2);
    expect(result?.kind).toBe('unconnected');
    expect(result?.kind === 'unconnected' && result.fromReach).toBe(1);
  });

  /**
   * The filter and the path have to agree. A route through a partnership the
   * reader has hidden with "min. events together" is a route they cannot see,
   * which reads as a bug rather than as an answer.
   */
  it('will not walk a partnership that was filtered out of the graph', () => {
    const nodes = [node(1), node(2), node(3)];
    const all = indexPartnerships(nodes, [edge(1, 2, 1), edge(2, 3, 1)]);
    expect(ids(findPath(all, 1, 3))).toEqual([1, 2, 3]);

    // Same slice with the one-event pairs filtered away.
    const filtered = indexPartnerships(nodes, []);
    expect(findPath(filtered, 1, 3)?.kind).toBe('unconnected');
  });

  it('ignores an edge whose endpoint is not in the slice', () => {
    // Guards against a filtered slice leaving a dangling endpoint, the same
    // way buildLayout does.
    const index = indexPartnerships([node(1), node(2)], [edge(1, 2), edge(2, 99)]);
    expect(index.neighbours.get(99)).toBeUndefined();
    expect(ids(findPath(index, 1, 2))).toEqual([1, 2]);
  });
});

/**
 * Among chains of equal length, the strongest one wins.
 *
 * The reason this exists: on the real Brazil men's graph, plain breadth-first
 * answered "Emanuel Rego to Marco Tullio" with four consecutive pairs who had
 * played a single tournament together, while a chain of the same length ran
 * through partnerships of 40 and 67. Both are five steps; only one is worth
 * reading.
 */
describe('choosing between chains of the same length', () => {
  // Two routes from 1 to 4, both two steps: through 2 (career partnerships)
  // or through 3 (a pair of one-offs).
  const forked = () =>
    indexPartnerships(
      [node(1), node(2), node(3), node(4)],
      [edge(1, 2, 40), edge(2, 4, 67), edge(1, 3, 1), edge(3, 4, 1)],
    );

  it('takes the route whose weakest partnership is strongest', () => {
    expect(ids(findPath(forked(), 1, 4))).toEqual([1, 2, 4]);
  });

  it('reports the chosen route\u2019s weakest link, not the other\u2019s', () => {
    const r = findPath(forked(), 1, 4);
    expect(r?.kind === 'path' && r.weakest).toBe(40);
  });

  it('still never trades length for strength', () => {
    // A one-step route through a single shared tournament beats a two-step
    // route through two career partnerships: the question is how *far* apart
    // they are, and strength only settles ties.
    const index = indexPartnerships(
      [node(1), node(2), node(3)],
      [edge(1, 3, 1), edge(1, 2, 90), edge(2, 3, 90)],
    );
    expect(ids(findPath(index, 1, 3))).toEqual([1, 3]);
  });

  it('gives the same answer every time it is asked', () => {
    // A tie broken by traversal order is not reproducible, which makes both
    // the tests and the URL of a shared path unreliable.
    const a = ids(findPath(forked(), 1, 4));
    const b = ids(findPath(forked(), 1, 4));
    expect(a).toEqual(b);
  });
});

describe('reach', () => {
  it('counts the players someone can get to, themselves included', () => {
    expect(reach(chain(), 1)).toBe(4);
    expect(reach(chain(), 6)).toBe(2);
  });

  it('is zero for someone outside the slice', () => {
    expect(reach(chain(), 99)).toBe(0);
  });
});

describe('highlighting', () => {
  it('names every player on the chain', () => {
    expect([...pathNodeIds(findPath(chain(), 1, 4))]).toEqual([1, 2, 3, 4]);
  });

  it('names every partnership on the chain, and no others', () => {
    const keys = pathEdgeKeys(findPath(chain(), 1, 4));
    expect([...keys].sort()).toEqual([pairKey(1, 2), pairKey(2, 3), pairKey(3, 4)].sort());
    expect(keys.has(pairKey(5, 6))).toBe(false);
  });

  it('lights nothing when there is no chain', () => {
    expect(pathNodeIds(findPath(chain(), 1, 5)).size).toBe(0);
    expect(pathEdgeKeys(findPath(chain(), 1, 5)).size).toBe(0);
    expect(pathNodeIds(null).size).toBe(0);
  });

  it('keys a pair the same way whichever end it is read from', () => {
    expect(pairKey(4, 9)).toBe(pairKey(9, 4));
  });
});
