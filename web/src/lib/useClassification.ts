/**
 * Lazy access to one tournament's final classification.
 *
 * Keyed by FIVB's tournament code, and null until a reader opens one — the
 * archive publishes 1,608 of these and a visit reads at most a handful.
 * `api.ts` memoises by URL, so reopening an event, or reaching the same event
 * from a second player's card, costs nothing.
 */

import { useEffect, useState } from 'react';
import type { ClassificationFile } from '../../../shared/schema';
import { fetchClassification } from './api';

export type ClassificationState =
  | { status: 'loading' }
  | { status: 'ready'; data: ClassificationFile }
  | { status: 'failed' };

const LOADING: ClassificationState = { status: 'loading' };

export function useClassification(code: string | null): ClassificationState {
  // Held with the code it answers. Resetting to loading inside the effect is
  // not enough: the effect runs after the render that changed the code, so
  // that render, painted, would show the previous event's field under the new
  // event's name. Comparing here makes a mismatch read as loading from the
  // first render on.
  const [held, setHeld] = useState<{ code: string; state: ClassificationState } | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetchClassification(code)
      .then((data) => !cancelled && setHeld({ code, state: { status: 'ready', data } }))
      .catch(() => !cancelled && setHeld({ code, state: { status: 'failed' } }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  return held && held.code === code ? held.state : LOADING;
}
