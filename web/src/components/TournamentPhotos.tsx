/**
 * FIVB's own photographs of a tournament: a strip under the page's heading,
 * and a viewer that opens over the page on a click.
 *
 * **Only in a build with `TOURNAMENT_PHOTOS=1`.** `TournamentRoute` imports
 * this module dynamically inside an `if (__TOURNAMENT_PHOTOS__)`, so a build
 * without the switch drops the import, and with it this file, its stylesheet
 * and the photo file's address. Every photograph is FIVB's copyright, and the
 * strip waits on their permission (fivb-email.md).
 *
 * Every photograph the tournament has, with FIVB's slideshow picks first: the
 * file is already in that order (`ingest/photos.ts`). A strip rather than a
 * grid because the owner chose it over one, on the mockup: the photos are the
 * first thing a reader sees and the results stay where they were.
 *
 * Thumbnails load lazily, as the strip scrolls them into view. A tournament
 * has about 400 photographs on average and the strip shows five or six; 23 KB each, the
 * rest are not worth asking FIVB's service for until someone scrolls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TournamentPhoto, TournamentPhotosFile } from '../../../shared/schema';
import { photosPath, tournamentPhotoUrl } from '../../../shared/schema';
import { formatTaken } from '../lib/photos';
import './TournamentPhotos.css';

const BASE = import.meta.env.BASE_URL;

/** Twice the strip's 132 CSS px, for a sharp thumbnail on a 2x display. Measured 23 KB. */
const THUMB = 320;
/** The viewer's width. Measured 156 KB, against 23 for the thumbnail, so only on a click. */
const LARGE = 1200;

export default function TournamentPhotos({ code, count }: { code: string; count: number }) {
  const [photos, setPhotos] = useState<TournamentPhoto[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhotos(null);
    fetch(photosPath(BASE, code))
      .then((res) => (res.ok ? (res.json() as Promise<TournamentPhotosFile>) : null))
      .then((file) => !cancelled && setPhotos(file?.photos ?? []))
      // A strip that cannot load is left out rather than shown broken: the page
      // is complete without it.
      .catch(() => !cancelled && setPhotos([]));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const close = useCallback(() => setOpen(null), []);

  if (photos !== null && photos.length === 0) return null;
  const total = photos?.length ?? count;
  const picks = photos?.filter((p) => p[3] === 1).length ?? 0;

  return (
    <section className="photo-strip" aria-label="Photographs">
      <ul>
        {photos
          ? photos.map(([no, caption], i) => (
              <li key={no}>
                <button type="button" onClick={() => setOpen(i)} aria-label={caption || `Photograph ${i + 1}`}>
                  <img src={tournamentPhotoUrl(no, THUMB)} alt="" loading="lazy" decoding="async" />
                </button>
              </li>
            ))
          : // The strip's height, held while the list loads, so the results
            // below do not jump when it arrives.
            Array.from({ length: Math.min(count, 8) }, (_, i) => <li key={i} className="is-waiting" />)}
      </ul>
      <p className="photo-credit">
        <span>
          {total.toLocaleString('en-US')} {total === 1 ? 'photograph' : 'photographs'}
          {picks > 0 && picks < total ? ", FIVB's picks first" : ''}
        </span>
        <span>© FIVB</span>
      </p>
      {photos && open !== null && photos[open] && (
        <PhotoViewer photos={photos} index={open} onIndex={setOpen} onClose={close} />
      )}
    </section>
  );
}

/**
 * One photograph, large, over a dimmed page, with its caption and the way to
 * the next. The portrait viewer's pattern (`PortraitLightbox`): the thumbnail
 * the reader clicked is in cache, so it paints at once and the large one
 * fades over it when it lands.
 */
function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: TournamentPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [no, caption, takenAt] = photos[index]!;
  const [sharp, setSharp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  useEffect(() => setSharp(false), [no]);

  useEffect(() => {
    const opener = document.activeElement;
    const root = rootRef.current;
    root?.querySelector<HTMLButtonElement>('.photo-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'ArrowRight' && hasNext) {
        onIndex(index + 1);
      } else if (event.key === 'ArrowLeft' && hasPrev) {
        onIndex(index - 1);
      } else if (event.key === 'Tab' && root) {
        // Keep focus inside: Tab walks the dialog's own buttons and wraps.
        const stops = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const at = stops.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const active = document.activeElement;
      const orphaned = !active || active === document.body || !!root?.contains(active);
      if (orphaned && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [index, hasNext, hasPrev, onIndex, onClose]);

  const taken = formatTaken(takenAt);
  return (
    <div
      ref={rootRef}
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={caption || `Photograph ${index + 1}`}
      onClick={onClose}
    >
      <figure onClick={(event) => event.stopPropagation()}>
        <div className={`photo-shot${sharp ? ' is-sharp' : ''}`}>
          <img className="photo-lo" src={tournamentPhotoUrl(no, THUMB)} alt="" />
          <img
            className="photo-hi"
            src={tournamentPhotoUrl(no, LARGE)}
            alt={caption}
            decoding="async"
            onLoad={() => setSharp(true)}
          />
        </div>
        <figcaption>
          {caption && <span className="photo-caption">{caption}</span>}
          <span className="photo-meta">
            <span>
              {taken ? `${taken} · ` : ''}
              {index + 1} of {photos.length}
            </span>
            <span>© FIVB</span>
          </span>
        </figcaption>
        <nav aria-label="Photographs">
          <button type="button" disabled={!hasPrev} onClick={() => onIndex(index - 1)}>
            ← Previous
          </button>
          <button type="button" disabled={!hasNext} onClick={() => onIndex(index + 1)}>
            Next →
          </button>
        </nav>
      </figure>
      <button type="button" className="photo-close" onClick={onClose} aria-label="Close photograph">
        ×
      </button>
    </div>
  );
}
