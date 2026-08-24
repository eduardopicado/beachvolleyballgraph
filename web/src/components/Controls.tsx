/**
 * The filter row: one left-aligned row above everything it scopes. Country and
 * gender re-render the graph, the stats and the table against the same slice,
 * so the numbers on screen always agree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gender, Manifest, SearchIndex } from '../schema';
import { GENDER_LABEL, GENDERS, parseSliceKey } from '../schema';
import { fetchSearchIndex } from '../lib/api';
import { flagEmoji, plural } from '../lib/format';
import {
  indexPlayers,
  searchPlayers,
  type MatchGroup,
  type SearchablePlayer,
  type SearchMatch,
  type Slice,
} from '../lib/search';
import { Avatar } from './Avatar';
import './Controls.css';

/**
 * A help affordance that works on both input modes: `title` still gives
 * desktop mouse users the free native hover tooltip, but a `title` attribute
 * alone is invisible on touch — there is no hover state to trigger it. So the
 * trigger is a real button that also opens a rendered bubble on tap/click,
 * closed by an outside tap, Escape, or blur.
 */
function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="help-tip" ref={rootRef}>
      <button
        type="button"
        className="help-tip-trigger"
        title={text}
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <span className="help-tip-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Where a search match lives.
 *
 * Rendered only on the rows under Elsewhere, so it no longer needs to decide
 * whether to emphasise itself: every row that has one is a row whose selection
 * leaves this country, which is the only thing on the line with a consequence.
 */
function Where({ slice, countries }: { slice: Slice; countries: Manifest['countries'] }) {
  const entry = countries.find((c) => c.code === slice.country);
  const flag = flagEmoji(entry?.iso2, slice.country);
  return (
    <span className="where">
      {flag && <span aria-hidden="true">{flag} </span>}
      {entry?.name ?? slice.country} {GENDER_LABEL[slice.gender]}
    </span>
  );
}

/**
 * Jump-to-player search. Deliberately not a filter on the table below it —
 * that pairing (type up top, watch a list scroll far down the page) was the
 * actual complaint. This is a self-contained combobox instead: matches render
 * in a dropdown right under the input, and picking one (click, or arrow keys
 * + Enter) opens that player's profile and pans the graph to them, same as
 * clicking their node or their row in the table directly.
 *
 * It searches every country, not just the one on screen. A reader usually
 * knows the name and not the federation — and for a player who transferred,
 * the federation they knew is no longer the right answer. Matches from
 * elsewhere carry their flag and switch country when picked.
 *
 * The index behind that is 370 KB and is fetched on the first interaction
 * with the input rather than with the page. Until it lands, the current
 * slice — already in memory — is searched on its own, so the box works
 * immediately and simply reaches further a moment later.
 */
function PlayerSearch({
  players,
  countries,
  country,
  gender,
  onSelectPlayer,
}: {
  /** The slice on screen. Named by `country`/`gender` rather than carrying it. */
  players: readonly { id: number; name: string; tournaments: number }[];
  countries: Manifest['countries'];
  country: string;
  gender: Gender;
  onSelectPlayer: (player: SearchablePlayer) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [wantIndex, setWantIndex] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Failure is silent on purpose: the slice-local search below still works,
  // so the box degrades to what it did before this file existed rather than
  // reporting an error for something the reader did not ask for.
  useEffect(() => {
    if (!wantIndex) return;
    let cancelled = false;
    fetchSearchIndex()
      .then((data) => !cancelled && setIndex(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wantIndex]);

  const onScreen = useMemo(() => new Set(players.map((p) => p.id)), [players]);

  /**
   * Everyone in the slice on screen, then everyone else. Players already on
   * screen are skipped in the second pass — they would otherwise appear twice,
   * once with a flag and once without, and the flagged copy would be a lie
   * about needing to navigate anywhere.
   */
  const searchable = useMemo(() => {
    // The slice on screen is named too, so every row carries a country.
    const all: SearchablePlayer[] = players.map((p) => ({ ...p, slice: { country, gender } }));
    for (const [key, entries] of Object.entries(index?.slices ?? {})) {
      const slice = parseSliceKey(key);
      if (!slice) continue;
      for (const [id, name, tournaments] of entries) {
        if (onScreen.has(id)) continue;
        all.push({ id, name, tournaments, slice });
      }
    }
    return indexPlayers(all);
  }, [players, index, onScreen, country, gender]);

  const home = useMemo<Slice>(() => ({ country, gender }), [country, gender]);
  const { matches, hidden } = useMemo(
    () => searchPlayers(searchable, query, home),
    [searchable, query, home],
  );

  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const label = (slice: Slice) => `${countryName(slice.country)} ${GENDER_LABEL[slice.gender]}`;

  /**
   * The matches cut into contiguous runs by how near they are.
   *
   * Safe to build by walking the list because proximity is the outermost sort
   * key — each group appears exactly once, so a run break *is* a group break.
   */
  const groups = useMemo(() => {
    const out: { group: MatchGroup; rows: { match: SearchMatch; index: number }[] }[] = [];
    matches.forEach((match, index) => {
      const last = out[out.length - 1];
      if (last?.group === match.group) last.rows.push({ match, index });
      else out.push({ group: match.group, rows: [{ match, index }] });
    });
    return out;
  }, [matches]);

  // Only when a boundary is actually crossed. On a query whose matches are all
  // from this page — which is how the box already behaved and how a reader
  // expects it to — a lone heading over one undivided list is noise.
  const noneHere = groups.length > 0 && groups[0]!.group !== 'home';
  const showGroups = groups.length > 1 || noneHere;

  // A new query invalidates whatever was highlighted; default to the top hit.
  useEffect(() => {
    setActiveIndex(matches.length > 0 ? 0 : -1);
  }, [matches]);

  // Keep the highlighted option in view as arrow keys move it. Currently a
  // no-op in practice — the default result limit and the dropdown's max-height
  // happen to agree, so every option is always on screen at once — but that is
  // a coincidence of two unrelated constants, not a guarantee; raise the limit,
  // shrink the dropdown, or add a second line per row and this starts mattering
  // with no other code change. `block: 'nearest'` only moves the list, never
  // the page, and is a no-op when the option is already visible.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`player-search-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const select = (player: SearchablePlayer) => {
    onSelectPlayer(player);
    // Clears rather than keeps the match text: this is "jump to", a completed
    // action, not an ongoing filter the reader would want to keep visible.
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
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
        select(match);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showResults = open && matches.length > 0;
  const showEmpty = open && !showResults && query.trim().length > 0;

  return (
    <div className="player-search field grow" ref={rootRef}>
      <span id="player-search-label">Find a player</span>
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-labelledby="player-search-label"
        aria-expanded={showResults}
        aria-controls="player-search-listbox"
        aria-activedescendant={activeIndex >= 0 ? `player-search-option-${activeIndex}` : undefined}
        value={query}
        placeholder="Start typing a name…"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setWantIndex(true);
          if (query.trim()) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showResults && (
        <ul className="player-search-results" role="listbox" id="player-search-listbox">
          {/* Says the quiet part. Without it the box looks identical whether
              the country selector matched everything or nothing, and half of
              realistic queries fill six or more of the eight rows from other
              slices. Hidden from assistive tech because the first group's
              label already carries it — a screen reader hears "Elsewhere,
              group" and knows exactly the same thing. */}
          {noneHere && (
            <li className="split is-note" role="presentation" aria-hidden="true">
              {`No ${countryName(country)} ${GENDER_LABEL[gender].toLowerCase()} match “${query.trim()}”`}
            </li>
          )}

          {groups.map((g) => {
            const rows = g.rows.map(({ match: m, index: i }) => (
              // Not a <button>: in the combobox pattern real focus stays in the
              // input and `aria-activedescendant` points at the active option, so
              // a focusable control per row would put 8 extra stops in the tab
              // order between the search box and the next control. `option` also
              // takes presentational children, so a nested button's semantics are
              // stripped from the accessibility tree anyway — it would be
              // tabbable but announce as nothing. Pointer users still click the
              // row; keyboard users arrow and press Enter.
              <li
                key={m.id}
                role="option"
                className={i === activeIndex ? 'result is-active' : 'result'}
                id={`player-search-option-${i}`}
                aria-selected={i === activeIndex}
                onPointerEnter={() => setActiveIndex(i)}
                // Selection happens on pointerdown rather than click so it beats
                // the outside-pointerdown handler that closes the dropdown.
                onPointerDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  select(m);
                }}
              >
                {/* Name on its own line, everything else under it. These names
                    run long — "Barbara De Sousa Alves Ferreira" — and sharing a
                    line with a country label ellipsised most of them down to
                    "Barbar…", which is not a search result. */}
                {/* Decorative, and deliberately not a reason to make the row
                    taller: the name and its meta line already stand two rows
                    high, so a 32px circle sits in space the row had anyway. */}
                <Avatar id={m.id} name={m.name} width={64} className="avatar" />
                <span className="who">
                  <span className="name">{m.name}</span>
                  <span className="meta">
                    {/* Only under Elsewhere, because that is the only heading
                        that cannot name a country — every row under it is from
                        a different one. The other two groups say it once, at
                        the top, instead of repeating it down seven rows.

                        This looks like the behaviour that was rejected — a
                        country on the far rows and nothing on the near ones —
                        but the objection was that a list where some rows named
                        a country and some were blank read as missing data. A
                        heading answers that for every row beneath it, so
                        nothing is left for the reader to infer. */}
                    {m.group === 'elsewhere' && (
                      <Where slice={m.slice} countries={countries} />
                    )}
                    {/* The separator travels with the count rather than sitting
                        between the two as its own item. A long country name
                        wraps this line, and on its own the dot was left
                        stranded at the end of the first one. */}
                    <span className="tally">
                      {m.group === 'elsewhere' && <span aria-hidden="true">· </span>}
                      {plural(m.tournaments, 'tournament')}
                    </span>
                  </span>
                </span>
              </li>
            ));

            if (!showGroups) return rows;

            // listbox -> group -> option is the ARIA-sanctioned nesting, and it
            // is what makes the heading free: a labelled group is announced
            // without being an option, so the arrow keys skip it and the option
            // positions a screen reader reads out stay honest. A heading faked
            // with a presentational <li> would have to be excluded from both by
            // hand.
            const name = g.group === 'elsewhere' ? 'Elsewhere' : label(g.rows[0]!.match.slice);
            return (
              <li className="group" key={g.group} role="group" aria-label={name}>
                <span className="split" aria-hidden="true">
                  {name}
                </span>
                <ul role="presentation">{rows}</ul>
              </li>
            );
          })}

          {/* The cut is the search's real filter and was completely silent: the
              median three-letter query matches 79 players and shows 8. */}
          {hidden > 0 && (
            <li className="split is-more" role="presentation">
              {hidden} more not shown
            </li>
          )}
        </ul>
      )}
      {showEmpty && (
        <p className="player-search-empty" role="status">
          {index
            ? `No players match "${query.trim()}".`
            : `No players on this page match "${query.trim()}" — still loading the other countries.`}
        </p>
      )}
    </div>
  );
}

/** Presets for the partnership-strength threshold. */
export const MIN_TOGETHER_OPTIONS = [1, 2, 3, 5, 10] as const;

interface Props {
  manifest: Manifest;
  country: string;
  gender: Gender;
  onCountry: (code: string) => void;
  onGender: (gender: Gender) => void;
  minTogether: number;
  onMinTogether: (value: number) => void;
  /** The slice on screen; the search names its country from the props below. */
  players: readonly { id: number; name: string; tournaments: number }[];
  onSelectPlayer: (player: SearchablePlayer) => void;
}

export function Controls({
  manifest,
  country,
  gender,
  onCountry,
  onGender,
  minTogether,
  onMinTogether,
  players,
  onSelectPlayer,
}: Props) {
  const selected = manifest.countries.find((c) => c.code === country);

  return (
    <div className="controls" role="group" aria-label="Filters">
      <label className="field">
        <span>Country</span>
        <select value={country} onChange={(e) => onCountry(e.target.value)}>
          {manifest.countries.map((c) => {
            const total = GENDERS.reduce((sum, g) => sum + (c.genders[g]?.nodes ?? 0), 0);
            const flag = flagEmoji(c.iso2, c.code);
            return (
              <option key={c.code} value={c.code}>
                {flag ? `${flag} ` : ''}
                {c.name} ({total})
              </option>
            );
          })}
        </select>
      </label>

      <div className="field">
        <span id="gender-label">Gender</span>
        <div className="segmented" role="group" aria-labelledby="gender-label">
          {GENDERS.map((g) => {
            const count = selected?.genders[g]?.nodes ?? 0;
            return (
              <button
                key={g}
                type="button"
                className={g === gender ? 'is-selected' : ''}
                aria-pressed={g === gender}
                disabled={count === 0}
                title={count === 0 ? `No ${GENDER_LABEL[g].toLowerCase()} players for this country` : undefined}
                onClick={() => onGender(g)}
              >
                {GENDER_LABEL[g]}
                <span className="tally">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span id="min-together-label">
          Min. events together
          <HelpTip text="Partnerships below this many shared tournaments are hidden — use it to strip one-off pairings." />
        </span>
        <div className="segmented" role="group" aria-labelledby="min-together-label">
          {MIN_TOGETHER_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={n === minTogether ? 'is-selected' : ''}
              aria-pressed={n === minTogether}
              onClick={() => onMinTogether(n)}
            >
              {n === 1 ? 'All' : `${n}+`}
            </button>
          ))}
        </div>
      </div>

      <PlayerSearch
        players={players}
        countries={manifest.countries}
        country={country}
        gender={gender}
        onSelectPlayer={onSelectPlayer}
      />

      <p className="as-of">
        Data as of{' '}
        <time dateTime={manifest.generatedAt}>
          {new Date(manifest.generatedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </time>
        <span className="sep">·</span>
        {plural(manifest.totals.tournaments, 'tournament')}, {manifest.seasons.from}–{manifest.seasons.to}
      </p>
    </div>
  );
}
