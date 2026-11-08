/**
 * Sorting for a tournament's entry list.
 *
 * The list opens in FIVB's order — entry points high to low, technical points
 * breaking ties, frozen at the registration deadline — which is the order FIVB
 * admits teams down, so it stays the default and every other order falls back
 * to it on a tie. A reader can re-sort by country, player or technical points
 * to find someone; nothing about the sort is kept in the address, so every
 * visit opens in FIVB's order again.
 *
 * Out of the component for the reason `table.ts` gives: a wrong sort fails
 * silently, a plausible table in the wrong order, and only an assertion on the
 * order catches it.
 */

import type { EntryTeam } from '../../../shared/schema';
import { readEntry } from '../../../shared/schema';

export type EntrySortKey = 'entry' | 'team' | 'fed' | 'tech';

export interface EntrySort {
  key: EntrySortKey;
  desc: boolean;
}

/** FIVB's order: the file is written in it (`entryOrder` in the ingest). */
export const ENTRY_ORDER: EntrySort = { key: 'entry', desc: true };

/**
 * Accents and case folded, so Céline sorts among the Cs and a name typed in
 * capitals does not jump to the top. One collator for the module rather than
 * one per comparison: building them is the expensive part.
 */
const collator = new Intl.Collator('en', { sensitivity: 'base' });

export interface SortedEntry {
  team: EntryTeam;
  /** 1-based place in FIVB's order, kept whatever the current sort. */
  at: number;
}

/**
 * The teams in `sort` order, each with its place in FIVB's order.
 *
 * `teams` arrives in FIVB's order, so "entry" is the file order itself rather
 * than a re-sort on points: the file also carries the ingest's last tie-break,
 * and re-deriving it here would be a second copy of a rule to keep in step.
 *
 * Player sorts on the first name shown in the row, which is what the eye reads
 * down; the file holds full names only, so there is no surname to sort on that
 * would not get "Tessa Van Winkle" wrong. Country sorts on the code shown, not
 * the country's name, so the order matches the column.
 *
 * Technical points missing from a row sort last in both directions. A team
 * with no figure is not the lowest-ranked team, and reversing the column should
 * not put the unknowns on top.
 */
export function sortEntries(
  teams: readonly EntryTeam[],
  sort: EntrySort,
  nameOf: (id: number) => string,
): SortedEntry[] {
  const rows = teams.map((team, i) => ({ team, at: i + 1, read: readEntry(team) }));
  const dir = sort.desc ? -1 : 1;
  return rows
    .sort((x, y) => {
      let d: number;
      if (sort.key === 'entry') d = -dir * (x.at - y.at);
      else if (sort.key === 'team') d = dir * collator.compare(nameOf(x.read.a), nameOf(y.read.a));
      else if (sort.key === 'fed') d = dir * collator.compare(x.read.federation, y.read.federation);
      else {
        const a = x.read.tech;
        const b = y.read.tech;
        if (a === null || b === null) d = a === b ? 0 : a === null ? 1 : -1;
        else d = dir * (a - b);
      }
      // FIVB's order breaks every tie, in the same direction whatever the
      // column: five Czech teams under "country" still read in the order they
      // would get in.
      return d || x.at - y.at;
    })
    .map(({ team, at }) => ({ team, at }));
}

/**
 * What clicking a header does: the same column flips, a new column starts the
 * way it is usually read — points high to low, names and codes A–Z. "#" is
 * FIVB's order and so is the entry column: the file is sorted on entry points.
 */
export function nextEntrySort(prev: EntrySort, key: EntrySortKey): EntrySort {
  if (prev.key === key) return { key, desc: !prev.desc };
  return { key, desc: key === 'entry' || key === 'tech' };
}
