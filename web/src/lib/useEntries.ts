/**
 * Fetch one tournament's entry list, for an event with no result yet.
 *
 * A sibling of `useClassification` and deliberately not a parameter on it: the
 * two are different files, different shapes and mutually exclusive — a
 * tournament has a classification or an entry list, never both — so folding
 * them into one hook would mean a discriminant on every read of the result.
 */

import { useEffect, useState } from 'react';
import type { EntriesFile } from '../../../shared/schema';
import { fetchEntries } from './api';

export type EntriesState =
  | { status: 'loading' }
  | { status: 'ready'; data: EntriesFile }
  | { status: 'failed' };

const LOADING: EntriesState = { status: 'loading' };

export function useEntries(code: string | null): EntriesState | null {
  // Held with the code it answers, for the reason `useClassification` gives:
  // otherwise the first render after the code changes shows the old list.
  const [held, setHeld] = useState<{ code: string; state: EntriesState } | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetchEntries(code)
      .then((data) => !cancelled && setHeld({ code, state: { status: 'ready', data } }))
      .catch(() => !cancelled && setHeld({ code, state: { status: 'failed' } }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Null rather than a state, so the page can ask "is this an event with an
  // entry list at all" without also having to know it is still loading.
  if (!code) return null;
  return held && held.code === code ? held.state : LOADING;
}
