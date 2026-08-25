/**
 * The chain of partners linking two players, kept pure so it can be tested
 * without a browser or a rendered graph.
 *
 * Scoped to one slice on purpose. There is no global network to walk: measured
 * over the whole published archive, 12,075 players fall into 2,100
 * disconnected components and the largest holds 5% of them. Men and women never
 * partner, and an FIVB pair represents a single federation, so only 111 of
 * 13,931 partnerships cross one at all. Emanuel Rego has no path to Duda and
 * never will. Inside a country it is a different picture — 192 of Brazil's 234
 * men are in one group, a median of 4 steps apart — and that is the question
 * this answers: how are these two connected, on the page you are looking at.
 */

import type { GraphEdge, GraphNode } from '../schema';

/** One partnership along the chain: who, and what the pair actually did. */
export interface PathLink {
  node: GraphNode;
  /** Tournaments this pair entered together, and the seasons they span. */
  t: number;
  f: number;
  l: number;
}

export interface PathFound {
  kind: 'path';
  /** Endpoints included, so `links.length - 1` is the number of steps. */
  links: PathLink[];
  /**
   * The thinnest partnership on the chain.
   *
   * A route through a pair who played once together is a much weaker claim
   * than one through a career partnership, and the difference is invisible
   * unless it is said.
   */
  weakest: number;
}

export interface PathMissing {
  kind: 'unconnected';
  /** How many players each endpoint can reach, themselves included. */
  fromReach: number;
  toReach: number;
}

export type PathResult = PathFound | PathMissing | null;

export interface PartnershipIndex {
  neighbours: Map<number, Set<number>>;
  nodes: Map<number, GraphNode>;
  /** Edge data by unordered pair, keyed `min:max`. */
  edges: Map<string, { t: number; f: number; l: number }>;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Build the adjacency once per slice, rather than per query.
 *
 * Deliberately takes the *filtered* nodes and edges the graph is showing. A
 * path through a partnership the reader has hidden with "min. events together"
 * would be a route they cannot see, which reads as a bug rather than an answer.
 */
export function indexPartnerships(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): PartnershipIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map<number, Set<number>>();
  const edgeData = new Map<string, { t: number; f: number; l: number }>();

  const link = (a: number, b: number) => {
    let set = neighbours.get(a);
    if (!set) neighbours.set(a, (set = new Set()));
    set.add(b);
  };

  for (const e of edges) {
    // An edge whose endpoint was filtered out is not walkable.
    if (!byId.has(e.a) || !byId.has(e.b)) continue;
    link(e.a, e.b);
    link(e.b, e.a);
    edgeData.set(pairKey(e.a, e.b), { t: e.t, f: e.f, l: e.l });
  }

  return { neighbours, nodes: byId, edges: edgeData };
}

/** How many players this one can reach, themselves included. */
export function reach(index: PartnershipIndex, id: number): number {
  if (!index.nodes.has(id)) return 0;
  const seen = new Set([id]);
  const queue = [id];
  for (let head = 0; head < queue.length; head++) {
    for (const next of index.neighbours.get(queue[head]!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size;
}

/**
 * The shortest chain from one player to another.
 *
 * Breadth-first for the length, then a second pass to choose between the
 * chains of that length: the one whose weakest partnership is strongest wins.
 * Several routes usually tie on length, and picking by traversal order picks
 * badly — see the note inside.
 *
 * `null` when either player is not in the slice. `unconnected` — which is the
 * common answer, not the error — when both are present but no chain joins
 * them; 17% of Brazil's men sit outside their slice's main group.
 */
export function findPath(index: PartnershipIndex, from: number, to: number): PathResult {
  const start = index.nodes.get(from);
  const end = index.nodes.get(to);
  if (!start || !end) return null;

  if (from === to) return { kind: 'path', links: [{ node: start, t: 0, f: 0, l: 0 }], weakest: 0 };

  // Distance from `from`, by breadth-first layer.
  const depth = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const next of index.neighbours.get(at) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(at)! + 1);
      queue.push(next);
    }
  }

  if (!depth.has(to)) {
    return { kind: 'unconnected', fromReach: reach(index, from), toReach: reach(index, to) };
  }

  /**
   * Among the shortest chains — and there are usually several — take the one
   * whose weakest partnership is strongest.
   *
   * Without this the answer is whichever route the traversal happened to reach
   * first, and on real data that is frequently the worst one: asked for Emanuel
   * Rego to Marco Tullio, plain breadth-first returned four consecutive pairs
   * who played a single tournament together, while a chain of the same length
   * existed through partnerships of 40 and 67. Both are five steps; only one is
   * worth reading. It also makes the result deterministic, which a tie broken
   * by iteration order is not.
   *
   * `best[v]` is the strongest weakest-link over any shortest chain reaching v,
   * built one layer at a time, so this costs a single extra pass over the
   * edges.
   */
  const best = new Map<number, number>([[from, Infinity]]);
  const cameFrom = new Map<number, number>();
  const byDepth = [...depth.entries()].sort((a, b) => a[1] - b[1]);
  for (const [at, d] of byDepth) {
    if (d === 0) continue;
    let bottleneck = -1;
    let via = -1;
    for (const prev of index.neighbours.get(at) ?? []) {
      if (depth.get(prev) !== d - 1) continue;
      const upstream = best.get(prev);
      if (upstream === undefined) continue;
      const edge = index.edges.get(pairKey(prev, at));
      if (!edge) continue;
      const candidate = Math.min(upstream, edge.t);
      // Ties settled by id, so the same slice always yields the same chain.
      if (candidate > bottleneck || (candidate === bottleneck && prev < via)) {
        bottleneck = candidate;
        via = prev;
      }
    }
    if (via < 0) continue;
    best.set(at, bottleneck);
    cameFrom.set(at, via);
  }

  // Walk the trail back, then read it forwards.
  const ids: number[] = [];
  for (let at = to; at !== from; at = cameFrom.get(at)!) ids.push(at);
  ids.push(from);
  ids.reverse();

  const links: PathLink[] = [];
  let weakest = Infinity;
  for (let i = 0; i < ids.length; i++) {
    const node = index.nodes.get(ids[i]!)!;
    if (i === 0) {
      links.push({ node, t: 0, f: 0, l: 0 });
      continue;
    }
    const edge = index.edges.get(pairKey(ids[i - 1]!, ids[i]!))!;
    weakest = Math.min(weakest, edge.t);
    links.push({ node, t: edge.t, f: edge.f, l: edge.l });
  }

  return { kind: 'path', links, weakest: Number.isFinite(weakest) ? weakest : 0 };
}

/** The ids on a found path, for lighting them up in the graph. */
export function pathNodeIds(result: PathResult): Set<number> {
  if (result?.kind !== 'path') return new Set();
  return new Set(result.links.map((l) => l.node.id));
}

/** The partnerships on a found path, keyed the way the graph can look them up. */
export function pathEdgeKeys(result: PathResult): Set<string> {
  const keys = new Set<string>();
  if (result?.kind !== 'path') return keys;
  for (let i = 1; i < result.links.length; i++) {
    keys.add(pairKey(result.links[i - 1]!.node.id, result.links[i]!.node.id));
  }
  return keys;
}

export { pairKey };
