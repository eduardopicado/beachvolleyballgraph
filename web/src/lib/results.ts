/**
 * Turn a player's published result rows into the events of one season.
 *
 * The timeline built in `timeline.ts` answers "what did each year look like"
 * from the edges alone — who, and how many. This is the layer under it: the
 * actual tournaments behind that count, with where they finished. It is a
 * separate module because it is also a separate *fetch* (see `fetchResults`),
 * so everything above stays renderable while this is still loading, or if it
 * never loads at all.
 */

import type { ResultEntry, Tier, TournamentMeta } from '../schema';

export interface SeasonEvent {
  /** FIVB tournament number. Unique per event *and gender*, so it keys a row. */
  no: number;
  name: string;
  tier: Tier;
  /** First day of the main draw, `null` when the tournament carried no date. */
  date: Date | null;
  /** Partner's player id. With `no`, the pair that identifies this entry. */
  partnerId: number;
  /** Partner's display name, `null` when nothing in the slice can name them. */
  partner: string | null;
  /** FIVB's placement. See `formatFinish` for what the negatives mean. */
  rank: number;
  /**
   * FIVB's tournament code — `MPAR2024`. Null on the oldest rows, where the
   * published tuple is too short to carry one.
   *
   * Carried because it is what addresses the event's published classification,
   * and a row without one has nothing to open.
   */
  code: string | null;
  /**
   * What FIVB called this event's level at the time — "4-star", "Elite16",
   * "Grand Slam". Null for the Olympics, the World Championships and the
   * age-group championships, which the card badges by tier instead.
   */
  level: string | null;
}

/**
 * Rebuild the calendar date from the season and the published day offset.
 *
 * The offset is signed and measured from 1 January of the season it belongs
 * to, so a December event opening a southern summer season lands in the
 * previous calendar year — which is exactly what it should do.
 */
function dateOf(season: number, offset: number | null | undefined): Date | null {
  if (offset === null || offset === undefined) return null;
  return new Date(Date.UTC(season, 0, 1) + offset * 86_400_000);
}

/**
 * The events of one season, keeping the published order — most recent first,
 * the same direction the timeline reads.
 *
 * An entry whose tournament is missing from the index is dropped rather than
 * shown unnamed: the two files are published together, so that only happens if
 * one of them is stale, and a row reading "Tournament 9138" would be worse
 * than one fewer row.
 */
export function seasonEvents(
  entries: readonly ResultEntry[] | undefined,
  tournaments: Record<string, TournamentMeta>,
  season: number,
  nameOf: (id: number) => string | null,
): SeasonEvent[] {
  const out: SeasonEvent[] = [];
  for (const [no, partner, rank] of entries ?? []) {
    const meta = tournaments[no];
    if (!meta || meta[1] !== season) continue;
    const [name, , tier, offset] = meta;
    // Positional read rather than a destructure: the tuple has four arities
    // and only the longest carries a level.
    const level = meta.length > 5 ? (meta[5] ?? null) : null;
    const code = meta.length > 4 ? (meta[4] ?? null) : null;
    out.push({
      no,
      name,
      tier,
      date: dateOf(season, offset),
      partnerId: partner,
      partner: nameOf(partner),
      rank,
      level,
      code,
    });
  }
  return out;
}
