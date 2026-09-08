/**
 * Reading `TournamentMeta`, which is a tuple of five different lengths.
 *
 * Positional reads guarded by `length` are spread across the app already, and
 * every new field adds another arity for each of them to get right. This is
 * the one place that knows the shape, so a reader asks for a field rather than
 * for an index — see `TournamentMeta` in `schema.ts` for why the tuple grew
 * this way rather than becoming an object (it is the largest published file
 * and short keys are most of its size).
 */

import type { Gender, Tier, TournamentMeta } from '../schema';

export interface TournamentFacts {
  name: string;
  season: number;
  tier: Tier;
  /** Days from 1 January of the season to the main draw's first day. */
  startOffset: number | null;
  /** FIVB's own code. Null on the oldest rows, whose tuple is too short. */
  code: string | null;
  level: string | null;
  /** ISO-2 of the venue's country, null when VIS has none usable (§25). */
  country: string | null;
  /** Days the main draw ran. Can be negative upstream (§25). */
  span: number | null;
  /**
   * Which draw, when the tree is new enough to say. Null on anything older,
   * and never guessed from the code's first letter — `WWRS2022` is a men's
   * field under a `W` (quirks §23).
   */
  gender: Gender | null;
}

export function readTournament(meta: TournamentMeta): TournamentFacts {
  return {
    name: meta[0],
    season: meta[1],
    tier: meta[2],
    startOffset: meta.length > 3 ? (meta[3] ?? null) : null,
    code: meta.length > 4 ? (meta[4] ?? null) : null,
    level: meta.length > 5 ? (meta[5] ?? null) : null,
    country: meta.length > 6 ? (meta[6] ?? null) : null,
    span: meta.length > 7 ? (meta[7] ?? null) : null,
    gender: meta.length > 8 ? (meta[8] ?? null) : null,
  };
}
