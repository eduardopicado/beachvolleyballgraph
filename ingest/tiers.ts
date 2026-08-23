/**
 * Which tournaments count as "FIVB international".
 *
 * VIS classifies every beach tournament with two fields:
 *   OrganizerType — 1 = FIVB, 2 = confederation (CEV/AVC/NORCECA/CSV/CAVB),
 *                   3/4 = multi-sport games bodies, 5 = national federation
 *   Type          — the competition format within that organizer
 *
 * `OrganizerType === 1` alone is not sufficient: FIVB is recorded as the
 * organizer for a number of continental events (CAVB/NORCECA championships,
 * zonal tours), snow volleyball, seminars and test events. So we require
 * OrganizerType 1 *and* an explicit Type allowlist.
 *
 * The result is auditable: every kept tournament carries its tier into the
 * manifest, so `manifest.tiers` shows exactly what the filter admitted.
 *
 * The `Type` names below come from FIVB's own enum and should be checked
 * against it rather than guessed from tournament names:
 * https://www.fivb.org/VisSDK/VisWebService/BeachTournamentType.html
 */

import type { Tier } from '../web/src/schema.js';

/** FIVB is the organizer. */
export const FIVB_ORGANIZER_TYPE = '1';

/**
 * VIS `Type` -> tier. Anything absent is excluded.
 *
 * Deliberately excluded, for the record:
 *   7, 8, 11, 12, 34, 47, 48, 55  continental championships / cups / zonal tours
 *   9, 35                          seminars, VIS clinics, test events
 *   15, 16-21, 28-30, 46           National Tour, all age groups (see below)
 *   19, 36, 45                     snow volleyball
 *   43                             Youth Olympic Games (see below)
 *   44                             multi-sport games (Commonwealth, Pan Am, FISU)
 *   49                             Olympic Qualification Tournament (see below)
 *   50                             King of the Court (outside the FIVB tour structure)
 *
 * The `olympics` tier used to hold three different competitions. It is now
 * only the Games.
 *
 * Type 43 is the *Youth* Olympic Games — an age-group event filed under the
 * Olympic tier, which was wrong twice over: it put U19 competition in the
 * senior graph, and because it wasn't tagged `age-group-wch` it sat outside
 * `INCLUDE_AGE_GROUP`, so the switch built for exactly that decision could
 * not reach it.
 *
 * Type 49 is the Olympic *Qualification* Tournament, and its results do not
 * mean what results normally mean here. Several teams win: the 2019 edition
 * (China, September) recorded two teams at Rank 1 and two more at Rank 3 in
 * each draw, because the point of the event is handing out Games berths
 * rather than crowning a winner. `medalTournaments()` already refused to read
 * that as a podium; keeping it out of the tier as well means nothing else has
 * to know about the exception either.
 *
 * Removing both costs no player and no partnership — measured, not assumed.
 * The 16 qualifier pairs all competed elsewhere, so no node or edge
 * disappears; only six tournaments leave the count.
 *
 * Type 15 was previously mapped to 'world-tour' here, on the theory that it
 * meant "1-star" and that OrganizerType alone was enough to tell a genuine
 * FIVB 1-star from a domestic one. Both halves of that were wrong: FIVB's own
 * schema (https://www.fivb.org/VisSDK/VisWebService/BeachTournamentType.html)
 * names value 15 `NationalTour` outright — the real 1-star is 42 — and
 * OrganizerType on National Tour records is not reliable enough to filter by;
 * a meaningful share of them carry OrganizerType 1 (FIVB) regardless of who
 * actually ran the event. Every Type-15 tournament this had let through
 * turned out to be a domestic tour (Australia, Argentina, Poland, New
 * Zealand, Cameroon, Mauritius, Egypt, Kenya, Estonia, Guinea and more,
 * checked directly against VIS) inflating those countries' player and
 * partnership counts — this is what made Australia's total look implausibly
 * close to Brazil's.
 */
export const TIER_BY_TYPE: Record<number, Tier> = {
  // --- Olympic ---
  5: 'olympics', // Olympic Games — the Games themselves, and nothing else

  // --- World Championships ---
  4: 'world-champs', // FIVB World Championships

  // --- Age-group World Championships ---
  13: 'age-group-wch', // Junior (U21) World Championships
  14: 'age-group-wch', // Youth (U19) World Championships
  25: 'age-group-wch', // U23 World Championships
  26: 'age-group-wch', // U21 World Championships
  27: 'age-group-wch', // U19 / U17 World Championships
  31: 'age-group-wch', // U17 World Championships

  // --- World Tour (1987-2021) ---
  0: 'world-tour', // Grand Slam / early World Tour
  1: 'world-tour', // Open
  2: 'world-tour', // Challenger
  3: 'world-tour', // World Series (1996)
  6: 'world-tour', // Satellite
  32: 'world-tour', // Major Series
  33: 'world-tour', // World Tour Finals
  // FIVB's own enum names this `WorldTour5Star`, "World Tour 5*" — not Major,
  // which is what this comment used to say. 32 events, 2017-2020: the top rung
  // of the star era, the tier Gstaad and Fort Lauderdale sat on. Nothing about
  // the mapping was wrong (they were always kept as world-tour), but the label
  // would have gone straight onto the page the day a tournament-level badge
  // ships. Major Series is 32, below, and is a genuinely different thing: the
  // 2015-2016 branding that 5-star replaced.
  38: 'world-tour', // World Tour 5*
  39: 'world-tour', // 4-star
  40: 'world-tour', // 3-star
  41: 'world-tour', // 2-star
  42: 'world-tour', // 1-star

  // --- Beach Pro Tour (2022-) ---
  // Types 51-55 are in use in live VIS data but are *not* in FIVB's published
  // enum, which stops at 50 (KingOfTheCourt). These four names are inferred
  // from the tournaments carrying them, not read off a spec — treat them as
  // less certain than everything above, and re-check before putting any of
  // them in front of a reader as a label.
  51: 'beach-pro-tour', // Challenge
  52: 'beach-pro-tour', // Elite16
  53: 'beach-pro-tour', // Futures
  54: 'beach-pro-tour', // Finals
};

/**
 * VIS `Type` -> the level FIVB called it *at the time*.
 *
 * Deliberately era-native and deliberately not ranked. FIVB has renumbered its
 * own hierarchy twice — Open/Challenger/Satellite, then 1-to-5-star, then
 * Elite16/Challenge/Futures — and no mapping between those eras survives the
 * archive. A 2005 Grand Slam is not a 2019 4-star is not a 2023 Elite16, so
 * this says what the event was called and stops there. Anything that tries to
 * order these against each other is inventing a fact.
 *
 * Names are FIVB's own, from the enum linked in the file header, not inferred
 * from tournament names — which is how Type 38 spent months labelled "Major"
 * when it is `WorldTour5Star`.
 *
 * Only the tour tiers appear. The Olympics, the World Championships and the
 * age-group championships have no level below the tier itself, and the card
 * already badges them by tier.
 */
export const LEVEL_BY_TYPE: Record<number, string> = {
  // --- World Tour (1987-2021) ---
  0: 'Grand Slam',
  1: 'Open',
  2: 'Challenger',
  3: 'World Series',
  6: 'Satellite',
  32: 'Major Series',
  33: 'Finals',
  38: '5-star',
  39: '4-star',
  40: '3-star',
  41: '2-star',
  42: '1-star',

  // --- Beach Pro Tour (2022-) ---
  51: 'Challenge',
  52: 'Elite16',
  53: 'Futures',
  54: 'Finals',
};

/** The level for a VIS `Type`, or null for a tier that has none. */
export function levelFor(type: string | undefined): string | null {
  return LEVEL_BY_TYPE[Number(type)] ?? null;
}

/**
 * Age-group world championships are FIVB world-level events but not senior
 * competition. Set `INCLUDE_AGE_GROUP=false` to restrict the graph to the
 * senior international game.
 */
export const INCLUDE_AGE_GROUP = process.env.INCLUDE_AGE_GROUP !== 'false';

export function tierFor(organizerType: string | undefined, type: string | undefined): Tier | null {
  if (organizerType !== FIVB_ORGANIZER_TYPE) return null;
  const tier = TIER_BY_TYPE[Number(type)];
  if (!tier) return null;
  if (tier === 'age-group-wch' && !INCLUDE_AGE_GROUP) return null;
  return tier;
}

export const TIER_LABEL: Record<Tier, string> = {
  olympics: 'Olympic Games',
  'world-champs': 'World Championships',
  'age-group-wch': 'Age-group World Championships',
  'world-tour': 'FIVB World Tour',
  'beach-pro-tour': 'Beach Pro Tour',
};
