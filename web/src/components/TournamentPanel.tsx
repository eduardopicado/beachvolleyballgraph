/**
 * One tournament's final classification, over the player card that opened it.
 *
 * The card already answers "how did *this* player do here". The question it
 * could never answer is "who else was there, and who won" — which used to mean
 * leaving the site for a results database, and leaving it in two directions
 * depending on whether the reader wanted the event or one of its players.
 *
 * A panel rather than a third level of the timeline, which is already a card
 * inside a scroll: a 105-team field (Gstaad 2002) pushes the rest of the season
 * a long way down, and a panel gets the full height whatever the field's size.
 * The card is exactly as it was when this closes.
 *
 * **Placements are grouped, because a rank is a bracket and not a position**
 * (quirks §5, §15). Eight teams finish 9th at the Olympics; six finish 19th.
 * Listing them as separate rows would invent an order FIVB does not publish,
 * so each placement is one heading with its teams under it.
 *
 * The grouping is left to say that on its own. A footnote spelling it out sat
 * here first and was cut: four teams drawn under one "5th" is not ambiguous,
 * and a line of explanation under every classification is a tax on the reader
 * who understood the first one.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { ClassificationFile, Tier } from '../schema';
import { TIER_BADGE } from '../schema';
import { flagEmoji, formatFinish, medalFor, ordinal, plural } from '../lib/format';
import './TournamentPanel.css';

interface Props {
  /** Everything the card already knows, so the header needs no second fetch. */
  name: string;
  season: number;
  tier: Tier;
  level: string | null;
  when: string | null;
  state:
    | { status: 'loading' }
    | { status: 'ready'; data: ClassificationFile }
    | { status: 'failed' };
  /** Federation code -> ISO-2, for the flags. From the manifest the app holds. */
  iso2Of: (federation: string) => string | null;
  /** The player whose card this is, marked in the field so they can be found. */
  highlightId: number;
  onSelectPlayer: (id: number) => void;
  onClose: () => void;
}

export function TournamentPanel({
  name,
  season,
  tier,
  level,
  when,
  state,
  iso2Of,
  highlightId,
  onSelectPlayer,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const root = rootRef.current;
    closeRef.current?.focus();

    // Capture and stop, so one Escape closes the panel and leaves the card —
    // the card listens for Escape too, and the innermost thing the reader
    // opened is the one that should go.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Only when focus is about to be orphaned; the card moves focus into
      // itself when it changes player, and that must win over this.
      const active = document.activeElement;
      const orphaned = !active || active === document.body || !!root?.contains(active);
      if (orphaned && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [onClose]);

  /** The field, grouped by placement and ordered best first. */
  const bands = useMemo(() => {
    if (state.status !== 'ready') return [];
    const byRank = new Map<number, ClassificationFile['teams']>();
    for (const team of state.data.teams) {
      let group = byRank.get(team[0]);
      if (!group) byRank.set(team[0], (group = []));
      group.push(team);
    }
    return [...byRank.entries()].sort(
      // Placements ascending, then everything eliminated before the main draw,
      // which is what a negative rank means.
      ([x], [y]) => Number(x < 0) - Number(y < 0) || x - y,
    );
  }, [state]);

  const badge = TIER_BADGE[tier] ?? level;

  return (
    <div className="tournament-panel" role="dialog" aria-modal="true" aria-label={`${name} ${season}: final classification`} ref={rootRef}>
      <header>
        <div className="who">
          <h3>
            {name} <span className="season">{season}</span>
          </h3>
          <p className="meta">
            {when && <span>{when}</span>}
            {badge && <span className="badge">{badge}</span>}
            {state.status === 'ready' && <span>{plural(state.data.teams.length, 'team')}</span>}
          </p>
        </div>
        <button ref={closeRef} type="button" className="close" onClick={onClose} aria-label="Close classification">
          ×
        </button>
      </header>

      {state.status === 'loading' && <p className="note">Loading the classification…</p>}
      {state.status === 'failed' && <p className="note">Could not load this tournament&rsquo;s classification.</p>}
      {state.status === 'ready' && state.data.teams.length === 0 && (
        <p className="note">FIVB publishes no placements for this tournament.</p>
      )}

      {state.status === 'ready' && bands.length > 0 && (
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
                    const mine = a === highlightId || b === highlightId;
                    return (
                      <li key={`${a}-${b}`} className={mine ? 'team is-mine' : 'team'}>
                        <span className="fed">
                          <span aria-hidden="true">{flagEmoji(iso2, federation)}</span> {federation}
                        </span>
                        <span className="pair">
                          {[a, b].map((id, at) => (
                            <span key={id}>
                              {at === 1 && <span className="sep"> / </span>}
                              {id === highlightId ? (
                                <strong>{state.data.players[id] ?? `Player ${id}`}</strong>
                              ) : (
                                <button type="button" onClick={() => onSelectPlayer(id)}>
                                  {state.data.players[id] ?? `Player ${id}`}
                                </button>
                              )}
                            </span>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

    </div>
  );
}
