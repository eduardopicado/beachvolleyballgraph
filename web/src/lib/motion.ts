/**
 * Does this reader want motion?
 *
 * Shared because two very different things ask: the graph decides whether to
 * animate the force simulation or settle it off-screen, and the player card
 * decides whether to scroll to itself smoothly or arrive instantly. Both are
 * the same question and must not drift apart.
 *
 * Guards `matchMedia` because the prerender runs this module in Node, where
 * there is no window at all.
 */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
