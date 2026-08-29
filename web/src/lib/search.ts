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
  /**
   * The label the graph draws for this player, when it is not simply their
   * name shortened -- "Duda" for Eduarda Santos Lisboa.
   *
   * Searchable because it is the only name a reader may ever have seen: the
   * graph shows it, the card's partner rows show it, and until this it was the
   * one word that found nobody.
   */
  short?: string;
  /**
   * Names this player used to compete under, which FIVB no longer holds —
   * "Kloth" for Taryn Brasher, "Nuss" for Kristen Cruz.
   *
   * Searchable and nothing else: the row still shows the current name, because
   * that is what FIVB is authoritative about. This only means the name a reader
   * remembers from a broadcast still reaches the right person.
   */
  alsoKnownAs?: string[];
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

/** A player with their names pre-folded, so a keystroke does not refold 12,000 of them. */
export interface IndexedPlayer extends SearchablePlayer {
  folded: string;
  /** The folded label, absent when it would only repeat `folded`. */
  foldedShort?: string;
  /**
   * Former names, folded and joined into one string.
   *
   * One string rather than an array because the hot loop below runs over every
   * player on every keystroke, and a nested loop over a field that 98% of
   * players do not have is a cost paid by all of them to serve almost none.
   * Joined with a space, so a query cannot match across the seam of two
   * separate names.
   */
  foldedAka?: string;
  /**
   * Every word of every name this player answers to, each one preceded by a
   * space: `" eduardo esteban mono martinez"`.
   *
   * Feeds the scattered-token match below. A blob rather than an array because
   * testing `includes(" " + token)` on one string is a word-prefix test with no
   * per-word loop and no allocation, and this runs 12,074 times a keystroke.
   *
   * Split on anything that is not a letter or digit, so the quotes around a
   * nickname are not part of the word — `"Mono"` indexes as `mono`.
   */
  foldedWords: string;
}

export interface SearchMatch extends IndexedPlayer {
  group: MatchGroup;
}

/**
 * Rows the dropdown renders at once.
 *
 * Was 8, chosen when the list could not be scrolled: eight rows fitted the
 * panel exactly, so the cap and the visible area happened to agree. Now that a
 * drag scrolls instead of selecting, eight is stingy for the case that asks for
 * scrolling in the first place -- knowing roughly how a name is spelled and
 * wanting to look down the list for it. 20 is enough to browse, small enough
 * to stay a jump-to-player box rather than a directory, and the footer still
 * reports what it left out.
 */
export const SEARCH_LIMIT = 20;

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
  return players.map((player) => {
    const folded = foldAccents(player.name);
    const short = player.short ? foldAccents(player.short) : '';
    const aka = (player.alsoKnownAs ?? []).map(foldAccents).filter(Boolean).join(' ');
    const words = `${folded} ${short} ${aka}`
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    return {
      ...player,
      folded,
      // Only when it reaches somewhere the name does not, so the hot loop below
      // skips a redundant second `includes` on almost every player.
      foldedShort: short && !folded.includes(short) ? short : undefined,
      foldedAka: aka || undefined,
      foldedWords: words.length ? ` ${words.join(' ')}` : '',
    };
  });
}

/**
 * Rank matches for a "jump to this player" search.
 *
 * The keys, in order: how near the reader the match is, then how well the name
 * matches — it starts with the query, contains it, or contains its words
 * separately — then tournaments played, then the name as a stable tie-break.
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
  limit = SEARCH_LIMIT,
): SearchResult {
  const q = foldAccents(query.trim());
  if (!q) return { matches: [], hidden: 0 };

  // Match quality as a sort key rather than three arrays: 0 a prefix, 1 a
  // contiguous substring, 2 the query's words found separately.
  const found: { player: IndexedPlayer; group: MatchGroup; quality: number }[] = [];
  // Only multi-word queries can match scattered; a single word already matches
  // as a substring anywhere, which is strictly broader.
  //
  // Split on the same class the index does, not on spaces, so a hyphen in the
  // query does not become part of a token that no word can start with:
  // "Kerri-Ann Pottharst" is three words to look up, not two.
  const tokens = q.includes(' ') ? q.split(/[^\p{L}\p{N}]+/u).filter(Boolean) : null;
  for (const player of players) {
    // Either name can match, and a prefix on either counts as a prefix: someone
    // typing "Duda" has typed the whole of what they saw.
    const short = player.foldedShort;
    // A former name matches as a substring but never as a prefix. Someone
    // typing "Kloth" should find Taryn Brasher — but above her should come
    // anyone actually *called* Kloth today, because a reader typing a name is
    // usually looking for the person who holds it. Ranking a former name level
    // with a current one would put a renamed player ahead of her own
    // namesakes.
    const aka = player.foldedAka;
    const quality =
      player.folded.startsWith(q) || short?.startsWith(q)
        ? 0
        : player.folded.includes(q) || short?.includes(q) || aka?.includes(q)
          ? 1
          : // Every word of the query begins a word of some name they answer to.
            // "Eduardo Martinez" is stored as `Eduardo Esteban "Mono" Martinez`
            // and "Paulo Moreira" as `Paulo Roberto "Paulão" Moreira da Costa`,
            // so the two words a reader actually knows are never adjacent and
            // a contiguous match cannot reach them. Measured over the published
            // index, 1,865 of 12,074 players — 15.45% — could not be found by
            // their own given name and surname before this.
            //
            // Word-prefix rather than substring-anywhere, so "an a" does not
            // match half the archive, and so "edu mart" still works.
            tokens?.every((t) => player.foldedWords.includes(` ${t}`))
            ? 2
            : -1;
    if (quality < 0) continue;
    found.push({ player, group: groupOf(player.slice, home), quality });
  }

  found.sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      a.quality - b.quality ||
      b.player.tournaments - a.player.tournaments ||
      a.player.name.localeCompare(b.player.name),
  );

  return {
    matches: found.slice(0, limit).map(({ player, group }) => ({ ...player, group })),
    hidden: Math.max(0, found.length - limit),
  };
}
