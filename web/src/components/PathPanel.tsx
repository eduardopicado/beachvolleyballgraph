/**
 * How two players in this slice are connected.
 *
 * Takes the card's slot rather than sitting beside it, so the chain and the
 * lit-up graph are one eyeful — a reader never picks a second player while the
 * picture is off-screen.
 *
 * Starts from the player whose card was open, and asks for one more. A pair of
 * pickers was drawn first and dropped: the way anyone arrives here is from
 * someone's profile, wondering how they reach someone else, so the first half
 * of the question is already answered.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../schema';
import { plural } from '../lib/format';
import { indexPlayers, searchPlayers, type SearchablePlayer } from '../lib/search';
import { findPath, type PartnershipIndex } from '../lib/path';
import { Avatar } from './Avatar';
import './PathPanel.css';

interface Props {
  index: PartnershipIndex;
  /** Everyone the graph is currently showing — the pool both ends come from. */
  nodes: readonly GraphNode[];
  from: GraphNode;
  toId: number | null;
  onPick: (id: number | null) => void;
  onSelectPlayer: (id: number) => void;
  onClose: () => void;
  country: string;
  gender: 'M' | 'W';
}

const MAX_SUGGESTIONS = 8;

export function PathPanel({
  index,
  nodes,
  from,
  toId,
  onPick,
  onSelectPlayer,
  onClose,
  country,
  gender,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLLIElement>(null);

  // Only this slice: a path can only run through partnerships the graph holds,
  // so offering anyone else would be offering an answer that cannot exist.
  const searchable = useMemo(
    () =>
      indexPlayers(
        nodes
          .filter((n) => n.id !== from.id)
          .map((n) => ({ id: n.id, name: n.name, short: n.short, tournaments: n.tournaments, slice: { country, gender } })),
      ),
    [nodes, from.id, country, gender],
  );

  const home = useMemo(() => ({ country, gender }), [country, gender]);
  const matches = useMemo(
    () => searchPlayers(searchable, query, home, MAX_SUGGESTIONS).matches,
    [searchable, query, home],
  );

  useEffect(() => setActiveIndex(matches.length > 0 ? 0 : -1), [matches]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const to = toId === null ? null : (index.nodes.get(toId) ?? null);
  const result = useMemo(() => (to ? findPath(index, from.id, to.id) : null), [index, from.id, to]);

  const choose = (player: SearchablePlayer) => {
    onPick(player.id);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (matches.length > 0) setActiveIndex((i) => (i + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (matches.length > 0) setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      const match = matches[activeIndex];
      if (match) {
        event.preventDefault();
        choose(match);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showResults = open && matches.length > 0;

  return (
    <section className="path-panel" aria-label={`Partnership path from ${from.name}`}>
      <header>
        <h2>Partnership path</h2>
        <button type="button" className="close" onClick={onClose} aria-label="Close path">
          ×
        </button>
      </header>

      <ol className="ends">
        <li>
          <span className="lab">From</span>
          <span className="nm">{from.name}</span>
        </li>
        <li className="picker" ref={rootRef}>
          <span className="lab" id="path-to-label">
            To
          </span>
          {to ? (
            <span className="chosen">
              <span className="nm">{to.name}</span>
              <button type="button" onClick={() => onPick(null)} aria-label="Choose someone else">
                change
              </button>
            </span>
          ) : (
            <>
              <input
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-labelledby="path-to-label"
                aria-expanded={showResults}
                aria-controls="path-listbox"
                aria-activedescendant={activeIndex >= 0 ? `path-option-${activeIndex}` : undefined}
                value={query}
                placeholder="Start typing a name…"
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => query.trim() && setOpen(true)}
                onKeyDown={onKeyDown}
              />
              {showResults && (
                <ul className="suggestions" role="listbox" id="path-listbox">
                  {matches.map((m, i) => (
                    <li
                      key={m.id}
                      role="option"
                      id={`path-option-${i}`}
                      className={i === activeIndex ? 'is-active' : ''}
                      aria-selected={i === activeIndex}
                      onPointerEnter={() => setActiveIndex(i)}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        choose(m);
                      }}
                    >
                      <span className="name">{m.name}</span>
                      <span className="tally">{m.tournaments}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </li>
      </ol>

      {result?.kind === 'path' && result.links.length > 1 && (
        <div className="answer">
          <p className="verdict">
            <strong>
              {result.links.length === 2
                ? 'They played together'
                : `${result.links.length - 1} steps apart`}
            </strong>
            {result.links.length > 2 && (
              <span className="sub">{plural(result.links.length - 2, 'player')} in between</span>
            )}
          </p>

          <ol className="chain">
            {result.links.map((link, i) => (
              <li key={link.node.id} className={i === 0 || i === result.links.length - 1 ? 'end' : ''}>
                {i > 0 && (
                  <span className="link">
                    <b>{link.t}</b> together · {link.f === link.l ? link.f : `${link.f}–${link.l}`}
                  </span>
                )}
                <button type="button" onClick={() => onSelectPlayer(link.node.id)}>
                  <Avatar id={link.node.id} name={link.node.name} width={64} className="avatar" />
                  <span className="who">
                    <span className="nm">{link.node.name}</span>
                    <span className="meta">{plural(link.node.tournaments, 'tournament')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {/* A chain is only as strong as its thinnest partnership, and that is
              invisible unless it is said: a route through a pair who played once
              together is a much weaker claim than one through a career. */}
          <p className="foot">
            Shortest route, and the strongest of those. Weakest link:{' '}
            {plural(result.weakest, 'tournament')} together.
          </p>
        </div>
      )}

      {result?.kind === 'unconnected' && (
        <div className="answer">
          <p className="verdict">
            <strong>No chain connects them</strong>
          </p>
          {/* Not an error and not rare — most pairs in the archive have no
              route at all. Naming each island turns a dead end into a fact
              about the player. */}
          <div className="islands">
            <p>
              <span className="nm">{from.name}</span> can reach{' '}
              <b>{plural(result.fromReach - 1, 'other player')}</b> through partnerships.
            </p>
            <p>
              <span className="nm">{to!.name}</span> can reach{' '}
              <b>{plural(result.toReach - 1, 'other player')}</b>.
            </p>
          </div>
          <p className="foot">
            They are in separate parts of this graph. Lowering “min. events together” may join
            them.
          </p>
        </div>
      )}

      {!to && (
        <p className="hint">
          Pick a second player to see the chain of partners linking them to {from.short}.
        </p>
      )}
    </section>
  );
}
