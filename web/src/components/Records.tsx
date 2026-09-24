/**
 * The records page, at `/records/`.
 *
 * `records.json` had been published for a while with nothing on the site
 * reading it; the start-here strip showed six of its 28 boards and had nowhere
 * to send a reader who wanted the rest. This is the rest.
 *
 * **One draw at a time**, like the tournament index, and chosen over the two
 * draws side by side from a mockup: the same Men / Women switch the rest of
 * the site uses, and a page half the length. The boards are split by gender in
 * the file for a reason of their own — a combined board turned out all-men in
 * five of six categories — so there is no single list to show either way.
 *
 * **Every name is a link** to that player's slice with them selected, the one
 * address that opens a named person. A full navigation rather than anything
 * clever: this page mounts its own root (see main.tsx), so there is no graph
 * here to select into.
 *
 * What is and is not shown is decided in `lib/records.ts`, including the rule
 * that an unconfirmed height never appears.
 */

import type { Gender, ManifestCountry, RecordsFile } from '../../../shared/schema';
import { GENDER_LABEL, GENDERS, RECORD_LABEL, RECORD_TITLE } from '../../../shared/schema';
import { playerPath } from '../../../shared/slug';
import { boardsFor, IN_CM, rowDetail } from '../lib/records';
import './Records.css';

interface Props {
  file: RecordsFile;
  countries: readonly ManifestCountry[];
  gender: Gender;
  onGender: (gender: Gender) => void;
  base: string;
  homeHref: string;
  seasons: { from: number };
}

export function Records({ file, countries, gender, onGender, base, homeHref, seasons }: Props) {
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const boards = boardsFor(file, gender);

  return (
    <main className="records-page">
      <nav aria-label="Breadcrumb">
        <a href={homeHref}>Beach Volleyball Partnership Graph</a>
      </nav>

      <header>
        <h1>Records</h1>
        <p className="blurb">
          {/* No season range: the manifest's runs to the newest season FIVB has
              published anything into, which is next year's Worlds — a range
              that would claim records from a season nobody has played. */}
          The archive’s extremes across every FIVB international tournament since {seasons.from}.
          Heights appear only once they have been confirmed outside FIVB’s own database.
        </p>
      </header>

      <div className="segmented" role="group" aria-label="Draw">
        {GENDERS.map((g) => (
          <button
            key={g}
            type="button"
            className={g === gender ? 'is-selected' : ''}
            aria-pressed={g === gender}
            onClick={() => onGender(g)}
          >
            {GENDER_LABEL[g]}
          </button>
        ))}
      </div>

      <div className="boards">
        {boards.map((board) => {
          const last = board.rows[board.rows.length - 1]!;
          const unit = IN_CM.has(board.key) ? ' cm' : '';
          return (
            <section key={board.key} className="board" aria-labelledby={`board-${board.key}`}>
              <h2 id={`board-${board.key}`}>{RECORD_TITLE[board.key]}</h2>
              <p className="unit">{RECORD_LABEL[board.key]}</p>
              <ol>
                {board.rows.map((row) => (
                  <li key={row.who.map((w) => w.id).join('-')} className={row.rank === 1 ? 'lead' : ''}>
                    {/* The rank is printed, not left to the list's own
                        counter: two rows can share one, and a hidden row
                        leaves a gap that renumbering would paper over. "=1"
                        on every row of a tie is the sporting convention. */}
                    <span className="rank" aria-label={row.joint ? `Joint rank ${row.rank}` : `Rank ${row.rank}`}>
                      {row.joint ? `=${row.rank}` : row.rank}
                    </span>
                    {/* Clipped to one line in the CSS, so the full names ride along
                        for a hover and for anyone whose pair was ellipsised. */}
                    <span className="who" title={row.who.map((w) => w.name).join(' & ')}>
                      {row.who.map((w, j) => (
                        <span key={w.id}>
                          {j > 0 && ' & '}
                          <a href={playerPath(base, nameOf(w.federation), gender, w.id)}>{w.name}</a>
                        </span>
                      ))}
                    </span>
                    <span className="value">
                      {row.value.toLocaleString()}
                      {unit}
                    </span>
                    <span className="detail">{rowDetail(board.key, row, nameOf)}</span>
                  </li>
                ))}
              </ol>
              {board.ties > 0 && (
                <p className="ties">
                  and {board.ties} more at {last.value.toLocaleString()}
                  {unit}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
