/**
 * A player's portrait, with an initials fallback.
 *
 * FIVB's image service 404s for a large share of the archive — plenty of
 * players simply have no photo on file — so the `<img>` is *expected* to fail
 * and the fallback is a normal outcome rather than an error path.
 *
 * Shared by the player card and the search results because the failure
 * handling is the interesting part and it must not diverge: two copies would
 * mean two chances to forget the reset below.
 *
 * **The initials sit under the photo rather than instead of it**, and that is
 * the load-bearing part of the layout. Drawing one *or* the other means the
 * circle is empty for as long as the request is in flight — and with
 * `loading="lazy"` a deferred portrait never starts, so "in flight" can mean
 * forever: a blank circle at one zoom level and initials at another, for the
 * same player on the same page. Underneath, the initials are what the reader
 * sees until a photo arrives to cover them, and there is no state in which the
 * circle says nothing.
 */

import { useEffect, useRef, useState } from 'react';
import { playerPhotoUrl } from '../schema';
import { initials } from '../lib/format';
import './Avatar.css';

/**
 * Three states, not two.
 *
 * `pending` used to be folded into "not failed", which is what made the
 * trigger below appear over a portrait that had not arrived — and then over
 * one that never would, since a deferred image fires neither `load` nor
 * `error`. Clicking the initials of a player with no photo opened a lightbox
 * for a portrait that does not exist.
 */
type Status = 'pending' | 'loaded' | 'failed';

interface Props {
  id: number;
  name: string;
  /**
   * Pixel width to request. Always pass one: without it FIVB serves the
   * original, which runs to 2-3MB per portrait instead of a few KB.
   *
   * Ask for roughly twice the rendered size so the circle stays sharp on a
   * 2x display — the difference between a 64px and a 32px fetch is about a
   * kilobyte.
   */
  width: number;
  /** Base class; the circle is not loaded also gets `is-fallback`. */
  className: string;
  /**
   * Fetch immediately instead of when the browser feels like it.
   *
   * For the one portrait a reader has just asked for — the card's. Everywhere
   * else an avatar is a row in a list of twenty and lazy is the right default,
   * but the card's is the subject of the click that created it, and deferring
   * it only adds latency to the thing being waited on.
   */
  eager?: boolean;
  /**
   * Makes the portrait open something — the card passes the lightbox opener.
   *
   * Handled here rather than by wrapping an `<Avatar>` at the call site,
   * because whether there *is* a portrait to enlarge is this component's own
   * state and nobody else's: only a `load` that actually fired says so. A
   * caller that wrapped it would have to render a button around the initials
   * fallback too, offering a reader a larger view of two letters.
   *
   * Omitted by the search results and the path panel, where the avatar is a
   * 32px identifier inside a row that already does something when clicked.
   */
  onExpand?: () => void;
}

export function Avatar({ id, name, width, className, eager, onExpand }: Props) {
  const [status, setStatus] = useState<Status>('pending');
  const imgRef = useRef<HTMLImageElement>(null);
  const src = playerPhotoUrl(id, width);

  // A new player means a new URL: reset so a previous result doesn't stick to
  // the element React reused for somebody else.
  useEffect(() => {
    setStatus('pending');
    // A portrait already in the browser's cache can finish before this runs,
    // and its `load` fired at an element React had not yet handed to us — so
    // ask the element instead of waiting for an event that has been and gone.
    // This is the second open of any player, which is most of them.
    const img = imgRef.current;
    if (img?.complete) setStatus(img.naturalWidth > 0 ? 'loaded' : 'failed');
  }, [src]);

  const loaded = status === 'loaded';
  return (
    <span className={loaded ? `avatar-slot ${className}` : `avatar-slot ${className} is-fallback`}>
      {/* Hidden from assistive tech in both layers: the player's name is
          already beside the circle in every place this is used, so announcing
          the portrait as well would read them twice. */}
      {!loaded && (
        <span className="avatar-initials" aria-hidden="true">
          {initials(name)}
        </span>
      )}
      <img
        ref={imgRef}
        src={src}
        alt=""
        aria-hidden="true"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
      />
      {/* A transparent disc over the photo rather than a wrapper around it:
          the image must not move in the DOM when it loads, or the browser
          throws away the decode it has just finished. */}
      {loaded && onExpand && (
        <button
          type="button"
          className="portrait-trigger"
          onClick={onExpand}
          aria-label={`Show a larger portrait of ${name}`}
        />
      )}
    </span>
  );
}
