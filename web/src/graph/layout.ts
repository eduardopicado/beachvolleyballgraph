/**
 * Force layout for a partnership graph.
 *
 * These graphs are made of many small components — a handful of large clusters
 * of players who partnered widely, plus a long tail of pairs who played
 * together once and with nobody else. The x/y centring forces are what keep
 * that tail from drifting off-canvas.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphNode } from '../schema';

export interface LayoutNode extends SimulationNodeDatum, GraphNode {
  /** Distinct partners — the node's degree. */
  degree: number;
  radius: number;
}

export interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  source: LayoutNode | number;
  target: LayoutNode | number;
  t: number;
  f: number;
  l: number;
  width: number;
}

export const MIN_RADIUS = 4;
export const MAX_RADIUS = 22;

/**
 * Area-proportional sizing: radius scales with the square root of tournaments
 * played, so a player with 4x the appearances reads as 4x the area rather than
 * 4x the width.
 */
export function radiusScale(maxTournaments: number) {
  const max = Math.max(maxTournaments, 1);
  return (tournaments: number) => {
    // Clamped so a value above `max` can never inflate a node past MAX_RADIUS.
    const ratio = Math.min(Math.sqrt(Math.max(tournaments, 1) / max), 1);
    return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * ratio;
  };
}

/**
 * Log-scaled rather than sqrt: partnership counts are heavily right-skewed
 * (most pairs share 1-5 tournaments; a handful of career partnerships run into
 * the hundreds), and sqrt compresses exactly the low end where nearly all the
 * data sits. `log1p` spreads that common range out instead, so the common case
 * is distinguishable rather than just the outliers.
 *
 * Pairs with this with `vector-effect: non-scaling-stroke` on `.link` (see
 * PartnershipGraph.css) — without it, the pan/zoom transform multiplies this
 * whole range by the current zoom level, which for a country zoomed out to
 * fit the screen can shrink it to well under a pixel of visible difference.
 */
export function edgeWidth(t: number, maxT: number): number {
  const ratio = Math.log1p(Math.max(t, 1)) / Math.log1p(Math.max(maxT, 1));
  return 1 + 5 * ratio;
}

export interface BuiltLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
  simulation: Simulation<LayoutNode, LayoutLink>;
  /** Distinct partners, by node id. */
  neighbours: Map<number, Set<number>>;
}

export function buildLayout(graphNodes: GraphNode[], graphEdges: GraphEdge[]): BuiltLayout {
  const neighbours = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    let set = neighbours.get(a);
    if (!set) neighbours.set(a, (set = new Set()));
    set.add(b);
  };
  for (const e of graphEdges) {
    link(e.a, e.b);
    link(e.b, e.a);
  }

  const maxTournaments = graphNodes.reduce((m, n) => Math.max(m, n.tournaments), 1);
  const radiusOf = radiusScale(maxTournaments);
  const maxT = graphEdges.reduce((m, e) => Math.max(m, e.t), 1);

  const nodes: LayoutNode[] = graphNodes.map((n) => ({
    ...n,
    degree: neighbours.get(n.id)?.size ?? 0,
    radius: radiusOf(n.tournaments),
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: LayoutLink[] = graphEdges.flatMap((e) => {
    const source = byId.get(e.a);
    const target = byId.get(e.b);
    if (!source || !target) return [];
    return [{ source, target, t: e.t, f: e.f, l: e.l, width: edgeWidth(e.t, maxT) }];
  });

  // The layout runs in its own coordinate space sized to the graph, not to the
  // viewport, and the view is fitted to the result afterwards. That keeps
  // spacing consistent across window sizes and stops a dense country from
  // collapsing into an unreadable blob just because the canvas is small.
  const extent = Math.max(600, Math.sqrt(nodes.length) * 62);
  const centre = extent / 2;

  const simulation = forceSimulation<LayoutNode, LayoutLink>(nodes)
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((d) => d.id)
        // Pairs who played many events together sit closer.
        .distance((l) => 58 - Math.min(30, l.t * 2))
        .strength(0.6),
    )
    // Repulsion is deliberately short-range. These graphs are one big component
    // plus a long tail of isolated pairs; with global repulsion the tail is
    // flung into a wide halo, which then dictates the zoom and shrinks the part
    // anyone actually wants to read.
    .force('charge', forceManyBody<LayoutNode>().strength(-190).distanceMax(340))
    .force('collide', forceCollide<LayoutNode>((d) => d.radius + 6).strength(1).iterations(2))
    .force('x', forceX<LayoutNode>(centre).strength(0.085))
    .force('y', forceY<LayoutNode>(centre).strength(0.1))
    .alpha(1)
    .alphaDecay(0.022)
    .velocityDecay(0.4);

  return { nodes, links, simulation, neighbours };
}

/** Run the simulation to rest without painting — used for reduced motion. */
export function settle(simulation: Simulation<LayoutNode, LayoutLink>, ticks = 320): void {
  simulation.stop();
  for (let i = 0; i < ticks; i++) simulation.tick();
}

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/**
 * Scale and centre the laid-out graph so all of it is on screen. Without this
 * the simulation's own coordinate space bleeds past the viewport and the outer
 * clusters are simply invisible.
 */
export function fitToView(
  nodes: LayoutNode[],
  width: number,
  height: number,
  padding = 28,
): ViewTransform {
  if (nodes.length === 0 || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = n.radius + 2;
    minX = Math.min(minX, (n.x ?? 0) - r);
    maxX = Math.max(maxX, (n.x ?? 0) + r);
    minY = Math.min(minY, (n.y ?? 0) - r);
    maxY = Math.max(maxY, (n.y ?? 0) + r);
  }

  const boxW = Math.max(maxX - minX, 1);
  const boxH = Math.max(maxY - minY, 1);
  // Never magnify past 1: a five-node country should sit at natural size in the
  // middle rather than being blown up to fill the canvas.
  const k = Math.min((width - padding * 2) / boxW, (height - padding * 2) / boxH, 1);

  return {
    k,
    x: (width - boxW * k) / 2 - minX * k,
    y: (height - boxH * k) / 2 - minY * k,
  };
}

/**
 * Smallest on-screen radius a node can be aimed at, in CSS pixels — a 44px
 * target, which is Apple's HIG minimum and comfortably over WCAG 2.5.8's 24px.
 *
 * This has to be applied in *screen* space. The obvious implementation, a
 * generous `r` on a transparent circle inside the pan/zoom group, silently
 * scales with the view: measured on the built site, a 14-unit hit circle came
 * out at a median 4.6px of radius on a 390px-wide phone showing Brazil's men
 * (k=0.33) and 4.1px for the United States (k=0.29) — 9.2px and 8.2px across,
 * against those two minimums, which are widths. The labels next to them
 * already counter-scale for exactly this reason; the hit areas did not.
 */
export const MIN_TAP_RADIUS = 22;

/**
 * The node at a point, or null for empty canvas.
 *
 * Nearest-centre-wins rather than "whichever transparent circle the browser
 * hit-tested first". Once targets are 44px wide they overlap constantly — in
 * the United States men's graph at its default fit, 358 of 398 nodes sit within
 * 22px of another node's centre — and stacked SVG circles resolve that by DOM
 * order, which is aggregation order and means nothing to the reader. Nearest
 * centre is at least the thing they aimed at.
 *
 * `px`/`py` are relative to the canvas's top-left corner, in CSS pixels.
 * Distances are compared squared, so this stays a single pass with no `sqrt`
 * over the largest slice's 422 nodes on every mouse move.
 */
export function nodeAtPoint(
  nodes: LayoutNode[],
  view: ViewTransform,
  px: number,
  py: number,
): LayoutNode | null {
  let best: LayoutNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const dx = px - ((node.x ?? 0) * view.k + view.x);
    const dy = py - ((node.y ?? 0) * view.k + view.y);
    const distance = dx * dx + dy * dy;
    // A big node keeps its own painted area as the target; a small one is
    // padded up to the floor. Without the first half, zooming right into a
    // 22px-radius dot would leave its edges unclickable.
    const reach = Math.max(node.radius * view.k + 8, MIN_TAP_RADIUS);
    if (distance <= reach * reach && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** Rough on-screen width of a node label at the 11px label size. */
const labelWidth = (name: string) => name.length * 5.7 + 14;

/**
 * Clear screen pixels required between one label and its neighbours.
 *
 * This, not a count, is what decides how many names a view carries. The rule
 * is geometric, so it answers the question a reader actually asks — "there is
 * obviously room here, why is that dot not named?" — at every zoom level and
 * on every screen, without a number to re-tune when either changes.
 *
 * 8px, measured rather than picked: Brazil's men at 900x620 carry 75 names
 * against the 16 a hard cap allowed, and 32 against 16 on a 390px phone — more
 * names everywhere, and still a clear gap between any two. At 12 the phone
 * gained nothing over the old cap; at 4 the labels touched.
 *
 * Labels are still allowed to cross *dots*, as they always have been. Treating
 * dots as obstacles too was built and then thrown away: dots are what the core
 * of a dense graph is made of, so the rule pushed every name out to the sparse
 * rim and cost Emanuel, Ricardo, Pedro Solberg and Bruno Schmidt their labels
 * — the graph stopped naming the players it exists to be about. Obvious in a
 * screenshot, invisible in the counts, which had it costing almost nothing.
 */
export const LABEL_GUTTER = 8;


/**
 * Choose which labels to draw.
 *
 * Labelling the top N by appearances puts every label in the dense core, where
 * they overlap into mush. Instead, walk players from most to least prominent
 * and keep a label only when its box is clear of every label already placed —
 * so the graph self-thins, and sparse regions get labelled too.
 *
 * `max` is a backstop against a pathological viewport, not the design control
 * it used to be. It sat at 16, which on every real slice was reached long
 * before the geometry ran out: at 900x620 Brazil's men had room for 108 names
 * and drew 16 of them, which is exactly the "there was space right there"
 * complaint. Whatever is dropped now is dropped for want of room, and the
 * ranking means it is the least prominent players who lose out.
 */
export function pickLabels(
  nodes: LayoutNode[],
  view: ViewTransform,
  width: number,
  height: number,
  max = 120,
): Set<number> {
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const chosen = new Set<number>();
  const ranked = [...nodes].sort((a, b) => b.tournaments - a.tournaments || b.degree - a.degree);

  const overlaps = (
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
  ) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

  for (const node of ranked) {
    if (chosen.size >= max) break;
    const cx = (node.x ?? 0) * view.k + view.x;
    const cy = (node.y ?? 0) * view.k + view.y;
    const w = labelWidth(node.short);
    const top = cy - node.radius * view.k - 18;
    const box = { x1: cx - w / 2, y1: top, x2: cx + w / 2, y2: top + 16 };

    // Off-canvas labels are wasted picks.
    if (box.x1 < 0 || box.x2 > width || box.y1 < 0 || box.y2 > height) continue;

    // The gutter is applied to the candidate only, so two labels end up with
    // one gutter between them rather than two.
    const padded = {
      x1: box.x1 - LABEL_GUTTER,
      y1: box.y1 - LABEL_GUTTER,
      x2: box.x2 + LABEL_GUTTER,
      y2: box.y2 + LABEL_GUTTER,
    };
    if (placed.some((p) => overlaps(padded, p))) continue;

    placed.push(box);
    chosen.add(node.id);
  }
  return chosen;
}
