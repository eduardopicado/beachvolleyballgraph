/**
 * Where each World Championships was held.
 *
 * FIVB named the first ten editions after the host city and nothing else —
 * "Los Angeles", "Marseille", "Klagenfurt", "Vienna" — and then stopped:
 *
 *   2015  "Beach Volleyball Men WCHs"                     no host at all
 *   2019  "WCH Hamburg"                                   prefixed
 *   2022  "Rome World Championships"                      suffixed
 *   2023  "World Championships 2023 - Tlaxcala Mexico"    and, for the women's
 *         "World Championships 2023 - Tlaxcala, Mexico"   draw, a comma
 *   2025  "FIVB Beach Volleyball World Championships"     no host at all
 *   2027  "FIVB Beach Volleyball World Championships"     no host at all
 *
 * So this map finishes a job FIVB started: every edition named the way FIVB
 * itself named ten of them. The tier badge beside the row already says
 * "Worlds" and the timeline shows the season in its gutter, which is why the
 * value here is the bare host rather than "Hamburg 2019" — unlike the Olympics
 * (see `olympics.ts`), where "Paris 2024" is the event's own official name and
 * the year is part of it.
 *
 * **The host is not derivable from VIS.** Three fields look like they should
 * supply it, and all three were measured against the 32 published World
 * Championship rows:
 *
 *  - `Code` is `MWCH2019`, `MWCH2023`, `MWCH2025` — from 2017 onward the code
 *    stopped carrying the city, so the trick that rescues London 2012 for the
 *    Olympics does not work here.
 *  - `DefaultCity` is populated on 4 of the 32 rows (2022 and 2025 only).
 *  - The per-match `City` is empty for every edition through 2013, gives three
 *    separate towns for 2023 (Tlaxcala 56 matches, Apizaco 27, Huamantla 25),
 *    court-suffixed strings for 2025 ("Adelaide (CC)", "Adelaide (2)",
 *    "Adelaide (3)"), and nothing at all for an edition that has not been
 *    played. It would also cost a request per tournament to read.
 *
 * `CountryName` is the one location field populated on all 32 rows, and it is
 * what the two Dutch entries below fall back to.
 *
 * **Keyed by season, not by tournament code**, for the same reason as the
 * Olympics: the published data holds exactly two rows per season, a men's draw
 * and a women's, so the season is a complete key — while the codes have used
 * four different shapes (`MLAX1997`, `MNED2015`, `MROM2022`, `MWCH2025`) and a
 * future edition's code cannot be guessed.
 *
 * Maintenance is one line every two years, and an edition this map has not
 * been told about keeps whatever FIVB called it.
 */
export const WORLD_CHAMPIONSHIPS: Readonly<Record<number, string>> = {
  1997: 'Los Angeles',
  1999: 'Marseille',
  2001: 'Klagenfurt',
  2003: 'Rio de Janeiro',
  2005: 'Berlin',
  2007: 'Gstaad',
  2009: 'Stavanger',
  2011: 'Rome',
  2013: 'Stare Jablonki',
  // Played across four cities, so no one of them is the host: the match rows
  // put 29 matches in The Hague, 25 in Amsterdam, 25 in Apeldoorn and 25 in
  // Rotterdam. VIS files both draws under CountryName "Netherlands", which is
  // the only answer that is true of the whole event.
  2015: 'Netherlands',
  2017: 'Vienna',
  2019: 'Hamburg',
  // No 2021 edition. The Rome championships were postponed into 2022, which is
  // the season the archive files them under — so unlike Tokyo, nothing here
  // needs to say a year the row does not.
  2022: 'Rome',
  // The state, not the town: the draw ran across Tlaxcala, Apizaco and
  // Huamantla, and Tlaxcala names both the state and its capital.
  2023: 'Tlaxcala',
  2025: 'Adelaide',
  // Awarded to the Netherlands; no host city announced. VIS already carries
  // both 2027 draws with CountryName "Netherlands" and a Title copied from
  // 2025, so this row is doing work today rather than waiting for one.
  2027: 'Netherlands',
};

/**
 * Where the World Championships of a season were held, or `null` when we have
 * no answer.
 *
 * Null rather than a guess: an edition this map has not been told about keeps
 * whatever FIVB called it, which is worse-looking but never wrong.
 */
export function worldChampionshipName(season: number): string | null {
  return WORLD_CHAMPIONSHIPS[season] ?? null;
}
