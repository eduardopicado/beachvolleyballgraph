/**
 * Stage 3-4: normalise VIS rows into players + weighted partnership edges, then
 * slice by country x gender.
 *
 * Pure functions over plain rows — no network, no filesystem — so the awkward
 * parts (pair canonicalisation, dedupe, slicing) are unit-testable.
 */

import type {
  AwayPartner,
  Gender,
  GraphEdge,
  GraphNode,
  MedalCounts,
  ResultEntry,
  SeasonTally,
  Tier,
  TimelineFilter,
} from '../web/src/schema.js';
import { TOUR_TIERS } from '../web/src/schema.js';
import { toCentimetres, toKilograms, type VisRow } from './vis.js';
import { tierFor, levelFor, FIVB_ORGANIZER_TYPE } from './tiers.js';
import { EXCLUDED_FEDERATIONS, FEDERATION_ALIASES } from './countries.js';
import { olympicName } from './olympics.js';
import { worldChampionshipName } from './worlds.js';
import {
  federationSpans,
  resolveFederation,
  type FederationConflict,
} from './federations.js';

export interface Tournament {
  no: string;
  /**
   * FIVB's own tournament code — `WBUS2026` is the 2026 women's Busan event.
   * Gender letter, venue, season. Stable, unique and populated on every
   * tournament in the archive (checked: 1,688 of 1,688, no duplicates), which
   * makes it the only durable public identifier an outside reference can key
   * on. `no` is stable too but means nothing outside VIS.
   */
  code: string;
  /**
   * Display name as VIS gives it — "BPT Elite16 Hamburg", "Gstaad". Short
   * (median 9 characters), and the gender is not in it: FIVB numbers the men's
   * and women's draws of one event separately, so a slice only ever sees its
   * own.
   */
  name: string;
  tier: Tier;
  /**
   * What FIVB called this event's level at the time — "Grand Slam", "4-star",
   * "Elite16". Null for the tiers that have no level below themselves.
   */
  level: string | null;
  season: number;
  version: string;
  /** `YYYY-MM-DD` of the main draw's last day, or null if VIS gave none. */
  endsOn: string | null;
  /**
   * Days from 1 January of `season` to the main draw's first day. Negative
   * when an event starts in the previous calendar year, which is why this is
   * an offset rather than a day-of-year: a December event opening a southern
   * summer season would otherwise sort *after* the following January's.
   *
   * Only ever compared within one season, so the origin is arbitrary as long
   * as it is consistent — and this keeps the published number two or three
   * digits instead of five.
   */
  startOffset: number | null;
}

/**
 * `YYYY-MM-DD` -> days from 1 January of `season`.
 *
 * `StartDateMainDraw` is populated on every tournament VIS returns (checked:
 * 9,264 of 9,264), so the null path is for a malformed value rather than a
 * missing one. Qualification can start earlier, but `StartDateQualification`
 * is populated on barely a third of them, so using it would order some
 * seasons by one field and some by another — worse than being uniformly
 * approximate by a day or two.
 */
export function startOffsetFor(raw: string | undefined, season: number): number | null {
  if (!raw) return null;
  const at = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(at)) return null;
  return Math.round((at - Date.UTC(season, 0, 1)) / 86_400_000);
}

export interface Player {
  id: number;
  name: string;
  /** Short competition name, e.g. "Emanuel". */
  short: string;
  gender: Gender;
  /** FIVB federation code. A player's *current* federation — no history kept. */
  federation: string;
  dob: string | null;
  height: number | null;
  weight: number | null;
  /** Free-text birth place, `null` when VIS has none worth showing. */
  birthPlace: string | null;
}

/** A canonical unordered pair key: always "smaller:larger" by numeric id. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export interface Partnership {
  a: number;
  b: number;
  tournaments: Set<string>;
  firstSeason: number;
  lastSeason: number;
  /**
   * Every federation code VIS stamped on this pair's team rows, by tournament.
   *
   * A set rather than a value because a pair can be entered twice for one
   * event and the duplicate rows occasionally disagree — see
   * ingest/federations.ts, which turns this into one answer per event.
   */
  fedCodes: Map<string, Set<string>>;
  /**
   * The pair's best main-draw placement, or `null` if they never reached one.
   *
   * Filled in after the aggregation loop rather than during it — see
   * `bestFinishByPair`, which reads the *deduplicated* results so this number
   * is always the minimum of what expanding the seasons below it shows.
   */
  best: number | null;
}

export interface RejectCounts {
  missingPlayer: number;
  selfPair: number;
  unknownPlayer: number;
  outOfScopeTournament: number;
  duplicateEntry: number;
  didNotPlay: number;
}

// --- Stage 1 normalisation -------------------------------------------------

/**
 * Season is usually a plain year, but the earliest World Tour records use a
 * range ("1987-91"). Take the leading year so those events are not silently
 * dropped by a `Number()` that yields NaN.
 */
export function parseSeason(raw: string | undefined): number | null {
  const match = /^\s*(\d{4})/.exec(raw ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1985 && year <= 2100 ? year : null;
}

/**
 * Was this tournament called off?
 *
 * VIS records it in the display name rather than a status field —
 * "Hamburg (canceled)", "Mangaung(Cancelled)", "CEV Lille Masters - canceled",
 * or sometimes just "Cancelled". Spelling, spacing and punctuation all vary,
 * and Spanish-language records use "cancelado"/"cancelada", so the test is a
 * substring rather than an exact marker.
 *
 * Deliberately does *not* match "postponed". A postponed event may still be
 * played, and 7 of them are sitting in the qualifying set; dropping those
 * would be asserting they never happen. They contribute no players either way
 * — no results, no rank — so leaving them counted costs nothing and stays
 * correct if one is eventually held.
 */
export function isCancelled(row: VisRow): boolean {
  return /cancel/i.test(row.Name ?? '');
}

/**
 * The name we hold for a season of a championship, or `null` to keep FIVB's.
 *
 * Two tiers get one. Both are events whose editions are known years ahead and
 * named after their host by convention, and in both FIVB's own naming broke
 * down often enough that a reader scanning a timeline could not tell what they
 * were looking at — "Olympic Games 2012" never says London, "FIVB Beach
 * Volleyball World Championships" never says Adelaide. Every other tier keeps
 * whatever FIVB typed: there are 1,600-odd of those, they carry no fixed
 * designation, and a map of them would be a second dataset to maintain.
 */
function curatedName(tier: Tier, season: number): string | null {
  if (tier === 'olympics') return olympicName(season);
  if (tier === 'world-champs') return worldChampionshipName(season);
  return null;
}

export function normaliseTournaments(rows: VisRow[]): Map<string, Tournament> {
  const out = new Map<string, Tournament>();
  for (const row of rows) {
    const tier = tierFor(row.OrganizerType, row.Type);
    if (!tier) continue;
    // A tournament that was called off is not a tournament. It never had
    // results, so `Rank` already kept its entrants out of the graph — but it
    // was still counted in `manifest.totals.tournaments`, which is the one
    // published number that claimed otherwise. 131 of them, mostly 2020.
    if (isCancelled(row)) continue;
    const season = parseSeason(row.Season);
    if (season === null) continue;
    const no = (row.No ?? '').trim();
    if (!no) continue;
    out.set(no, {
      no,
      // Trimmed because some do carry trailing spaces ("FIVB Beach Volleyball
      // World Championships  "), and numbered rather than left blank because a
      // nameless row on the card would be indistinguishable from a bug.
      //
      // The Olympics and the World Championships get the host we hold for the
      // season instead of whatever FIVB typed, because several editions do not
      // name their host at all — 2012 is filed as "Olympic Games 2012", which
      // never says London. See `curatedName` above; an edition neither map has
      // been told about keeps FIVB's name.
      name: curatedName(tier, season) ?? ((row.Name ?? '').trim() || `Tournament ${no}`),
      code: (row.Code ?? '').trim(),
      tier,
      level: levelFor(row.Type),
      season,
      version: (row.Version ?? '').trim(),
      endsOn: /^\d{4}-\d{2}-\d{2}/.test(row.EndDateMainDraw ?? '')
        ? row.EndDateMainDraw!.slice(0, 10)
        : null,
      startOffset: startOffsetFor(row.StartDateMainDraw, season),
    });
  }
  return out;
}

/**
 * Tournaments that have finished and still have no result at all: every team
 * row carrying `Rank` 0 or blank, which the aggregation reads as "registered
 * but never played" (docs/fivb-data-quirks.md §3).
 *
 * That rule is right, and this is the case it cannot tell apart on its own. A
 * played event is invisible here for the days between the last match and FIVB
 * writing placements into `BeachTeam.Rank` — the match list is populated in
 * the meantime, the placement field is not. Measured across the archive it
 * resolves: of 468 finished tournaments only one was ever in this state, and
 * it had ended the previous day.
 *
 * So this is not an error and does not fail the run. It exists to be *seen*:
 * without it a real event silently contributes nothing and the first anyone
 * knows is a reader asking why a result is missing, which is exactly how it
 * came up (BPT Futures Busan, WBUS2026, 16 August 2026).
 */
export function finishedWithoutResults(
  tournaments: Map<string, Tournament>,
  teamRows: VisRow[],
  asOf: string,
): Tournament[] {
  const withAResult = new Set<string>();
  for (const row of teamRows) {
    if (Number(row.Rank) !== 0) withAResult.add((row.NoTournament ?? '').trim());
  }
  const day = asOf.slice(0, 10);
  return [...tournaments.values()]
    .filter((t) => t.endsOn !== null && t.endsOn <= day && !withAResult.has(t.no))
    .sort((a, b) => (b.endsOn ?? '').localeCompare(a.endsOn ?? ''));
}

export type MedalCategory = 'olympics' | 'world-champs';

/**
 * Tournament number -> which medal event it is, restricted to the actual
 * senior Olympic Games (VIS Type 5) and FIVB World Championships (Type 4).
 *
 * Narrow on purpose, and it stays narrow even though the `olympics` tier is
 * now the Games alone: this reads `Type` off the raw rows rather than
 * deferring to `tierFor`, so a future addition to that tier cannot quietly
 * start minting medals. That guard already earned its keep once — the tier
 * used to include the Olympic Qualification Tournament, whose 2019 edition
 * records *two* teams at Rank 1 per draw.
 */
export function medalTournaments(rows: VisRow[]): Map<string, MedalCategory> {
  const out = new Map<string, MedalCategory>();
  for (const row of rows) {
    if (row.OrganizerType !== FIVB_ORGANIZER_TYPE) continue;
    const no = (row.No ?? '').trim();
    if (!no) continue;
    if (row.Type === '5') out.set(no, 'olympics');
    else if (row.Type === '4') out.set(no, 'world-champs');
  }
  return out;
}

const RANK_TO_MEDAL: Record<number, keyof MedalCounts> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

/**
 * Per-player medal counts from `Rank` at real Olympic Games / World
 * Championships matches. A handful of the earliest World Championships
 * (1997) had no bronze-medal match and awarded two bronzes — both semifinal
 * losers carry `Rank: 3`, and both are credited here.
 */
export function aggregateMedals(
  teamRows: VisRow[],
  medals: Map<string, MedalCategory>,
): Map<number, Record<MedalCategory, MedalCounts>> {
  const out = new Map<number, Record<MedalCategory, MedalCounts>>();

  const credit = (id: number, category: MedalCategory, medal: keyof MedalCounts) => {
    let entry = out.get(id);
    if (!entry) {
      out.set(
        id,
        (entry = {
          olympics: { gold: 0, silver: 0, bronze: 0 },
          'world-champs': { gold: 0, silver: 0, bronze: 0 },
        }),
      );
    }
    entry[category][medal]++;
  };

  for (const row of teamRows) {
    const category = medals.get((row.NoTournament ?? '').trim());
    if (!category) continue;
    const medal = RANK_TO_MEDAL[Number(row.Rank)];
    if (!medal) continue;
    const a = Number(row.NoPlayer1);
    const b = Number(row.NoPlayer2);
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0 || a === b) continue;
    credit(a, category, medal);
    credit(b, category, medal);
  }
  return out;
}

/**
 * The two tiers that make up the FIVB tour, whatever it has been called.
 *
 * Age-group world championships are excluded — they are world-level events,
 * but they are not the senior tour and a U19 title next to a Grand Slam title
 * would flatter the wrong careers. The Olympics and the World Championships
 * are excluded because they are counted separately and more precisely.
 */


/**
 * Per-player podium counts across the tour: 1,552 of the 1,688 qualifying
 * tournaments.
 *
 * Deliberately mixes levels. A 2019 4-star, a 2015 Grand Slam and a 2024
 * Elite16 all count as one gold, and there is no honest alternative: FIVB has
 * renumbered its own hierarchy repeatedly — Open/Challenger/Satellite, then
 * 1-to-5-star, now Elite16/Challenge/Futures — and no mapping between those
 * eras survives contact with the archive. A podium is a podium.
 *
 * Read off the *tier* rather than the raw `Type`, unlike `medalTournaments`
 * above, and that difference is deliberate. There the narrow reading is a
 * guard: a tier gaining a member must not quietly start minting Olympic
 * medals. Here it is the definition — any FIVB tour stop counts, so a new
 * format joining the tour should be included automatically.
 *
 * Safe to read `Rank` 1-3 as a clean podium here: measured across every tour
 * event in the archive, not one has a duplicated podium place. The ties that
 * make `Rank` ambiguous elsewhere (docs/fivb-data-quirks.md §2 and §5) are a
 * 1997 World Championships and the Olympic qualifier, neither of which is a
 * tour event.
 */
export function aggregateTourPodiums(
  teamRows: VisRow[],
  tournaments: Map<string, Tournament>,
): Map<number, MedalCounts> {
  const out = new Map<number, MedalCounts>();

  const credit = (id: number, medal: keyof MedalCounts) => {
    let counts = out.get(id);
    if (!counts) out.set(id, (counts = { gold: 0, silver: 0, bronze: 0 }));
    counts[medal]++;
  };

  for (const row of teamRows) {
    const tournament = tournaments.get((row.NoTournament ?? '').trim());
    if (!tournament || !TOUR_TIERS.has(tournament.tier)) continue;
    const medal = RANK_TO_MEDAL[Number(row.Rank)];
    if (!medal) continue;
    const a = Number(row.NoPlayer1);
    const b = Number(row.NoPlayer2);
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0 || a === b) continue;
    credit(a, medal);
    credit(b, medal);
  }
  return out;
}

/** A token that is a shout: letters, all of them upper case. */
function isShouted(token: string): boolean {
  const letters = token.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && token === token.toUpperCase() && token !== token.toLowerCase();
}

/**
 * Tidy the presentation of a name VIS holds untidily.
 *
 * Two fixes, both cosmetic, neither changing which characters a name is made
 * of. Measured over the 12,074 players we publish: 36 names carry a double
 * space, and 64 are typed entirely in capitals.
 *
 * **Capitals only when they carry nothing.** The rule is deliberately
 * whole-name rather than per-word, because a partly-capitalised name is using
 * the capitals to *say* something: "Katharina HETZENDORFER" and "MUKUNZI Christ
 * Ornel" mark the surname that way, which is the convention across much of
 * Europe and Africa and is the only indication of name order those rows have.
 * 66 published players are in that shape, and title-casing them would delete
 * the one useful signal in the row. Where every word shouts there is no such
 * signal to lose, so those are the only ones touched.
 *
 * **No particle lowering.** "ADLA MARINA TAVARES DE PINA" becomes "Adla Marina
 * Tavares De Pina" where Portuguese would write "de Pina". That is knowingly
 * left alone: the same "DE" is correctly capitalised in Flemish ("LOTTE DE
 * CLERCQ" is De Clercq), and "LE" three rows away is a Malaysian name rather
 * than a French particle ("OOI TIAN LE"). Guessing which is which needs the
 * player's nationality *and* their culture's convention, and getting it wrong
 * lowercases somebody's surname. Title case is never wrong-looking; it is only
 * ever less right than a human would manage.
 *
 * Initialisms are left verbatim, so "A.J." does not become "A.j.".
 */
export function tidyName(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  const words = collapsed.split(' ');
  const shoutable = words.filter((w) => /\p{L}/u.test(w) && !w.includes('.'));
  // A name of nothing but short words could be an initialism rather than a
  // shout, so require one substantial word before deciding it is one.
  const substantial = shoutable.some((w) => w.replace(/[^\p{L}]/gu, '').length >= 4);
  if (!substantial || shoutable.length === 0 || !shoutable.every(isShouted)) return collapsed;

  return words.map((word) => (word.includes('.') ? word : titleCaseWord(word))).join(' ');
}

/**
 * One word, lower-cased with each part capitalised.
 *
 * A part starts at any letter not preceded by another letter: Hsin-Tung,
 * D'Almeida, O'Brien — and also `(Urss)` and `Aktau,Kazakhstan`, which the
 * narrower "start, hyphen or apostrophe" rule this replaces got wrong. FIVB
 * stores "Poltana (URSS)" and "AKTAU,KAZAKHSTAN" as single space-free tokens;
 * lower-casing them and then only capitalising after the three characters that
 * rule knew about published "Poltana (urss)" and "Aktau,kazakhstan", which
 * reads as a different mistake from the shouting it was fixing.
 */
function titleCaseWord(word: string): string {
  return word.toLowerCase().replace(/(?<!\p{L})\p{L}/gu, (letter) => letter.toUpperCase());
}

/**
 * Where a player was born, when VIS holds something worth showing.
 *
 * `BirthPlace` is one free-text field with no separate city or country, filled
 * in by hand at a couple of hundred federations, and it holds four conventions
 * at once: "Curitiba, PR", "Berlin", "Juiz de Fora (BRA)",
 * "Resende-Rio de Janeiro". None of that is fixable — nothing separates a city
 * from a province, and nothing says which country a bare "Portland" is in — so
 * the value is published verbatim apart from the tidying below.
 *
 * It is far cleaner than it first looks. Measured over the 6,496 published
 * players who have one, **21 are unusable (0.32%)**, and most of those are only
 * suspicious rather than wrong: "Paris 14e", "Praha 4", "Sèvres (92)" and
 * "St Brieul (12)" are arrondissements and department numbers, which are real
 * answers to where somebody was born. Rejecting anything containing a digit
 * would throw all of those away to catch the seven records that are actually
 * broken, so the rules are narrow and each one names its cases:
 *
 *  - a date in the birth *place* field — "21.08.77", "03/09/1988",
 *    "06-05-1991", "17/01/1992" (4 records);
 *  - a bare postcode with nothing else — "30019", "98278" (2);
 *  - an internal note that should never have left the database —
 *    "to be Merged with (#164181) as" (1).
 *
 * Capitals are normalised in both directions. 444 published birth places shout,
 * and "BUENOS AIRES" is no more correct than "MUKUNZI" was; 102 more have no
 * capital at all — "rio de janeiro", "salvador" — which is the same box filled
 * in with caps lock the other way. Only a value that is uniformly one case is
 * touched: mixed capitals are a choice somebody made, and "St-Gallen" or
 * "Adelaide, SA" is already right.
 *
 * Stray quotation marks are stripped, which is one record — `"9 de JULIO"` is a
 * real Argentine town wearing the quotes FIVB stored it with.
 */
export function tidyBirthPlace(value: string | undefined): string | null {
  const raw = (value ?? '').replace(/\s+/g, ' ').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!raw) return null;

  // A whole date, however it is punctuated. Anchored, so "Paris 14e" and
  // "Sèvres (92)" — which merely contain digits — survive.
  if (/^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(raw)) return null;
  // Digits and separators only: a postcode, never a place name.
  if (!/\p{L}/u.test(raw)) return null;
  // An editing note aimed at whoever maintains the record, not at a reader.
  if (/\bto be merged\b|\bmerge[dr]?\s+with\b|#\d{3,}|\bduplicate\b/i.test(raw)) return null;

  // A value with no capital in it anywhere has lost its casing rather than
  // chosen it: "rio de janeiro", "buenos aires", "salvador". 102 published
  // places are like this, against 444 that shout, and both are the same
  // failure — a federation typing into a free-text box with caps lock in one
  // state or the other.
  //
  // Handled before the shout rule because the two need opposite treatment of
  // short words. Nothing here is a code: a code is upper case, and a value with
  // no capitals cannot be hiding one, so "arg" simply becomes "Arg". What the
  // length gate below protects does not exist in this direction.
  if (!/\p{Lu}/u.test(raw)) return titleCasePlace(raw) || null;

  // Capitals are normalised per *word* here, not per string as in `tidyName`.
  // A name uses partial capitals to mark the family name (§6.5) and that has to
  // survive; a place has no such convention, so "9 de JULIO" should become
  // "9 de Julio" even though "de" is already lower case.
  //
  // The length gate is what makes per-word safe: a short upper-case token in a
  // place name is a code, not a shout — the "PR" in "Curitiba, PR", the "BRA"
  // in "Juiz de Fora (BRA)", the whole of "TN", the "N2" in "Auckland N2".
  // Title-casing those would turn a province code into a word.
  return (
    raw
      .split(' ')
      .map((word) => {
        const letters = word.replace(/[^\p{L}]/gu, '');
        const shouts = letters.length >= 4 && word === word.toUpperCase() && word !== word.toLowerCase();
        return shouts ? titleCaseWord(word) : word;
      })
      .join(' ') || null
  );
}

/**
 * Words that stay lower case inside a place name: "Rio de Janeiro", not "Rio De
 * Janeiro". Kept deliberately small — every entry is one that actually occurs
 * in the published data.
 */
const PLACE_PARTICLES = new Set(['de', 'del', 'di', 'da', 'do', 'la', 'le', 'el', 'y']);

/**
 * Title-case a place that arrived with no capitals at all.
 *
 * A particle is only left alone **between** two other words. That position test
 * is doing real work, because the same two letters are a particle in the middle
 * and something else at either end: "el" is a particle in "Yacoub el Mansour"
 * and the start of "El Jadida", and a trailing token is far more likely to be a
 * region or country than a preposition. First and last are therefore always
 * capitalised, which is also what makes this safe to run on a one-word value.
 */
function titleCasePlace(value: string): string {
  const words = value.split(' ');
  return words
    .map((word, i) => {
      const interior = i > 0 && i < words.length - 1;
      if (interior && PLACE_PARTICLES.has(word)) return word;
      return titleCaseWord(word);
    })
    .join(' ');
}

/**
 * Which timeline narrowings a player has anything for.
 *
 * Read from the deduplicated results rather than the raw rows, so it agrees
 * exactly with what expanding a season will show — a filter that offers a chip
 * and then renders an empty list is worse than no chip.
 *
 * `tour-podium` asks for ranks 1-3; the other two ask only that the player was
 * there. That asymmetry is the point: 412 of the 488 published Olympians never
 * medalled, and they are precisely the careers this control exists to make
 * legible.
 */
export function timelineFiltersByPlayer(
  results: ReadonlyMap<number, ResultEntry[]>,
  tournaments: ReadonlyMap<string, Tournament>,
): Map<number, TimelineFilter[]> {
  const out = new Map<number, TimelineFilter[]>();
  for (const [player, entries] of results) {
    let olympics = false;
    let worlds = false;
    let podium = false;
    for (const [no, , rank] of entries) {
      const tier = tournaments.get(String(no))?.tier;
      if (tier === 'olympics') olympics = true;
      else if (tier === 'world-champs') worlds = true;
      // TOUR_TIERS, not 'world-tour' alone: the tour is two tiers, and the
      // Beach Pro Tour is the whole of it from 2022 on. This has to be the same
      // set `aggregateTourPodiums` uses, or the chip and the Tour podiums tile
      // beside it would be counting different events.
      else if (tier && TOUR_TIERS.has(tier) && rank >= 1 && rank <= 3) podium = true;
    }
    const filters: TimelineFilter[] = [];
    if (olympics) filters.push('olympics');
    if (worlds) filters.push('world-champs');
    if (podium) filters.push('tour-podium');
    if (filters.length) out.set(player, filters);
  }
  return out;
}

/**
 * How many Olympic Games each player competed at.
 *
 * The card has always had an Olympics tile, but it was drawn from the medal
 * tally, so it appeared for 76 players and vanished for the other 412 — a tile
 * headed "Olympics" absent for 84.4% of the people who went to the Olympics.
 * Martin Alejo Conde has four Games and no tile at all. Being an Olympian is
 * the achievement; the medal is a separate one.
 *
 * Counted over distinct tournaments rather than result rows. A player has one
 * entry per Games in practice, but the pair is what a row records, and nothing
 * upstream guarantees a player is never entered twice — counting rows would
 * turn that into a second Games.
 *
 * Deliberately not extended to the World Championships. That reaches 1,359
 * players against 488 here, and a first-round exit twice over is not the same
 * kind of fact; the Worlds tile stays a medal tally.
 */
export function olympicGamesByPlayer(
  results: ReadonlyMap<number, ResultEntry[]>,
  tournaments: ReadonlyMap<string, Tournament>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [player, entries] of results) {
    const games = new Set<number>();
    for (const [no] of entries) {
      if (tournaments.get(String(no))?.tier === 'olympics') games.add(no);
    }
    if (games.size > 0) out.set(player, games.size);
  }
  return out;
}

function fullName(row: VisRow): string {
  const first = (row.FirstName ?? '').trim();
  const last = (row.LastName ?? '').trim();
  // Tidied as one string rather than field by field, so the shout test sees the
  // whole name: "Katharina HETZENDORFER" is a marked surname, but a LastName of
  // "HETZENDORFER" on its own looks like a name that simply shouts.
  const joined = tidyName(`${first} ${last}`);
  return joined || tidyName(row.TeamName ?? '') || `Player ${row.No}`;
}

/**
 * The name a player competes under. VIS `TeamName` holds it ("Emanuel"), but it
 * is not always populated — fall back to the surname, then the full name.
 */
function shortName(row: VisRow, full: string): string {
  const team = tidyName(row.TeamName ?? '');
  if (team) return team;
  // From the raw field rather than sliced out of `full`, which is already
  // tidied and may have been title-cased as part of a longer name.
  const last = tidyName(row.LastName ?? '');
  return last || full;
}

export function normalisePlayers(rows: VisRow[]): Map<number, Player> {
  const out = new Map<number, Player>();
  for (const row of rows) {
    const id = Number(row.No);
    if (!Number.isFinite(id) || id <= 0) continue;
    // VIS encodes gender as 0 = men, 1 = women. Anything else is unusable for a
    // gendered graph, so those players are dropped at slice time.
    const gender: Gender | null = row.Gender === '0' ? 'M' : row.Gender === '1' ? 'W' : null;
    if (!gender) continue;
    const rawFederation = (row.FederationCode ?? '').trim().toUpperCase();
    if (EXCLUDED_FEDERATIONS.has(rawFederation)) continue;
    const dob = (row.Birthdate ?? '').trim();
    const name = fullName(row);
    out.set(id, {
      id,
      name,
      short: shortName(row, name),
      gender,
      federation: FEDERATION_ALIASES[rawFederation] ?? rawFederation,
      dob: /^\d{4}-\d{2}-\d{2}$/.test(dob) && !dob.startsWith('0001') ? dob : null,
      height: toCentimetres(row.Height),
      weight: toKilograms(row.Weight),
      birthPlace: tidyBirthPlace(row.BirthPlace),
      // VIS also has an `IsActive` flag, deliberately not carried through: it is
      // not beach-specific (it tracks a player's overall FIVB registration
      // across beach/indoor/snow) and is not reliably updated for retired
      // athletes. Cross-checked against this dataset: 66% of players it flags
      // active have no qualifying beach tournament in the last 5+ seasons.
    });
  }
  return out;
}

// --- Stage 3 aggregation ---------------------------------------------------

export interface AggregateResult {
  partnerships: Map<string, Partnership>;
  /** player id -> set of qualifying tournament numbers entered. */
  appearances: Map<number, Set<string>>;
  /**
   * player id -> every tournament they played, most recent first. The same
   * rows as `partnerships`, kept individually instead of summed: this is what
   * turns a season on the card from "7 with Ricardo" into the seven events.
   */
  results: Map<number, ResultEntry[]>;
  rejects: RejectCounts;
  /**
   * player id -> season -> federation code -> how many times.
   *
   * Counted only from rows where VIS listed the player first — the nearest
   * thing to a *player's* own federation a team row offers, since a mixed pair
   * carries one code and it usually follows player 1.
   *
   * "Usually" is the honest word. §6c measures it at 207 of 296 (69.9%) on
   * mixed rows, so 30.1% follow player 2 instead. It is far safer than it
   * sounds for this use: the overwhelming majority of rows are *not* mixed,
   * and on those both players share the code, so reading it as player 1's is
   * trivially right. The 69.9% bites only where a player's rows are mostly
   * mixed — Gisi being the extreme, which is why she stays unresolved.
   */
  ownFederation: Map<number, Map<number, Map<string, number>>>;
}

/**
 * Most recent first, matching the card's timeline: season, then when in the
 * season the event started, then tournament number as a stable tie-break.
 *
 * A season's undated events sort last rather than first. `startOffset` is
 * missing only on malformed dates, so this is a handful of rows, but "unknown"
 * belonging at the top of a chronological list would be the wrong default —
 * and comparing `null` explicitly avoids the NaN a stand-in infinity produces
 * when two undated events meet.
 */
export function orderResults(entries: ResultEntry[], tournaments: Map<string, Tournament>): ResultEntry[] {
  const meta = (no: number) => tournaments.get(String(no));
  return [...entries].sort((x, y) => {
    const a = meta(x[0]);
    const b = meta(y[0]);
    if ((a?.season ?? 0) !== (b?.season ?? 0)) return (b?.season ?? 0) - (a?.season ?? 0);
    const sa = a?.startOffset ?? null;
    const sb = b?.startOffset ?? null;
    if (sa !== sb) {
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa;
    }
    return y[0] - x[0];
  });
}

/**
 * Collapse team entries into weighted partnership edges.
 *
 * One entry row = +1 tournament for the pair, except that a pair entering both
 * the qualification and the main draw of the same tournament produces two rows
 * and must count once — hence the tournament *set* rather than a counter.
 */
export function aggregatePartnerships(
  teamRows: VisRow[],
  tournaments: Map<string, Tournament>,
  players: Map<number, Player>,
): AggregateResult {
  const partnerships = new Map<string, Partnership>();
  const appearances = new Map<number, Set<string>>();
  /**
   * Keyed by `tournament:partner` inside each player so a pair that entered
   * the qualification *and* the main draw of one event collapses to a single
   * row — the same double-registration the `tournaments` set above absorbs.
   * Two pairs in the whole archive; the main-draw placement is the result, so
   * the higher rank wins.
   *
   * Not keyed by tournament alone: 43 players have two played rows in one
   * event with *different* partners, and both are real entries the partner
   * list already counts on both pairings. Collapsing those would leave a
   * season's expanded rows short of the tallies above them.
   */
  const results = new Map<number, Map<string, ResultEntry>>();
  /**
   * Federation codes seen on a pair's team rows, keyed `pair@tournament`.
   *
   * Collected *before* the Rank filter below, which is the whole point. VIS
   * keeps superseded registrations, and when a pair is entered twice for one
   * event the surviving row is not always the one telling the truth about the
   * federation: Taiana Lima's 2010 Gstaad and Stare Jablonki entries exist
   * twice each, once BRA with a blank Rank and once AZE with a real one. The
   * blank-Rank rows are rejected as "did not play" — so before this, the only
   * federation the resolver ever saw for those events was AZE, and a Brazilian
   * legend was published as Azerbaijani with nothing to disagree with.
   */
  const fedCodesByPair = new Map<string, Set<string>>();
  /**
   * Each player's own federation by season, counted only from rows where VIS
   * listed them first. See the capture below for why that is the only place
   * this can come from.
   */
  const ownFederation = new Map<number, Map<number, Map<string, number>>>();
  const rejects: RejectCounts = {
    missingPlayer: 0,
    selfPair: 0,
    unknownPlayer: 0,
    outOfScopeTournament: 0,
    duplicateEntry: 0,
    didNotPlay: 0,
  };

  const noteAppearance = (id: number, tournamentNo: string) => {
    let set = appearances.get(id);
    if (!set) appearances.set(id, (set = new Set()));
    set.add(tournamentNo);
  };

  const noteResult = (self: number, partner: number, tournamentNo: string, rank: number) => {
    let byKey = results.get(self);
    if (!byKey) results.set(self, (byKey = new Map()));
    const key = `${tournamentNo}:${partner}`;
    const existing = byKey.get(key);
    if (!existing || rank > existing[2]) byKey.set(key, [Number(tournamentNo), partner, rank]);
  };

  for (const row of teamRows) {
    const tournamentNo = (row.NoTournament ?? '').trim();
    const tournament = tournaments.get(tournamentNo);
    if (!tournament) {
      rejects.outOfScopeTournament++;
      continue;
    }

    const a = Number(row.NoPlayer1);
    const b = Number(row.NoPlayer2);
    // Withdrawals and placeholder entries show up with one side missing or zero.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      rejects.missingPlayer++;
      continue;
    }
    if (a === b) {
      rejects.selfPair++;
      continue;
    }
    if (!players.has(a) || !players.has(b)) {
      rejects.unknownPlayer++;
      continue;
    }

    // VIS keeps a team's registration row even after it's superseded: a pair
    // registers, one side pulls out before the event and re-registers with a
    // different partner, and the original row is never deleted — just marked
    // Rank 0 ("has not played the tournament", per FIVB's own field
    // description). Filtering on that, not on Status, is what actually tells
    // "never competed" apart from "competed and has a real result": a team
    // that plays into the tournament and can't finish (an injury retirement,
    // even in the very last match) still keeps its bracket placement and a
    // real Rank — Status alone doesn't distinguish these, Rank does. Negative
    // Rank values (qualification/quota eliminations) are real participation
    // and are kept; `Number('')` also happens to be 0, which is exactly right
    // for a blank Rank on a row that was never played.
    // Before the Rank filter: a rejected row is still evidence about which
    // federation the entry was made under. See fedCodesByPair.
    const stamped = (row.FederationCode ?? '').trim().toUpperCase();
    if (stamped) {
      const fedKey = `${pairKey(a, b)}@${tournamentNo}`;
      let codes = fedCodesByPair.get(fedKey);
      if (!codes) fedCodesByPair.set(fedKey, (codes = new Set()));
      codes.add(stamped);

      // The same code, filed under whoever VIS listed *first* on the row.
      //
      // This is the only per-player federation signal in the data, and it
      // exists because of §6c: a team gets one code, and on a mixed pair that
      // code follows player 1 about seven times in ten (207 of 296 measured;
      // the rest follow player 2). So a row where a player is listed first says
      // something about *them*; a row where they are listed second says
      // something about their partner. `pair.a`/`pair.b` are the numeric
      // minimum and maximum and cannot answer this, which is why it is
      // captured here rather than derived later.
      const first = Number(row.NoPlayer1);
      const season = tournament.season;
      if (Number.isFinite(first) && first > 0) {
        let seasons = ownFederation.get(first);
        if (!seasons) ownFederation.set(first, (seasons = new Map()));
        let tally = seasons.get(season);
        if (!tally) seasons.set(season, (tally = new Map()));
        tally.set(stamped, (tally.get(stamped) ?? 0) + 1);
      }
    }

    const rank = Number(row.Rank);
    if (rank === 0) {
      rejects.didNotPlay++;
      continue;
    }

    noteAppearance(a, tournamentNo);
    noteAppearance(b, tournamentNo);
    noteResult(a, b, tournamentNo, rank);
    noteResult(b, a, tournamentNo, rank);

    const key = pairKey(a, b);
    let pair = partnerships.get(key);
    if (!pair) {
      partnerships.set(
        key,
        (pair = {
          a: Math.min(a, b),
          b: Math.max(a, b),
          tournaments: new Set(),
          firstSeason: tournament.season,
          lastSeason: tournament.season,
          fedCodes: new Map(),
          best: null,
        }),
      );
    }
    if (pair.tournaments.has(tournamentNo)) rejects.duplicateEntry++;
    pair.tournaments.add(tournamentNo);
    pair.firstSeason = Math.min(pair.firstSeason, tournament.season);
    pair.lastSeason = Math.max(pair.lastSeason, tournament.season);
  }

  // Hand each partnership the codes gathered above, for the events it kept.
  for (const [key, pair] of partnerships) {
    for (const no of pair.tournaments) {
      const codes = fedCodesByPair.get(`${key}@${no}`);
      if (codes) pair.fedCodes.set(no, codes);
    }
  }

  const ordered = new Map(
    [...results].map(([id, byKey]) => [id, orderResults([...byKey.values()], tournaments)]),
  );
  for (const [key, best] of bestFinishByPair(ordered)) {
    const pair = partnerships.get(key);
    if (pair) pair.best = best;
  }

  return { partnerships, appearances, results: ordered, rejects, ownFederation };
}

/**
 * Each pair's best main-draw placement, keyed by `pairKey`.
 *
 * Deliberately derived from the finished result rows rather than accumulated
 * in the loop above, so that "best 5th" is provably the minimum of the rows a
 * reader sees when they expand the seasons underneath it. The loop's own
 * `noteResult` collapses a pair entered twice for one event and keeps the
 * *higher* rank — the main draw over the qualification it came through — and a
 * best-so-far tracked alongside it would have already banked the discarded
 * number. Two events in the archive are in that position.
 *
 * Only positive ranks count. Zero never arrives (§3 rejects it upstream), and
 * negatives are eliminations before the main draw rather than placements
 * within it — a pair whose every entry ended in qualification has no best
 * finish, which is a different statement from "finished last" and is published
 * as absent rather than as a number.
 *
 * `Number.isFinite` rather than the `rank > 0` that reads as sufficient: a row
 * with no `Rank` attribute at all parses to `NaN`, every comparison against it
 * is false, and `NaN <= 0` being false is enough to walk a missing rank
 * straight past a `continue` and publish it as this pair's best result. The
 * §3 filter upstream does not catch it either, because it tests `=== 0`.
 */
export function bestFinishByPair(results: Map<number, ResultEntry[]>): Map<string, number> {
  const best = new Map<string, number>();
  for (const [self, entries] of results) {
    for (const [, partner, rank] of entries) {
      if (!Number.isFinite(rank) || rank <= 0) continue;
      const key = pairKey(self, partner);
      const current = best.get(key);
      if (current === undefined || rank < current) best.set(key, rank);
    }
  }
  return best;
}

// --- Stage 4 slicing -------------------------------------------------------

export interface Slice {
  country: string;
  gender: Gender;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Group players into country x gender slices and keep only edges whose *both*
 * endpoints fall inside the slice.
 *
 * Strict slicing drops cross-national partnerships entirely. Measured against
 * the live FIVB archive that is ~1% of all partnerships, which is why it is a
 * reasonable simplification rather than a silent hole.
 */
/**
 * Partnerships the slicing throws away, indexed by each player in them.
 *
 * `sliceByCountryAndGender` keeps an edge only when both endpoints land in the
 * same country x gender bucket, so a pair split across federations vanishes
 * from the graph entirely — from *both* countries, since neither slice
 * contains both players. That is right for the graph and wrong for the player:
 * a career built with foreign partners reads on the card as no career at all.
 *
 * Around 0.8% of partnerships, but concentrated. A player who changes
 * federation keeps their new country and loses every partnership they made
 * under the old one, all in a single weekly refresh — Karen Noppen moved
 * BDI to NED on 16 August 2026 and went from two partners to none.
 *
 * Returned per player rather than per pair because that is how the card reads
 * it, and sorted the same way the in-slice partner list is: most tournaments
 * together first, then name.
 */
/**
 * A partnership's tournaments, grouped into per-season tallies.
 *
 * Shared by the graph's edges and by the away partners below, which is the
 * point: the player card renders both through the same timeline, so a season
 * tally computed two ways would be two ways for them to disagree.
 *
 * The offset marks the pair's *last* event that season rather than their first,
 * because the card lists seasons newest first and the rows inside one have to
 * run the same way or the reading order jumps at every season boundary.
 */
export function seasonTallies(
  tournamentNumbers: Iterable<string>,
  tournaments: Map<string, Tournament>,
): SeasonTally[] {
  const perSeason = new Map<number, { n: number; latest: number | null }>();
  for (const t of tournamentNumbers) {
    const tournament = tournaments.get(t);
    const season = tournament?.season ?? 0;
    if (season <= 0) continue;
    const row = perSeason.get(season);
    const start = tournament?.startOffset ?? null;
    if (!row) {
      perSeason.set(season, { n: 1, latest: start });
    } else {
      row.n++;
      if (start !== null && (row.latest === null || start > row.latest)) row.latest = start;
    }
  }
  return [...perSeason]
    .sort((x, y) => x[0] - y[0])
    .map(([season, { n, latest }]): SeasonTally => (latest === null ? [season, n] : [season, n, latest]));
}

export function awayPartnersByPlayer(
  partnerships: Map<string, Partnership>,
  players: Map<number, Player>,
  tournaments: Map<string, Tournament>,
  ownFederation: Map<number, Map<number, Map<string, number>>>,
  conflicts: FederationConflict[] = [],
): Map<number, AwayPartner[]> {
  const out = new Map<number, AwayPartner[]>();
  const sliceKey = (p: Player) => `${p.federation}-${p.gender}`;

  /**
   * How often each code appears across a pair's *unambiguous* entries in one
   * season — the evidence that settles a disagreeing duplicate. Built from
   * every partnership, not just the away ones, so a pair's own record can vouch
   * for them even when the conflicting event is their only cross-federation
   * one.
   */
  const seasonEvidence = new Map<string, Map<string, number>>();
  for (const pair of partnerships.values()) {
    for (const [no, codes] of pair.fedCodes) {
      if (codes.size !== 1) continue;
      const season = tournaments.get(no)?.season;
      if (!season) continue;
      for (const id of [pair.a, pair.b]) {
        const key = `${id}:${season}`;
        let tally = seasonEvidence.get(key);
        if (!tally) seasonEvidence.set(key, (tally = new Map()));
        const code = [...codes][0]!;
        tally.set(code, (tally.get(code) ?? 0) + 1);
      }
    }
  }

  /**
   * A player's own federation in a season, from the rows where VIS listed them
   * first — the closest a team row comes to naming that player's own
   * federation (§6c, and see `ownFederation` for how close that is).
   *
   * Falls back to the nearest season they have a record for, because a player
   * does not change federation for one event and back: a partnership in 2003
   * is corroborated by that player being Italian in 2002 and 2004. Returns
   * null when they were never listed first at all, which is 31.5% of players —
   * and null means "cannot corroborate", never "disagrees".
   */
  const ownFedAt = (id: number, season: number): string | null => {
    const seasons = ownFederation.get(id);
    if (!seasons) return null;
    let best: string | null = null;
    let bestDistance = Infinity;
    let bestCount = 0;
    for (const [year, tally] of seasons) {
      const distance = Math.abs(year - season);
      if (distance > bestDistance) continue;
      for (const [code, count] of tally) {
        if (distance < bestDistance || count > bestCount) {
          best = code;
          bestDistance = distance;
          bestCount = count;
        }
      }
    }
    return best;
  };

  /** The federation a pair represented, season by season. */
  const spansFor = (pair: Partnership): [number, string][] => {
    const bySeason = new Map<number, string>();
    for (const [no, codes] of pair.fedCodes) {
      const season = tournaments.get(no)?.season;
      if (!season) continue;
      const evidence = new Map<string, number>();
      for (const id of [pair.a, pair.b]) {
        for (const [code, n] of seasonEvidence.get(`${id}:${season}`) ?? []) {
          evidence.set(code, (evidence.get(code) ?? 0) + n);
        }
      }
      const resolved = resolveFederation([...codes], evidence);
      if (!resolved) continue;
      if (resolved.why !== 'only') {
        conflicts.push({
          tournament: no,
          a: pair.a,
          b: pair.b,
          season,
          saw: [...codes].sort(),
          chose: resolved.code,
          why: resolved.why,
        });
      }
      // Seasons hold one code: a pair does not change federation mid-season
      // in this data, and where two events in one season disagree the later
      // read wins, which is the same order the spans are read in.
      bySeason.set(season, resolved.code);
    }
    return federationSpans(bySeason);
  };

  for (const pair of partnerships.values()) {
    const a = players.get(pair.a);
    const b = players.get(pair.b);
    if (!a || !b || !a.federation || !b.federation) continue;
    if (sliceKey(a) === sliceKey(b)) continue; // in-slice: the graph has it

    const spans = spansFor(pair);

    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      // Only claim a federation for the partnership where *both* players'
      // own records agree with it.
      //
      // `spansFor` returns the code stamped on the team row, and on a mixed
      // pair that code describes one player rather than the pair (§6c) — so on
      // Gisi Gavio's card it said her Italian partners represented Brazil, and
      // the flag pair rendered from it read as a transfer none of them made.
      //
      // Measured on the published rows, the filter drops 154 spans: 100 where a
      // player's own record names a *different* federation, so the claim was
      // simply wrong, and 54 where nobody disagrees and one side merely has no
      // record. Away rows carrying a federation go 221 -> 111, and rows drawing
      // a transfer arrow 116 -> 58.
      //
      // Symmetric on purpose, and an asymmetric version of this was wrong.
      // Checking only the partner looks like it gives a pleasingly different
      // answer per direction — nothing about Cicola on Gisi's card, but Gisi
      // still Brazilian on Cicola's. That second half is the code vouching for
      // itself: Gisi is listed first on all fifteen of her rows, is never
      // listed second, and never once partnered a Brazilian, so every row
      // saying BRA is a row whose BRA came from her being player 1 on it.
      // There is no independent evidence of her federation in this data at
      // all, and a rule that produces one is measuring its own input.
      //
      // Requiring both sides also makes the field mean what it says. "The
      // federation the pair represented" is only true of a pair who were both
      // in it; where they were not, there is no such federation to name.
      //
      // What this is *not* is proof the surviving codes are historically true.
      // Both sides of the test read the same field, written by the same people,
      // and §6d measures how little independence there is between two rows: the
      // biggest single write covers 21,580 rows spanning 1996 to 2024, 303 bulk
      // writes rewrite rows a decade or more apart in one operation, and 60.0%
      // of players have their whole player-1 record written in one transaction
      // — Gisi's fifteen rows among them. Rows concurring is usually one
      // assertion consulted repeatedly. So this catches rows that *disagree*,
      // which is the case that produced the 31 false transfers, and it cannot
      // catch a code that was wrong, or retroactively made wrong, everywhere at
      // once. Only a source outside VIS could.
      //
      // Silence is the fallback, not a guess. A row with no span shows the
      // partner's current federation and nothing about the past, which is
      // exactly what we know.
      const corroborated = spans.filter(
        ([season, code]) => ownFedAt(self.id, season) === code && ownFedAt(other.id, season) === code,
      );
      const list = out.get(self.id) ?? [];
      list.push({
        id: other.id,
        name: other.name,
        fed: other.federation,
        gender: other.gender,
        t: pair.tournaments.size,
        f: pair.firstSeason,
        l: pair.lastSeason,
        s: seasonTallies(pair.tournaments, tournaments),
        at: corroborated.length > 0 ? corroborated : undefined,
        ...(pair.best === null ? {} : { r: pair.best }),
      });
      out.set(self.id, list);
    }
  }

  for (const list of out.values()) {
    list.sort((x, y) => y.t - x.t || x.name.localeCompare(y.name));
  }
  return out;
}

export function sliceByCountryAndGender(
  partnerships: Map<string, Partnership>,
  appearances: Map<number, Set<string>>,
  players: Map<number, Player>,
  tournaments: Map<string, Tournament>,
  minNodes = 2,
): Slice[] {
  const seasonOf = (t: string) => tournaments.get(t)?.season ?? 0;

  // Bucket every player that actually entered a qualifying tournament.
  const buckets = new Map<string, GraphNode[]>();
  const bucketOf = new Map<number, string>();

  for (const [id, entered] of appearances) {
    const player = players.get(id);
    if (!player || !player.federation) continue;
    const key = `${player.federation}-${player.gender}`;
    const seasons = [...entered].map(seasonOf).filter((s) => s > 0);
    if (seasons.length === 0) continue;

    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push({
      id,
      name: player.name,
      short: player.short,
      tournaments: entered.size,
      first: Math.min(...seasons),
      last: Math.max(...seasons),
    });
    bucketOf.set(id, key);
  }

  const edgesByBucket = new Map<string, GraphEdge[]>();
  for (const pair of partnerships.values()) {
    const ka = bucketOf.get(pair.a);
    const kb = bucketOf.get(pair.b);
    if (!ka || ka !== kb) continue; // cross-country or cross-gender: dropped
    let list = edgesByBucket.get(ka);
    if (!list) edgesByBucket.set(ka, (list = []));

    // Per-season breakdown, derived here rather than tracked through
    // aggregation: the pair's tournament numbers are already in hand and the
    // tournament lookup is already needed for the nodes above, so this costs
    // one pass over a set that has a median size of 1.
    //
    // Each season carries a count *and* when in that season the pair last
    // played. The count alone cannot order two partners within one year, and
    // ordering by volume put the wrong name first in 38% of the archive's
    // 5,891 shared seasons — a one-off fill-in ranked above the partner
    // somebody actually switched to.
    //
    // The *last* event rather than the first, because the card lists seasons
    // newest first and the rows inside one have to run the same way or the
    // reading order jumps at every season boundary. In a newest-first list a
    // partnership belongs where it was most recently played, which is also
    // what puts a partner carried into the following season directly beneath
    // their row in it.
    list.push({
      a: pair.a,
      b: pair.b,
      t: pair.tournaments.size,
      f: pair.firstSeason,
      l: pair.lastSeason,
      s: seasonTallies(pair.tournaments, tournaments),
      ...(pair.best === null ? {} : { r: pair.best }),
    });
  }

  const slices: Slice[] = [];
  for (const [key, nodes] of buckets) {
    if (nodes.length < minNodes) continue;
    const split = key.lastIndexOf('-');
    const country = key.slice(0, split);
    const gender = key.slice(split + 1) as Gender;
    // Sorted by id — an immutable key — rather than tournament count: this is
    // the order written to disk, and every consumer (the app's table, the
    // graph's label picker, the prerendered page) already re-sorts by
    // whatever it actually needs. Sorting by a mutable field here instead
    // would mean a single player entering one more tournament reorders the
    // whole array, turning a one-line data change into a full-file diff.
    nodes.sort((x, y) => x.id - y.id);
    const edges = (edgesByBucket.get(key) ?? []).sort((x, y) => x.a - y.a || x.b - y.b);
    slices.push({ country, gender, nodes, edges });
  }
  slices.sort((x, y) => x.country.localeCompare(y.country) || x.gender.localeCompare(y.gender));
  return slices;
}
