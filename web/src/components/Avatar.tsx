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
 */

import { useEffect, useState } from 'react';
import { playerPhotoUrl } from '../schema';
import { initials } from '../lib/format';

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
  /** Base class; the fallback also gets `is-fallback`. */
  className: string;
  /**
   * Makes the portrait open something — the card passes the lightbox opener.
   *
   * Handled here rather than by wrapping an `<Avatar>` at the call site,
   * because whether there *is* a portrait to enlarge is this component's own
   * state and nobody else's: `failed` is set by an `onError` only reached
   * after the fetch. A caller that wrapped it would have to render a button
   * around the initials fallback too, offering a reader a larger view of two
   * letters.
   *
   * Omitted by the search results and the path panel, where the avatar is a
   * 32px identifier inside a row that already does something when clicked.
   */
  onExpand?: () => void;
}

export function Avatar({ id, name, width, className, onExpand }: Props) {
  const [failed, setFailed] = useState(false);
  const src = playerPhotoUrl(id, width);
  // A new player means a new URL: reset so a previous 404 doesn't stick to the
  // element React reused for somebody else.
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className={`${className} is-fallback`} aria-hidden="true">
        {initials(name)}
      </div>
    );
  }
  const img = (
    <img
      className={className}
      src={src}
      // Decorative in both places it is used: the name is already right beside
      // it, so announcing the portrait as well would read the player twice.
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
  if (!onExpand) return img;
  // The class stays on the image so its size, shape and border are unchanged;
  // the button is a transparent wrapper that only adds the hit area and the
  // accessible name the image deliberately does not have.
  return (
    <button
      type="button"
      className="portrait-trigger"
      onClick={onExpand}
      aria-label={`Show a larger portrait of ${name}`}
    >
      {img}
    </button>
  );
}
