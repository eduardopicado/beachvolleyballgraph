import { describe, expect, it } from 'vitest';
import {
  buildLayout,
  edgeWidth,
  fitToView,
  MAX_RADIUS,
  MIN_RADIUS,
  MIN_TAP_RADIUS,
  nodeAtPoint,
  pickLabels,
  radiusScale,
  settle,
  type LayoutNode,
} from './layout';
import type { GraphEdge, GraphNode } from '../schema';

const node = (id: number, tournaments = 10): GraphNode => ({
  id,
  name: `Player ${id}`,
  short: `P${id}`,
  tournaments,
  first: 2010,
  last: 2020,
});

const edge = (a: number, b: number, t = 1): GraphEdge => ({ a, b, t, f: 2010, l: 2020 });

describe('radiusScale', () => {
  it('is area-proportional: a quarter of the tournaments is half the radius offset', () => {
    const r = radiusScale(100);
    const offset = (t: number) => r(t) - MIN_RADIUS;
    expect(offset(25) / offset(100)).toBeCloseTo(0.5, 5);
  });

  it('clamps between the minimum and maximum radius', () => {
    const r = radiusScale(200);
    expect(r(0)).toBeCloseTo(r(1), 5); // zero is floored to one
    expect(r(200)).toBeGreaterThan(r(1));
    expect(r(200)).toBeCloseTo(MAX_RADIUS, 5);
    expect(r(1)).toBeGreaterThanOrEqual(MIN_RADIUS);
  });

  it('does not inflate a node whose count exceeds the stated maximum', () => {
    expect(radiusScale(200)(10_000)).toBeLessThanOrEqual(MAX_RADIUS);
  });

  it('never divides by zero when nobody has played a tournament', () => {
    expect(Number.isFinite(radiusScale(0)(0))).toBe(true);
  });
});

describe('edgeWidth', () => {
  it('grows with shared tournaments and stays bounded', () => {
    expect(edgeWidth(1, 100)).toBeLessThan(edgeWidth(50, 100));
    expect(edgeWidth(100, 100)).toBeCloseTo(6, 5);
    expect(edgeWidth(1, 1)).toBeCloseTo(6, 5);
  });

  it('separates the low end of the range, where most partnerships sit', () => {
    // Real partnership counts are heavily right-skewed: most pairs share 1-5
    // tournaments, a handful run into the hundreds. A sqrt scale (the previous
    // implementation) compresses exactly this common range — e.g. against a
    // maxT of 124 it put t=1..3 within 0.33px of each other, which on a
    // zoomed-out view is not a perceptible difference. This asserts the
    // low-end spread a reader can actually see stays above that floor.
    const maxT = 124;
    const spread = edgeWidth(3, maxT) - edgeWidth(1, maxT);
    expect(spread).toBeGreaterThan(0.5);
  });
});

describe('buildLayout', () => {
  it('derives degree from distinct partners', () => {
    const { nodes } = buildLayout([node(1), node(2), node(3)], [edge(1, 2), edge(1, 3)]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get(1)!.degree).toBe(2);
    expect(byId.get(2)!.degree).toBe(1);
  });

  it('records neighbours in both directions', () => {
    const { neighbours } = buildLayout([node(1), node(2)], [edge(1, 2)]);
    expect([...neighbours.get(1)!]).toEqual([2]);
    expect([...neighbours.get(2)!]).toEqual([1]);
  });

  it('drops an edge that references a node outside the slice', () => {
    // Guards against a filtered slice leaving a dangling endpoint.
    const { links } = buildLayout([node(1), node(2)], [edge(1, 2), edge(1, 99)]);
    expect(links).toHaveLength(1);
  });

  it('gives isolated players a degree of zero rather than undefined', () => {
    const { nodes } = buildLayout([node(1), node(2)], []);
    expect(nodes.every((n) => n.degree === 0)).toBe(true);
  });
});

/** Place nodes at known coordinates without running the simulation. */
const placed = (coords: [number, number][], radius = 5): LayoutNode[] =>
  coords.map(([x, y], i) => ({
    ...node(i + 1),
    x,
    y,
    degree: 0,
    radius,
  }));

describe('fitToView', () => {
  it('centres and scales the graph down to fit', () => {
    const nodes = placed([
      [0, 0],
      [1000, 1000],
    ]);
    const view = fitToView(nodes, 400, 400, 20);
    for (const n of nodes) {
      const sx = n.x! * view.k + view.x;
      const sy = n.y! * view.k + view.y;
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(400);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(400);
    }
  });

  it('never magnifies a small graph past natural size', () => {
    const view = fitToView(placed([[0, 0], [10, 10]]), 1000, 1000);
    expect(view.k).toBeLessThanOrEqual(1);
  });

  it('accounts for node radius so edge circles are not clipped', () => {
    const nodes = placed([[0, 0], [100, 0]], 40);
    const view = fitToView(nodes, 300, 300, 0);
    const left = nodes[0]!.x! * view.k + view.x - 40 * view.k;
    expect(left).toBeGreaterThanOrEqual(-0.001);
  });

  it('returns an identity transform for degenerate input instead of NaN', () => {
    expect(fitToView([], 400, 400)).toEqual({ x: 0, y: 0, k: 1 });
    expect(fitToView(placed([[0, 0]]), 0, 0)).toEqual({ x: 0, y: 0, k: 1 });
  });

  it('handles every node sharing one position', () => {
    const view = fitToView(placed([[50, 50], [50, 50]]), 400, 400);
    expect(Number.isFinite(view.k)).toBe(true);
    expect(Number.isFinite(view.x)).toBe(true);
  });
});

describe('pickLabels', () => {
  const identity = { x: 0, y: 0, k: 1 };

  it('does not label two nodes whose labels would overlap', () => {
    // Same spot: only one label can be placed.
    const nodes = placed([
      [200, 200],
      [202, 200],
    ]);
    expect(pickLabels(nodes, identity, 400, 400).size).toBe(1);
  });

  it('labels nodes that are comfortably apart', () => {
    const nodes = placed([
      [60, 60],
      [60, 300],
      [300, 60],
    ]);
    expect(pickLabels(nodes, identity, 400, 400).size).toBe(3);
  });

  it('prefers the player with more tournaments when labels collide', () => {
    const nodes = placed([[200, 200], [202, 200]]);
    nodes[0]!.tournaments = 5;
    nodes[1]!.tournaments = 500;
    expect([...pickLabels(nodes, identity, 400, 400)]).toEqual([nodes[1]!.id]);
  });

  it('never exceeds the requested maximum', () => {
    const nodes = placed(Array.from({ length: 60 }, (_, i) => [40 + (i % 10) * 90, 40 + Math.floor(i / 10) * 90]));
    expect(pickLabels(nodes, identity, 1200, 800, 5).size).toBeLessThanOrEqual(5);
  });

  it('skips labels that would fall outside the canvas', () => {
    const nodes = placed([[-500, -500], [5000, 5000]]);
    expect(pickLabels(nodes, identity, 400, 400).size).toBe(0);
  });
});

describe('settle', () => {
  it('produces finite coordinates for every node', () => {
    const layout = buildLayout(
      [node(1), node(2), node(3), node(4)],
      [edge(1, 2, 5), edge(2, 3), edge(3, 4)],
    );
    settle(layout.simulation, 60);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});

describe('nodeAtPoint', () => {
  const identity = { x: 0, y: 0, k: 1 };

  it('finds a node the pointer is directly over', () => {
    const nodes = placed([[100, 100]]);
    expect(nodeAtPoint(nodes, identity, 100, 100)?.id).toBe(1);
  });

  it('returns null for empty canvas, so a tap there can deselect', () => {
    const nodes = placed([[100, 100]]);
    expect(nodeAtPoint(nodes, identity, 400, 400)).toBeNull();
  });

  it('reaches a node from MIN_TAP_RADIUS away but not beyond it', () => {
    const nodes = placed([[100, 100]], 3);
    expect(nodeAtPoint(nodes, identity, 100 + MIN_TAP_RADIUS - 1, 100)?.id).toBe(1);
    expect(nodeAtPoint(nodes, identity, 100 + MIN_TAP_RADIUS + 1, 100)).toBeNull();
  });

  /**
   * The regression this whole change exists for. A hit area expressed in
   * user-space units shrinks with the view; measured on the built site, the
   * old 14-unit circle came out at 4.6px on a phone showing Brazil's men.
   */
  it('keeps the same on-screen reach however far the view is zoomed out', () => {
    const nodes = placed([[100, 100]], 3);
    for (const k of [1, 0.5, 0.33, 0.25]) {
      const view = { x: 0, y: 0, k };
      const sx = 100 * k;
      const sy = 100 * k;
      expect(nodeAtPoint(nodes, view, sx + MIN_TAP_RADIUS - 1, sy)?.id).toBe(1);
      expect(nodeAtPoint(nodes, view, sx + MIN_TAP_RADIUS + 1, sy)).toBeNull();
    }
  });

  it('grows the target with a big node rather than capping it at the floor', () => {
    // Zoomed in, a 40-unit radius node is 80px on screen — every painted pixel
    // of it has to stay clickable, which the floor alone would not give.
    const nodes = placed([[100, 100]], 40);
    const view = { x: 0, y: 0, k: 2 };
    expect(nodeAtPoint(nodes, view, 200 + 70, 200)?.id).toBe(1);
  });

  it('picks the nearest centre when targets overlap', () => {
    // Two nodes 20px apart: both are within reach of a point between them, so
    // DOM order would decide. The tap is 6px from the first and 14px from the
    // second, and must resolve to the first.
    const nodes = placed([
      [100, 100],
      [120, 100],
    ]);
    expect(nodeAtPoint(nodes, identity, 106, 100)?.id).toBe(1);
    expect(nodeAtPoint(nodes, identity, 114, 100)?.id).toBe(2);
  });

  it('respects the pan offset', () => {
    const nodes = placed([[0, 0]]);
    const view = { x: 250, y: 80, k: 1 };
    expect(nodeAtPoint(nodes, view, 250, 80)?.id).toBe(1);
    expect(nodeAtPoint(nodes, view, 0, 0)).toBeNull();
  });

  it('survives a node the simulation has not placed yet', () => {
    const nodes: LayoutNode[] = [{ ...node(1), degree: 0, radius: 5 }];
    expect(() => nodeAtPoint(nodes, identity, 0, 0)).not.toThrow();
  });
});
