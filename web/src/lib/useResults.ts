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
const IDLE: ResultsState = { status: 'idle' };
const LOADING: ResultsState = { status: 'loading' };

export function useResults(country: string, gender: Gender, wanted: boolean): ResultsState {
  // Held with the slice it answers, for the reason `useClassification` gives:
  // otherwise the first render after a country switch reads the new player's
  // seasons out of the old slice's results.
  const slice = `${country}-${gender}`;
  const [held, setHeld] = useState<{ slice: string; state: ResultsState } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    fetchResults(country, gender)
      .then((data) => !cancelled && setHeld({ slice: `${country}-${gender}`, state: { status: 'ready', data } }))
      .catch(() => !cancelled && setHeld({ slice: `${country}-${gender}`, state: { status: 'failed' } }));
    return () => {
      cancelled = true;
    };
  }, [country, gender, wanted]);

  if (!wanted) return IDLE;
  return held && held.slice === slice ? held.state : LOADING;
}
