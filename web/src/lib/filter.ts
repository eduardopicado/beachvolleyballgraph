/**
 * The partnership-strength filter, behind the "min. events together" control.
 *
 * Lifted out of a `useMemo` in App.tsx so it can be tested at all. It is the
 * one control on the page that changes what the graph, the stats, the table
 * and the player card each contain, and until this file existed it had no
 * coverage at any layer.
 */

import type { GraphEdge, GraphNode } from '../../../shared/schema';

export interface Slice {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Drop partnerships below `minTogether` shared tournaments, and drop players
 * left with no remaining partnership along with them.
 *
 * That second half is the part worth stating: without it, raising the
 * threshold leaves a field of unconnected dots — every player still present,
 * almost no lines — which reads as a broken graph rather than a filtered one.
 *
 * The node objects come through untouched, so `tournaments` still describes a
 * player's whole career. Node size is a property of the player, not of the
 * edges currently on screen; rescaling it to the filtered set would say
 * someone entered fewer tournaments than they did.
 *
 * A threshold of 1 or less means "no threshold", and returns the inputs by
 * reference — this runs on every render, and the identity is what keeps the
 * force layout from restarting.
 */
export function filterByStrength(
  nodes: GraphNode[],
  edges: GraphEdge[],
  minTogether: number,
): Slice {
  if (minTogether <= 1) return { nodes, edges };

  const kept = edges.filter((e) => e.t >= minTogether);
  const connected = new Set<number>();
  for (const e of kept) {
    connected.add(e.a);
    connected.add(e.b);
  }
  return { nodes: nodes.filter((n) => connected.has(n.id)), edges: kept };
}
