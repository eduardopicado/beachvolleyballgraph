/**
 * What the records page shows, decided apart from how it is drawn.
 *
 * The one rule with consequences lives here: **an unconfirmed record is not
 * shown.** `records.json` already carries such a row as a rank with nothing on
 * it — no name, no value — so the page could draw "2. —" and stay truthful.
 * It does not, because a blank line on a page of records reads as missing data
 * or as a bug, and the owner's call was to show only what has been checked.
 *
 * What the rule deliberately does *not* do is renumber. Tallest, women is
 * 1, 2, x, 2, x on today's data — Kathryn Plummer is joint second with two
 * unconfirmed 198 cm players — and the page shows 1, 2, 5. Closing the gap to
 * 1, 2, 3 would call Aine Raupelyte the third-tallest woman in the archive,
 * which it does not say. A missing number in the ranks is honest about there
 * being something unpublished; a renumbered board would not be.
 */

import type { Gender, RecordKey, RecordRow, RecordsFile } from '../../../shared/schema';
import { RECORD_KEYS } from '../../../shared/schema';

/** A row the page draws: everything a published row has, never a withheld one. */
export type ShownRow = Exclude<RecordRow, { withheld: true }>;

export interface ShownBoard {
  key: RecordKey;
  rows: (ShownRow & { joint: boolean })[];
  /**
   * The "and 3 more at 5" count, or 0 where saying it would be misleading.
   *
   * `ties` in the file counts candidates sharing the *last row's* value. When
   * that last row is withheld, the value is one the page does not show, so "and
   * 2 more at —" has no honest rendering; it is dropped with the row.
   */
  ties: number;
}

/**
 * Every board the page draws for one draw, in the file's category order.
 *
 * A board whose every row is withheld has nothing to show and is left out
 * rather than drawn empty — Shortest, men and Shortest, women, on today's data.
 * It comes back on its own the day one of its heights is confirmed.
 */
export function boardsFor(file: RecordsFile, gender: Gender): ShownBoard[] {
  const boards: ShownBoard[] = [];
  for (const key of RECORD_KEYS) {
    const board = file.categories[key]?.[gender];
    if (!board) continue;
    const last = board.rows[board.rows.length - 1];
    const rows = board.rows
      .filter((r): r is ShownRow => !('withheld' in r))
      .map((r) => ({
        ...r,
        // Joint against the whole board, not against the rows drawn: a
        // published 198 sharing second with a hidden 198 is joint second
        // whether or not the other is on the page. And the last row is joint
        // with every candidate `ties` says was cut at its value.
        joint: board.rows.filter((o) => o.rank === r.rank).length > 1 || (r === last && board.ties > 0),
      }));
    if (rows.length === 0) continue;
    boards.push({ key, rows, ties: last && 'withheld' in last ? 0 : board.ties });
  }
  return boards;
}

/**
 * The small line under a name: where, and when where the row knows.
 *
 * A reunion names the two seasons either side of the gap rather than the
 * pair's whole span, because the gap is the record — "split after 1995, back
 * in 2008" is the fact; 1995–2008 would read as twelve years together.
 */
export function rowDetail(key: RecordKey, row: ShownRow, countryName: (code: string) => string): string {
  const where = [...new Set(row.who.map((w) => countryName(w.federation)))].join(' & ');
  if (key === 'reunion' && row.gap) return `${where} · split after ${row.gap[0]}, back in ${row.gap[1]}`;
  if (row.first !== undefined && row.last !== undefined) return `${where} · ${row.first}–${row.last}`;
  return where;
}

/** The boards measured in centimetres, whose value carries its unit inline. */
export const IN_CM: ReadonlySet<RecordKey> = new Set(['tallest', 'shortest', 'shortest-champion']);
