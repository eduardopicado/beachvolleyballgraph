/**
 * The tournament index, at `/tournaments/`.
 *
 * Until this existed, all 1,610 tournament pages had exactly one way in: open a
 * player, find the event on their timeline, click through. Every route to a
 * tournament ran through a person who happened to play it, which is a strange
 * thing to require of a reader who wants to know what happened in Gstaad in
 * 2019 — and left a thousand pages with no internal link a crawler could
 * follow.
 *
 * **One season and one draw at a time.** The whole archive in one list is not
 * an index, it is a haystack, and the men's and women's calendars run in
 * parallel rather than interleaving, so showing both at once doubles the page
 * to say the same thing twice. What a reader gets is between 1 and 52 rows: the
 * calendar of one season, which is a list a person can read.
 *
 * **The season is one field, stepped or typed.** Forty year-buttons in a row is
 * a wall that reads as clutter before it reads as a control, and it prices the
 * common move — the season next to this one — the same as the rare one. Arrows
 * put the neighbour one click away; the year between them is the field itself,
 * so reaching 1996 from 2026 is typing it rather than hunting a second control
 * that repeats what the first already shows.
 *
 * The rows are a table because they are four parallel facts about each event —
 * when, what, where, which level — and a table is what says so. It is also the
 * only shape that could later take sortable headers, which `TableView` already
 * does for players.
 */

import { useState } from 'react';
import type { Gender } from '../schema';
import {
  groupsIn,
  levelsIn,
  nearestSeason,
  seasonsFor,
  sliceOf,
  TIER_GROUP_LABEL,
  type IndexFilter,
  type IndexRow,
  type TierGroup,
} from '../lib/tournamentIndex';
import { countryName, flagEmoji, formatDateRange, plural } from '../lib/format';
import './TournamentIndex.css';

interface Props {
  /** Every tournament with a page, from `buildIndex`. */
  rows: readonly IndexRow[];
  /** Already reconciled by the caller, so every chip here is honourable. */
  filter: IndexFilter;
  onFilter: (next: IndexFilter) => void;
  /** Where a row links. */
  tournamentHref: (slug: string) => string;
  /** Back to the graph. */
  homeHref: string;
}

const GENDER_LABEL: Record<Gender, string> = { M: 'Men', W: 'Women' };
const GENDERS: Gender[] = ['M', 'W'];

export function TournamentIndex({ rows, filter, onFilter, tournamentHref, homeHref }: Props) {
  // Newest first is the natural reading order for a list of years; the stepper
  // needs the opposite, so it walks its own ascending copy.
  const seasons = seasonsFor(rows, filter.gender);
  const ascending = [...seasons].reverse();
  const at = ascending.indexOf(filter.season);

  const slice = sliceOf(rows, filter.gender, filter.season);
  const groups = groupsIn(slice);
  const withinGroup = filter.group ? slice.filter((r) => r.group === filter.group) : slice;
  const levels = levelsIn(withinGroup);
  const visible = filter.level ? withinGroup.filter((r) => r.level === filter.level) : withinGroup;
  const upcoming = visible.filter((r) => !r.played).length;

  const set = (patch: Partial<IndexFilter>) => onFilter({ ...filter, ...patch });

  return (
    <main className="tournament-index">
      <nav aria-label="Breadcrumb">
        <a href={homeHref}>Beach Volleyball Partnership Graph</a>
      </nav>

      <header>
        <h1>Tournaments</h1>
        <p className="blurb">
          Every FIVB international tournament — the World Tour, Beach Pro Tour, World
          Championships, Olympic Games and the age-group championships — season by season, with
          the ones still to be played.
        </p>
      </header>

      <div className="filters">
        <div className="line">
          <span className="key" id="index-draw">
            Draw
          </span>
          <div className="segmented" role="group" aria-labelledby="index-draw">
            {GENDERS.map((g) => (
              <button
                key={g}
                type="button"
                className={g === filter.gender ? 'is-selected' : ''}
                aria-pressed={g === filter.gender}
                // The season is not carried across: the women's tour has
                // nothing before 1992, so the caller reconciles it rather than
                // this landing on a year that draw never had.
                onClick={() => set({ gender: g })}
              >
                {GENDER_LABEL[g]}
              </button>
            ))}
          </div>
        </div>

        <div className="line">
          <span className="key" id="index-season">
            Season
          </span>
          <div className="stepper" role="group" aria-labelledby="index-season">
            <button
              type="button"
              className="arrow"
              aria-label="Previous season"
              disabled={at <= 0}
              onClick={() => set({ season: ascending[at - 1]! })}
            >
              ‹
            </button>
            {/* The year is the field, not a label beside one. The arrows walk
                to the neighbouring season and typing over the year reaches any
                of the other thirty-nine, so there is one place the season is
                both shown and changed. */}
            <SeasonField
              season={filter.season}
              onSeason={(season) => set({ season })}
              nearest={(wanted) => nearestSeason(rows, filter.gender, wanted) ?? filter.season}
            />
            <button
              type="button"
              className="arrow"
              aria-label="Next season"
              disabled={at < 0 || at >= ascending.length - 1}
              onClick={() => set({ season: ascending[at + 1]! })}
            >
              ›
            </button>
          </div>
        </div>

        <div className="line">
          <span className="key" id="index-tier">
            Tier
          </span>
          <div className="chips" role="group" aria-labelledby="index-tier">
            <Chip
              label="All"
              count={slice.length}
              pressed={filter.group === null}
              onClick={() => set({ group: null, level: null })}
            />
            {groups.map((g) => (
              <Chip
                key={g}
                label={TIER_GROUP_LABEL[g]}
                count={slice.filter((r) => r.group === g).length}
                pressed={filter.group === g}
                // The level goes with the tier: "Olympics" and "Elite16" can
                // never both be true, and clearing it here saves the caller
                // repairing a filter the reader can see is contradictory.
                onClick={() => set({ group: nextGroup(filter.group, g), level: null })}
              />
            ))}
          </div>
        </div>

        {levels.length > 0 && (
          <div className="line">
            <span className="key" id="index-level">
              Level
            </span>
            <div className="chips" role="group" aria-labelledby="index-level">
              <Chip
                label="All"
                count={withinGroup.length}
                pressed={filter.level === null}
                onClick={() => set({ level: null })}
              />
              {levels.map(({ level, count }) => (
                <Chip
                  key={level}
                  label={level}
                  count={count}
                  pressed={filter.level === level}
                  onClick={() => set({ level: filter.level === level ? null : level })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <section aria-label={`${filter.season} ${GENDER_LABEL[filter.gender]}`}>
        <p className="tally">
          {plural(visible.length, 'tournament')} · {filter.season} ·{' '}
          {GENDER_LABEL[filter.gender]}
          {/* Counted rather than left to be noticed: a season part-played
              reads as a short season otherwise. */}
          {upcoming > 0 && <span> · {upcoming} still to play</span>}
        </p>

        {visible.length === 0 ? (
          <p className="note">Nothing published for this season and draw.</p>
        ) : (
          <table>
            <caption className="sr-only">
              {filter.season} {GENDER_LABEL[filter.gender]} — dates, tournament, country and level
            </caption>
            <thead>
              <tr>
                <th scope="col">Dates</th>
                <th scope="col">Tournament</th>
                <th scope="col">Country</th>
                <th scope="col">Level</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const where = countryName(row.country);
                return (
                  <tr key={row.code}>
                    <td className="when">{formatDateRange(row.start, row.end) ?? '—'}</td>
                    <td className="what">
                      {/* Every row links: an event with no result has a page
                          too, carrying its entry list. The tag says the result
                          is not there yet, so a reader knows what they are
                          clicking into. */}
                      <a href={tournamentHref(row.slug)}>{row.name}</a>
                      {!row.played && <span className="soon">Upcoming</span>}
                    </td>
                    <td className="where">
                      {where ? (
                        <>
                          <span aria-hidden="true">{flagEmoji(row.country)}</span>{' '}
                          <span className="cname">{where}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    {/* The Olympics, the Worlds and the age-group events carry
                        no level below their tier, so the tier stands in — the
                        column is "what rung was this", and blank would read as
                        missing data rather than as not applicable. */}
                    <td className="level">{row.level ?? TIER_GROUP_LABEL[row.group]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

/**
 * The season, shown and edited in one field.
 *
 * Held as its own draft string while the reader types, because a controlled
 * input committing every keystroke cannot be typed into: clearing 2026 to type
 * 1996 passes through the empty string and `202`, and each of those would
 * resolve to some season and re-render the field out from under the cursor.
 * The draft is what is on screen; the commit happens on blur and on Enter,
 * and Escape abandons it.
 */
function SeasonField({
  season,
  onSeason,
  nearest,
}: {
  season: number;
  onSeason: (season: number) => void;
  nearest: (wanted: number) => number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const wanted = Number(draft);
    // Anything unreadable leaves the season alone rather than guessing at it.
    if (draft.trim() !== '' && Number.isFinite(wanted)) onSeason(nearest(wanted));
    setDraft(null);
  };

  return (
    <input
      className="year"
      type="text"
      inputMode="numeric"
      // Four digits is every season the archive will ever hold, and the cap
      // stops a paste from scrolling the field sideways.
      maxLength={4}
      size={4}
      aria-label="Season"
      value={draft ?? String(season)}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(null);
        }
      }}
      // Selecting on focus makes typing a year replace the old one, which is
      // the only thing anyone does here.
      onFocus={(e) => e.currentTarget.select()}
    />
  );
}

/**
 * Clicking the selected tier clears it.
 *
 * Without this the only way back to "everything" is the All chip, and a reader
 * who filtered by clicking naturally tries to unfilter the same way.
 */
function nextGroup(current: TierGroup | null, clicked: TierGroup): TierGroup | null {
  return current === clicked ? null : clicked;
}

function Chip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {label}
      <span className="n">{count}</span>
    </button>
  );
}
