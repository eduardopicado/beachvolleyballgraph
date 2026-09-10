/**
 * Fetch one tournament's entry list, for an event with no result yet.
 *
 * A sibling of `useClassification` and deliberately not a parameter on it: the
 * two are different files, different shapes and mutually exclusive — a
 * tournament has a classification or an entry list, never both — so folding
 * them into one hook would mean a discriminant on every read of the result.
 */

import { useEffect, useState } from 'react';
import type { EntriesFile } from '../schema';
import { fetchEntries } from './api';

export type EntriesState =
  | { status: 'loading' }
  | { status: 'ready'; data: EntriesFile }
  | { status: 'failed' };

export function useEntries(code: string | null): EntriesState | null {
  const [state, setState] = useState<EntriesState>({ status: 'loading' });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchEntries(code)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch(() => !cancelled && setState({ status: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Null rather than a state, so the page can ask "is this an event with an
  // entry list at all" without also having to know it is still loading.
  return code ? state : null;
}
