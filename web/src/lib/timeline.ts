/**
 * Regroup a player's partnerships by season.
 *
 * The partner list answers "who did they play with most". This answers "what
 * did each year look like" — the question the aggregate cannot reach. A
 * partner list shows Doherty 2013–2014 and Hyden 2013 as separate rows and
 * gives no way to see that 2013 was shared between them. A quarter of players
 * in the archive have at least one season like that; among those with 20 or
 * more tournaments it is over three quarters.
 */

import type { GraphNode, SeasonTally } from '../../../shared/schema';

/** The part of a partner row this needs. `PartnerRow` satisfies it structurally. */
export interface TimelinePartner {
  node: GraphNode;
  s?: SeasonTally[];
}

export interface TimelineSeason {
  season: number;
  partners: { node: GraphNode; t: number }[];
  /** Tournaments across every partner that season. */
  total: number;
}

/**
 * Later first, undated last, then by volume and name.
 *
 * `null` is compared explicitly rather than standing in as an infinity: two
 * undated rows would subtract to NaN, which only happens to fall through to
 * the tie-breaks because NaN is falsy.
 */
function byRecency(
  x: { start: number | null; t: number; name: string },
  y: { start: number | null; t: number; name: string },
): number {
  if (x.start !== y.start) {
    if (x.start === null) return 1;
    if (y.start === null) return -1;
    return y.start - x.start;
  }
  return y.t - x.t || x.name.localeCompare(y.name);
}

/**
 * Newest season first — a career is usually read from "what are they doing
 * now" backwards, and the players with the longest timelines are exactly the
 * ones still active.
 *
 * Seasons run newest first, and so do the partners inside one — the same
 * direction throughout, or the reading order jumps at every season boundary.
 * It also puts a partner carried across the new year directly beneath their
 * row in the following season, which is what makes a settled pairing visible.
 *
 * The key is when the pair *last* played that year, falling back to
 * tournaments together when a season carries no date. Ordering by volume
 * instead — all this could do before the ingest fetched `StartDateMainDraw` —
 * put a different name first in 38% of the archive's 5,891 shared seasons,
 * routinely ranking a one-off fill-in above the partner somebody actually
 * switched to.
 *
 * The trade is that the *biggest* partner of a season is no longer
 * necessarily at the top of it. For a view called a timeline that is the
 * right way round: sequence is the premise, and each row carries its own
 * tally anyway.
 *
 * What dates do not fix is what a row means. A player who partners A,
 * switches to B, then returns to A inside one season still gets two rows, not
 * three: the edge is keyed by the pair, so both spells with A arrive here as
 * one number. Splitting them needs per-tournament data, not just an ordering.
 */
export function buildTimeline(partners: readonly TimelinePartner[]): TimelineSeason[] {
  const bySeason = new Map<number, { season: number; total: number; rows: SeasonRow[] }>();

  for (const partner of partners) {
    // Absent on slices published before the per-season field existed. Callers
    // treat an empty result as "no timeline to offer" rather than "no seasons".
    for (const [season, t, latestOffset] of partner.s ?? []) {
      let row = bySeason.get(season);
      if (!row) bySeason.set(season, (row = { season, total: 0, rows: [] }));
      row.rows.push({ node: partner.node, t, start: latestOffset ?? null, name: partner.node.name });
      row.total += t;
    }
  }

  return [...bySeason.values()]
    .sort((a, b) => b.season - a.season)
    .map(({ season, total, rows }) => ({
      season,
      total,
      partners: rows.sort(byRecency).map(({ node, t }) => ({ node, t })),
    }));
}

/** A partner within one season, carrying the keys `byRecency` sorts on. */
interface SeasonRow {
  node: GraphNode;
  t: number;
  start: number | null;
  name: string;
}
