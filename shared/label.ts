/**
 * Does the graph's label for a player say anything their name does not?
 *
 * The label is VIS's `TeamName`, the short form a federation chose for the
 * scoreboard. Sometimes it is the name people actually use — "Duda" for
 * Eduarda Santos Lisboa, "Guto" for Gustavo Albrecht Carvalhaes, a married
 * name, a spelling the player prefers — and then it is worth showing under the
 * heading on the card and worth indexing for search, because nothing else on
 * the site reaches it. Far more often it is the name cut short: "Capogrosso
 * T.", "Seidl, R.", "Andersson, Dav.", "J.Q. Liu". Those only repeat the
 * heading in a worse form, and a search for any part of them already finds
 * the player by name.
 *
 * Shared because two places decide this and they have to agree: the ingest,
 * which leaves a plain shortening out of the search index, and the player
 * card, which leaves it off the card. The card's own comment says what it
 * shows is "the same test as the search index".
 *
 * A label is a plain shortening when it cuts at least one word short and
 * every part of it is one of these:
 *  - a word of the name ("Seidl", "Del", "Coto");
 *  - the start of a word of the name, either one or two letters ("T", "Ch",
 *    "Jo") or any length marked with a full stop ("Dav.", "Mag.");
 *  - a run of initials spelling, in order, letters of one word of the name
 *    from its first letter, which is how Chinese given names are
 *    abbreviated: "J.Q." for Jinqiu, "Ch. W." for Chaowei.
 *
 * Hyphens split words on both sides, so "Wang C.J." shortens Chin-Ju Wang
 * and "Maau Boutry" is just Maau-Boutry. Everything is compared folded, so
 * "Lopez R" shortens Raul López.
 */

import { foldAccents } from './fold';

/** The words a label part may match: split on spaces, hyphens and quotes. */
function wordsOf(name: string): string[] {
  return foldAccents(name)
    .split(/[\s"-]+/)
    .map((w) => w.replace(/[.,]/g, ''))
    .filter(Boolean);
}

/** The label's parts, each keeping a trailing full stop if it had one. */
function partsOf(label: string): string[] {
  return foldAccents(label).match(/[^\s.,"-]+\.?/g) ?? [];
}

/** Is `letters` a subsequence of `word` that starts with the word's first letter? */
function spells(letters: string, word: string): boolean {
  if (letters[0] !== word[0]) return false;
  let at = 0;
  for (const letter of letters) {
    at = word.indexOf(letter, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

export function labelAddsToName(name: string, label: string): boolean {
  const folded = foldAccents(label).trim();
  const full = foldAccents(name);
  // Nothing to add when it is empty, or when one already contains the other.
  if (!folded || full.includes(folded) || folded.includes(full)) return false;

  const words = wordsOf(name);
  const starts = (part: string) => words.some((w) => w.startsWith(part));
  // Consecutive initials, judged together once the run ends: each the start
  // of a word ("C.J." for Chin-Ju), or all of them spelling one ("J.Q.").
  let run: string[] = [];
  const runShortens = () =>
    run.length === 0 || run.every(starts) || words.some((w) => spells(run.join(''), w));

  // Whether anything was actually cut short. A label of whole words only —
  // "Marcio Araujo" for Marcio Henrique Barroso Araujo, "Wu Jiaxin" for Jiaxin
  // Wu — is the name as people use it, and search ranks on it: without it in
  // the index, "Marcio A" stops being a prefix match and falls below every
  // Marcio Alves.
  let abbreviated = false;
  for (const part of partsOf(label)) {
    const dotted = part.endsWith('.');
    const bare = dotted ? part.slice(0, -1) : part;
    if (bare.length <= 2 && !words.includes(bare)) {
      run.push(bare);
      continue;
    }
    if (!runShortens()) return true;
    if (run.length > 0) abbreviated = true;
    run = [];
    if (words.includes(bare)) continue;
    if (dotted && starts(bare)) {
      abbreviated = true;
      continue;
    }
    return true;
  }
  if (!runShortens()) return true;
  return !(abbreviated || run.length > 0);
}
