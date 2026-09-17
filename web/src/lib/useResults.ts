/**
 * Lazy access to a slice's tournament-by-tournament results.
 *
 * Kept out of the slice load in `App` on purpose: this is the largest data the
 * site publishes, and it is only worth a request once somebody actually opens
 * a season on a player card. `api.ts` memoises the fetch, so re-expanding —
 * here, on another player, or after switching country and back — costs nothing.
 */

import { useEffect, useState } from 'react';
import type { Gender, ResultsFile, TournamentMeta } from '../../../shared/schema';
import { fetchResults } from './api';

export interface ResultsBundle {
  results: ResultsFile;
  tournaments: Record<string, TournamentMeta>;
}

export type ResultsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: ResultsBundle }
  | { status: 'failed' };

/**
 * `wanted` is the whole point: the hook does nothing until a caller says the
 * data is being looked at, then follows the slice for as long as that stays
 * true. It is never lowered again once raised — a reader who expanded one
 * season is likely to expand another, and dropping the state would trade a
 * cached instant render for a "Loading…" flash on every player they click.
 */
export function useResults(country: string, gender: Gender, wanted: boolean): ResultsState {
  const [state, setState] = useState<ResultsState>({ status: 'idle' });

  useEffect(() => {
    if (!wanted) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchResults(country, gender)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch(() => !cancelled && setState({ status: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [country, gender, wanted]);

  return state;
}
