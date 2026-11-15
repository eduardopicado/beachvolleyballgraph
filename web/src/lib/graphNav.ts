/**
 * Moving around the graph with the arrow keys.
 *
 * Every node used to be a tab stop of its own: on the Brazilian women's graph
 * that put 198 presses of Tab between the filters and the table under them,
 * in an order (the order the nodes happen to be drawn in) that means nothing
 * on screen. The graph is one tab stop now, and the arrows move within it to
 * the nearest player in the direction pressed.
 */

export interface Placed {
  id: number;
  x: number;
  y: number;
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const STEP: Record<ArrowKey, readonly [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function isArrowKey(key: string): key is ArrowKey {
  // Own keys only: `'toString' in STEP` is true.
  return Object.hasOwn(STEP, key);
}

/**
 * The node an arrow key moves to from `fromId`, or null at the graph's edge.
 *
 * "Nearest in that direction" needs a rule for a node that is close but well
 * off to one side. Distance along the arrow counts once and distance across it
 * twice, so Right prefers a player straight to the right over a slightly
 * nearer one that is mostly above; and anything more across than along (outside
 * a 45° cone) is left to the other pair of arrows, which is what keeps Right
 * followed by Left coming back to where it started more often than not.
 *
 * When the cone is empty the half-plane is searched instead, so a player out
 * on a limb can still be reached and the keys only stop at a true edge.
 */
export function nextNode(nodes: readonly Placed[], fromId: number, key: ArrowKey): number | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const [sx, sy] = STEP[key];

  let inCone: { id: number; cost: number } | null = null;
  let ahead: { id: number; cost: number } | null = null;
  for (const node of nodes) {
    if (node.id === fromId) continue;
    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const along = dx * sx + dy * sy;
    if (along <= 0) continue;
    const across = Math.abs(dx * sy) + Math.abs(dy * sx);
    const cost = along + 2 * across;
    if (across <= along && (inCone === null || cost < inCone.cost)) inCone = { id: node.id, cost };
    if (ahead === null || cost < ahead.cost) ahead = { id: node.id, cost };
  }
  return (inCone ?? ahead)?.id ?? null;
}

/**
 * Which node holds the graph's one tab stop.
 *
 * The one last focused, while it is still drawn; otherwise the selected
 * player, so Tab lands on whoever the card is about; otherwise the first node.
 * A filter change can remove any of them, hence the membership checks.
 */
export function tabStop(
  nodes: readonly { id: number }[],
  lastFocused: number | null,
  selected: number | null,
): number | null {
  const has = (id: number | null): id is number => id !== null && nodes.some((n) => n.id === id);
  if (has(lastFocused)) return lastFocused;
  if (has(selected)) return selected;
  return nodes[0]?.id ?? null;
}
