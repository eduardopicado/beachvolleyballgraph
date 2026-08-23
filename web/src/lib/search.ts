/** Pure matching/ranking logic for the jump-to-player search, kept separate so it can be unit-tested without React. */

import type { Gender } from '../schema';

/** A country x gender pair — one published slice, and one page of the site. */
export interface Slice {
  country: string;
  gender: Gender;
}

export interface SearchablePlayer {
  id: number;
  name: string;
  tournaments: number;
  /**
   * The slice this player belongs to. Always set, because every row names a
   * country now — a reader looking at a list of eight "Sam"s wants to know
   * which is which, and the ones already on screen were the rows left blank.
   */
  slice: Slice;
}

/**
 * How far a match is from the page the reader is on.
 *
 * Three values rather than two because "home" used to mean the country *and*
 * the gender, which made Kimberly Dicello a foreigner on the United States
 * men's page — flagged in orange, sorted below two Swiss players. She is
 * American. Someone reading "here" means their country; the gender is a page
 * within it. Measured over 400 realistic queries, 10% put a compatriot of the
 * other gender in the eight rows, every one of them mislabelled.
 */
export type MatchGroup = 'home' | 'country' | 'elsewhere';

const GROUP_ORDER: Record<MatchGroup, number> = { home: 0, country: 1, elsewhere: 2 };

export function groupOf(slice: Slice, home: Slice): MatchGroup {
  if (slice.country !== home.country) return 'elsewhere';
  return slice.gender === home.gender ? 'home' : 'country';
}

/** A player with their name pre-folded, so a keystroke does not refold 12,000 of them. */
export interface IndexedPlayer extends SearchablePlayer {
  folded: string;
}

export interface SearchMatch extends IndexedPlayer {
  group: MatchGroup;
}

export interface SearchResult {
  matches: SearchMatch[];
  /**
   * Matches the limit threw away.
   *
   * Reported because the cut is the search's real filter and used to be
   * completely invisible: the median three-letter query against the published
   * index matches 79 players and renders 8 of them.
   */
  hidden: number;
}

/**
 * Strip diacritics and case, so "Joao" finds "João" and "Ozols" finds "Ozols"
 * however either is typed.
 *
 * Beach volleyball is played almost everywhere, and this archive is full of
 * names a reader cannot reasonably be expected to reproduce exactly:
 * "Bárbara Seixas de Freitas", "Márton Szabó", "Kristīne Puriņa". Typing the
 * plain-ASCII form is the normal case, not the degraded one — before this,
 * searching "Barbara" found nothing at all, which is indistinguishable from
 * "she isn't in the data".
 *
 * NFD splits a precomposed letter into its base plus a combining mark, which
 * `\p{Diacritic}` then removes. Deliberately *not* symmetric with a locale
 * collator: `localeCompare` with sensitivity options can only compare whole
 * strings, and this needs substring matching.
 */
export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Fold a list of players once, ready to be searched by every keystroke. */
export function indexPlayers(players: readonly SearchablePlayer[]): IndexedPlayer[] {
  return players.map((player) => ({ ...player, folded: foldAccents(player.name) }));
}

/**
 * Rank matches for a "jump to this player" search.
 *
 * The keys, in order: how near the reader the match is, then whether the name
 * starts with the query or merely contains it, then tournaments played, then
 * the name as a stable tie-break.
 *
 * **Proximity leads, and that is the change.** It used to come second, as a
 * tie-break *inside* the prefix and substring groups, which meant a prefix
 * anywhere in the world outranked a local player whose name contained the
 * query. Searching "silva" on the Brazil men's page put Silvana Hernandez
 * Barisone — Uruguay, one tournament — above Harley Marques Silva and his
 * 147, because "Silvana" happens to begin with those five letters. That is
 * not a tie-break behaving oddly at the margin: 4% of realistic queries put
 * someone from elsewhere above someone from home.
 *
 * Ordering this way also makes the list groupable, which is the point. The
 * country selector has always ranked the search rather than filtering it, and
 * nothing on screen said so; with proximity as the outermost key the boundaries
 * are contiguous, so the dropdown can draw and label them.
 *
 * Case- and accent-insensitive. An empty or whitespace-only query matches
 * nothing: there is no "everyone" result to jump to.
 */
export function searchPlayers(
  players: readonly IndexedPlayer[],
  query: string,
  home: Slice,
  limit = 8,
): SearchResult {
  const q = foldAccents(query.trim());
  if (!q) return { matches: [], hidden: 0 };

  // 0 for a prefix, 1 for a substring — a sort key rather than two arrays,
  // now that it is no longer the outermost distinction.
  const found: { player: IndexedPlayer; group: MatchGroup; prefix: number }[] = [];
  for (const player of players) {
    const prefix = player.folded.startsWith(q) ? 0 : player.folded.includes(q) ? 1 : -1;
    if (prefix < 0) continue;
    found.push({ player, group: groupOf(player.slice, home), prefix });
  }

  found.sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      a.prefix - b.prefix ||
      b.player.tournaments - a.player.tournaments ||
      a.player.name.localeCompare(b.player.name),
  );

  return {
    matches: found.slice(0, limit).map(({ player, group }) => ({ ...player, group })),
    hidden: Math.max(0, found.length - limit),
  };
}
