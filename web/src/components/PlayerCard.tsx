/**
 * Detail panel for the selected player.
 *
 * Photos come straight from FIVB's image service and 404 for players with none
 * on file, so the <img> is allowed to fail and an initials avatar takes over.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AwayPartner, Gender, GraphNode, PlayerDetail, SeasonTally, Tier } from '../schema';
import { playerProfileUrl, TIER_BADGE, TOUR_TIERS, type TimelineFilter } from '../schema';
import { foldAccents } from '../lib/search';
import {
  age,
  formatDate,
  formatDayMonth,
  formatFinish,
  formatMedals,
  medalAriaLabel,
  medalFor,
  plural,
  seasonSpan,
} from '../lib/format';
import { Avatar } from './Avatar';
import { PortraitLightbox } from './PortraitLightbox';
import { TournamentPanel } from './TournamentPanel';
import { buildTimeline, type TimelineSeason } from '../lib/timeline';
import { seasonEvents, type SeasonEvent } from '../lib/results';
import { prefersReducedMotion } from '../lib/motion';
import { useResults } from '../lib/useResults';
import { useClassification } from '../lib/useClassification';
import './PlayerCard.css';

export interface PartnerRow {
  node: GraphNode;
  /** Tournaments played together. */
  t: number;
  f: number;
  l: number;
  /** Per-season breakdown, ascending. Absent on data published before it existed. */
  s?: SeasonTally[];
  /** Best finish together. Absent when the pair never reached a main draw. */
  r?: number;
}


/**
 * One season-by-season list: a year, the partners in it, and the tournaments
 * behind the year once it is opened.
 *
 * Extracted because the card now renders two of them — the player's own
 * partnerships, and the ones with players from other federations, which the
 * graph cannot hold. Those two blocks are supposed to behave identically, and
 * the only way to guarantee that is for them to be the same component rather
 * than two copies that drift.
 */
interface SeasonListProps {
  rows: TimelineSeason[];
  /** Which seasons are expanded. Each list owns its own set. */
  open: ReadonlySet<number>;
  onToggle: (season: number) => void;
  /** Prefix for the panel ids, so two lists on one card cannot collide. */
  idPrefix: string;
  eventsFor: (season: number) => SeasonEvent[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
  onSelectPartner: (id: number) => void;
  /**
   * Opens a tournament's full field. Takes the season from the row rather than
   * from the event's own date: the date is null on malformed rows, and on a
   * ranged season (§19) the two can legitimately differ — the row's season is
   * the one the timeline is showing.
   */
  onOpenEvent: (event: SeasonEvent, season: number) => void;
  /**
   * Extra class on the <ol>. The card renders two of these now, and without
   * something to tell them apart `.timeline` matches both — which is not a
   * styling problem but a correctness one for anything selecting on it.
   */
  variant?: string;
}

function SeasonList({
  rows,
  open: open_,
  onToggle,
  idPrefix,
  eventsFor,
  status,
  onSelectPartner,
  onOpenEvent,
  variant,
}: SeasonListProps) {
  return (
          <ol className={variant ? `timeline ${variant}` : 'timeline'}>
            {rows.map((row) => {
              const open = open_.has(row.season);
              // The season's real calendar, not the graph's view of it: the
              // partner rows above are subject to the "min events together"
              // filter, and once a year is open the honest answer to "what
              // happened in it" is every tournament that did.
              const events = open ? eventsFor(row.season) : [];
              const panelId = `${idPrefix}-${row.season}`;
              return (
                <li key={row.season}>
                  {/* The year sits in a gutter beside its partners rather than
                      on a line of its own: one year with two names against it
                      is the shape worth seeing, and it keeps a 20-season career
                      readable without turning into a wall of headings. */}
                  <button
                    type="button"
                    className="season"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => onToggle(row.season)}
                  >
                    <span className="year-row">
                      {/* The only thing on this row that says it opens. The
                          underline it used to rely on appears on hover, and
                          touch has no hover — so on a phone or tablet the year
                          read as a plain label and the tournaments behind it
                          went unfound. */}
                      <span className="caret" aria-hidden="true" />
                      <span className="year">{row.season}</span>
                    </span>
                    {/* Open, this counts the events listed below; closed, the
                        tournaments behind the partner rows — and then only when
                        it says something those rows don't, since with a single
                        partner it is just their tally again. */}
                    {open ? (
                      <span className="total" aria-label={plural(events.length, 'tournament')}>
                        {events.length}
                      </span>
                    ) : (
                      row.partners.length > 1 && (
                        <span className="total" aria-label={plural(row.total, 'tournament', 'tournaments')}>
                          {row.total}
                        </span>
                      )
                    )}
                  </button>

                  <div id={panelId}>
                    {!open ? (
                      <ul>
                        {row.partners.map((p) => (
                          <li key={p.node.id}>
                            <button type="button" onClick={() => onSelectPartner(p.node.id)}>
                              <span className="name">{p.node.name}</span>
                              <span className="tally">{p.t}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : status === 'failed' ? (
                      <p className="events-note">Could not load this season's tournaments.</p>
                    ) : events.length === 0 ? (
                      <p className="events-note">
                        {status === 'ready' ? 'No tournament detail for this season.' : 'Loading…'}
                      </p>
                    ) : (
                      <ol className="events">
                        {events.map((event) => {
                          const finish = formatFinish(event.rank);
                          const medal = medalFor(event.rank);
                          const when = formatDayMonth(event.date);
                          // Tier first, then level. The Olympics, the World
                          // Championships and the age-group championships are
                          // badged by tier and have no level below it; every
                          // other event is a week on tour and its level is the
                          // thing worth saying — "4-star", "Elite16", "Grand
                          // Slam". Before this, a tour row carried no badge at
                          // all, so a 2005 Grand Slam and a 2019 1-star read
                          // identically. See LEVEL_BY_TYPE in ingest/tiers.ts
                          // for why these are era-native labels rather than a
                          // scale.
                          const badge = TIER_BADGE[event.tier] ?? event.level;
                          return (
                            <li key={`${event.no}-${event.partnerId}`}>
                              <p className="event">
                                {/* The name opens the field that played this
                                    event. A row without a published code —
                                    only the oldest, whose tuple is too short
                                    to carry one — stays plain text rather than
                                    offering a button that cannot answer. */}
                                {event.code ? (
                                  <button
                                    type="button"
                                    className="name is-open"
                                    onClick={() => onOpenEvent(event, row.season)}
                                  >
                                    {event.name}
                                  </button>
                                ) : (
                                  <span className="name">{event.name}</span>
                                )}
                                <span className={`finish${medal ? ' podium' : ''}`}>
                                  {/* Hidden from assistive tech, like the
                                      ordinal beside it: `finish.label` already
                                      says "Won the tournament", which is the
                                      medal in words. */}
                                  {medal && (
                                    <span className="medal" aria-hidden="true">
                                      {medal}
                                    </span>
                                  )}
                                  <span aria-hidden="true">{finish.text}</span>
                                  <span className="sr-only">{finish.label}</span>
                                </span>
                              </p>
                              <p className="event-meta">
                                {when && <span>{when}</span>}
                                {badge && <span className="badge">{badge}</span>}
                                {event.partner && <span className="with">{event.partner}</span>}
                              </p>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
  );
}

/**
 * The pair's best finish together, as a chip beside their tournament count.
 *
 * One component for both the in-slice list and the away list below it, so the
 * two cannot drift into describing the same number differently.
 *
 * Renders nothing at all when there is no best finish rather than a dash or a
 * zero: 2% of partnerships never reached a main draw together, and every way
 * of drawing that absence as a value reads as a bad result instead of no
 * result. The tournament count beside it already says they competed.
 *
 * The visible text is the bare placement, because the row is four chips wide
 * on a 320px card and "best 5th" does not fit. What that placement *means* is
 * carried in the tooltip and the screen-reader label, including FIVB's
 * bracketing — 5th is a bracket shared with other teams, not a position
 * (docs/fivb-data-quirks.md §15).
 */
function BestFinish({ rank }: { rank: number | undefined }) {
  if (rank === undefined) return null;
  const { text, label } = formatFinish(rank);
  return (
    <span
      className={`best${rank <= 3 ? ' is-podium' : ''}`}
      title={`Best finish together: ${label.toLowerCase()}`}
    >
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">Best finish together: {label}</span>
    </span>
  );
}

/** An away partner, resolved against the manifest so it can be rendered. */
export interface AwayRow {
  partner: AwayPartner;
  /** Where they compete *now* — where selecting this row navigates to. */
  countryName: string;
  flag: string;
  /**
   * What the pair actually represented, season by season, oldest first.
   *
   * Distinct from the two fields above, and that distinction is the whole
   * point: a federation is a snapshot of today, so describing a 2005
   * partnership with it says something false. Pedro Solberg and Tiago De J
   * Santos played one event together as Brazilians and this block called it
   * Qatar, because Tiago moved there eight years later.
   */
  then: { season: number; fed: string; countryName: string; flag: string }[];
  /** False when that slice was too small to publish — nothing to link to. */
  linkable: boolean;
}

/**
 * The federations a pair represented, collapsed for display: consecutive
 * seasons under one flag read as one span rather than as a list of years.
 */
function representedAs(
  then: AwayRow['then'],
): { fed: string; countryName: string; flag: string; from: number; to: number }[] {
  const out: { fed: string; countryName: string; flag: string; from: number; to: number }[] = [];
  for (const entry of then) {
    const last = out[out.length - 1];
    if (last && last.fed === entry.fed) last.to = entry.season;
    else out.push({ ...entry, from: entry.season, to: entry.season });
  }
  return out;
}

interface Props {
  node: GraphNode;
  detail: PlayerDetail | undefined;
  partners: PartnerRow[];
  away: AwayRow[];
  /**
   * The slice the card is showing, taken from the loaded graph rather than the
   * app's selection: following an away partner sets the new country a render
   * before the new graph lands, and the results fetch has to follow the data,
   * not the intent.
   */
  country: string;
  gender: Gender;
  countryName: string;
  flag: string;
  /** Federation code -> ISO-2, for flags on federations other than this one. */
  iso2Of: (federation: string) => string | null;
  /**
   * Every player in the slice, unfiltered — the "min events together" control
   * hides edges, and an expanded season still has to be able to name the
   * partner of an event whose edge is currently hidden.
   */
  names: ReadonlyMap<number, string>;
  onSelectPartner: (id: number) => void;
  onSelectAway: (partner: AwayPartner) => void;
  /** Opens the partnership path panel with this player as the near end. */
  onFindPath: () => void;
  onClose: () => void;
}

/**
 * `focus`/`blur` reach both HTML and SVG elements through the `HTMLOrSVGElement`
 * mixin, but `Element` — the type of `document.activeElement` — has no shared
 * base TypeScript models cleanly as that mixin. A duck-typed guard is simpler
 * than a cast through `unknown`.
 */
function isFocusable(el: Element): el is Element & Pick<HTMLOrSVGElement, 'focus'> {
  return typeof (el as Partial<HTMLOrSVGElement>).focus === 'function';
}

/**
 * What each narrowing is called on screen.
 *
 * "Tour podiums" matches the vitals tile of the same name exactly, because the
 * two count the same events — a chip called "Podiums" would promise the
 * Olympic and World Championship podiums as well.
 */
const FILTER_LABEL: Record<TimelineFilter, string> = {
  olympics: 'Olympics',
  'world-champs': 'Worlds',
  'tour-podium': 'Tour podiums',
};

export function PlayerCard({
  node,
  detail,
  partners,
  away,
  country,
  gender,
  countryName,
  flag,
  iso2Of,
  names,
  onSelectPartner,
  onSelectAway,
  onFindPath,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLElement>(null);

  /**
   * The graph's label for this player, when it says something their name does
   * not — "Duda" for Eduarda Santos Lisboa, "Guto" for Gustavo Albrecht
   * Carvalhaes. 203 published players are in that position. Empty for the
   * plain shortenings ("P. Solberg"), which would only repeat the heading.
   */
  const alias = useMemo(() => {
    const short = foldAccents(node.short);
    return short && !foldAccents(node.name).includes(short) ? node.short : '';
  }, [node.name, node.short]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the card whenever it starts showing a *different* player —
  // on first open, and again if the reader clicks through a partner without
  // closing it — so a keyboard or screen-reader user who just picked someone
  // (from the graph, the table, search, or a partner link) lands where the
  // result actually is, instead of on a control that hasn't moved while a new
  // panel appears elsewhere on the page. Escape already closes the card; this
  // is the entry half of that same contract.
  useEffect(() => {
    // Whatever had focus a moment ago — a graph node, a table row, the search
    // input — so closing the card (Escape, or selecting nobody) can hand focus
    // back rather than dropping it to <body>, which is where the browser sends
    // it once the element that held it is removed from the DOM.
    const previouslyFocused = document.activeElement;
    // The card itself, not the close button. Chrome works out Enter's default
    // action *after* the keydown handlers have run — so when a reader presses
    // Enter on a table row, focus has already moved by then, and if it landed
    // on a <button> that same keystroke activates it. The card opened and shut
    // again in 19ms, which made every player unreachable from the keyboard.
    // A container with tabIndex -1 has no default action to trigger, and
    // focusing it announces the panel's own label rather than "Close profile".
    //
    // `preventScroll` because focusing an off-screen element makes the browser
    // jump to it with no transition, and on a phone that is a 1,570px jump the
    // moment a search result is picked — measured, and the reason opening a
    // player read as "what just happened". The scroll is still wanted; it is
    // the instantaneous part that is not, so it is done deliberately below
    // rather than as a side effect of focus.
    cardRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView({
      // `nearest` so a card already on screen -- the desktop case, and clicking
      // a graph node right beside it -- does not move at all.
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    return () => {
      if (
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.body.contains(previouslyFocused) &&
        isFocusable(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [node.id]);

  const years = age(detail?.dob ?? null);
  // Both lists, because both are on the card. Counting only the graph's edges
  // made a player whose partners all competed elsewhere read "0 partners"
  // directly above a list of six of them — the vitals describing the graph
  // while the rest of the card described the player.
  const partnerCount = partners.length + away.length;

  const timeline = useMemo(() => buildTimeline(partners), [partners]);
  /**
   * The same timeline, for partnerships the graph cannot hold.
   *
   * `buildTimeline` wants graph nodes and these players have none — they live
   * in another slice by definition — so each is given the node it would have
   * had. `short` is the full name rather than a competition name because that
   * is what this block shows: the reader is being told who somebody played
   * with abroad, and "Emanuel" is only recognisable once you already know.
   */
  const awayTimeline = useMemo(
    () =>
      buildTimeline(
        away.map(({ partner }) => ({
          node: {
            id: partner.id,
            name: partner.name,
            short: partner.name,
            tournaments: partner.t,
            first: partner.f,
            last: partner.l,
          },
          s: partner.s,
        })),
      ),
    [away],
  );
  const awayIds = useMemo(() => new Set(away.map((a) => a.partner.id)), [away]);

  /**
   * The away timeline's rows carry a synthesised node, so selecting one has to
   * find the real `AwayPartner` again — that is what `onSelectAway` needs to
   * send the app to the right slice. A partner whose slice was too small to
   * publish is skipped rather than navigating to a page that does not exist.
   */
  const onSelectAwayById = useCallback(
    (id: number) => {
      const row = away.find((a) => a.partner.id === id);
      if (row?.linkable) onSelectAway(row.partner);
    },
    [away, onSelectAway],
  );
  const [view, setView] = useState<'partners' | 'timeline'>('partners');
  // Slices published before the per-season field existed have nothing to draw,
  // so the switch hides rather than offering an empty view. Deliberately not
  // reset when the selected player changes: someone reading careers year by
  // year should stay in that mode as they click through partners.
  const canShowTimeline = timeline.length > 0 || awayTimeline.length > 0;
  const showing = canShowTimeline ? view : 'partners';

  /**
   * A narrowing of the timeline: the Games, the World Championships, or the
   * weeks on tour a player finished on the podium.
   *
   * Which chips exist comes from the published `filters`, not from the results
   * file, because that file is only fetched when somebody opens a season — a
   * control that appeared after the first click would not be a control anyone
   * could find. Picking one raises the same flag an expansion does.
   */
  const [filter, setFilter] = useState<TimelineFilter | null>(null);
  const available = detail?.filters ?? [];

  // A different player has different chips, and one of them may not exist here.
  useEffect(() => setFilter(null), [node.id]);

  const matchesFilter = useCallback(
    (event: SeasonEvent) => {
      if (filter === 'olympics') return event.tier === 'olympics';
      if (filter === 'world-champs') return event.tier === 'world-champs';
      // Ranks 1-3 on tour, which is what the Tour podiums tile counts.
      if (filter === 'tour-podium') {
        return TOUR_TIERS.has(event.tier) && event.rank >= 1 && event.rank <= 3;
      }
      return true;
    },
    [filter],
  );

  // --- expanding a season into its tournaments ------------------------------
  const [openSeasons, setOpenSeasons] = useState<ReadonlySet<number>>(new Set());
  // Raised by the first expansion and never lowered, which is what keeps the
  // fetched slice around as the reader clicks from player to player.
  const [wantResults, setWantResults] = useState(false);
  const results = useResults(country, gender, wantResults);

  // The away list expands independently: the two blocks answer different
  // questions, and a 2015 opened in one is not a 2015 opened in the other.
  const [openAwaySeasons, setOpenAwaySeasons] = useState<ReadonlySet<number>>(new Set());

  // --- the portrait, large --------------------------------------------------
  // Reset with the seasons below on every change of node: a partner row is
  // clickable from behind the scrim on nothing, but the card *does* change
  // player underneath an open portrait via the graph and the search box, and
  // leaving it open would show one player's photo captioned with another's
  // name.
  const [portraitOpen, setPortraitOpen] = useState(false);

  // --- a tournament's full field --------------------------------------------
  // The event's whole header is kept, not just its code, so the panel can draw
  // itself before the fetch lands: all of it is already in the timeline row
  // that opened it, and re-reading it from the classification would mean
  // waiting on a request to show a heading we already have.
  const [openEvent, setOpenEvent] = useState<{
    code: string;
    name: string;
    season: number;
    tier: Tier;
    level: string | null;
    when: string | null;
  } | null>(null);
  const classification = useClassification(openEvent?.code ?? null);

  const openEventPanel = useCallback((event: SeasonEvent, season: number) => {
    if (!event.code) return;
    setOpenEvent({
      code: event.code,
      name: event.name,
      season,
      tier: event.tier,
      level: event.level,
      when: formatDayMonth(event.date),
    });
  }, []);

  // A different player's seasons are not this player's, so start them closed —
  // but leave `view` alone, so someone reading careers year by year stays in
  // the timeline as they click through.
  useEffect(() => {
    setOpenSeasons(new Set());
    setOpenAwaySeasons(new Set());
    setPortraitOpen(false);
    setOpenEvent(null);
  }, [node.id]);

  const toggleAwaySeason = useCallback((season: number) => {
    setWantResults(true);
    setOpenAwaySeasons((open) => {
      const next = new Set(open);
      if (!next.delete(season)) next.add(season);
      return next;
    });
  }, []);

  const toggleSeason = useCallback((season: number) => {
    setWantResults(true);
    setOpenSeasons((open) => {
      const next = new Set(open);
      if (!next.delete(season)) next.add(season);
      return next;
    });
  }, []);

  const nameOf = useCallback(
    (id: number) =>
      names.get(id) ??
      (results.status === 'ready' ? (results.data.results.names[id] ?? null) : null),
    [names, results],
  );

  const entries = results.status === 'ready' ? results.data.results.players[node.id] : undefined;

  const eventsForSeason = useCallback(
    (season: number) =>
      seasonEvents(entries, results.status === 'ready' ? results.data.tournaments : {}, season, nameOf),
    [entries, results, nameOf],
  );

  /**
   * The same season, narrowed to the partners this block is about.
   *
   * The results file holds a player's whole career, so an unfiltered season
   * would list their home partnerships under a heading that says "other
   * federations" — the events are real, they are just not what was asked for.
   */
  const awayEventsForSeason = useCallback(
    (season: number) => eventsForSeason(season).filter((event) => awayIds.has(event.partnerId)),
    [eventsForSeason, awayIds],
  );

  /**
   * The timeline, narrowed to the events a chip asks for.
   *
   * Built from the results rather than from the partnership rows above,
   * because those are grouped by partner and a filter is a question about
   * *events*. Every season that survives is rendered open: a filtered list
   * exists to show the events themselves, so making the reader open four
   * seasons to see four Games would be the same list they already had.
   */
  const filteredSeasons = useMemo(() => {
    if (!filter || results.status !== 'ready') return [];
    const seasons = new Set<number>();
    for (const [no] of entries ?? []) {
      const tournament = results.data.tournaments[no];
      if (tournament) seasons.add(tournament[1]);
    }
    return [...seasons]
      .filter((season) => eventsForSeason(season).some(matchesFilter))
      .sort((a, b) => b - a)
      .map((season) => ({ season, partners: [], total: 0 }));
  }, [filter, results, entries, eventsForSeason, matchesFilter]);

  const filteredEventsForSeason = useCallback(
    (season: number) => eventsForSeason(season).filter(matchesFilter),
    [eventsForSeason, matchesFilter],
  );

  const allFilteredOpen = useMemo(
    () => new Set(filteredSeasons.map((r) => r.season)),
    [filteredSeasons],
  );


  return (
    <aside
      ref={cardRef}
      className="player-card"
      // Focusable programmatically, never in the tab order.
      tabIndex={-1}
      aria-label={`Profile: ${node.name}`}
    >
      <header>
        <Avatar
          id={node.id}
          name={node.name}
          width={200}
          className="player-photo"
          // The reader clicked a player to get here, and this is that player's
          // face: there is nothing to defer it behind. Lazily, a card opened
          // below the fold — which is where it lands on a phone, and at some
          // zoom levels on a desktop — never started the request at all.
          eager
          onExpand={() => setPortraitOpen(true)}
        />
        <div className="who">
          <h2>{node.name}</h2>
          {/* The name the graph draws, when it is not simply this one cut
              short. It is how a reader got here — the node said "Duda", the
              search row said "Duda" — and without it the card is the first
              place that stops saying it, which is exactly where they are
              deciding whether they landed on the right person. Same test as
              the search index: shown only when it reaches somewhere the full
              name does not. */}
          {alias && <p className="alias">“{alias}”</p>}
          <p className="country">
            <span aria-hidden="true">{flag}</span> {countryName}
          </p>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Close profile">
          ×
        </button>
      </header>

      <dl className="vitals">
        <div>
          <dt>Height</dt>
          <dd>{detail?.height ? `${detail.height} cm` : '—'}</dd>
        </div>
        <div>
          <dt>Born</dt>
          {/* The city goes under the date rather than into a tile of its own.
              A seventh tile would have displaced Seasons from the grid, and it
              would have shown an em dash on the 46% of players VIS has no birth
              place for — next to the em dash 60% of them already get for
              height. Folded in, the absent case renders nothing at all.

              Measured on the running card: 21px in the vitals block, which on
              desktop the card absorbs entirely (it is height-matched to the
              graph, so it stays 680px); a phone grows by 20px. The column is
              97px, so 84.7% of birth places fit on one line and the rest wrap
              to two, which reads fine and needs no truncation. */}
          <dd>
            {formatDate(detail?.dob ?? null)}
            {detail?.birthPlace && <span className="birth-place">{detail.birthPlace}</span>}
          </dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{years ?? '—'}</dd>
        </div>
        <div>
          <dt>Tournaments</dt>
          <dd>{node.tournaments}</dd>
        </div>
        <div>
          <dt>Partners</dt>
          <dd>{partnerCount}</dd>
        </div>
        <div>
          <dt>Seasons</dt>
          <dd>{seasonSpan(node.first, node.last)}</dd>
        </div>
        {/* Drawn from appearances as well as medals, because the tile is headed
            "Olympics" and used to appear only for the 76 published players who
            medalled — absent for the other 412, which is 84.4% of the people it
            names. Being an Olympian is the fact; the medal is a second one.

            The Games count sits under the medals rather than replacing them,
            the same shape the birth city takes under the date. A player with no
            medal gets the count as the value, so the tile still says something
            rather than showing an em dash. */}
        {(detail?.olympics || detail?.olympicGames) && (
          <div>
            <dt>Olympics</dt>
            <dd aria-label={detail.olympics ? medalAriaLabel(detail.olympics) : undefined}>
              {detail.olympics ? (
                <>
                  {formatMedals(detail.olympics)}
                  {detail.olympicGames ? (
                    <span className="sub">{plural(detail.olympicGames, 'Game')}</span>
                  ) : null}
                </>
              ) : (
                plural(detail.olympicGames!, 'Game')
              )}
            </dd>
          </div>
        )}
        {detail?.worldChamps && (
          <div>
            <dt>Worlds</dt>
            <dd aria-label={medalAriaLabel(detail.worldChamps)}>{formatMedals(detail.worldChamps)}</dd>
          </div>
        )}
        {/* Last of the three, and the one most players who have any will have:
            the tour is where a career is actually spent. Broken out by colour
            like the other two rather than totalled — a total says 149 and
            loses that 73 of them were wins. */}
        {detail?.tour && (
          <div>
            <dt>Tour podiums</dt>
            <dd aria-label={medalAriaLabel(detail.tour)}>{formatMedals(detail.tour)}</dd>
          </div>
        )}
      </dl>

      <section className="partners">
        {/* Switch shares the heading's row rather than taking one of its own:
            the card is sized to the graph beside it, so on a short window
            every row this header costs comes straight out of the list. */}
        <div className="partners-head">
          {/* The switch *is* the heading when there is one. Whichever half is
              pressed names the list below it, so a separate <h3> beside it said
              "Partners" twice on the same row. Kept for screen readers, which
              need the section named without relying on a pressed state.

              The visible fallback is for data with no per-season tallies, which
              is what `canShowTimeline` already guards for: every one of the
              13,820 published edges carries them today, so this branch is
              reachable only by a slice published before that field existed. It
              matches the guard rather than assuming the guard is dead. */}
          {canShowTimeline ? (
            <h3 className="sr-only">{showing === 'timeline' ? 'Timeline' : 'Partners'}</h3>
          ) : (
            <h3>Partners</h3>
          )}

          {canShowTimeline && (
            <div className="view-switch" role="group" aria-label="Partner view">
              <button
                type="button"
                aria-pressed={showing === 'partners'}
                onClick={() => setView('partners')}
              >
                Partners
              </button>
              <button
                type="button"
                aria-pressed={showing === 'timeline'}
                onClick={() => setView('timeline')}
              >
                Timeline
              </button>
            </div>
          )}
        </div>

        {showing === 'timeline' && available.length > 0 && (
          /* The narrowings this player has anything for. Rendered only in the
             timeline, because they narrow *events* and the partner list has
             none — and only when there is something to narrow to, so most
             cards never see them. */
          <div className="tl-filters" role="group" aria-label="Show only">
            <button
              type="button"
              className={filter === null ? 'on' : undefined}
              aria-pressed={filter === null}
              onClick={() => setFilter(null)}
            >
              All
            </button>
            {available.map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? 'on' : undefined}
                aria-pressed={filter === f}
                onClick={() => {
                  // Same flag an expansion raises: choosing a chip is the first
                  // thing that needs the results file.
                  setWantResults(true);
                  setFilter((current) => (current === f ? null : f));
                }}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        )}

        {partners.length === 0 ? (
          <p className="empty">
            {/* Says where the partnerships *are*, not just where they are not.
                An earlier wording ended on "none of them appear in the
                ${countryName} graph" with a list of them immediately below it,
                which reads as a contradiction rather than an explanation.

                The pointer stays; naming its target does not. The heading is
                the next thing on the card, so "See Partners not in this graph
                below" would spend six words on a place the eye has already
                reached. */}
            {away.length > 0
              ? `None of these partnerships appear in the ${countryName} graph, which links players by the federation they are in today. See below.`
              : `No partnerships on record for this player.`}
          </p>
        ) : showing === 'timeline' && filter ? (
          results.status !== 'ready' ? (
            <p className="events-note">Loading…</p>
          ) : filteredSeasons.length === 0 ? (
            /* Reachable only if the published `filters` and the results file
               disagree, which would be a bug rather than an empty career — the
               chip is not drawn unless the ingest found something. */
            <p className="events-note">Nothing to show for this filter.</p>
          ) : (
            <SeasonList
              rows={filteredSeasons}
              open={allFilteredOpen}
              onToggle={() => undefined}
              idPrefix={`filtered-${node.id}`}
              eventsFor={filteredEventsForSeason}
              status={results.status}
              onSelectPartner={onSelectPartner}
              onOpenEvent={openEventPanel}
              variant="is-filtered"
            />
          )
        ) : showing === 'timeline' ? (
          <SeasonList
            rows={timeline}
            open={openSeasons}
            onToggle={toggleSeason}
            idPrefix={`season-${node.id}`}
            eventsFor={eventsForSeason}
            status={results.status}
            onSelectPartner={onSelectPartner}
            onOpenEvent={openEventPanel}
          />
        ) : (
          <ul>
            {partners.map((p) => (
              <li key={p.node.id}>
                <button type="button" onClick={() => onSelectPartner(p.node.id)}>
                  <span className="name">{p.node.name}</span>
                  <span className="meta">
                    <span className="tally">{p.t}</span>
                    <BestFinish rank={p.r} />
                    <span className="span">{seasonSpan(p.f, p.l)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {away.length > 0 && (
          <div className="away">
            {/* Named rather than hidden: the graph deliberately holds only
                same-slice pairs, and a player who moved keeps their new country
                while every partner stays behind. Without this the card reads as
                though they never had a partner at all.

                The heading says nothing about *who* moved, because the block
                cannot tell. It read "Now with other federations" until someone
                opened Tiago De J Santos in Qatar and found Pedro Solberg under
                it: they played one event in 2005, both Brazilian, and Pedro has
                been Brazilian ever since. Tiago is the one who left. Of the 111
                published away rows carrying a federation for the partnership,
                53 are that way round and 54 are the other, so a heading that
                points at the partner is wrong about as often as it is right.
                (4 more are the GBR split into ENG and SCO, where both ends
                moved because the federation did.)

                Six rows are not a federation difference at all. Three pairs sit
                in the same federation under opposite genders — and since FIVB
                runs no mixed beach competition, that is an upstream error
                rather than a category: all three played men's events
                (`MU212012`, `MRIO1989`, `MAGA2011`). The errors differ, though,
                and only one is the mislabel it looks like — a duplicated
                athlete, a wrong gender, and a team row crediting the wrong
                person entirely. Quirks §18.

                So "not in this graph" is the one description true of all 221
                rows, and it is what the row's own flags then qualify, since a
                partner who has since moved carries an arrow to where they are
                today. */}
            <h4>Partners not in this graph</h4>
            {showing === 'timeline' && awayTimeline.length > 0 ? (
              <SeasonList
                rows={awayTimeline}
                open={openAwaySeasons}
                onToggle={toggleAwaySeason}
                idPrefix={`away-season-${node.id}`}
                eventsFor={awayEventsForSeason}
                status={results.status}
                onSelectPartner={onSelectAwayById}
                onOpenEvent={openEventPanel}
                variant="is-away"
              />
            ) : (
            <ul>
              {away.map(({ partner, countryName: partnerCountry, flag: partnerFlag, then, linkable }) => {
                // What the pair represented, not where the partner is today.
                // The two differ for exactly the partnerships this block was
                // getting wrong.
                const spans = representedAs(then);
                // Where they are today, but only when the row does not already
                // say it. Half the published away rows (110 of 221) end on a
                // federation the partner has since left, and after the flags
                // started telling the truth about *then*, nothing on the row
                // told the reader about *now* — including the fact that
                // selecting it navigates to another country's graph.
                const moved = spans.length > 0 && spans[spans.length - 1]!.fed !== partner.fed;
                const label =
                  spans.length > 0
                    ? spans
                        .map((r) => `${r.countryName}, ${r.from === r.to ? r.from : `${r.from}–${r.to}`}`)
                        .join(' · ') + (moved ? ` · now ${partnerCountry}` : '')
                    : partnerCountry;
                const badge = spans.length > 0 ? spans.map((r) => r.flag).join('') : partnerFlag;
                return (
                <li key={partner.id}>
                  {linkable ? (
                    <button type="button" onClick={() => onSelectAway(partner)}>
                      <span className="name">{partner.name}</span>
                      <span className="meta">
                        <span className="fed" title={label}>
                          <span aria-hidden="true">
                            {badge}
                            {/* The arrow carries the whole story in two
                                characters: was there, is here now. Spelled out
                                for a screen reader by `label`. */}
                            {moved && <span className="moved-to">→{partnerFlag}</span>}
                          </span>
                          <span className="sr-only">{label}</span>
                        </span>
                        <span className="tally">{partner.t}</span>
                        <BestFinish rank={partner.r} />
                        <span className="span">{seasonSpan(partner.f, partner.l)}</span>
                      </span>
                    </button>
                  ) : (
                    // That slice has fewer than two players, so it was never
                    // published — the partner is real, the page is not.
                    <span className="unlinked">
                      <span className="name">{partner.name}</span>
                      <span className="meta">
                        <span className="fed" title={label}>
                          <span aria-hidden="true">
                            {badge}
                            {/* The arrow carries the whole story in two
                                characters: was there, is here now. Spelled out
                                for a screen reader by `label`. */}
                            {moved && <span className="moved-to">→{partnerFlag}</span>}
                          </span>
                          <span className="sr-only">{label}</span>
                        </span>
                        <span className="tally">{partner.t}</span>
                        <BestFinish rank={partner.r} />
                        <span className="span">{seasonSpan(partner.f, partner.l)}</span>
                      </span>
                    </span>
                  )}
                </li>
                );
              })}
            </ul>
            )}
          </div>
        )}
      </section>

      <div className="card-foot">
        {/* The way into the path panel, and the only one: the question is
            "how does this player reach someone else", so it belongs on a
            player rather than on the graph's toolbar.

            "a player" rather than "another player" to keep the foot on one
            line. The card is 340px wide, which leaves 189px beside the FIVB
            link; the longer label measured 200px and wrapped, this one 153px.
            The word it drops was doing nothing — the button is on a player's
            own card, so the other end of the path is another player by
            construction. */}
        <button type="button" className="find-path" onClick={onFindPath}>
          Path to a player
        </button>
        <a
          className="profile-link"
          href={playerProfileUrl(node.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          FIVB profile ↗
        </a>
      </div>
      {openEvent && (
        <TournamentPanel
          name={openEvent.name}
          season={openEvent.season}
          tier={openEvent.tier}
          level={openEvent.level}
          when={openEvent.when}
          state={classification}
          iso2Of={iso2Of}
          highlightId={node.id}
          onSelectPlayer={(id) => {
            setOpenEvent(null);
            onSelectPartner(id);
          }}
          onClose={() => setOpenEvent(null)}
        />
      )}
      {portraitOpen && (
        <PortraitLightbox
          id={node.id}
          name={node.name}
          flag={flag}
          countryName={countryName}
          onClose={() => setPortraitOpen(false)}
        />
      )}
    </aside>
  );
}
