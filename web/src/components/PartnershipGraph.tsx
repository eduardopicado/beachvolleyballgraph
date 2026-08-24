/**
 * The graph canvas.
 *
 * React owns the SVG structure (one <line> per partnership, one <g> per player)
 * and never re-renders it during simulation. The force ticks write x/y straight
 * to the DOM through refs — re-rendering ~1,500 elements at 60fps through React
 * would drop frames on the larger countries.
 *
 * Selection and hover only toggle CSS classes, which is cheap enough to go
 * through React normally.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphNode } from '../schema';
import {
  buildLayout,
  fitToView,
  nodeAtPoint,
  pickLabels,
  settle,
  type LayoutLink,
  type LayoutNode,
} from '../graph/layout';
import { pairKey } from '../lib/path';
import { seasonSpan, plural } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import './PartnershipGraph.css';

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Bumped by the parent to re-run the layout (e.g. "re-tangle" button). */
  layoutKey: number;
  /**
   * Reports the canvas's actual rendered size on every resize, so the parent
   * can match another element's height to it. A plain CSS grid/flex "stretch"
   * can't do this on its own when the sibling's content wants to be taller
   * than the row: intrinsic row-sizing computes each item's natural size as
   * if percentage heights were auto, so a percentage-height sibling ends up
   * sized to its own unclamped content rather than actually capped at the
   * row height. An explicit pixel value from here sidesteps that entirely.
   */
  onSize?: (size: { width: number; height: number }) => void;
  /**
   * A partnership path to light up, if one is open.
   *
   * When set it takes over the dimming entirely — hover and selection stop
   * deciding what is bright, because the reader is asking one question and the
   * picture should answer that one. Edges are keyed by `pairKey` from lib/path.
   */
  pathIds?: ReadonlySet<number> | null;
  pathEdges?: ReadonlySet<string> | null;
}

interface Hover {
  node: LayoutNode;
  x: number;
  y: number;
}

/**
 * How far a pointer may travel and still count as a tap rather than a drag.
 *
 * A finger never lands and lifts on the same pixel, so without a tolerance
 * every touch is a pan; much above this and a deliberate short drag starts
 * selecting whatever it ended on.
 */
const TAP_SLOP = 8;

export function PartnershipGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  layoutKey,
  onSize,
  pathIds,
  pathEdges,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<number, SVGGElement>());
  const labelEls = useRef(new Map<number, SVGGElement>());
  const linkEls = useRef<(SVGLineElement | null)[]>([]);
  const [size, setSize] = useState({ width: 900, height: 620 });
  // The simulation callbacks outlive any single render, so they read the
  // container size through a ref — otherwise a resize mid-simulation fits the
  // graph to whatever the size was when the layout was built.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [hover, setHover] = useState<Hover | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  // Read at pointer-up to toggle the tap target off if it is already selected.
  // A ref rather than a dependency: the pointer handlers are stable across the
  // whole gesture, and rebuilding them mid-drag on a selection change would
  // drop the pan bookkeeping they hold.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  /**
   * Anchor the tooltip to the node's simulation coordinates rather than the
   * pointer, so it stays put on keyboard focus too.
   */
  const showHover = useCallback((node: LayoutNode) => {
    const t = transformRef.current;
    setHover((prev) =>
      prev?.node.id === node.id
        ? prev
        : { node, x: (node.x ?? 0) * t.k + t.x, y: (node.y ?? 0) * t.k + t.y },
    );
  }, []);

  // --- responsive sizing ---------------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onSize?.(size);
  }, [size, onSize]);

  // The layout has its own coordinate space, so it does not depend on viewport
  // size and a resize never restarts the simulation.
  //
  // `layoutKey` is a deliberate cache-buster, not a value the body reads: the
  // "re-tangle" button bumps it to force a fresh simulation from the same
  // nodes and edges. The lint rule can only see that it is unused and asks for
  // it to be dropped, which would make the button do nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => buildLayout(nodes, edges), [nodes, edges, layoutKey]);

  const { neighbours } = layout;
  const [labelled, setLabelled] = useState<Set<number>>(() => new Set());

  // Once the reader pans or zooms, stop auto-framing and leave the view alone.
  const userAdjusted = useRef(false);
  useEffect(() => {
    userAdjusted.current = false;
  }, [layout]);

  // Whether the simulation has stopped moving and the view has had its initial
  // fit. Anything that wants to take the view over (see the pan-to-selection
  // effect) has to wait for this, or it claims the view before the graph has
  // been framed even once.
  const [settled, setSettled] = useState(false);

  // --- run the simulation --------------------------------------------------
  useEffect(() => {
    const { simulation } = layout;
    let frame = 0;

    const applyView = (view: { x: number; y: number; k: number }) => {
      viewRef.current?.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    };

    const paint = () => {
      for (let i = 0; i < layout.links.length; i++) {
        const el = linkEls.current[i];
        const link = layout.links[i];
        if (!el || !link) continue;
        const s = link.source as LayoutNode;
        const t = link.target as LayoutNode;
        el.setAttribute('x1', String(s.x ?? 0));
        el.setAttribute('y1', String(s.y ?? 0));
        el.setAttribute('x2', String(t.x ?? 0));
        el.setAttribute('y2', String(t.y ?? 0));
      }
      for (const node of layout.nodes) {
        const at = `translate(${node.x ?? 0},${node.y ?? 0})`;
        const el = nodeEls.current.get(node.id);
        if (el) el.setAttribute('transform', at);
        // The label layer is positioned separately now, so it has to be driven
        // from the same tick or labels lag a frame behind their dots.
        const label = labelEls.current.get(node.id);
        if (label) label.setAttribute('transform', at);
      }
      // Keep the whole graph framed while it expands, or the reader spends the
      // animation looking at a zoomed-in corner of it.
      if (!userAdjusted.current && frame++ % 5 === 0) {
        const { width, height } = sizeRef.current;
        applyView(fitToView(layout.nodes, width, height));
      }
    };

    // Once the graph stops moving, frame it and decide which labels fit.
    const finish = () => {
      const { width, height } = sizeRef.current;
      const view = userAdjusted.current
        ? transformRef.current
        : fitToView(layout.nodes, width, height);
      if (!userAdjusted.current) {
        setTransform(view);
        applyView(view);
      }
      // No cap passed: how many names fit is a question about the geometry of
      // this view, and pickLabels is where that geometry lives. A number here
      // was the thing actually deciding, and it decided 16 everywhere -- on a
      // 900x620 desktop view of Brazil's men there was room for over a hundred.
      setLabelled(pickLabels(layout.nodes, view, width, height));
      setSettled(true);
    };

    setSettled(false);

    // Warm the layout up off-screen so the first painted frame is already
    // structured, rather than an exploding ball of nodes at the centre.
    simulation.stop();
    for (let i = 0; i < 130; i++) simulation.tick();
    paint();

    if (prefersReducedMotion()) {
      settle(simulation, 200);
      paint();
      finish();
      return () => simulation.stop();
    }
    simulation.on('tick', paint);
    simulation.on('end', finish);
    simulation.alpha(0.6).restart();
    return () => {
      simulation.on('tick', null);
      simulation.on('end', null);
      simulation.stop();
    };
    // `size` is deliberately absent, and needs no suppression to be: it is read
    // through `sizeRef` rather than as a dependency, so re-fitting on resize is
    // handled separately and a drag of the window doesn't restart the layout.
  }, [layout]);

  // Re-frame (but never re-simulate) when the container resizes.
  useEffect(() => {
    if (userAdjusted.current) return;
    if (layout.simulation.alpha() > layout.simulation.alphaMin()) return;
    const view = fitToView(layout.nodes, size.width, size.height);
    setTransform(view);
    setLabelled(pickLabels(layout.nodes, view, size.width, size.height));
  }, [layout, size]);

  // Pan to keep a newly selected player in view — otherwise "select" (from
  // search, a table row, or a partner link in the card) leaves the reader
  // hunting for a highlighted dot somewhere in a graph that hasn't moved.
  // Zoom level is left alone; only the pan target changes. Runs whenever
  // selectedId changes to a different, real node — not on every render, and
  // not for a deselect.
  const centeredIdRef = useRef<number | null>(null);
  // A relayout (filter change, re-tangle) moves every node, including
  // whichever one is still selected — its last centering is now stale even
  // though selectedId itself didn't change, so forget it and let the effect
  // below re-fire for the current layout.
  useEffect(() => {
    centeredIdRef.current = null;
  }, [layout]);
  useEffect(() => {
    // Wait for the initial fit. A player selected before the graph has settled
    // — which is exactly what a shared `?player=` link does — would otherwise
    // claim the view on mount, and because claiming it means setting
    // `userAdjusted`, the one-time `fitToView` would never run at all: the
    // graph stays at the default scale with a third of its nodes off-canvas.
    // Waiting also means the pan inherits the *fitted* zoom rather than 1.
    if (!settled) return;
    if (selectedId === null || selectedId === centeredIdRef.current) return;
    const node = layout.nodes.find((n) => n.id === selectedId);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    centeredIdRef.current = selectedId;
    userAdjusted.current = true; // don't let the resize auto-fit undo this
    setTransform((prev) => ({
      k: prev.k,
      x: size.width / 2 - (node.x ?? 0) * prev.k,
      y: size.height / 2 - (node.y ?? 0) * prev.k,
    }));
  }, [selectedId, layout, size, settled]);

  // --- pan & zoom ------------------------------------------------------------
  // Every active pointer's last known position, keyed by pointerId. A single
  // pointer drags to pan; a second one joining mid-gesture switches to pinch
  // (spread distance -> zoom, midpoint travel -> pan), and dropping back to one
  // resumes panning from wherever that finger currently is, rather than jumping
  // back to the original single-finger start.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panStart = useRef<{ pointerId: number; x: number; y: number; transform: typeof transform } | null>(
    null,
  );
  const pinchStart = useRef<{
    distance: number;
    mid: { x: number; y: number };
    transform: typeof transform;
  } | null>(null);

  /**
   * The in-flight gesture, for telling a tap from a pan at pointer-up.
   *
   * Selection used to be an `onClick` on each node's `<g>`, which forced
   * pointer-down on a node to opt out of panning entirely — otherwise the drag
   * and the click fought over the same gesture. That was survivable while the
   * targets were a few pixels wide; at 44px it would make most of a dense graph
   * un-pannable, because almost anywhere you put a finger is on a node. So the
   * canvas now owns the whole gesture and decides afterwards: travel under
   * TAP_SLOP with one finger is a tap, anything else was a pan or a pinch.
   */
  const gesture = useRef<{ pointerId: number; x: number; y: number; moved: number; multi: boolean } | null>(
    null,
  );

  const distanceAndMid = (pts: { x: number; y: number }[]) => {
    const [a, b] = pts;
    return { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
  };

  /** The node under a client-space point, or null. */
  const hitTest = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return nodeAtPoint(layout.nodes, transformRef.current, clientX - rect.left, clientY - rect.top);
    },
    [layout],
  );

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    // Touch/pen contacts report button 0 too, but aren't "a button held down"
    // in the mouse sense — only gate on it for an actual mouse.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    userAdjusted.current = true;

    const svg = event.currentTarget;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nice-to-have (keeps events routed here if a finger
         slides outside the SVG); gesture tracking below works without it */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      // Second finger joined: hand off from panning to pinch.
      panStart.current = null;
      svg.classList.remove('is-panning');
      const pts = [...pointers.current.values()];
      pinchStart.current = { ...distanceAndMid(pts), transform: transformRef.current };
      // A pinch is never a tap, however little either finger ends up moving.
      if (gesture.current) gesture.current.multi = true;
    } else if (pointers.current.size === 1) {
      pinchStart.current = null;
      panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, transform: transformRef.current };
      svg.classList.add('is-panning');
      gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, multi: false };
    }
    // A third simultaneous pointer is tracked but otherwise ignored — pinch
    // math keeps using whichever two pointers were already active.
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) {
      // No button down: this is a mouse crossing the canvas. Hover comes from
      // the same hit test as selection, so the node the tooltip names is always
      // the node a click would select — two different resolutions (the browser's
      // topmost-element for hover, nearest-centre for the tap) would disagree
      // wherever targets overlap, which is most of a dense graph.
      if (event.pointerType !== 'mouse') return;
      const node = hitTest(event.clientX, event.clientY);
      svgRef.current?.classList.toggle('is-over-node', node !== null);
      if (node) showHover(node);
      else setHover((prev) => (prev ? null : prev));
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const g = gesture.current;
    if (g && g.pointerId === event.pointerId) {
      g.moved = Math.max(g.moved, Math.hypot(event.clientX - g.x, event.clientY - g.y));
    }

    if (pointers.current.size >= 2 && pinchStart.current) {
      const pts = [...pointers.current.values()].slice(0, 2);
      const { distance, mid } = distanceAndMid(pts);
      const { distance: d0, mid: mid0, transform: t0 } = pinchStart.current;
      const k = Math.min(4, Math.max(0.25, t0.k * (distance / d0)));
      const rect = event.currentTarget.getBoundingClientRect();
      const px = mid0.x - rect.left;
      const py = mid0.y - rect.top;
      // Anchor the pinch's starting midpoint in graph space (same trick as
      // onWheel), then add however far the midpoint itself has travelled.
      setTransform({
        k,
        x: px - ((px - t0.x) / t0.k) * k + (mid.x - mid0.x),
        y: py - ((py - t0.y) / t0.k) * k + (mid.y - mid0.y),
      });
    } else if (pointers.current.size === 1 && panStart.current?.pointerId === event.pointerId) {
      const { x: startX, y: startY, transform: start } = panStart.current;
      setTransform({ ...start, x: start.x + (event.clientX - startX), y: start.y + (event.clientY - startY) });
    }
  }, [hitTest, showHover]);

  const endPointer = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    const svg = event.currentTarget;
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }

    // Settle the gesture before the pan bookkeeping below reassigns anything.
    const g = gesture.current;
    if (event.type === 'pointerup' && g?.pointerId === event.pointerId && !g.multi && g.moved <= TAP_SLOP) {
      const node = hitTest(event.clientX, event.clientY);
      // Tapping the canvas closes the card. On a phone the card sits below the
      // fold, so without this the only way to dismiss it is to scroll down and
      // find the × — and a reader who opened it by mistake has no reason to
      // expect it is down there at all.
      onSelect(node ? (node.id === selectedIdRef.current ? null : node.id) : null);
      // Touch has no hover: leaving the tooltip up would park it over the graph
      // until something else happened to clear it.
      if (event.pointerType !== 'mouse') setHover(null);
    }
    if (g?.pointerId === event.pointerId) gesture.current = null;

    if (pointers.current.size === 1) {
      // Dropped from two fingers to one: resume panning from here, not from
      // the surviving finger's original touch-down position, or the view jumps.
      const survivor = [...pointers.current.entries()][0];
      if (survivor) {
        const [pointerId, pos] = survivor;
        pinchStart.current = null;
        panStart.current = { pointerId, x: pos.x, y: pos.y, transform: transformRef.current };
        svg.classList.add('is-panning');
      }
    } else if (pointers.current.size === 0) {
      panStart.current = null;
      pinchStart.current = null;
      svg.classList.remove('is-panning');
    }
  }, [hitTest, onSelect]);

  // Bound natively rather than through an `onWheel` prop, and explicitly
  // non-passive. React registers `wheel` on its root container as a *passive*
  // listener, which makes `preventDefault()` inside a React wheel handler a
  // silent no-op ("Unable to preventDefault inside passive event listener
  // invocation") — so zooming the graph also scrolled the page out from under
  // the reader, several hundred pixels per gesture. `touch-action: none` in
  // the CSS already covers the pinch path; this is the mouse/trackpad half.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      userAdjusted.current = true;
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setTransform((prev) => {
        const k = Math.min(4, Math.max(0.25, prev.k * Math.exp(-event.deltaY * 0.0015)));
        // Keep the point under the cursor fixed while scaling.
        return { k, x: px - ((px - prev.x) / prev.k) * k, y: py - ((py - prev.y) / prev.k) * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    userAdjusted.current = true;
    setTransform((prev) => {
      const k = Math.min(4, Math.max(0.25, prev.k * factor));
      const cx = size.width / 2;
      const cy = size.height / 2;
      return { k, x: cx - ((cx - prev.x) / prev.k) * k, y: cy - ((cy - prev.y) / prev.k) * k };
    });
  };

  // --- highlight state -----------------------------------------------------
  const activeId = hover?.node.id ?? selectedId;
  const activeNeighbours = activeId === null ? null : (neighbours.get(activeId) ?? new Set<number>());

  // A path answers one question, so while it is open it owns the dimming: hover
  // and selection stop deciding what is bright.
  const onPath = pathIds && pathIds.size > 0 ? pathIds : null;

  const nodeClass = (node: LayoutNode) => {
    if (onPath) return onPath.has(node.id) ? 'node is-active' : 'node is-dimmed';
    if (activeId === null) return 'node';
    if (node.id === activeId) return 'node is-active';
    if (activeNeighbours?.has(node.id)) return 'node is-partner';
    return 'node is-dimmed';
  };

  const linkClass = (link: LayoutLink) => {
    const s = (link.source as LayoutNode).id;
    const t = (link.target as LayoutNode).id;
    if (onPath) {
      return pathEdges?.has(pairKey(s, t)) ? 'link is-active' : 'link is-dimmed';
    }
    if (activeId === null) return 'link';
    return s === activeId || t === activeId ? 'link is-active' : 'link is-dimmed';
  };

  const labelClass = (node: LayoutNode) => {
    if (onPath) return onPath.has(node.id) ? 'label is-active' : 'label is-dimmed';
    if (activeId === null) return 'label';
    if (node.id === activeId) return 'label is-active';
    return activeNeighbours?.has(node.id) ? 'label' : 'label is-dimmed';
  };

  // Every player on the chain is named, whether or not the collision test would
  // have picked them: a route you cannot read the names of is not an answer.
  const showLabel = (node: LayoutNode) =>
    onPath?.has(node.id) ||
    labelled.has(node.id) ||
    node.id === activeId ||
    (activeNeighbours?.has(node.id) ?? false);

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="graph"
        width={size.width}
        height={size.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        // Hover is resolved against node centres rather than by the browser
        // hit-testing an element, so nothing fires a "left the node" event when
        // the mouse slides off the canvas mid-graph — the tooltip would stay up
        // over whatever the reader moved on to.
        onPointerLeave={() => {
          svgRef.current?.classList.remove('is-over-node');
          setHover(null);
        }}
        role="group"
        aria-label={`Partnership graph: ${plural(nodes.length, 'player')}, ${plural(edges.length, 'partnership')}. Use the table view below for a screen-reader friendly listing.`}
      >
        <g ref={viewRef} transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          <g className="links">
            {layout.links.map((link, i) => (
              <line
                key={`${(link.source as LayoutNode).id}-${(link.target as LayoutNode).id}`}
                ref={(el) => {
                  linkEls.current[i] = el;
                }}
                className={linkClass(link)}
                strokeWidth={link.width}
              />
            ))}
          </g>
          <g className="nodes">
            {layout.nodes.map((node) => (
              <g
                key={node.id}
                data-node={node.id}
                className={nodeClass(node)}
                ref={(el) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                }}
                tabIndex={0}
                role="button"
                aria-label={`${node.name}, ${plural(node.tournaments, 'tournament')}, ${plural(node.degree, 'partner')}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(node.id === selectedId ? null : node.id);
                  }
                }}
                onFocus={() => showHover(node)}
                onBlur={() => setHover(null)}
              >
                {/*
                  Not the tap target. Selection is resolved against node centres
                  by the canvas (see `hitTest` and `nodeAtPoint`), which is what
                  gives every node its 44px of reach — this circle only has to
                  give the group a bounding box centred on the dot, for the
                  focus ring and for anything automating a click on it.

                  Deliberately *not* grown to MIN_TAP_RADIUS. Sized in screen
                  pixels these circles are 44px wide and overlap constantly, and
                  since they still take pointer events, the topmost one over any
                  given dot is whichever node happens to render last —
                  `elementFromPoint` at a node's own centre starts returning a
                  neighbour, and a click driven off the box never lands.
                */}
                <circle className="hit" r={Math.max(node.radius + 8, 14)} />
                <circle className="dot" r={node.radius} />
              </g>
            ))}
          </g>
          {/*
            Labels are a layer of their own rather than a child of each node,
            and that is load-bearing in two ways.

            Hovering reveals the labels of a player and all their partners. With
            the text inside the node group, that changed the group's bounding
            box the instant the cursor arrived — and a click driven off that box
            oscillates: the box grows, its centre moves off the dot, the cursor
            follows it, the hover drops, the box shrinks back. Playwright sat in
            exactly that loop until it timed out ("element is not stable").

            It also fixes the z-order. Every label now paints above every dot,
            instead of being overlapped by whichever nodes happen to render
            after it.
          */}
          <g className="labels">
            {layout.nodes.filter(showLabel).map((node) => (
              <g
                key={node.id}
                ref={(el) => {
                  if (el) labelEls.current.set(node.id, el);
                  else labelEls.current.delete(node.id);
                }}
                transform={`translate(${node.x ?? 0},${node.y ?? 0})`}
              >
                {/* Counter-scale so label text keeps a constant on-screen size
                    however far the view is zoomed out. Inside this transform
                    one unit is one screen pixel. */}
                <text
                  className={labelClass(node)}
                  transform={`scale(${1 / transform.k})`}
                  y={-(node.radius * transform.k + 7)}
                >
                  {node.short}
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>

      <div className="graph-controls">
        <button type="button" onClick={() => zoomBy(1.35)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            userAdjusted.current = false;
            const view = fitToView(layout.nodes, size.width, size.height);
            setTransform(view);
            setLabelled(pickLabels(layout.nodes, view, size.width, size.height));
          }}
          aria-label="Fit graph to view"
          className="reset"
        >
          Fit
        </button>
      </div>

      {hover && (
        <div
          className="graph-tooltip"
          style={{
            left: Math.min(Math.max(hover.x, 12), size.width - 12),
            top: Math.max(hover.y - hover.node.radius - 14, 12),
          }}
          role="status"
        >
          <strong>{hover.node.name}</strong>
          <dl>
            <div>
              <dt>Tournaments</dt>
              <dd>{hover.node.tournaments}</dd>
            </div>
            <div>
              <dt>Partners</dt>
              <dd>{hover.node.degree}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{seasonSpan(hover.node.first, hover.node.last)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
