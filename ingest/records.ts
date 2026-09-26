/**
 * `/v1/records.json`: the archive's extremes, per category and per gender.
 *
 * Every other file in the tree is a slice of the archive, fetched one country
 * and gender at a time; this is the one file whose whole job is comparing
 * across all of them, so it is computed here, once per run, from the same
 * in-memory data the slices are cut from. Pure functions over plain inputs so
 * every rule below can be tested on a fixture, and a real-data test in
 * build.test.ts reads what was published back.
 *
 * Two rules shape the output more than any other:
 *
 * 1. **A record is about the sport, never about the database.** Categories
 *    that would measure FIVB's data entry rather than anyone's career are not
 *    here. FIVB's own test accounts never reach this code — `normalisePlayers`
 *    drops them — and neither does any player in no published slice, because
 *    a row has to link somewhere.
 *
 * 2. **An unconfirmed number does not ship.** Height is hand-entered at a
 *    couple of hundred federations, and the extremes are exactly where a typo
 *    lands: two Czech players tied at 149 cm is more likely one stale import
 *    than two coincident measurements. A height board publishes a row only
 *    when every player on it is in `CONFIRMED_HEIGHTS`, checked against a
 *    source outside FIVB; anything else is a rank with nothing on it, and is
 *    logged as a TODO so the list keeps filling as new extremes turn up.
 */

import type {
  Gender,
  Highlight,
  RecordBoard,
  RecordHolder,
  RecordKey,
  RecordRow,
  RecordsFile,
} from '../shared/schema.js';
import { GENDERS, RECORD_KEYS } from '../shared/schema.js';
import type { PairDecoration } from './build.js';

/** What the per-player categories read. One per published player. */
export interface RecordPlayer {
  id: number;
  name: string;
  federation: string;
  gender: Gender;
  /** Distinct qualifying tournaments entered — `GraphNode.tournaments`. */
  tournaments: number;
  first: number;
  last: number;
  /** Distinct partners, in their own slice and away. */
  partners: number;
  /** World Tour and Beach Pro Tour wins. */
  tourGold: number;
  /** World Championship wins. */
  worldGold: number;
  /** Olympic Games competed at, medal or not. */
  olympicGames: number;
  /** Centimetres, or null when VIS has none. */
  height: number | null;
}

/** What the per-pair categories read. One per partnership with both halves published. */
export interface RecordPair {
  a: RecordHolder;
  b: RecordHolder;
  gender: Gender;
  tournaments: number;
  first: number;
  last: number;
  /** Distinct seasons the pair played, ascending. */
  seasons: number[];
  decoration: PairDecoration;
}

/** Rows per board. Top five: one name reads like a trivia card, and is one retirement from stale. */
export const RECORD_TOP = 5;

/**
 * Players whose published height has been checked against a source outside
 * FIVB, and where. The only gate on the three height boards.
 *
 * Added to by hand, with the source, and never by the ingest: the point is
 * that a human looked. A source is accepted when it is independent of FIVB's
 * database — an encyclopaedia entry, a club or federation roster, a profile
 * piece — and not when it is a fan database that may mirror it. Where the
 * outside figure differs from VIS by a centimetre or two (Doherty is 7 ft 1
 * in there and 214 here) the row still ships with VIS's number: the check is
 * that the person is that tall, not that two roundings agree.
 *
 * Checked 15 and 17 September 2026. The value in the comment is VIS's.
 */
export const CONFIRMED_HEIGHTS: ReadonlyMap<number, string> = new Map<number, string>([
  // --- tallest, men ---
  // 215. volleyballmag.com, 21 June 2021: "7-footer Page left pro beach
  // volleyball, built a company, and now he's back" — UCLA, then the AVP
  // tour. FIVB's file spells the first name "Robart".
  [136385, 'volleyballmag.com, 2021 profile'],
  // 214. Wikipedia: 7 ft 1 in; the tallest pitcher in professional baseball
  // history before the AVP.
  [141629, 'Wikipedia; MLB.com on his baseball career'],
  // 212. German Wikipedia: 2.12 m, indoor middle blocker before the beach.
  [141407, 'German Wikipedia'],
  // 212. German Wikipedia: 2.12 m.
  [105109, 'German Wikipedia'],
  // 212. Wikipedia: 6 ft 11 in (211 cm), some sources 212.
  [119235, 'Wikipedia'],
  // --- tallest, women ---
  // 204. Wikipedia: 6 ft 8.5 in; Florida Gators roster.
  [162019, 'Wikipedia; Florida Gators roster'],
  // 198. Wikipedia and USA Volleyball: 6 ft 6 in.
  [146722, 'Wikipedia; USA Volleyball profile'],
  // 197. Wikipedia; CEV, 2023: "the tallest woman to appear on the Beach Pro
  // Tour" that season.
  [169390, 'Wikipedia; CEV EuroBeachVolley profile, 2023'],
  // --- shortest champion, men ---
  // 185. Wikipedia: 185 cm. Olympic champion 2016.
  [117474, 'Wikipedia'],
  // 186. Wikipedia: 185 cm; the 2008 Olympic roster lists 186.
  [100148, 'Wikipedia; 2008 Olympic roster'],
  // 186. Wikipedia: 186 cm.
  [103217, 'Wikipedia'],
  // 187. Wikipedia: 6 ft 2 in (188 cm).
  [100425, 'Wikipedia'],
  // 190. Wikipedia: 190 cm.
  [100427, 'Wikipedia'],
  // --- shortest champion, women ---
  // 165. Wikipedia: 1.65 m. Two world titles with Adriana Behar.
  [100926, 'Wikipedia'],
  // 170. Wikipedia: 1.70 m. Olympic champion 1996.
  [100250, 'Wikipedia'],
  // 174. Wikipedia: 1.74 m. Olympic champion 1996.
  [100258, 'Wikipedia'],
  // 174. Wikipedia: 1.74 m.
  [103903, 'Wikipedia'],
  // 175. Wikipedia: 1.75 m.
  [124979, 'Wikipedia'],
  // Looked for and not found outside FIVB, 17 September 2026, so withheld:
  // Esther Mbah (145, NGR), whose qualification coverage carries no height;
  // Leah Best (198, ENG); Rolando Hernández (150, VEN), whose Olympic profile
  // gives none; Lucía Gómez Arguedas (155, CRC); Martin Toufar and Ondřej
  // Kuliš (149, CZE), the tie that started this rule. Anielka Alonzo Zapata
  // (149, NCA) and Vânia Miambo (155, MOZ) appear only on volleybox.net and
  // volleyballworld.com, which carry FIVB's own figure.
  //
  // Looked for and not found, 26 September 2026:
  // Therese Strålman (198, SWE): bvbinfo.com gives 6'6", but its profile is
  // credited to CEV and 6'6" is FIVB's 198 converted, so it is not a second
  // source. Gina Kirstein (147, USA): an AVP player and Division I at
  // Illinois under a name before her married one; her academy's biography
  // gives no height and nothing else does. Abdou Kabirou Mama (157, BEN) and
  // Joaquín López (157, CAN): 16-year-olds at an age-group World
  // Championship, found only on volleyballworld.com. Kuliš retried in Czech;
  // his coaching profile at bvsp.cz gives no height either.
]);

/**
 * Players whose height VIS has wrong, and the source that says so. They are
 * never a candidate on a height board — not ranked, not withheld, not there.
 *
 * `CONFIRMED_HEIGHTS` can only say yes. Without this there is nowhere to put
 * a no, and a figure found to be wrong would sit on its board as a withheld
 * rank for ever: a 149 cm typo at the top of Shortest, men would hide the
 * real shortest man beneath it until FIVB corrected its record, which it has
 * no reason to know to do. Withholding is for "unchecked"; this is for
 * "checked, and false".
 *
 * **What earns an entry is a number, not a doubt.** A source outside FIVB
 * that gives this player a *different* height, far enough from VIS's that the
 * two cannot be one measurement rounded twice — the same independence test as
 * `CONFIRMED_HEIGHTS`, with the opposite answer. "147 cm seems short for a
 * Division I player" is not an entry; a roster that says 5'9" is.
 *
 * Only the height boards are affected. The player keeps their tournaments,
 * partners and titles, which VIS has no reason to have wrong.
 *
 * Empty since it was added on 26 September 2026: the searches recorded above
 * found no source contradicting FIVB, only sources that said nothing.
 */
export const DISPROVEN_HEIGHTS: ReadonlyMap<number, string> = new Map<number, string>([]);

/** The boards that publish nothing unconfirmed. */
const HEIGHT_KEYS: ReadonlySet<RecordKey> = new Set(['tallest', 'shortest', 'shortest-champion']);

/** The boards ranked smallest first. */
const ASCENDING: ReadonlySet<RecordKey> = new Set(['shortest', 'shortest-champion']);

/**
 * A row that has not shipped, for the log and the TODO list. Carries the value
 * and the names precisely because the file does not.
 */
export interface WithheldRecord {
  key: RecordKey;
  gender: Gender;
  rank: number;
  value: number;
  who: RecordHolder[];
}

/** A candidate before ranking: the row it would become, plus the ids that break a tie. */
interface Candidate {
  value: number;
  who: RecordHolder[];
  first?: number;
  last?: number;
  gap?: [number, number];
}

const holder = (p: RecordPlayer): RecordHolder => ({ id: p.id, name: p.name, federation: p.federation });

/** The largest run of idle seasons inside a partnership, and the seasons either side of it. */
export function longestGap(seasons: readonly number[]): { idle: number; gap: [number, number] } | null {
  let best: { idle: number; gap: [number, number] } | null = null;
  for (let i = 1; i < seasons.length; i++) {
    const from = seasons[i - 1]!;
    const to = seasons[i]!;
    const idle = to - from - 1;
    if (idle >= 1 && (!best || idle > best.idle)) best = { idle, gap: [from, to] };
  }
  return best;
}

/**
 * The candidates for one category, unranked. Each rule is one line of sport:
 * what is counted is written next to what it is called.
 */
export function candidatesFor(
  key: RecordKey,
  players: readonly RecordPlayer[],
  pairs: readonly RecordPair[],
): Candidate[] {
  const one = (p: RecordPlayer, value: number, span = false): Candidate =>
    span ? { value, who: [holder(p)], first: p.first, last: p.last } : { value, who: [holder(p)] };
  const two = (q: RecordPair, value: number): Candidate => ({
    value,
    who: [q.a, q.b],
    first: q.first,
    last: q.last,
  });

  switch (key) {
    case 'tournaments':
      return players.filter((p) => p.tournaments > 0).map((p) => one(p, p.tournaments));
    case 'career':
      // Years between first and last season, not seasons played: a career that
      // ran 1991 to 2019 is 28 here whatever happened in between.
      return players.filter((p) => p.last > p.first).map((p) => one(p, p.last - p.first, true));
    case 'partners':
      return players.filter((p) => p.partners > 0).map((p) => one(p, p.partners));
    case 'titles':
      return players.filter((p) => p.tourGold > 0).map((p) => one(p, p.tourGold));
    case 'games':
      return players.filter((p) => p.olympicGames > 0).map((p) => one(p, p.olympicGames));
    case 'tallest':
    case 'shortest':
      return players.filter((p) => p.height !== null).map((p) => one(p, p.height!));
    case 'shortest-champion':
      return players
        .filter((p) => p.height !== null && p.worldGold > 0)
        .map((p) => one(p, p.height!));
    case 'partnership':
      return pairs.filter((q) => q.tournaments > 0).map((q) => two(q, q.tournaments));
    case 'span':
      return pairs.filter((q) => q.last > q.first).map((q) => two(q, q.last - q.first));
    case 'reunion':
      return pairs.flatMap((q) => {
        const found = longestGap(q.seasons);
        return found ? [{ ...two(q, found.idle), gap: found.gap }] : [];
      });
    case 'pair-podiums':
      return pairs.filter((q) => q.decoration.podiums > 0).map((q) => two(q, q.decoration.podiums));
    case 'pair-titles':
      return pairs.filter((q) => q.decoration.titles > 0).map((q) => two(q, q.decoration.titles));
    case 'pair-olympic-worlds':
      return pairs
        .filter((q) => q.decoration.olympicAndWorlds > 0)
        .map((q) => two(q, q.decoration.olympicAndWorlds));
  }
}

const idsOf = (c: Candidate) => c.who.map((w) => w.id);

/** Value first, in the board's direction; then the ids, so equal values order the same way every run. */
function compare(ascending: boolean) {
  return (x: Candidate, y: Candidate): number => {
    if (x.value !== y.value) return ascending ? x.value - y.value : y.value - x.value;
    const a = idsOf(x);
    const b = idsOf(y);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
}

/**
 * Rank candidates into a board of `top` rows.
 *
 * `confirmed` applies only when `gate` is set: a row whose players are not all
 * in it becomes a rank with nothing on it, and is returned separately so the
 * caller can log it. The rank is kept — see `RecordRow` for why.
 */
export function rankBoard(
  candidates: readonly Candidate[],
  options: { top: number; ascending: boolean; gate: ReadonlySet<number> | null },
): { board: RecordBoard; withheld: { rank: number; value: number; who: RecordHolder[] }[] } {
  const sorted = [...candidates].sort(compare(options.ascending));
  const shown = sorted.slice(0, options.top);
  const last = shown[shown.length - 1];
  const ties = last ? sorted.slice(options.top).filter((c) => c.value === last.value).length : 0;

  const withheld: { rank: number; value: number; who: RecordHolder[] }[] = [];
  let rank = 0;
  const rows: RecordRow[] = shown.map((c, i) => {
    // Equal values share a rank, and the next distinct value takes the place
    // it would have had anyway: 5, 5, 4 ranks 1, 1, 3. The id order from
    // `compare` still decides who is *listed* first within a tie, so the file
    // is stable between runs — but it is a filing order, not a result. Before
    // this, Laura Ludwig was "2nd" for Olympic Games behind Nat Cook on five
    // apiece, for no reason but that Cook's FIVB id is smaller.
    //
    // Decided on the candidate's value, which a withheld row still has here,
    // so an unconfirmed height shares its rank the same way a published one
    // does and the board does not change shape when it is later confirmed.
    if (i === 0 || c.value !== shown[i - 1]!.value) rank = i + 1;
    if (options.gate && !c.who.every((w) => options.gate!.has(w.id))) {
      withheld.push({ rank, value: c.value, who: c.who });
      return { rank, withheld: true };
    }
    const row: RecordRow = { rank, value: c.value, who: c.who };
    if (c.first !== undefined && c.last !== undefined) Object.assign(row, { first: c.first, last: c.last });
    if (c.gap) Object.assign(row, { gap: c.gap });
    return row;
  });
  return { board: { rows, ties }, withheld };
}

/** Every board, every gender: the file, plus what was held back from it. */
export function buildRecords(
  players: readonly RecordPlayer[],
  pairs: readonly RecordPair[],
  options: {
    top?: number;
    confirmedHeights?: ReadonlySet<number>;
    disprovenHeights?: ReadonlySet<number>;
  } = {},
): { file: RecordsFile; withheld: WithheldRecord[] } {
  const top = options.top ?? RECORD_TOP;
  const confirmed = options.confirmedHeights ?? new Set(CONFIRMED_HEIGHTS.keys());
  const disproven = options.disprovenHeights ?? new Set(DISPROVEN_HEIGHTS.keys());
  const withheld: WithheldRecord[] = [];
  const categories = {} as RecordsFile['categories'];
  for (const key of RECORD_KEYS) {
    const boards = {} as Record<Gender, RecordBoard>;
    for (const gender of GENDERS) {
      const own = candidatesFor(
        key,
        // A disproven height is off the height boards entirely — see
        // DISPROVEN_HEIGHTS. Every other board still counts the player.
        players.filter((p) => p.gender === gender && !(HEIGHT_KEYS.has(key) && disproven.has(p.id))),
        pairs.filter((q) => q.gender === gender),
      );
      const ranked = rankBoard(own, {
        top,
        ascending: ASCENDING.has(key),
        gate: HEIGHT_KEYS.has(key) ? confirmed : null,
      });
      boards[gender] = ranked.board;
      for (const w of ranked.withheld) withheld.push({ key, gender, ...w });
    }
    categories[key] = boards;
  }
  return { file: { top, categories }, withheld };
}

/**
 * The lowest value the leader of each board may hold before the run refuses to
 * publish the file, per gender.
 *
 * Measured against the archive on 17 September 2026 and set at roughly half
 * the leader then: Emanuel Rego's 255 tournaments, Serguei Prokopiev's 28-year
 * career, Herrera and Gavira's 159 events together. A real archive moves these
 * by ones; a fetch that came back with a fraction of the team rows moves them
 * by half, which is the same instinct as `regression.ts` applied to the one
 * file where a wrong number is the whole content. The height boards have no
 * floor, because a board every row of which is withheld is a legitimate state
 * for them.
 */
export const RECORD_FLOORS: Readonly<Record<Exclude<RecordKey, 'tallest' | 'shortest' | 'shortest-champion'>, number>> = {
  tournaments: 120,
  career: 14,
  partnership: 70,
  partners: 10,
  titles: 30,
  games: 3,
  span: 9,
  reunion: 4,
  'pair-podiums': 40,
  'pair-titles': 20,
  'pair-olympic-worlds': 3,
};

/** One line per board that fails its floor; empty when the file is fit to publish. */
export function recordsBelowFloor(file: RecordsFile): string[] {
  const problems: string[] = [];
  for (const [key, floor] of Object.entries(RECORD_FLOORS) as [keyof typeof RECORD_FLOORS, number][]) {
    for (const gender of GENDERS) {
      const lead = file.categories[key]?.[gender]?.rows[0];
      if (!lead) {
        problems.push(`${key} ${gender}: no rows at all`);
      } else if ('withheld' in lead) {
        problems.push(`${key} ${gender}: leader withheld on a board with no gate`);
      } else if (lead.value < floor) {
        problems.push(`${key} ${gender}: leader holds ${lead.value}, floor is ${floor}`);
      }
    }
  }
  return problems;
}

/**
 * The boards the home page's "start here" strip draws from, in card order.
 *
 * A hand-written list, not a computed "best six". There is no scale on which
 * 255 tournaments and 4 Olympic medals compare, so any ranking across
 * categories would be an invented weighting dressed up as a measurement — and
 * the list has a second job the numbers cannot do: six cards that are all
 * "most tournaments" in six countries say one thing six times.
 *
 * So the order is chosen for what the set covers rather than for size:
 *
 *   - three solo records and three partnerships, because the site is about
 *     pairs and a strip of six individuals would misdescribe it;
 *   - three men's boards and three women's, alternating, because a reader
 *     scanning the first two cards should not have to reach the fourth to
 *     find out the women's tour is in here;
 *   - longevity, titles and decoration between them, so the six answer
 *     different questions rather than one question six times.
 *
 * `pickHighlights` may return fewer than six — a withheld, empty or shared
 * lead, or a player already on an earlier card, drops out — so the strip is
 * built to render whatever it is handed.
 */
export const HIGHLIGHTS: readonly { key: RecordKey; gender: Gender }[] = [
  { key: 'tournaments', gender: 'M' },
  { key: 'pair-podiums', gender: 'W' },
  { key: 'partnership', gender: 'M' },
  { key: 'titles', gender: 'W' },
  { key: 'pair-olympic-worlds', gender: 'M' },
  { key: 'tournaments', gender: 'W' },
];

/**
 * Flatten the leaders of `HIGHLIGHTS` into the cards the strip renders.
 *
 * Rank 1 only. A board's second row is not a highlight, it is a leaderboard,
 * and the page that shows leaderboards is a different page.
 *
 * **No player opens two cards.** The top of this archive is a small club: 28
 * boards have 28 distinct leaders between them, and seven of those people lead
 * more than one — Emanuel Rego leads four, Carolina Solberg Salgado three. The
 * six boards in `HIGHLIGHTS` are chosen not to overlap, so nothing is dropped
 * today; this is what keeps that true as the archive moves under a list nobody
 * is editing.
 *
 * The rule is about the player a card *opens*, not everyone it names. Behar &
 * Bede is one click, and it goes to Behar; Shelda Bede is free to lead a board
 * of her own later without the pair card having retired her on its way past.
 * Blocking both halves would be stricter than the duplication a reader can
 * actually see, and every card it dropped would cost the strip a slot to
 * prevent a repeat that was never on the page.
 */
export function pickHighlights(
  file: RecordsFile,
  wanted: readonly { key: RecordKey; gender: Gender }[] = HIGHLIGHTS,
): Highlight[] {
  const picked: Highlight[] = [];
  const opened = new Set<number>();

  for (const { key, gender } of wanted) {
    const board = file.categories[key]?.[gender]?.rows ?? [];
    const lead = board[0];
    if (!lead || 'withheld' in lead) continue;
    // A record two people share has no single holder to put on a card: the
    // strip names one row, and naming whichever of them has the smaller id
    // would repeat, on the home page, the arbitrary "2nd" this rank rule
    // exists to remove. Only Olympic Games, women, is tied at the top today,
    // and it is not one of the six.
    if (board[1]?.rank === 1) continue;

    // `who[0]` is the half whose id broke the tie in `rankBoard`, and the half
    // the card links to — see StartHere.tsx for why a pair opens a player.
    const opens = lead.who[0];
    if (!opens || opened.has(opens.id)) continue;
    opened.add(opens.id);

    const card: Highlight = { key, gender, value: lead.value, who: lead.who };
    // Pairs always carry their seasons; a solo row only does where the span is
    // the thing being measured. The card renders two shapes rather than one
    // with a blank in it, so the field stays absent rather than becoming null.
    if (lead.first !== undefined && lead.last !== undefined) {
      card.first = lead.first;
      card.last = lead.last;
    }
    picked.push(card);
  }

  return picked;
}
