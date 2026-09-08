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
 * The edition list — every other Gstaad, with its top four — is the other half
 * of this page and is not here yet. It needs series membership, which is
 * hand-maintained for Gstaad and the Rio Open because the codes lie
 * (`MRIO2005` is Salvador), and a precomputed top four per edition so the page
 * does not fetch fifty classification files to draw its own history.
 */

import { useMemo } from 'react';
import type { ClassificationFile, Gender, Tier } from '../schema';
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
  /** Back to the graph. A page reached cold has nothing else to offer. */
  homeHref: string;
}

const GENDER_LABEL: Record<Gender, string> = { M: "Men's", W: "Women's" };

export function TournamentPage({ tournament, state, iso2Of, onSelectPlayer, homeHref }: Props) {
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
      <nav aria-label="Breadcrumb">
        <a href={homeHref}>Beach Volleyball Partnership Graph</a>
      </nav>

      <header>
        {/* "Beijing 2008" is the event's whole name, so the season must not
            be printed beside it a second time. */}
        <h1>
          {name}
          {!nameCarriesSeason(name, season) && <span className="season"> {season}</span>}
        </h1>
        <p className="facts">
          {where && (
            <span>
              <span aria-hidden="true">{flagEmoji(country)}</span> {where}
            </span>
          )}
          {when && <span>{when}</span>}
          {gender && <span>{GENDER_LABEL[gender]}</span>}
          {badge && <span className="badge">{badge}</span>}
          {state.status === 'ready' && <span>{plural(state.data.teams.length, 'team')}</span>}
        </p>
      </header>

      {state.status === 'loading' && <p className="note">Loading the classification…</p>}
      {state.status === 'failed' && (
        <p className="note">Could not load this tournament&rsquo;s classification.</p>
      )}
      {state.status === 'ready' && state.data.teams.length === 0 && (
        <p className="note">FIVB publishes no placements for this tournament.</p>
      )}

      {state.status === 'ready' && bands.length > 0 && (
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
    </main>
  );
}
