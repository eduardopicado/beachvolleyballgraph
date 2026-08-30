/**
 * What to call an Olympic Games.
 *
 * FIVB names them six different ways, and two of those never say where the
 * Games were held:
 *
 *   1996  "Atlanta"                                    the city, on its own
 *   2012  "Olympic Games 2012"                         no city at all
 *   2016  "Men's Olympic Game - Rio 2016"              city, gender, typo
 *   2021  "Tokyo Olympic Games - Men's Tournament"     city, gender, wrong year
 *   2024  "Olympic Games Paris 2024 - Beach Volleyball"
 *
 * A reader scanning a timeline wants one shape, and the official designation is
 * the one we are entitled to use: it is not ours to rename the Games.
 *
 * **Keyed by season, not by tournament code.** The codes are inconsistent too —
 * `MATL1996` and `MLON2012` follow one pattern, `Rio2016M` follows another —
 * and keying on them would mean guessing the code FIVB will invent for a Games
 * that has not happened. There is exactly one Olympic Games per season, so the
 * season is a complete key, and a future edition needs only its host adding.
 *
 * Note 2021. The Tokyo Games were postponed a year and are officially
 * **Tokyo 2020**, so the label carries 2020 while the row sits in the 2021 the
 * archive records it under. That is the case this map exists for: the timeline
 * shows the season in its gutter and the name beside it, so a reader sees both
 * when it was played and what it is called.
 *
 * 2028 and 2032 are entered ahead of time. Los Angeles and Brisbane are
 * settled hosts, but neither has a tournament in VIS yet — so those rows do
 * nothing until one appears, and cost nothing if FIVB files them under codes
 * nobody predicted. Keying by season is what makes that safe: a guess at the
 * code could be wrong, but there will be exactly one Games in 2032 whatever it
 * ends up being called.
 */
export const OLYMPIC_GAMES: Readonly<Record<number, string>> = {
  1996: 'Atlanta 1996',
  2000: 'Sydney 2000',
  2004: 'Athens 2004',
  2008: 'Beijing 2008',
  2012: 'London 2012',
  2016: 'Rio de Janeiro 2016',
  // Played in 2021, named for 2020.
  2021: 'Tokyo 2020',
  2024: 'Paris 2024',
  2028: 'Los Angeles 2028',
  2032: 'Brisbane 2032',
};

/**
 * The official name of the Games held in a season, or `null` when we have none.
 *
 * Null rather than a guess: an edition this map has not been told about keeps
 * whatever FIVB called it, which is worse-looking but never wrong.
 */
export function olympicName(season: number): string | null {
  return OLYMPIC_GAMES[season] ?? null;
}
