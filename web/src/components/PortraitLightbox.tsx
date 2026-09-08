/**
 * A player's portrait, large, over a dimmed page.
 *
 * The card draws a 68px circle. FIVB's image service takes a width parameter,
 * so the large view is a second request for the same portrait rather than a
 * bigger file everyone downloads, and nobody pays the difference who does not
 * ask for it. Re-measured 2026-09-08 on three players from the most recent
 * Elite16 field: 200px runs 5.0-7.8KB and 600px 27-44KB, four to six times
 * the size. An earlier note here said 10KB and 58KB from a single player; the
 * multiple is the part that holds, not the absolute figures.
 *
 * **600, not more.** 900px is 108KB for a portrait that is displayed at most
 * 420 CSS px here — the extra bytes buy nothing except on a 2x display, where
 * 600 is already a fair match for the rendered size.
 *
 * The format is FIVB's choice, not ours. The same URL returns WebP for some
 * players and JPEG for others (Mol WebP, Sørum JPEG), so nothing here may key
 * on an extension.
 *
 * Only reachable when a portrait actually loaded — `Avatar` owns that state and
 * only renders its trigger once a `load` has fired, so this is never opened on
 * the initials fallback.
 *
 * **That guarantee is what makes the dialog open on a picture rather than on
 * nothing.** The 200px the card drew is in cache by definition — it is the
 * thing the reader clicked — so it is painted here first, upscaled into the
 * box the 600px will fill, and the larger one fades over it when it lands.
 * The reader sees a soft portrait immediately instead of a dark rectangle for
 * however long FIVB takes. It costs no request: both widths were going to be
 * fetched anyway, and the small one already has been.
 *
 * **No blur on the placeholder, deliberately.** A 200px source in a 420px box
 * is soft on its own, which reads as a photo that has not sharpened yet; a
 * blur filter on top reads as an effect. Compared side by side on real archive
 * portraits, the plain upscale held up — though those were modern, sharp
 * photographs, and an old low-resolution one may not flatter it as well. The
 * blur is one line in the stylesheet if it ever needs adding back.
 *
 * It still handles its own failure, because "a portrait loaded" is not quite
 * the same statement as "this request will succeed": the card asks for 200px
 * and this asks for 600, a second request that can fail on its own — a dropped
 * connection, or FIVB holding one width and not the other. When only the large
 * one fails the placeholder simply stays, which is a real portrait rather than
 * the initials this used to fall back to.
 */

import { useEffect, useRef, useState } from 'react';
import { playerPhotoUrl } from '../schema';
import { initials } from '../lib/format';
import './PortraitLightbox.css';

interface Props {
  id: number;
  name: string;
  /** Flag glyph and country name, drawn under the portrait as a caption. */
  flag: string;
  countryName: string;
  onClose: () => void;
}

export function PortraitLightbox({ id, name, flag, countryName, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [sharp, setSharp] = useState(false);
  const [largeFailed, setLargeFailed] = useState(false);
  const [smallFailed, setSmallFailed] = useState(false);

  useEffect(() => {
    // Whatever opened this — the portrait button, in every path that exists
    // today — so focus can go back to it rather than being dropped on the
    // floor when the dialog is removed.
    const opener = document.activeElement;
    // Read now, not in the cleanup: by then React may already have detached the
    // node and cleared the ref, and this has to be able to ask whether focus is
    // still inside the dialog it is tearing down.
    const root = rootRef.current;

    // The close button is the only thing in here that can hold focus, so the
    // trap is "keep it" rather than a ring of stops: Tab and Shift+Tab both
    // land back on it and focus cannot walk out into the page behind.
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    // Capture, so Escape closes the portrait rather than the card underneath —
    // the card's own handler is on the document too, and the innermost thing a
    // reader opened is the one Escape should take away.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Give focus back only when it is about to be orphaned — still inside
      // the dialog, or already dropped to <body> because the dialog has gone.
      //
      // The card changes player underneath this (the graph, the search box),
      // and when it does it closes the portrait *and* moves focus into itself.
      // Restoring unconditionally would win that race and pull a keyboard
      // reader back to the portrait button of a player they have just left.
      const active = document.activeElement;
      const orphaned = !active || active === document.body || !!root?.contains(active);
      if (orphaned && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="portrait-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Portrait of ${name}`}
      // A click anywhere on the backdrop closes. Only the picture itself stops
      // propagation — not the whole figure, which also contains the caption and
      // the gap above it. Guarding the figure meant the name, and the strip of
      // dark either side of it, read as part of the dialog and swallowed the
      // click; nothing is being protected there, because the caption is text
      // nobody clicks for its own sake.
      onClick={onClose}
    >
      <figure>
        {largeFailed && smallFailed ? (
          // The same initials the card draws, at this size. The caption below
          // still names the player, so the dialog says who it is about rather
          // than showing the browser's broken-image glyph and nothing else.
          //
          // Both requests have to fail to get here, which is close to
          // unreachable: the trigger is only offered once the 200px has
          // loaded, so it is in cache when this opens. It stays for the case
          // where that cache entry is gone and the network with it.
          <div
            className="portrait-missing"
            aria-hidden="true"
            onClick={(event) => event.stopPropagation()}
          >
            {initials(name)}
          </div>
        ) : (
          <div
            className={[
              'portrait-shot',
              sharp ? 'is-sharp' : '',
              smallFailed ? 'no-placeholder' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(event) => event.stopPropagation()}
          >
            {!smallFailed && (
              // The card's own 200px, blown up to the size the 600px will
              // take. It is in cache — it is the picture the reader clicked —
              // so it paints on the frame the dialog opens, and the wait
              // becomes a sharpening rather than an empty box.
              //
              // It also carries the size: the 600px is positioned over it, so
              // this is what gives the box its height before anything arrives.
              <img
                className="portrait-lo"
                src={playerPhotoUrl(id, 200)}
                // Decorative while the real one is coming, and the description
                // itself when the real one never does.
                alt={largeFailed ? `${name}, ${countryName}` : ''}
                onError={() => setSmallFailed(true)}
              />
            )}
            {!largeFailed && (
              <img
                className="portrait-hi"
                src={playerPhotoUrl(id, 600)}
                alt={`${name}, ${countryName}`}
                decoding="async"
                onLoad={() => setSharp(true)}
                onError={() => setLargeFailed(true)}
              />
            )}
          </div>
        )}
        <figcaption>
          <strong>{name}</strong>
          <span>
            <span aria-hidden="true">{flag}</span> {countryName}
          </span>
        </figcaption>
      </figure>
      <button
        ref={closeRef}
        type="button"
        className="portrait-close"
        onClick={onClose}
        aria-label="Close portrait"
      >
        ×
      </button>
    </div>
  );
}
