/**
 * Detail panel for the selected player.
 *
 * Photos come straight from FIVB's image service and 404 for players with none
 * on file, so the <img> is allowed to fail and an initials avatar takes over.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AwayPartner, Gender, GraphNode, PlayerDetail, SeasonTally } from '../schema';
import { playerProfileUrl, TIER_BADGE } from '../schema';
import { foldAccents } from '../lib/search';
import {
  age,
  formatDate,
  formatDayMonth,
  formatFinish,
  formatMedals,
  medalAriaLabel,
  plural,
  seasonSpan,
} from '../lib/format';
import { Avatar } from './Avatar';
import { buildTimeline, type TimelineSeason } from '../lib/timeline';
import { seasonEvents, type SeasonEvent } from '../lib/results';
import { prefersReducedMotion } from '../lib/motion';
import { useResults } from '../lib/useResults';
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
                                <span className="name">{event.name}</span>
                                <span
                                  className={`finish${event.rank >= 1 && event.rank <= 3 ? ' podium' : ''}`}
                                >
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

export function PlayerCard({
  node,
  detail,
  partners,
  away,
  country,
  gender,
  countryName,
  flag,
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
  // made a player whose partners all competed elsewhere read "0 partners, 0
  // entries" directly above a list of six of them and a career of fifteen
  // tournaments — the vitals describing the graph while the rest of the card
  // described the player.
  const partnerCount = partners.length + away.length;
  const totalTogether =
    partners.reduce((sum, p) => sum + p.t, 0) + away.reduce((sum, a) => sum + a.partner.t, 0);

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

  // --- expanding a season into its tournaments ------------------------------
  const [openSeasons, setOpenSeasons] = useState<ReadonlySet<number>>(new Set());
  // Raised by the first expansion and never lowered, which is what keeps the
  // fetched slice around as the reader clicks from player to player.
  const [wantResults, setWantResults] = useState(false);
  const results = useResults(country, gender, wantResults);

  // The away list expands independently: the two blocks answer different
  // questions, and a 2015 opened in one is not a 2015 opened in the other.
  const [openAwaySeasons, setOpenAwaySeasons] = useState<ReadonlySet<number>>(new Set());

  // A different player's seasons are not this player's, so start them closed —
  // but leave `view` alone, so someone reading careers year by year stays in
  // the timeline as they click through.
  useEffect(() => {
    setOpenSeasons(new Set());
    setOpenAwaySeasons(new Set());
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

  return (
    <aside
      ref={cardRef}
      className="player-card"
      // Focusable programmatically, never in the tab order.
      tabIndex={-1}
      aria-label={`Profile: ${node.name}`}
    >
      <header>
        <Avatar id={node.id} name={node.name} width={200} className="player-photo" />
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
          <dd>{formatDate(detail?.dob ?? null)}</dd>
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
        {detail?.olympics && (
          <div>
            <dt>Olympics</dt>
            <dd aria-label={medalAriaLabel(detail.olympics)}>{formatMedals(detail.olympics)}</dd>
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
          <h3>
            {showing === 'timeline' ? 'Timeline' : 'Partners'}{' '}
            <span className="count">{plural(totalTogether, 'entry', 'entries')}</span>
          </h3>

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

        {partners.length === 0 ? (
          <p className="empty">
            {/* Says where the partnerships *are*, not just where they are not.
                An earlier wording ended on "none of them appear in the
                ${countryName} graph" with a list of them immediately below it,
                which reads as a contradiction rather than an explanation.

                The pointer stays; naming its target does not. The heading is
                the next thing on the card, so "See Now with other federations
                below" spent six words on a place the eye has already reached —
                and reading a heading that opens with "Now" back into a sentence
                made the sentence stumble. */}
            {away.length > 0
              ? `None of these partnerships appear in the ${countryName} graph, which links players by the federation they are in today. See below.`
              : `No partnerships on record for this player.`}
          </p>
        ) : showing === 'timeline' ? (
          <SeasonList
            rows={timeline}
            open={openSeasons}
            onToggle={toggleSeason}
            idPrefix={`season-${node.id}`}
            eventsFor={eventsForSeason}
            status={results.status}
            onSelectPartner={onSelectPartner}
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
                same-federation pairs, and a player who moved keeps their new
                country while every partner stays behind. Without this the card
                reads as though they never had a partner at all.

                "Now" is load-bearing. The rows underneath carry the federation
                the pair represented *at the time*, and on 106 of the 221
                published away rows that is this very country — so a heading
                reading "Other federations" sat directly above this slice's own
                flag. Gabriel Pereira's whole card is one such row: his only
                partner is Jefferson Santos Pereira, they played one event
                together in 2008 as Brazilians, and Jefferson is Qatari today.
                The block is not "partners from elsewhere", it is "partners who
                are elsewhere now". */}
            <h4>Now with other federations</h4>
            {showing === 'timeline' && awayTimeline.length > 0 ? (
              <SeasonList
                rows={awayTimeline}
                open={openAwaySeasons}
                onToggle={toggleAwaySeason}
                idPrefix={`away-season-${node.id}`}
                eventsFor={awayEventsForSeason}
                status={results.status}
                onSelectPartner={onSelectAwayById}
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
    </aside>
  );
}
