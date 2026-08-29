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
} from '../web/src/schema.js';
import { toCentimetres, toKilograms, type VisRow } from './vis.js';
import { tierFor, levelFor, FIVB_ORGANIZER_TYPE } from './tiers.js';
import { EXCLUDED_FEDERATIONS, FEDERATION_ALIASES } from './countries.js';
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
      name: (row.Name ?? '').trim() || `Tournament ${no}`,
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
const TOUR_TIERS = new Set<Tier>(['world-tour', 'beach-pro-tour']);

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

  return words
    .map((word) =>
      word.includes('.')
        ? word
        : // A letter starts a new part of a name when it opens the word or
          // follows a hyphen or apostrophe: Hsin-Tung, D'Almeida, O'Brien.
          word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase()),
    )
    .join(' ');
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

  return { partnerships, appearances, results: ordered, rejects };
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
        at: spans.length > 0 ? spans : undefined,
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
