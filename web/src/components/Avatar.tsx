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
}

export function Avatar({ id, name, width, className }: Props) {
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
  return (
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
}
