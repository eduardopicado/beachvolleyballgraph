/**
 * Start a player's portrait before it is asked for.
 *
 * The card shows a portrait from FIVB's image service, a different origin that
 * nothing touches until a reader opens somebody. `index.html` preconnects to
 * it so the first click does not pay for DNS, TCP and TLS — but a preconnected
 * socket that goes unused is dropped after a few seconds, and a reader explores
 * the graph for far longer than that before clicking anyone. Measured against
 * `sharp.fivb.com`: 26ms after 3 seconds idle, 91ms after 15, 187ms after 45,
 * against 434ms from properly cold.
 *
 * Hovering a node or a row is the reader saying which player they are about to
 * open. Fetching then does two things at once — it re-establishes the
 * connection *and* starts the image — so the click lands on a picture that is
 * already there or nearly. A pointer takes 100-300ms to travel and settle,
 * which is most of the gap.
 *
 * **Nothing here awaits anything.** A prefetch that fails, 404s, or is still in
 * flight when the reader clicks costs nothing, because the card's `<img>` makes
 * its own request either way and the browser reconciles the two itself. Both
 * paths were measured, against a 400ms response and a real cache header:
 * clicking 300ms after the hover, while the prefetch is still in flight, the
 * second request is *coalesced* onto the first and the card draws in 86ms
 * rather than 407ms; clicking after it has finished, the cache answers in 3ms.
 * The server is hit once in both, and once when nobody hovers at all — this
 * moves a request earlier, it does not add one.
 *
 * That is the whole reason this is an `Image` rather than a `fetch`: no CORS
 * mode to match, no response to hold, and the request it makes is the same
 * request an `<img>` makes, which is what lets the two be reconciled at all.
 * FIVB sends `cache-control: public, max-age=60`, so only the coalescing path
 * is load-bearing — but a reader who hovers, reads the tooltip and clicks is
 * inside 60 seconds regardless.
 */

import { playerPhotoUrl } from '../schema';

/**
 * Players already started, so crossing the same node twice costs one request.
 *
 * Unbounded on purpose. It holds numbers, one per player hovered, against a
 * graph whose largest slice is a few thousand — and the browser's own cache is
 * the thing actually storing the images. Capping it would only mean re-issuing
 * requests the cache would answer anyway.
 */
const started = new Set<number>();

/**
 * How long a pointer must stay on one player before their portrait is started.
 *
 * Without this the prefetch fires for every node the pointer *crosses*, not
 * every node it stops on, and a graph is mostly nodes in the way of other
 * nodes. USA-W is the largest slice at 423 players; sweeping across it would
 * have issued 423 requests for 2.4 MB, against the 611 KB the page loads in
 * total. Measured over 40 of its players: 52.5% have no photo on file and 404
 * at zero bytes, the rest come to 12.3 KB on average, so a hovered node costs
 * 5.8 KB expected.
 *
 * 120ms separates the two cases cleanly. A pointer travelling at a few hundred
 * pixels a second is over a node for something like 20ms, while a reader
 * deciding to open somebody rests there long enough to read the tooltip that
 * appears under them. The cost is paid out of the prefetch's own head start,
 * not the reader's: a click 300ms after arriving still gets 180ms of warming,
 * which was the difference between 407ms and 86ms when it was the full 300.
 */
const DWELL_MS = 120;

/** The player waiting out {@link DWELL_MS}, and the timer that will start them. */
let pending: { id: number; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * The width the card draws at. Deliberately not the lightbox's 600: most
 * players opened are never magnified, and 600 is ten times the bytes — 8.4 KB
 * against 85 KB at the median, and one player in a sample of ten came to
 * 496 KB. On a warm connection the two cost the same *time*, so this is a
 * choice about a reader's data rather than their patience.
 */
const CARD_WIDTH = 200;

export function prefetchPortrait(id: number): void {
  if (!Number.isFinite(id) || id <= 0 || started.has(id)) return;
  started.add(id);
  // `Image` rather than `new Image()` via the DOM: nothing is appended, so
  // there is no element to clean up and no layout to invalidate.
  const img = new Image();
  // Low priority: this is a guess about what the reader will do next, and it
  // must never compete with the graph data or a portrait actually on screen.
  img.fetchPriority = 'low';
  img.decoding = 'async';
  img.src = playerPhotoUrl(id, CARD_WIDTH);
}

/**
 * Start a player's portrait once the pointer has stayed on them.
 *
 * This is what hover should call. Moving to a different player abandons the
 * previous one — a pointer crossing a cluster leaves nothing behind but the
 * node it came to rest on.
 */
export function prefetchPortraitOnDwell(id: number): void {
  if (pending?.id === id) return;
  // Not `started.has(id)` as the early exit: `prefetchPortrait` already ignores
  // a player it has fetched, and returning here would leave a *different*
  // player's timer armed to fire after the pointer had moved on to this one.
  cancelPortraitDwell();
  pending = { id, timer: setTimeout(() => { pending = null; prefetchPortrait(id); }, DWELL_MS) };
}

/**
 * Abandon whoever is waiting. Call when the pointer leaves the nodes entirely,
 * and on unmount — a timer that survives the component would fetch a portrait
 * for a page the reader has already left.
 */
export function cancelPortraitDwell(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

/** Forget what has been started. Exists so tests do not leak into each other. */
export function resetPrefetchedPortraits(): void {
  cancelPortraitDwell();
  started.clear();
}
