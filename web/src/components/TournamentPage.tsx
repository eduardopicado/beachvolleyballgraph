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
import { fieldPlayerSlice, TIER_BADGE } from '../schema';
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
 * Grouped by federation rather than listed flat: an entry list has no order of
 * merit to impose — nobody has played yet — and "who is coming, from where" is
 * the question it can actually answer. Measured across the four events that
 * have one, 24 to 32 federations each, so the grouping is real structure
 * rather than a heading per row.
 *
 * Names are plain text, not links. A classification links every name because
 * those players have a page in the slice the event belongs to; an entrant may
 * be entering their first FIVB event and have no page at all, and a list where
 * some names are links and some are not reads as broken rather than as honest.
 *
 * Only teams that are actually in the tournament reach here — the ingest drops
 * every entry FIVB marks as not playing. That filter is why no player appears
 * in two pairs: before it, 14 of 265 entries were a player entered two or
 * three times, which looked like provisional pairings and was really the
 * withdrawn and replaced entries showing through.
 */
function EntryList({
  entries,
  iso2Of,
}: {
  entries: Exclude<Props['entries'], null>;
  iso2Of: (federation: string) => string | null;
}) {
  if (entries.status === 'loading') return <p className="note">Loading the entry list…</p>;
  if (entries.status === 'failed')
    return <p className="note">Could not load this tournament&rsquo;s entry list.</p>;

  const { teams, players } = entries.data;
  if (teams.length === 0) {
    // The 2027 World Championships, a year out. Nothing is broken; nobody has
    // entered yet, and saying so beats an empty heading.
    return (
      <section aria-label="Entry list" className="entries">
        <h2>Entry list</h2>
        <p className="note">No teams have entered yet.</p>
      </section>
    );
  }

  const byFederation = new Map<string, EntriesFile['teams']>();
  for (const team of teams) {
    const list = byFederation.get(team[2]) ?? [];
    list.push(team);
    byFederation.set(team[2], list);
  }

  return (
    <section aria-label="Entry list" className="entries">
      <h2>Entry list</h2>
      <p className="blurb">
        Who has entered. FIVB publishes this before the event; the final classification replaces it
        once the tournament has been played.
      </p>
      <ul className="feds">
        {[...byFederation]
          .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
          .map(([federation, list]) => (
            <li key={federation}>
              <p className="fed">
                <span aria-hidden="true">{flagEmoji(iso2Of(federation), federation)}</span>{' '}
                {federation}
                <span className="n">{list.length}</span>
              </p>
              <ul className="pairs">
                {list.map(([a, b]) => (
                  <li key={`${a}-${b}`}>
                    {players[a] ?? `Player ${a}`}
                    <span className="sep"> / </span>
                    {players[b] ?? `Player ${b}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
      </ul>
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

      {entries && <EntryList entries={entries} iso2Of={iso2Of} />}

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
