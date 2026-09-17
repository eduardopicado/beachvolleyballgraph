/**
 * Sorting for the "All players" table.
 *
 * Out of the component for the reason a wrong sort is worth guarding at all:
 * it fails silently. A comparator with the direction inverted, or a tie-break
 * dropped, still renders a full, plausible-looking table — there is no error,
 * no gap, nothing to notice. The only way to catch it is to assert the order.
 */

import type { GraphNode } from '../../../shared/schema';

export interface TableRow extends GraphNode {
  partners: number;
  /** Most frequent partner, for context. */
  topPartner: string | null;
}

export type SortKey = 'name' | 'tournaments' | 'partners' | 'last';

export interface Sort {
  key: SortKey;
  desc: boolean;
}

export const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Player', numeric: false },
  { key: 'tournaments', label: 'Tournaments', numeric: true },
  { key: 'partners', label: 'Partners', numeric: true },
  { key: 'last', label: 'Seasons', numeric: true },
];

/** What the table opens on: busiest career first. */
export const DEFAULT_SORT: Sort = { key: 'tournaments', desc: true };

/**
 * Sort a copy of `rows`. Never sorts in place — the array belongs to a
 * `useMemo` upstream, and mutating it would reorder the graph's node list as a
 * side effect of clicking a column header.
 *
 * Numeric columns tie-break on name, so the many players sharing a tournament
 * count come out in a stable, readable order rather than in whatever order the
 * ingest happened to emit. The tie-break is deliberately *not* reversed with
 * the column: descending by tournaments still lists equal careers A–Z, which
 * is what a reader scanning for a name expects.
 *
 * "Seasons" sorts on the last season and falls back to the first, so two
 * players still active are ordered by who started earlier — the longer career
 * ranks above the shorter one it contains.
 */
export function sortRows(rows: TableRow[], sort: Sort): TableRow[] {
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
    if (sort.key === 'last') return dir * (a.last - b.last || a.first - b.first);
    return dir * (a[sort.key] - b[sort.key]) || a.name.localeCompare(b.name);
  });
}

/**
 * What clicking a header does: same column flips direction, a new column
 * starts in the direction that column is usually read — numbers biggest
 * first, names A–Z.
 */
export function nextSort(prev: Sort, key: SortKey): Sort {
  return prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'name' };
}
