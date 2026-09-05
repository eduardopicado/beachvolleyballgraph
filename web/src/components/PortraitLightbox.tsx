/**
 * A player's portrait, large, over a dimmed page.
 *
 * The card draws a 68px circle. FIVB's image service takes a width parameter,
 * so the large view is a second request for the same portrait rather than a
 * bigger file everyone downloads: measured, 200px is 10KB and 600px is 58KB,
 * and nobody pays the difference who does not ask for it.
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
 * only renders its trigger on success, so this is never opened on the initials
 * fallback.
 */

import { useEffect, useRef } from 'react';
import { playerPhotoUrl } from '../schema';
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
      // A click anywhere on the backdrop closes. The figure below stops
      // propagation, so a click that lands on the photo itself does not.
      onClick={onClose}
    >
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={playerPhotoUrl(id, 600)} alt={`${name}, ${countryName}`} decoding="async" />
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
