/**
 * The published data contract (`/v1/`). Shared verbatim by the ingest pipeline
 * and the web app so the two can never drift.
 *
 * Keys on `edges` are deliberately short (`a`/`b`/`t`) — edges dominate file
 * size and terse keys are a ~30% saving for free.
 */

export const DATA_VERSION = 'v1';

export type Gender = 'M' | 'W';

/** Competition tiers we consider "FIVB international". See ingest/tiers.ts. */
export type Tier = 'olympics' | 'world-champs' | 'world-tour' | 'beach-pro-tour' | 'age-group-wch';

export interface GraphNode {
  /** FIVB player number — the stable identity across the whole dataset. */
  id: number;
  /** Display name, "First Last". */
  name: string;
  /**
   * Competition name — what the player is actually known as in the sport
   * ("Emanuel", "Alison"). Used for graph labels, where full names of the
   * "Paulo Roberto Moreira da Costa" sort would bury the graph.
   */
  short: string;
  /** Count of qualifying tournaments entered. Drives node size. */
  tournaments: number;
  /** Season of first qualifying entry. */
  first: number;
  /** Season of most recent qualifying entry. */
  last: number;
}

/**
 * One season of a partnership: `[season, tournaments together, startOffset?]`.
 *
 * A tuple rather than an object because these are the most numerous values in
 * the published data — there are more of them than there are partnerships.
 *
 * `startOffset` is days from 1 January of that season to the first event the
 * pair played in it, and exists only to order two partners *within* one year.
 * An offset rather than a calendar date so it stays two or three digits, and
 * signed so a December event opening a southern season still sorts before the
 * following January's. Absent when the tournament carried no usable date.
 */
export type SeasonTally =
  | [season: number, tournaments: number]
  | [season: number, tournaments: number, startOffset: number];

export interface GraphEdge {
  a: number;
  b: number;
  /** Number of qualifying tournaments this pair entered together. */
  t: number;
  /** First and last season the pair played together. */
  f: number;
  l: number;
  /**
   * Per-season breakdown, ascending by season. `t`, `f` and `l` are all
   * derivable from it (sum, first, last) and are kept anyway: they are what
   * the graph and the partner list read on every render, and recomputing them
   * per edge per frame to save a few bytes is the wrong trade.
   *
   * Optional because data published before this field existed does not carry
   * it — the timeline view hides itself rather than rendering empty when a
   * slice predates it.
   */
  s?: SeasonTally[];
}

export interface GraphFile {
  country: string;
  countryName: string;
  gender: Gender;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MedalCounts {
  gold: number;
  silver: number;
  bronze: number;
}

/**
 * A partner who competed for a different federation, so the partnership sits
 * outside this slice and has no edge in the graph.
 *
 * Only ~0.8% of partnerships, but they are not evenly spread: a player who
 * transferred can lose every partner at once and render as a lone dot with an
 * empty card. Carrying them on the player rather than the graph shows the
 * career without inventing a cross-country edge the slicing deliberately
 * excludes.
 */
export interface AwayPartner {
  id: number;
  name: string;
  /** Federation code — the slice this partner actually lives in. */
  fed: string;
  gender: Gender;
  /** Tournaments together, and the first and last season of them. */
  t: number;
  f: number;
  l: number;
  /**
   * Per-season breakdown, exactly as on a graph edge — so the player card can
   * run these through the same timeline as in-slice partnerships rather than
   * stranding a transferred player's career in a flat list below it.
   *
   * Optional for the same reason `s` is terse on edges: it is absent on a
   * partnership whose tournaments all carried unusable seasons, which is rare
   * but not impossible.
   */
  s?: SeasonTally[];
}

/** Lazy-loaded detail for every player in one country x gender slice. */
export interface PlayerDetail {
  id: number;
  name: string;
  /** ISO date, `null` when FIVB has no date on file. */
  dob: string | null;
  /** Centimetres, `null` when unknown (~60% of the archive has no height). */
  height: number | null;
  /** Kilograms, `null` when unknown. */
  weight: number | null;
  /**
   * Present only when the player won at least one medal at a real, senior
   * Olympic Games. Omitted (not zeroed) for the vast majority of players who
   * never medalled, to keep the common case free.
   */
  olympics?: MedalCounts;
  /** Present only when the player won at least one FIVB World Championships medal. */
  worldChamps?: MedalCounts;
  /**
   * Podium finishes across the FIVB tour — the World Tour and the Beach Pro
   * Tour, with levels mixed and age-group events left out. Separate from the
   * two above rather than folded in: those are the events that define a
   * career, and burying an Olympic gold in a total of 149 would lose it.
   */
  tour?: MedalCounts;
  /**
   * Partnerships with players from another federation, which the graph drops.
   * Omitted entirely for the ~98% of players who have none.
   */
  away?: AwayPartner[];
}

/**
 * Portrait for a player. May 404 — plenty of players have no photo on file, so
 * callers must handle failure (the UI falls back to initials).
 *
 * `width` matters: without it FIVB serves the original, which runs to 2-3MB per
 * portrait. With it, the image service returns a resized WebP of about 10KB.
 */
export const playerPhotoUrl = (id: number, width = 200) =>
  `https://sharp.fivb.com/Legacy/GetImage?Type=Player&No=${id}&Style=Portrait&width=${width}`;

/** Public FIVB athlete page. */
export const playerProfileUrl = (id: number) =>
  `https://www.fivb.com/players/players-database/player/${id}`;

export interface PlayersFile {
  country: string;
  gender: Gender;
  players: PlayerDetail[];
}

/**
 * One tournament in the shared index: `[name, season, tier, startOffset?]`.
 *
 * `startOffset` is the same signed day count as `SeasonTally` carries — days
 * from 1 January of `season` to the main draw's first day — and reconstructs
 * the exact date, so no separate date string is published. Absent, or `null`
 * alongside a code, when the tournament carried no usable date.
 *
 * `code` is FIVB's own identifier for the event — `WBUS2026` is the 2026
 * women's Busan tournament. Published because it is the only stable, public
 * handle on a tournament: FIVB retired its per-tournament pages, the
 * replacement uses hand-curated slugs that cannot be derived, and anyone
 * cross-referencing this data with another beach volleyball source needs
 * something to join on. Nothing here renders it yet.
 */
export type TournamentMeta =
  | [name: string, season: number, tier: Tier]
  | [name: string, season: number, tier: Tier, startOffset: number]
  | [name: string, season: number, tier: Tier, startOffset: number | null, code: string]
  | [
      name: string,
      season: number,
      tier: Tier,
      startOffset: number | null,
      code: string,
      /**
       * What FIVB called this event's level at the time — "Grand Slam",
       * "4-star", "Elite16". Absent for the Olympics, the World Championships
       * and the age-group championships, which have no level below the tier.
       *
       * Era-native and unranked on purpose: the hierarchy was renumbered twice
       * and no mapping across those eras survives, so these are labels rather
       * than a scale. See `LEVEL_BY_TYPE` in ingest/tiers.ts.
       */
      level: string,
    ];

/**
 * Every qualifying tournament, keyed by FIVB tournament number.
 *
 * One shared file rather than a copy inside each slice: the names are the same
 * everywhere, and 575 slices each carrying their own subset would repeat most
 * of this file hundreds of times in a tree that is committed to git.
 */
export interface TournamentsFile {
  tournaments: Record<string, TournamentMeta>;
}

/**
 * One tournament a player entered: `[tournament number, partner id, rank]`.
 *
 * `rank` is FIVB's own placement, which is shared rather than unique — 89% of
 * played rows sit on a rank another team also holds, because beach volleyball
 * reports brackets (9th covers 9th–16th). Negative values are eliminations
 * before the main draw; see `formatFinish`.
 */
export type ResultEntry = [tournament: number, partner: number, rank: number];

/**
 * Every tournament entered by every player in one slice — the detail behind
 * the player card's timeline, loaded only when a season is expanded.
 *
 * Its own file rather than a field on `PlayersFile` because it is an order of
 * magnitude larger than everything else about a player put together, and most
 * readers never open a season at all.
 */
export interface ResultsFile {
  country: string;
  gender: Gender;
  /**
   * Display names for partners with no node in this slice's graph — the
   * cross-federation pairs of `AwayPartner`, plus the handful of players FIVB
   * files under no federation at all. In-slice partners are named by the graph.
   */
  names: Record<string, string>;
  /** Player id -> the tournaments they entered, most recent first. */
  players: Record<string, ResultEntry[]>;
}

/**
 * One player in the search index: `[id, name, tournaments]`, plus the graph's
 * label for them when that label cannot be reached by typing their name.
 *
 * The fourth element exists because the graph draws `short` and the search
 * matched only `name`, so the one word a reader could see was the one word
 * that found nothing: Eduarda Santos Lisboa is labelled "Duda" on every graph
 * she appears in, and searching "Duda" returned nobody. 203 players are in
 * that position -- FIVB nicknames, and names taken later in a career, like
 * Laura Longuet appearing as "Walgenwitz".
 *
 * Omitted when `short` is already inside `name` (a plain shortening such as
 * "P. Solberg"), which is the overwhelming majority: carrying it for all
 * 12,000 would grow the second-largest published file to no purpose.
 */
export type SearchEntry =
  | [id: number, name: string, tournaments: number]
  | [id: number, name: string, tournaments: number, short: string];

/**
 * Every published player, grouped by the slice they belong to.
 *
 * Exists so the search box can reach a player without knowing which country
 * they compete for — which is most of the time, since a reader usually knows
 * the name and not the federation. Grouped rather than flat because the key
 * would otherwise be repeated on all 12,000 rows.
 *
 * Loaded on the first interaction with the search box, never with the page:
 * it is the second-largest file published here, and a reader who only ever
 * clicks the graph should not pay for it.
 */
export interface SearchIndex {
  /** `"BRA-M"` -> the players in that slice, most tournaments first. */
  slices: Record<string, SearchEntry[]>;
}

/**
 * Short badge for the tiers worth calling out on a result row. The two tour
 * tiers are deliberately absent: they are the ordinary case, and a badge on
 * every row would carry no information.
 */
export const TIER_BADGE: Partial<Record<Tier, string>> = {
  olympics: 'Olympics',
  'world-champs': 'Worlds',
  'age-group-wch': 'Age-group',
};

export interface ManifestCountry {
  /** FIVB federation code, e.g. "BRA". */
  code: string;
  name: string;
  /** ISO-3166-1 alpha-2, for the flag glyph. Null when FIVB has no usable code. */
  iso2: string | null;
  genders: Partial<Record<Gender, { nodes: number; edges: number }>>;
}

export interface Manifest {
  generatedAt: string;
  /** Highest tournament `Version` seen upstream — changes when FIVB edits data. */
  sourceVersion: string;
  /** Seasons covered by the qualifying tournament set. */
  seasons: { from: number; to: number };
  totals: {
    tournaments: number;
    players: number;
    partnerships: number;
  };
  /** Qualifying tournament count per tier, so the filter is inspectable. */
  tiers: Record<string, number>;
  countries: ManifestCountry[];
}

export const GENDERS: Gender[] = ['M', 'W'];

export const GENDER_LABEL: Record<Gender, string> = {
  M: "Men",
  W: "Women",
};

export const graphPath = (base: string, country: string, gender: Gender) =>
  `${base}${DATA_VERSION}/graphs/${country}-${gender}.json`;

export const playersPath = (base: string, country: string, gender: Gender) =>
  `${base}${DATA_VERSION}/players/${country}-${gender}.json`;

export const resultsPath = (base: string, country: string, gender: Gender) =>
  `${base}${DATA_VERSION}/results/${country}-${gender}.json`;

export const tournamentsPath = (base: string) => `${base}${DATA_VERSION}/tournaments.json`;

export const searchPath = (base: string) => `${base}${DATA_VERSION}/search.json`;

/** `"BRA-M"` -> `{ country: "BRA", gender: "M" }`. Federation codes can contain a dash. */
export function parseSliceKey(key: string): { country: string; gender: Gender } | null {
  const split = key.lastIndexOf('-');
  if (split <= 0) return null;
  const gender = key.slice(split + 1);
  if (gender !== 'M' && gender !== 'W') return null;
  return { country: key.slice(0, split), gender };
}

export const manifestPath = (base: string) => `${base}${DATA_VERSION}/manifest.json`;
