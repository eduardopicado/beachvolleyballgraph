/**
 * The table twin of the graph.
 *
 * Every value the graph encodes visually — size, degree, season span — is
 * readable here without colour, hover or a pointer. Sorting is client-side and
 * the whole slice is present, so nothing is gated behind an interaction.
 */

import { useMemo, useState } from 'react';
import { seasonSpan } from '../lib/format';
import { COLUMNS, DEFAULT_SORT, nextSort, sortRows, type SortKey, type TableRow } from '../lib/table';
import { prefetchPortrait } from '../lib/prefetchPortrait';
import './TableView.css';

export type { TableRow } from '../lib/table';

interface Props {
  rows: TableRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function TableView({ rows, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState(DEFAULT_SORT);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  const toggle = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  return (
    <div className="table-view">
      <table>
        <caption className="sr-only">
          Every player in the current selection, with tournaments entered, distinct partners and the
          seasons they were active.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'num' : ''}
                aria-sort={sort.key === col.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              >
                <button type="button" onClick={() => toggle(col.key)}>
                  {col.label}
                  <span className="arrow" aria-hidden="true">
                    {sort.key === col.key ? (sort.desc ? '▾' : '▴') : ''}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">Most frequent partner</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.id}
              className={row.id === selectedId ? 'is-selected' : ''}
              onClick={() => onSelect(row.id)}
              tabIndex={0}
              // Both ways in say the same thing: this is the row about to be
              // opened. Focus covers the keyboard, where there is no hover at
              // all and tabbing is the only approach a reader has.
              onPointerEnter={() => prefetchPortrait(row.id)}
              onFocus={() => prefetchPortrait(row.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(row.id);
              }}
            >
              <td>{row.name}</td>
              <td className="num">{row.tournaments}</td>
              <td className="num">{row.partners}</td>
              <td className="num">{seasonSpan(row.first, row.last)}</td>
              <td className="muted">{row.topPartner ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <p className="empty">No players match the current filters.</p>}
    </div>
  );
}
