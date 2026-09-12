/**
 * One tournament's own page, at `/tournament/gstaad-2019-women/`.
 *
 * The same final classification the player card's panel shows, given an
 * address of its own. That is the whole difference and it is the point: the
 * panel is reachable only by opening a player first, so there was no way to
 * link anyone to a tournament, and nothing for a search engine to index. A
 * reader who wants "who won Gstaad in 2019" had to know a player who was
 * there.
 *
 * **Not a dialog.** It shares `bandsOf` with the panel so the grouping cannot
 * drift, and nothing else: a page has no close button, no focus trap and no
 * card underneath to return to, and forcing one component to be both would
 * mean a prop for every one of those differences.
 *
 * **The edition list is the second half.** Below the classification, every
 * other edition of the same event with its first four placements — the
 * "results by year" a recurring tournament gets on Wikipedia. It is what turns
 * a page about one week in 2019 into a page about Gstaad.
 *
 * Both halves are lists of placements and they are deliberately not the same
 * component: this one is the field of *this* edition, in full, grouped by a
 * shared rank; that one is four rows each from fifty other editions, and every
 * row is a link somewhere else.
 */

import { useMemo } from 'react';
import type { ClassificationFile, EntriesFile, Gender, SeriesFile, Tier } from '../schema';
import { fieldPlayerSlice, playerProfileUrl, readEntry, TIER_BADGE } from '../schema';
import { bandsOf } from '../lib/classification';
import { nameCarriesSeason } from '../lib/slug';
import {
  countryName,
  flagEmoji,
  formatDateRange,
  formatFinish,
  medalFor,
  ordinal,
  plural,
} from '../lib/format';
import './TournamentPage.css';

export interface TournamentPageData {
  name: string;
  season: number;
  tier: Tier;
  level: string | null;
  gender: Gender | null;
  /** ISO-2 of the venue's country, null when VIS has none usable (§25). */
  country: string | null;
  start: Date | null;
  end: Date | null;
}

interface Props {
  tournament: TournamentPageData;
  state:
    | { status: 'loading' }
    | { status: 'ready'; data: ClassificationFile }
    | { status: 'failed' };
  /** Federation code -> ISO-2, for the flags on each team row. */
  iso2Of: (federation: string) => string | null;
  /** Opens a player on the slice they are published under. */
  onSelectPlayer: (id: number, slice: { country: string; gender: Gender }) => void;
  /** Back to the graph. */
  homeHref: string;
  /**
   * The index, filtered to this event's own season and draw — the page this
   * one actually sits in.
   */
  indexHref: string;
  /** The same event's other draw, when it has exactly one. */
  counterpart: { gender: Gender; href: string } | null;
  /**
   * Who has entered, for an event with no result yet. Null for a played one,
   * which shows its classification instead.
   */
  entries:
    | null
    | { status: 'loading' }
    | { status: 'ready'; data: EntriesFile }
    | { status: 'failed' };
  /**
   * The series this edition belongs to, each with its own editions. Usually
   * none; two for Gstaad 2007, which was also the World Championships.
   */
  series: SeriesFile[];
  /** Where an edition of the same series lives. */
  editionHref: (slug: string) => string;
  /** This edition's own code, so it can be marked rather than linked. */
  code: string;
}

const GENDER_LABEL: Record<Gender, string> = { M: "Men's", W: "Women's" };

/**
 * The draw without the possessive, for the breadcrumb and the switch.
 *
 * "2008 Women's" is not a thing; "2008 Women" is the slice of the index this
 * page sits in, and it is what that page calls itself.
 */
const DRAW_LABEL: Record<Gender, string> = { M: 'Men', W: 'Women' };

/**
 * Who has entered an event that has not produced a result.
 *
 * A table ordered by entry points, which is the order that decides who gets
 * in: FIVB freezes both figures at the registration deadline and admits teams
 * down the list, breaking ties on technical points. It reads as their own
 * entry list reads, and the earlier version — grouped alphabetically by
 * federation — hid the one thing the list is for.
 *
 * **The points are frozen, and the page says so.** A player's own card on this
 * site shows live points, so the same pair can show two different numbers a
 * few pixels apart; without the label that reads as a bug rather than as the
 * two different questions they answer.
 *
 * **Every name goes somewhere, and not all of them go here.** 432 of the 491
 * entrants across the published lists have a page on this site and open it;
 * the other 59 have no international result we count, and their name links out
 * to their FIVB profile instead.
 *
 * That second group is not a group of beginners, which is why they are not
 * left as plain text. Oguz Degirmenci has twenty-four team rows in VIS across
 * twenty tournaments; exactly one is in our set, and it is the event he is
 * entering. The other nineteen are fourteen Turkish National Tour meetings
 * between 2015 and 2026 plus two zonal tours — tiers excluded on purpose, so
 * the gap is a fact about this site's scope rather than about him. A plain
 * name would assert "nobody" over a ten-year career; FIVB's page is where that
 * career actually is.
 */
function EntryList({
  entries,
  iso2Of,
  onSelectPlayer,
}: {
  entries: Exclude<Props['entries'], null>;
  iso2Of: (federation: string) => string | null;
  onSelectPlayer: Props['onSelectPlayer'];
}) {
  if (entries.status === 'loading') return <p className="note">Loading the entry list…</p>;
  if (entries.status === 'failed')
    return <p className="note">Could not load this tournament&rsquo;s entry list.</p>;

  const { teams, withdrawn, players } = entries.data;

  /**
   * One entrant's name, as whichever kind of link it can be.
   *
   * A published player opens their card here; anyone else opens FIVB's page
   * for them in a new tab, marked the same way the player card marks its own
   * FIVB link. The arrow is the only thing distinguishing the two, and it is
   * doing real work: the reader is about to leave the site.
   */
  const name = (id: number, federation: string) => {
    const label = players[id] ?? `Player ${id}`;
    const to = fieldPlayerSlice(entries.data, id, federation);
    if (to) {
      return (
        <button type="button" onClick={() => onSelectPlayer(id, to)}>
          {label}
        </button>
      );
    }
    return (
      <a className="offsite" href={playerProfileUrl(id)} target="_blank" rel="noopener noreferrer">
        {label}
        <span aria-hidden="true"> ↗</span>
        {/* The arrow carries the meaning visually and nothing carries it
            otherwise, so a reader who cannot see it is told in words. */}
        <span className="sr-only"> — FIVB profile, opens in a new tab</span>
      </a>
    );
  };

  const pair = (a: number, b: number, federation: string) => (
    <>
      {name(a, federation)}
      <span className="sep"> / </span>
      {name(b, federation)}
    </>
  );

  if (teams.length === 0 && !withdrawn?.length) {
    // The 2027 World Championships, a year out. Nothing is broken; nobody has
    // entered yet, and saying so beats an empty heading.
    return (
      <section aria-label="Entry list" className="entries">
        <h2>Entry list</h2>
        <p className="note">No teams have entered yet.</p>
      </section>
    );
  }

  return (
    <section aria-label="Entry list" className="entries">
      <h2>Entry list</h2>
      <p className="blurb">
        Entry points decide who gets in, and technical points break their ties. Both are FIVB&rsquo;s
        figures frozen at the registration deadline, so they sit behind the live points on a
        player&rsquo;s own page.
      </p>

      {teams.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Team</th>
              <th scope="col">Fed.</th>
              <th scope="col" className="num">
                Entry
              </th>
              <th scope="col" className="num">
                Tech
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team, at) => {
              const { a, b, federation, entry, tech, route } = readEntry(team);
              return (
                <tr key={`${a}-${b}`}>
                  <td className="at">{at + 1}</td>
                  <td className="who">
                    {pair(a, b, federation)}
                    {/* Only the four routes that are not "by ranking"; the
                        ordinary case is the whole rest of the table. */}
                    {route && <span className="route">{route}</span>}
                  </td>
                  <td className="fed">
                    <span aria-hidden="true">{flagEmoji(iso2Of(federation), federation)}</span>{' '}
                    {federation}
                  </td>
                  <td className="num">{entry ?? '—'}</td>
                  <td className="num">{tech ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {withdrawn && withdrawn.length > 0 && (
        // A table, in the same shape as the entry list above it, rather than
        // the flex list this used to be. That list right-aligned the reason
        // with `margin-left: auto`, which reads as a column only while every
        // row fits on one line — at phone width the names wrap and the reason
        // is flung to the right edge of whichever line it landed on, orphaned
        // from the team it belongs to. Columns do what the alignment was
        // pretending to do, and they hold at any width.
        //
        // No `#` column: these teams have no position in the entry order, and
        // numbering them would invent one.
        <table className="gone">
          <caption>{plural(withdrawn.length, 'team')} withdrawn</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Federation</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {withdrawn.map((team) => {
              const { a, b, federation } = readEntry(team);
              const medical = team[5] === 'medical';
              return (
                <tr key={`${a}-${b}`}>
                  <td className="who">{pair(a, b, federation)}</td>
                  <td className="fed">
                    <span aria-hidden="true">{flagEmoji(iso2Of(federation), federation)}</span>{' '}
                    {federation}
                  </td>
                  <td className="why">
                    {/* "Medical certificate" is what FIVB calls it, and what
                        this said before. The column is the narrowest on the
                        page and the phrase is the longest thing that could go
                        in it, so the visible label is the short form and the
                        full one stays for anyone listening rather than
                        looking. */}
                    {medical ? 'Medical' : 'Withdrawn'}
                    {medical && <span className="sr-only"> certificate</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function TournamentPage({
  tournament,
  state,
  iso2Of,
  onSelectPlayer,
  homeHref,
  indexHref,
  counterpart,
  entries,
  series,
  editionHref,
  code,
}: Props) {
  const { name, season, tier, level, gender, country, start, end } = tournament;
  const bands = useMemo(
    () => (state.status === 'ready' ? bandsOf(state.data.teams) : []),
    [state],
  );

  const badge = TIER_BADGE[tier] ?? level;
  const where = countryName(country);
  const when = formatDateRange(start, end);

  return (
    <main className="tournament-page">
      {/* Three steps, because a tournament page has three ancestors and a
          reader arriving cold on a search result had only the first: the site,
          the season and draw this event sits in, and the event. Before this
          the one link out was the graph, which is the least related of the
          three. */}
      <nav aria-label="Breadcrumb">
        <a href={homeHref}>Beach Volleyball Partnership Graph</a>
        <span aria-hidden="true"> / </span>
        <a href={indexHref}>
          {season} {DRAW_LABEL[gender ?? 'M']}
        </a>
      </nav>

      <header>
        {/* "Beijing 2008" is the event's whole name, so the season must not
            be printed beside it a second time. */}
        <h1>
          {name}
          {!nameCarriesSeason(name, season) && <span className="season"> {season}</span>}
        </h1>
        {counterpart && (
          /* Only when the same event ran both draws, which is 75.5% of the
             archive. The 369 single-draw events get no control rather than a
             dead half of one. */
          <div className="draws" role="group" aria-label="Draw">
            <span className="is-here" aria-current="page">
              {DRAW_LABEL[gender ?? 'M']}
            </span>
            <a href={counterpart.href}>{DRAW_LABEL[counterpart.gender]}</a>
          </div>
        )}
        <p className="facts">
          {where && (
            <span>
              <span aria-hidden="true">{flagEmoji(country)}</span> {where}
            </span>
          )}
          {when && <span>{when}</span>}
          {/* The switch above already names the draw, and more usefully. This
              stays for the 369 single-draw events, which have no switch. */}
          {gender && !counterpart && <span>{GENDER_LABEL[gender]}</span>}
          {badge && <span className="badge">{badge}</span>}
          {/* An unplayed event counts entries, not teams that played. */}
          {entries?.status === 'ready' && entries.data.teams.length > 0 && (
            <span>{plural(entries.data.teams.length, 'team')} entered</span>
          )}
          {!entries && state.status === 'ready' && (
            <span>{plural(state.data.teams.length, 'team')}</span>
          )}
        </p>
      </header>

      {entries && (
        <EntryList entries={entries} iso2Of={iso2Of} onSelectPlayer={onSelectPlayer} />
      )}

      {!entries && state.status === 'loading' && (
        <p className="note">Loading the classification…</p>
      )}
      {!entries && state.status === 'failed' && (
        <p className="note">Could not load this tournament&rsquo;s classification.</p>
      )}
      {!entries && state.status === 'ready' && state.data.teams.length === 0 && (
        <p className="note">FIVB publishes no placements for this tournament.</p>
      )}

      {!entries && state.status === 'ready' && bands.length > 0 && (
        <section aria-label="Final classification">
          <h2>Final classification</h2>
          <ol className="bands">
            {bands.map(([rank, teams]) => {
              const finish = formatFinish(rank);
              const medal = medalFor(rank);
              return (
                <li key={rank} className={medal ? 'band podium' : 'band'}>
                  <p className="place">
                    {medal && (
                      <span className="medal" aria-hidden="true">
                        {medal}
                      </span>
                    )}
                    <span aria-hidden="true">{rank > 0 ? ordinal(rank) : finish.text}</span>
                    <span className="sr-only">{finish.label}</span>
                  </p>
                  <ul className="teams">
                    {teams.map(([, a, b, federation]) => {
                      const iso2 = iso2Of(federation);
                      return (
                        <li key={`${a}-${b}`} className="team">
                          <span className="fed">
                            <span aria-hidden="true">{flagEmoji(iso2, federation)}</span>{' '}
                            {federation}
                          </span>
                          <span className="pair">
                            {[a, b].map((id, at) => {
                              const player = state.data.players[id] ?? `Player ${id}`;
                              // Null for a player with no page: their slice
                              // held too few players to publish one. Plain
                              // text rather than a link to an empty country.
                              const to = fieldPlayerSlice(state.data, id, federation);
                              return (
                                <span key={id}>
                                  {at === 1 && <span className="sep"> / </span>}
                                  {to ? (
                                    <button type="button" onClick={() => onSelectPlayer(id, to)}>
                                      {player}
                                    </button>
                                  ) : (
                                    <span className="unlinked">{player}</span>
                                  )}
                                </span>
                              );
                            })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {series.map((s) => (
        <section key={s.slug} className="editions" aria-label={`${s.name}: every edition`}>
          <h2>{s.name}, year by year</h2>
          <p className="blurb">{s.blurb}</p>
          <ol className="years">
            {s.editions.map((edition) => {
              // The edition being read is marked rather than linked: a link to
              // the page you are on is a dead control, and the row is what
              // gives the rest of the list its point of reference.
              const here = edition.code === code;
              return (
                <li key={edition.code} className={here ? 'edition is-here' : 'edition'}>
                  <p className="which">
                    {here ? (
                      <span className="year" aria-current="page">
                        {edition.season}
                      </span>
                    ) : (
                      <a className="year" href={editionHref(edition.slug)}>
                        {edition.season}
                      </a>
                    )}
                    <span className="draw">{GENDER_LABEL[edition.gender]}</span>
                  </p>
                  <ol className="top">
                    {edition.top.map(([rank, pair, federation], at) => (
                      <li key={`${rank}-${pair}-${at}`}>
                        <span className="rank" aria-hidden="true">
                          {medalFor(rank) ?? ordinal(rank)}
                        </span>
                        <span className="sr-only">{formatFinish(rank).label}</span>
                        <span className="who">{pair}</span>
                        <span className="fed">
                          <span aria-hidden="true">{flagEmoji(iso2Of(federation), federation)}</span>{' '}
                          {federation}
                        </span>
                      </li>
                    ))}
                    {edition.top.length === 0 && (
                      <li className="none">FIVB publishes no placements for this edition.</li>
                    )}
                  </ol>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </main>
  );
}
