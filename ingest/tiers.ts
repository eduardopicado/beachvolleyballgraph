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

import type { Tier } from '../shared/schema.js';

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
  //
  // That warning was earned and then ignored: 51 and 52 were inferred the
  // wrong way round, and the day a level badge shipped they went straight onto
  // the page, putting "Challenge" under every Elite16 on the site. They are
  // now checked the only way these four can be — see LEVEL_BY_TYPE.
  51: 'beach-pro-tour', // Elite16
  52: 'beach-pro-tour', // Challenge
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
  //
  // These four are the exception to the paragraph above: FIVB's enum stops at
  // 50, so there is no spec to read them off and the tournaments themselves
  // are the only source. 51 and 52 were inferred the wrong way round, which
  // put "Challenge" under every Elite16 on the site and "Elite16" under the
  // 2022 Challenges.
  //
  // Settled by cross-tabulating Type against the tournaments' own titles: of
  // the 88 whose name contains "Elite", every one is Type 51 and none is 52;
  // of the 68 containing "Challenge", every one is 52 and none is 51. Futures
  // (53) and Finals (54) were confirmed the same way. A test re-runs that
  // comparison against the published index, so a future transposition fails
  // instead of shipping.
  //
  // Nothing else moved — both types are `beach-pro-tour` above, so no player,
  // partnership or count was ever affected. Only the label.
  51: 'Elite16',
  52: 'Challenge',
  53: 'Futures',
  54: 'Finals',
};

/**
 * The first day of FIVB's restructured circuit: World Series at the top, then
 * Elite, then (expected) Challenge. Its opening event is Beach Elite Itapema,
 * main draw 10 December 2026.
 *
 * **FIVB minted no new `Type` for it.** It reused two that already mean
 * something here, so the number alone cannot tell the eras apart:
 *
 *   3   "Beach World Series Dubai" 2027 — and the 1996 World Series
 *   51  "Beach Elite Itapema" 2026     — and every BPT Elite16 since 2022
 *
 * Without this, the new Elite was badged "Elite16", which it is not, and the
 * World Series sat in the 1987-2021 World Tour tier. The date splits them:
 * measured against VIS on 14 October 2026, every tour event opening before
 * this is titled "BPT …" and every one from Itapema on is titled "Beach …",
 * with nothing in between to straddle the line. A test re-checks that against
 * the published names, so a misplaced cut fails rather than ships.
 */
export const NEW_CIRCUIT_FROM = '2026-12-01';

/** What a reused `Type` means on the new circuit. Types absent keep their old meaning. */
const NEW_CIRCUIT: Readonly<Record<number, { tier: Tier; level: string }>> = {
  // `beach-pro-tour` for the tier although FIVB has dropped "BPT" from the
  // titles: the tier only ever separates the pre-2022 tour from the current
  // one, nothing renders its name, and both count as tour (TOUR_TIERS).
  3: { tier: 'beach-pro-tour', level: 'World Series' },
  // "Elite", not "Elite16": FIVB's own title is "Beach Elite".
  51: { tier: 'beach-pro-tour', level: 'Elite' },
};

/** True when an event opening on `opensOn` (ISO day) belongs to the new circuit. */
function onNewCircuit(type: string | undefined, opensOn: string | undefined): boolean {
  return opensOn !== undefined && opensOn >= NEW_CIRCUIT_FROM && Number(type) in NEW_CIRCUIT;
}

/**
 * The level for a VIS `Type`, or null for a tier that has none.
 *
 * `opensOn` is the day the event opens, which only matters for the types the
 * new circuit reused; an event with no date keeps the type's older meaning.
 */
export function levelFor(type: string | undefined, opensOn?: string): string | null {
  if (onNewCircuit(type, opensOn)) return NEW_CIRCUIT[Number(type)]!.level;
  return LEVEL_BY_TYPE[Number(type)] ?? null;
}

/**
 * Age-group world championships are FIVB world-level events but not senior
 * competition. Set `INCLUDE_AGE_GROUP=false` to restrict the graph to the
 * senior international game.
 */
export const INCLUDE_AGE_GROUP = process.env.INCLUDE_AGE_GROUP !== 'false';

export function tierFor(
  organizerType: string | undefined,
  type: string | undefined,
  opensOn?: string,
): Tier | null {
  if (organizerType !== FIVB_ORGANIZER_TYPE) return null;
  const tier = TIER_BY_TYPE[Number(type)];
  if (!tier) return null;
  if (onNewCircuit(type, opensOn)) return NEW_CIRCUIT[Number(type)]!.tier;
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

/**
 * Every `Type` an FIVB-organised row can carry that is left out on purpose —
 * the "Deliberately excluded" list on `TIER_BY_TYPE`, as data, so that
 * `unrecognisedTourRows` can tell a decision from a surprise.
 */
export const EXCLUDED_TYPES: ReadonlySet<number> = new Set([
  7, 8, 11, 12, 34, 47, 48, 55, // continental championships / cups / zonal tours
  9, 35, // seminars, VIS clinics, test events
  15, 16, 17, 18, 20, 21, 28, 29, 30, 46, // National Tour, all age groups
  19, 36, 45, // snow volleyball
  43, // Youth Olympic Games
  44, // multi-sport games
  49, // Olympic Qualification Tournament
  50, // King of the Court
]);

/** A title FIVB gives its own tour events, in either branding. */
const TOUR_TITLE = /^(?:BPT\b|Beach (?:World Series|Elite|Challenge|Futures|Pro Tour)\b)/i;

/**
 * Tournaments the allowlist dropped that it may not have meant to, one line
 * each, for the ingest to warn about. Empty on a normal day.
 *
 * The allowlist is the right default — it is what keeps national tours and
 * snow volleyball out — but it fails silently: a type it has never seen is
 * simply excluded, and nothing on the site shows an event that is not there.
 * FIVB is restructuring its circuit as of December 2026 and has already reused
 * two old types for it (see NEW_CIRCUIT_FROM); the third rung, "Beach
 * Challenge", is not in VIS yet, and if it arrives under a new number it would
 * vanish with no error anywhere. Two checks, because either can be the one
 * that sees it:
 *
 *  - **an FIVB-organised row whose `Type` is in neither list** — a number
 *    nobody has decided about yet;
 *  - **a row titled like the FIVB tour that was not admitted**, whatever its
 *    organizer or type — catches a new circuit filed under a type we exclude
 *    on purpose, or under an organizer we never read.
 *
 * Called-off events are the caller's to remove first: they carry tour titles
 * and are dropped deliberately.
 */
export function unrecognisedTourRows(
  rows: readonly { Name?: string; Code?: string; Season?: string; Type?: string; OrganizerType?: string }[],
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const what = `${(row.Name ?? '').trim() || '(no name)'} (${row.Code ?? '?'}, ${row.Season ?? '?'}, Type ${row.Type ?? '?'})`;
    const type = Number(row.Type);
    if (
      row.OrganizerType === FIVB_ORGANIZER_TYPE &&
      !(type in TIER_BY_TYPE) &&
      !EXCLUDED_TYPES.has(type)
    ) {
      out.push(`unknown type: ${what}`);
    } else if (TOUR_TITLE.test((row.Name ?? '').trim()) && tierFor(row.OrganizerType, row.Type) === null) {
      out.push(`tour-titled but not admitted: ${what}`);
    }
  }
  return out;
}
