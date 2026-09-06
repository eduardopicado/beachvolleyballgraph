/**
 * Lazy access to one tournament's final classification.
 *
 * Keyed by FIVB's tournament code, and null until a reader opens one — the
 * archive publishes 1,608 of these and a visit reads at most a handful.
 * `api.ts` memoises by URL, so reopening an event, or reaching the same event
 * from a second player's card, costs nothing.
 */

import { useEffect, useState } from 'react';
import type { ClassificationFile } from '../schema';
import { fetchClassification } from './api';

export type ClassificationState =
  | { status: 'loading' }
  | { status: 'ready'; data: ClassificationFile }
  | { status: 'failed' };

export function useClassification(code: string | null): ClassificationState {
  const [state, setState] = useState<ClassificationState>({ status: 'loading' });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchClassification(code)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch(() => !cancelled && setState({ status: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  return state;
}
