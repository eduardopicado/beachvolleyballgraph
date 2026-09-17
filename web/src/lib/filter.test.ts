import { describe, expect, it } from 'vitest';
import { filterByStrength } from './filter';
import type { GraphEdge, GraphNode } from '../../../shared/schema';

const node = (id: number, tournaments = 10): GraphNode => ({
  id,
  name: `Player ${id}`,
  short: `P${id}`,
  tournaments,
  first: 2000,
  last: 2010,
});

const edge = (a: number, b: number, t: number): GraphEdge => ({ a, b, t, f: 2000, l: 2010 });

/**
 *   1 ═══ 2      5 events
 *   3 ─── 4      1 event
 *   5            no partnership at all
 */
const NODES = [node(1), node(2), node(3), node(4), node(5)];
const EDGES = [edge(1, 2, 5), edge(3, 4, 1)];

describe('filterByStrength', () => {
  it('keeps everything at the "All" setting', () => {
    const { nodes, edges } = filterByStrength(NODES, EDGES, 1);
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(2);
  });

  it('returns the inputs by reference when there is no threshold', () => {
    // Identity, not just equality: this runs on every render, and a fresh
    // array each time restarts the force layout — the graph would twitch on
    // any unrelated state change.
    const { nodes, edges } = filterByStrength(NODES, EDGES, 1);
    expect(nodes).toBe(NODES);
    expect(edges).toBe(EDGES);
  });

  it('drops partnerships below the threshold', () => {
    const { edges } = filterByStrength(NODES, EDGES, 2);
    expect(edges).toEqual([edge(1, 2, 5)]);
  });

  it('drops players left with no remaining partnership', () => {
    // The half of the rule that matters: without it the graph keeps all five
    // players and shows one line, which reads as broken rather than filtered.
    const { nodes } = filterByStrength(NODES, EDGES, 2);
    expect(nodes.map((n) => n.id)).toEqual([1, 2]);
  });

  it('drops a player who had no partnership even at the "All" threshold', () => {
    // Player 5 is only ever visible unfiltered — nothing connects them.
    expect(filterByStrength(NODES, EDGES, 1).nodes.map((n) => n.id)).toContain(5);
    expect(filterByStrength(NODES, EDGES, 2).nodes.map((n) => n.id)).not.toContain(5);
  });

  it('includes a pair exactly on the threshold', () => {
    // "2+" means two, not three. An off-by-one here silently loses the
    // largest group of pairs, since partnership counts skew low.
    expect(filterByStrength(NODES, [edge(1, 2, 2)], 2).edges).toHaveLength(1);
    expect(filterByStrength(NODES, [edge(1, 2, 1)], 2).edges).toHaveLength(0);
  });

  it('leaves node size describing the whole career', () => {
    // A player with 40 tournaments who kept one strong partnership is still a
    // 40-tournament player; rescaling to the filtered edges would understate
    // every career on screen.
    const veteran = node(1, 40);
    const { nodes } = filterByStrength([veteran, node(2, 3)], [edge(1, 2, 5)], 5);
    expect(nodes[0]!.tournaments).toBe(40);
  });

  it('does not mutate what it was given', () => {
    const nodes = [...NODES];
    const edges = [...EDGES];
    filterByStrength(nodes, edges, 3);
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(2);
  });

  it('can empty the graph entirely', () => {
    // Reachable in the UI: most countries have no pair with 10+ events
    // together, and the empty state depends on this returning nothing rather
    // than a scatter of partnerless players.
    const { nodes, edges } = filterByStrength(NODES, EDGES, 10);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('handles an empty slice without a threshold special case', () => {
    expect(filterByStrength([], [], 1)).toEqual({ nodes: [], edges: [] });
    expect(filterByStrength([], [], 5)).toEqual({ nodes: [], edges: [] });
  });

  it('keeps a player connected by any one qualifying partnership', () => {
    // A hub whose other partnerships all fall away stays, because one edge
    // survives — the rule is per player, not per edge.
    const edges = [edge(1, 2, 5), edge(1, 3, 1), edge(1, 4, 1)];
    const { nodes } = filterByStrength(NODES, edges, 2);
    expect(nodes.map((n) => n.id)).toEqual([1, 2]);
  });
});
