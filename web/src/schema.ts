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
  /**
   * The pair's best main-draw placement — 1 is a title.
   *
   * Named `r` rather than the obvious `b` because `b` is already one of the
   * two endpoints above.
   *
   * Absent, rather than zero or a sentinel, when the pair never reached a main
   * draw together: 285 of 14,041 partnerships (2.0%) played only qualification
   * rounds, and "no best finish" is a different statement from "finished last"
   * — a sentinel would sort and render as the latter. Also absent on data
   * published before the field existed, which the card treats the same way.
   *
   * Precomputed here rather than derived from `results/`, which holds the same
   * ranks: that file is an order of magnitude larger and is fetched only when
   * a reader expands a season, while this is on screen the moment a card
   * opens. One number per edge is ~47KB across all slices, or 1.0%.
   */
  r?: number;
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
  /**
   * Federation code — the slice this partner lives in *today*, which is where
   * selecting them navigates to. Deliberately not what the card says the
   * partnership was: see `at`.
   */
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
  /**
   * The federation the pair actually represented, per season, oldest first —
   * `[[2005, 'BRA']]`, or several entries for a pair who kept playing through
   * a transfer.
   *
   * A player's federation is a snapshot of today, so using it to describe a
   * partnership from twenty years ago states something false: Pedro Solberg
   * and Tiago De J Santos played one event together in 2005, both Brazilian,
   * and the card attributed it to Qatar because that is where Tiago went in
   * 2013. FIVB stamps a federation on the team entry itself, which is the
   * thing that was true at the time.
   *
   * Absent when no entry carried a usable code.
   */
  at?: [season: number, fed: string][];
  /** Best main-draw placement, exactly as on a graph edge. */
  r?: number;
}

/**
 * A narrowing the timeline offers, when the player has anything to show for it.
 *
 * Deliberately not derived from the medal counts above. Those record what a
 * player *won*; these record what they *entered*, and the two come apart hard:
 * 412 of the 488 published Olympians (84.4%) never reached an Olympic podium,
 * so a control driven by medals would be missing for five Olympians in six.
 * `tour-podium` is the exception and does mean ranks 1-3, because that is the
 * question worth asking of a tour career.
 */
export type TimelineFilter = 'olympics' | 'world-champs' | 'tour-podium';

/**
 * The two tiers that together are "the tour" — the World Tour up to 2021 and
 * the Beach Pro Tour after it.
 *
 * Shared rather than defined twice: the ingest decides which podiums the Tour
 * podiums tile counts, and the card decides which events the matching filter
 * shows. Two copies of this would eventually disagree, and the disagreement
 * would look like a data bug rather than a drifted constant.
 */
export const TOUR_TIERS: ReadonlySet<Tier> = new Set<Tier>(['world-tour', 'beach-pro-tour']);

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
   * Where FIVB says they were born, as free text — "Curitiba, PR", "Berlin".
   * Absent for the 46% of players VIS has no usable birth place for.
   */
  birthPlace?: string;
  /**
   * Which timeline narrowings have anything to show for this player, so the
   * card can draw the controls before it has fetched a single result. The
   * results file is only loaded when somebody opens a season, and a control
   * that appeared after that click would be no control at all.
   *
   * Absent for the great majority who have none.
   */
  filters?: TimelineFilter[];
  /**
   * Present only when the player won at least one medal at a real, senior
   * Olympic Games. Omitted (not zeroed) for the vast majority of players who
   * never medalled, to keep the common case free.
   */
  olympics?: MedalCounts;
  /**
   * Olympic Games competed at, medal or not — 488 published players have one,
   * and only 76 of them medalled. Separate from `olympics` above because they
   * answer different questions and the card shows both: the medals, and the
   * Games that produced them.
   */
  olympicGames?: number;
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
      /** Null here rather than absent: the two fields below need the slot. */
      level: string | null,
      /**
       * Where it was played, ISO-3166-1 alpha-2 — VIS's `CountryCode`, which
       * is already ISO-2 and needs no lookup, unlike the federation code on a
       * team row. Null on the eight whose code is not a country at all
       * (quirks §25); draw no flag rather than guessing one.
       */
      country: string | null,
      /**
       * Days the main draw runs, last day minus first: 0 for a one-day event,
       * 3 for the ordinary tour week, 15 for an Olympic fortnight. The end
       * date is `startOffset + span`.
       *
       * **Can be negative.** `MOST1995` ends 29 days before it starts, which
       * is upstream and published as-is (quirks §25) — anything rendering a
       * range has to decide what to draw when it is.
       */
      span: number | null,
    ]
  | [
      name: string,
      season: number,
      tier: Tier,
      startOffset: number | null,
      code: string,
      level: string | null,
      country: string | null,
      span: number | null,
      /**
       * Which draw. VIS's own `Gender`, never the code's first letter —
       * `WWRS2022` is a men's field under a `W` (quirks §23).
       *
       * Published because two readers need it and neither can afford the
       * alternative: a tournament's page is addressed by a slug carrying the
       * draw, and the index flips between the men's and women's calendars.
       * Without it both would have to open a classification file per
       * tournament to find out.
       *
       * The eight-element form above is the tree as published between the
       * commit that added `country` and this one — a window in which a
       * scheduled refresh could have run.
       */
      gender: Gender,
    ]
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
/**
 * One edition inside a series file: `[rank, "A / B", federation]` for each of
 * the first four placements.
 *
 * Precomputed rather than derived on the page, because a Gstaad page listing
 * 51 editions would otherwise fetch 51 classification files to find four rows
 * in each.
 */
export interface SeriesEdition {
  code: string;
  season: number;
  gender: Gender;
  /** The page this edition lives on. */
  slug: string;
  /** Its own name, which changes across a long series ("BPT Elite16 Gstaad"). */
  name: string;
  top: [rank: number, pair: string, federation: string][];
}

/**
 * A recurring event and every edition of it: `/v1/series/gstaad.json`.
 *
 * Series membership is not something VIS publishes — there is no series id and
 * no parent record — so `ingest/series.ts` defines it, deriving where the data
 * supports it and enumerating where it does not. See that file for why Gstaad
 * can be matched on its code and the Rio Open cannot.
 */
export interface SeriesFile {
  slug: string;
  name: string;
  blurb: string;
  /** Newest first, men's draw before women's. */
  editions: SeriesEdition[];
}

/**
 * Which series each tournament belongs to: `/v1/series/index.json`.
 *
 * Only the ~112 tournaments in one at all appear. A page fetches this first,
 * learns it is a Gstaad, and fetches only that series — the 87% in none stop
 * here.
 */
export interface SeriesIndexFile {
  of: Record<string, string[]>;
}

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
 * One team in a tournament's final classification:
 * `[rank, player A, player B, federation]`.
 *
 * **The federation is the team's, taken from its own row, and not either
 * player's.** VIS stamps one `FederationCode` per team entry, and a player's
 * record only ever holds their federation *today* (§6). A classification is a
 * historical document: reading a flag off the player record would show Taiana
 * Lima under Azerbaijan at a 2010 event she played for Brazil, and would
 * silently rewrite the flags of every athlete who has ever transferred.
 *
 * `rank` is shared, not unique — see `ResultEntry`. A tournament's teams come
 * back grouped by placement for exactly that reason.
 */
export type ClassificationTeam = [rank: number, a: number, b: number, federation: string];

/**
 * The full final classification of one tournament — every team that played it,
 * whatever federation they came from.
 *
 * One small file per tournament rather than one large file for all of them, or
 * one per season. The panel that reads this opens for a single event, so the
 * fetch should be that event and nothing else: measured over the archive, a
 * tournament averages 3.9 KB and the largest is 10.4 KB, against 146 KB for an
 * average season and 6 MB for the lot.
 *
 * Self-contained on purpose, and that is what `players` is for. The obvious
 * saving is to drop the names and look them up in `search.json`, which already
 * holds every player in the archive — but that file is 390 KB and is
 * deliberately not fetched until someone uses the search box. Depending on it
 * here would mean pulling 390 KB to read a 2 KB classification.
 *
 * Carries no name, season or date for the tournament itself: `tournaments.json`
 * has them, is already loaded by anything that can open this, and duplicating
 * them would be two places to disagree.
 */
export interface ClassificationFile {
  /** FIVB's tournament code, echoing the filename — `MPAR2024`. */
  code: string;
  /**
   * The event's gender, so a name in the field can be resolved to the page it
   * belongs to without a second file.
   *
   * Stored rather than read off the code, which *usually* starts with the
   * gender letter — `WBUS2026` — but does not always: `Rio2016M` and
   * `Rio2016W` put it at the end, and `WWRS2022` is a men's event under a `W`.
   * Taking the first character would send every reader of the 2016 Olympic
   * women's field to a men's page. Quirks §23.
   *
   * Comes from VIS's own `Gender` on the tournament, which is populated on all
   * 9,272 it holds and has both of those right.
   */
  gender: Gender;
  /** Every team that played, best placement first. */
  teams: ClassificationTeam[];
  /** Player id -> display name, for every player named in `teams`. */
  players: Record<string, string>;
  /**
   * Where a player's page is, for the few whose page is not where their team's
   * flag says it is. `null` means they have no published page at all.
   *
   * A name in the field opens that player, and the page it opens is a country
   * x gender slice — which for 99.17% of the archive's 128,118 field
   * appearances is exactly the team's own federation and the gender above, no
   * lookup required. The other 1,066 are what a guess gets wrong: mostly a
   * player who has since transferred, because a classification is historical
   * and a slice is current (§6), plus the GBR split into ENG and SCO, and the
   * five players with no published page at all.
   *
   * The exceptions rather than every player's slice, because that is what it
   * costs: 30 KB across the archive against 1.3 MB, on files whose whole point
   * is being small enough to fetch one at a time. 496 of the 1,608 tournaments
   * carry one, and the largest has eight entries.
   */
  elsewhere?: Record<string, string | null>;
}

/**
 * The published page a player in a tournament's field belongs to, or null when
 * they have none — their slice held too few players for one to be built.
 *
 * The team's federation and the event's gender, unless the file says
 * otherwise. See `ClassificationFile.elsewhere` for why that is a guess with a
 * correction list rather than a slice stored against every name.
 */
export function fieldPlayerSlice(
  file: ClassificationFile,
  id: number,
  federation: string,
): { country: string; gender: Gender } | null {
  const override = file.elsewhere?.[id];
  // `undefined` is "not an exception"; `null` is "nowhere to send them".
  const key = override === undefined ? `${federation}-${file.gender}` : override;
  return key === null ? null : parseSliceKey(key);
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
  | [id: number, name: string, tournaments: number, short: string]
  | [id: number, name: string, tournaments: number, short: string, alsoKnownAs: string[]];

/**
 * The fifth element: names this player has competed under that FIVB no longer
 * holds, from Wikidata (see `ingest/aliases.ts`).
 *
 * Searchable only, never displayed. VIS renames in place and keeps no history,
 * so Kristen Nuss's fourteen titles all read "Cruz" today and searching the
 * name on every broadcast through 2024 finds nobody. Wikidata joins to us by
 * FIVB player id, so these are matched by number rather than by name.
 *
 * Not shown on a card because the direction cannot be trusted: Wikidata is
 * sometimes behind FIVB and sometimes ahead of it, and nothing in the data says
 * which. Confined to search, the worst a wrong entry can do is make an extra
 * string findable — it can never put a false name in front of a reader.
 *
 * Present on 274 of 12,075 players, so the fourth element carries `short`
 * alone on almost every row.
 */

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
  /**
   * FIVB codes of the qualifying tournaments for which VIS publishes no field
   * at all — 78 of 1,688 at the last measurement.
   *
   * These are not future events, though six of them are: they run from 1994 to
   * 2027 and are mostly cancellations (Kiev 2003 and 2006, Montreal 2004 and
   * 2008), plus two rows that are not tournaments in any sense — an "FIVB
   * Presidency Handover Ceremony" and a "Congress 2010". No date rule finds
   * them and nothing in the tuple marks them, so the set has to be published.
   *
   * They stay in `tournaments.json` rather than being dropped from it. Dropping
   * 78 of 1,688 is a 4.6% fall in the tournament count, and `regression.ts`
   * refuses a rebuild that loses more than 5% — clearing a "did the fetch
   * break" guard by 0.4 points is luck, not design, and the guard exists
   * because a silent shrinkage is exactly what a broken fetch looks like.
   *
   * Both the prerenderer and the index must skip the *same* set, not merely
   * equivalent ones: `tournamentSlugs` appends FIVB's code to every member of a
   * colliding group, so a set differing by a single row can resolve a collision
   * the other way and send one side's links to an address the other never
   * wrote. Sharing the fact is what keeps them honest.
   *
   * **Optional, and it has to be.** The published tree is regenerated by the
   * weekly ingest, never by the merge that adds a field to it, so every reader
   * of this meets a tree without it at least once — including the build of the
   * change that introduced it. The prerenderer falls back to the classification
   * files, which are the fact this only summarises; the index page has no
   * filesystem to fall back to and lists what it cannot rule out, which is the
   * honest failure and lasts until the next ingest.
   */
  withoutField?: string[];
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
export const seriesIndexPath = (base: string) => `${base}${DATA_VERSION}/series/index.json`;
export const seriesPath = (base: string, slug: string) =>
  `${base}${DATA_VERSION}/series/${slug}.json`;

export const searchPath = (base: string) => `${base}${DATA_VERSION}/search.json`;

/**
 * Keyed by FIVB's tournament code rather than its number: the code is the
 * archive's only durable public identifier (see `Tournament.code`), so
 * `/v1/classifications/MPAR2024.json` means something to anyone reading the
 * contract, where the internal number would not.
 */
/**
 * Who has entered a tournament that has no result yet.
 *
 * The same shape as a classification minus the one thing it cannot have — a
 * placement — so the page can run it through the same name-to-page resolution
 * rather than growing a second copy of that logic.
 *
 * Published for every tournament the index shows without a field: the ones
 * still to come, and the one being played this week whose placements FIVB has
 * not written yet. `teams` is empty when nobody has entered — the 2027 World
 * Championships had no entries a year out — and the file is written anyway, so
 * a reader gets "no entries yet" rather than a page that failed to load.
 */
/**
 * How a team got into the field, when it was not by ranking.
 *
 * FIVB's own labels, decoded from `BeachTeam.Type` against their published
 * entry lists: 1 is a wild card, 6 a qualification wild card, 9 a continental
 * slot and 10 an open vacancy. Type 0 is the ordinary route and carries no
 * label, which is why this is absent rather than `'MD'` on most teams.
 */
export type EntryRoute = 'WC' | 'QWC' | 'CS' | 'OV';

/**
 * Why a team that entered will not play.
 *
 * `BeachTeam.Status` 2 and 3, matched against FIVB's own entry list for
 * Corigliano Rossano, which shows exactly three of each. Status 1 is a third
 * kind — an entry superseded by a later one — and is published nowhere,
 * including by FIVB.
 */
export type WithdrawalReason = 'withdrawn' | 'medical';

/**
 * One team on an entry list.
 *
 * `entry` and `tech` are FIVB's entry and technical points, **frozen at the
 * registration deadline** rather than current: a player's own page shows live
 * points and the two differ by every result since. Null where FIVB publishes
 * none, which happens for a pair who have never scored.
 *
 * Entry points decide who gets in and technical points break their ties —
 * both confirmed against FIVB's published list, where Schinko's 788 technical
 * points beat Saucedo's 744 on an equal 464 entry points.
 *
 * The three-element form is what the tree carried before the points existed.
 */
export type EntryTeam =
  | [a: number, b: number, federation: string]
  | [a: number, b: number, federation: string, entry: number | null, tech: number | null]
  | [
      a: number,
      b: number,
      federation: string,
      entry: number | null,
      tech: number | null,
      route: EntryRoute,
    ];

/** A team that entered and will not play, with FIVB's reason. */
export type WithdrawnTeam = [
  a: number,
  b: number,
  federation: string,
  entry: number | null,
  tech: number | null,
  reason: WithdrawalReason,
];

export interface EntriesFile {
  /** FIVB's tournament code, echoing the filename. */
  code: string;
  gender: Gender;
  /** Every team entered and still in, best entry points first. */
  teams: EntryTeam[];
  /**
   * Teams that entered and withdrew. Absent when none did.
   *
   * Kept rather than dropped because an entry list a week out is read to see
   * who is coming, and "was coming, is not" is part of that answer — it is
   * why FIVB shows them too.
   */
  withdrawn?: WithdrawnTeam[];
  /** Player id -> display name, for every player named above. */
  players: Record<string, string>;
  /** Exactly as on a classification: the few whose page is elsewhere. */
  elsewhere?: Record<string, string | null>;
}

/** Read an entry row whatever arity the published tree used. */
export function readEntry(team: EntryTeam | WithdrawnTeam): {
  a: number;
  b: number;
  federation: string;
  entry: number | null;
  tech: number | null;
  route: EntryRoute | null;
} {
  // Indexing past the end of a shorter arity gives `undefined`, so `?? null`
  // is the whole arity guard — a `length` check here would read as though it
  // were doing something and would not be.
  const sixth: unknown = team[5];
  return {
    a: team[0],
    b: team[1],
    federation: team[2],
    entry: team[3] ?? null,
    tech: team[4] ?? null,
    // A withdrawal reason shares the slot and is not a route.
    route: sixth === 'WC' || sixth === 'QWC' || sixth === 'CS' || sixth === 'OV' ? sixth : null,
  };
}

export const entriesPath = (base: string, code: string) =>
  `${base}${DATA_VERSION}/entries/${code}.json`;

export const classificationPath = (base: string, code: string) =>
  `${base}${DATA_VERSION}/classifications/${code}.json`;

/** `"BRA-M"` -> `{ country: "BRA", gender: "M" }`. Federation codes can contain a dash. */
export function parseSliceKey(key: string): { country: string; gender: Gender } | null {
  const split = key.lastIndexOf('-');
  if (split <= 0) return null;
  const gender = key.slice(split + 1);
  if (gender !== 'M' && gender !== 'W') return null;
  return { country: key.slice(0, split), gender };
}

export const manifestPath = (base: string) => `${base}${DATA_VERSION}/manifest.json`;
