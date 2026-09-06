import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AwayPartner, Gender, GraphFile, Manifest, MedalCounts, PlayerDetail, PlayersFile } from './schema';
import { GENDERS } from './schema';
import { fetchGraph, fetchManifest, fetchPlayers } from './lib/api';
import { flagEmoji, formatMedals, plural } from './lib/format';
import { CONTACT_EMAIL, SOURCE_NAME, SOURCE_URL } from './site';
import { Controls, MIN_TOGETHER_OPTIONS } from './components/Controls';
import { filterByStrength } from './lib/filter';
import { parseMinTogether } from './lib/params';
import type { SearchablePlayer } from './lib/search';
import { GENDER_LABEL } from './schema';
import { sliceSlug, slugFromPath } from './lib/slug';
import { PartnershipGraph } from './components/PartnershipGraph';
import { PathPanel } from './components/PathPanel';
import { indexPartnerships, pathEdgeKeys, pathNodeIds, findPath } from './lib/path';
import { PlayerCard, type AwayRow, type PartnerRow } from './components/PlayerCard';
import { StatTiles, type Stat } from './components/StatTiles';
import { TableView, type TableRow } from './components/TableView';
import { ThemeToggle } from './components/ThemeToggle';
import './App.css';

/** Opening view: the country with the most players. */
const DEFAULT_COUNTRY = 'BRA';

/** Read/write the current slice in the URL so a view is linkable. */
function readUrl(): {
  slug: string | null;
  country: string | null;
  gender: Gender | null;
  player: number | null;
  min: number | null;
  pathTo: number | null;
} {
  const params = new URLSearchParams(location.search);
  const gender = params.get('gender');
  const player = Number(params.get('player'));
  const pathTo = Number(params.get('path'));
  return {
    // The prerendered path ("/brazil-men/") is the canonical form; the query
    // parameters stay supported so older links keep working.
    slug: slugFromPath(location.pathname, import.meta.env.BASE_URL),
    country: params.get('country'),
    gender: gender === 'M' || gender === 'W' ? gender : null,
    player: Number.isFinite(player) && player > 0 ? player : null,
    min: parseMinTogether(params.get('min'), MIN_TOGETHER_OPTIONS),
    pathTo: Number.isFinite(pathTo) && pathTo > 0 ? pathTo : null,
  };
}

/** Point a <link> or <meta> tag in the document head at a new value. */
function setHeadTag(selector: string, attr: 'href' | 'content', value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState(initial.country ?? DEFAULT_COUNTRY);
  const [gender, setGender] = useState<Gender>(initial.gender ?? 'M');
  const [graph, setGraph] = useState<GraphFile | null>(null);
  const [details, setDetails] = useState<PlayersFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(initial.player);
  const [layoutKey, setLayoutKey] = useState(0);
  /** Hide partnerships below this many shared tournaments. 1 = show all. */
  const [minTogether, setMinTogether] = useState(initial.min ?? 1);
  /**
   * The far end of an open partnership path, or null when the panel is closed.
   * The near end is always the selected player, so the panel is a mode of the
   * card rather than a thing of its own.
   */
  const [pathTo, setPathTo] = useState<number | null>(initial.pathTo);
  /**
   * Whether the path panel has the card's slot. Kept apart from `pathTo`
   * because the panel is open for a while before a second player is picked,
   * and "open with nobody chosen" is a real state rather than a missing value.
   */
  const [pathOpen, setPathOpen] = useState(initial.pathTo !== null);

  // --- manifest ------------------------------------------------------------
  useEffect(() => {
    fetchManifest()
      .then((m) => {
        setManifest(m);

        // A prerendered path wins over the query string: it is the canonical URL.
        if (initial.slug) {
          for (const c of m.countries) {
            for (const g of GENDERS) {
              if (c.genders[g] && sliceSlug(c.name, g) === initial.slug) {
                setCountry(c.code);
                setGender(g);
                return;
              }
            }
          }
        }
        // Fall back if the requested slice does not exist in this build.
        const known = m.countries.find((c) => c.code === country);
        if (!known) {
          const fallback = m.countries.find((c) => c.code === DEFAULT_COUNTRY) ?? m.countries[0];
          if (fallback) setCountry(fallback.code);
        }
      })
      .catch((e: Error) =>
        setError(
          `Could not load the data index (${e.message}). If you are running locally, generate it first with \`npm run ingest\`.`,
        ),
      );
    // Country is intentionally read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep gender valid for the chosen country.
  useEffect(() => {
    if (!manifest) return;
    const entry = manifest.countries.find((c) => c.code === country);
    if (entry && !entry.genders[gender]) {
      const other = GENDERS.find((g) => entry.genders[g]);
      if (other) setGender(other);
    }
  }, [manifest, country, gender]);

  // --- slice ---------------------------------------------------------------
  useEffect(() => {
    if (!manifest) return;
    const entry = manifest.countries.find((c) => c.code === country);
    if (!entry?.genders[gender]) return;

    let cancelled = false;
    setLoading(true);
    Promise.all([fetchGraph(country, gender), fetchPlayers(country, gender)])
      .then(([g, p]) => {
        if (cancelled) return;
        setGraph(g);
        setDetails(p);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(`Could not load ${country}-${gender}: ${e.message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [manifest, country, gender]);

  // A path is a statement about one slice, so changing country or gender ends
  // it rather than leaving a far end pointing at somebody who is no longer here.
  //
  // Compares against the slice it last ran for rather than just depending on
  // the two values, because an effect also fires on mount — which cleared the
  // path a shared link had just opened, before anything was rendered.
  const pathSlice = useRef(`${country}-${gender}`);
  useEffect(() => {
    const key = `${country}-${gender}`;
    if (pathSlice.current === key) return;
    pathSlice.current = key;
    setPathTo(null);
    setPathOpen(false);
  }, [country, gender]);

  // --- URL and document head sync -----------------------------------------
  useEffect(() => {
    if (!manifest) return;
    const entry = manifest.countries.find((c) => c.code === country);
    if (!entry) return;

    // Keep the address bar on the canonical prerendered path, so a copied link
    // matches the URL that is actually indexed.
    const base = import.meta.env.BASE_URL;
    const params = new URLSearchParams();
    if (minTogether > 1) params.set('min', String(minTogether));
    if (selectedId) params.set('player', String(selectedId));
    // Only a finished path is worth linking to.
    if (selectedId && pathOpen && pathTo) params.set('path', String(pathTo));
    const query = params.toString();
    const url = `${base}${sliceSlug(entry.name, gender)}/${query ? `?${query}` : ''}`;
    history.replaceState(null, '', url);

    const label = GENDER_LABEL[gender];
    const counts = entry.genders[gender];
    const title = `${entry.name} ${label} — Beach Volleyball Partnership Graph`;
    const description = `Every ${label.toLowerCase()}'s beach volleyball player from ${entry.name} who has competed on the FIVB World Tour, Beach Pro Tour, World Championships or Olympic Games — ${counts?.nodes ?? 0} players and ${counts?.edges ?? 0} partnerships, ${manifest.seasons.from}–${manifest.seasons.to}.`;

    document.title = title;
    setHeadTag('link[rel="canonical"]', 'href', new URL(url, location.origin).toString());
    setHeadTag('meta[name="description"]', 'content', description);
    setHeadTag('meta[property="og:title"]', 'content', title);
    setHeadTag('meta[property="og:description"]', 'content', description);
    setHeadTag('meta[property="og:url"]', 'content', new URL(url, location.origin).toString());
  }, [manifest, country, gender, selectedId, minTogether, pathTo, pathOpen]);

  // --- derived -------------------------------------------------------------
  /** See lib/filter.ts for why an orphaned player leaves with their edges. */
  const { nodes: visibleNodes, edges: visibleEdges } = useMemo(
    () => filterByStrength(graph?.nodes ?? [], graph?.edges ?? [], minTogether),
    [graph, minTogether],
  );

  const nodesById = useMemo(
    () => new Map(visibleNodes.map((n) => [n.id, n])),
    [visibleNodes],
  );

  /**
   * Adjacency for the partnership path, built from the *filtered* slice.
   *
   * A route through a partnership the reader has hidden with "min. events
   * together" is a route they cannot see on the graph, which reads as a bug
   * rather than as an answer — so the walk and the picture share one source.
   */
  const partnerships = useMemo(
    () => indexPartnerships(visibleNodes, visibleEdges),
    [visibleNodes, visibleEdges],
  );

  const pathResult = useMemo(
    () =>
      selectedId !== null && pathOpen && pathTo !== null
        ? findPath(partnerships, selectedId, pathTo)
        : null,
    [partnerships, selectedId, pathTo, pathOpen],
  );
  const litNodes = useMemo(() => pathNodeIds(pathResult), [pathResult]);
  const litEdges = useMemo(() => pathEdgeKeys(pathResult), [pathResult]);

  const partnersByPlayer = useMemo(() => {
    const map = new Map<number, PartnerRow[]>();
    for (const edge of visibleEdges) {
      const a = nodesById.get(edge.a);
      const b = nodesById.get(edge.b);
      if (!a || !b) continue;
      if (!map.has(edge.a)) map.set(edge.a, []);
      if (!map.has(edge.b)) map.set(edge.b, []);
      map.get(edge.a)!.push({ node: b, t: edge.t, f: edge.f, l: edge.l, s: edge.s, r: edge.r });
      map.get(edge.b)!.push({ node: a, t: edge.t, f: edge.f, l: edge.l, s: edge.s, r: edge.r });
    }
    for (const list of map.values()) list.sort((x, y) => y.t - x.t || x.node.name.localeCompare(y.node.name));
    return map;
  }, [visibleEdges, nodesById]);

  const detailsById = useMemo(
    () => new Map((details?.players ?? []).map((p) => [p.id, p])),
    [details],
  );

  /**
   * Names for the whole slice, before the strength filter thins it. The player
   * card's expanded seasons list every tournament a player entered, including
   * ones played with a partner whose edge the filter is currently hiding —
   * `nodesById` above cannot name those.
   */
  const namesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n.name])),
    [graph],
  );

  /**
   * The selected player's partners from other federations, resolved against
   * the manifest so each one can carry its own flag and country name.
   *
   * `linkable` is false when that country x gender slice was too small to
   * publish (fewer than two players): the partner is real and still worth
   * naming, but there is no page to send anyone to.
   */
  /**
   * Federation code -> ISO-2, for flags on federations that are not the slice's
   * own. The manifest is the only place that mapping exists on the client, and
   * a tournament's classification is full of them: Paris 2024 alone draws teams
   * from fourteen federations.
   */
  const iso2Of = useCallback(
    (code: string) => manifest?.countries.find((c) => c.code === code)?.iso2 ?? null,
    [manifest],
  );

  const awayRows: AwayRow[] = useMemo(() => {
    const list = selectedId ? (detailsById.get(selectedId)?.away ?? []) : [];
    const named = (code: string) => {
      const entry = manifest?.countries.find((c) => c.code === code);
      return { countryName: entry?.name ?? code, flag: flagEmoji(entry?.iso2, code), entry };
    };
    return list.map((partner) => {
      const now = named(partner.fed);
      // What the pair actually represented, oldest first — one entry for
      // almost all of them, more for a pair who kept playing through a
      // transfer.
      const then = (partner.at ?? []).map(([season, code]) => ({
        season,
        fed: code,
        ...named(code),
      }));
      return {
        partner,
        countryName: now.countryName,
        flag: now.flag,
        then,
        linkable: Boolean(now.entry?.genders[partner.gender]),
      };
    });
  }, [selectedId, detailsById, manifest]);

  /** Follow an away partner into the slice they actually live in. */
  const selectAwayPartner = useCallback((partner: AwayPartner) => {
    setCountry(partner.fed);
    setGender(partner.gender);
    setSelectedId(partner.id);
  }, []);

  /**
   * Open a player from a tournament's field, on the page they belong to.
   *
   * A classification is not a slice, and that is the whole reason this exists:
   * Paris 2024 alone holds teams from fourteen federations, so most names in a
   * field are not on the page the reader is looking at. Setting the id alone —
   * which is what this used to do, sharing the graph's plain selection — left
   * `selectedId` pointing at somebody the current slice has never heard of, and
   * the card simply vanished. From the reader's side: click a name in a
   * tournament, lose the card and land back on a bare country page.
   *
   * So it does what following an away partner does, and what the search box
   * does for a match from elsewhere: the slice and the selection move together.
   * `setMinTogether(1)` for the same reason `jumpToPlayer` does it — the
   * threshold is a statement about the graph the reader was reading, and
   * carrying it into a new country can hide the player they just asked for.
   */
  const selectFieldPlayer = useCallback(
    (id: number, slice: { country: string; gender: Gender }) => {
      if (slice.country !== country || slice.gender !== gender) {
        setCountry(slice.country);
        setGender(slice.gender);
        setMinTogether(1);
        setSelectedId(id);
        return;
      }
      // Already here, and possibly hidden by the threshold rather than absent.
      if (!nodesById.has(id)) setMinTogether(1);
      setSelectedId(id);
    },
    [country, gender, nodesById],
  );

  const countryEntry = manifest?.countries.find((c) => c.code === country);
  const flag = flagEmoji(countryEntry?.iso2, countryEntry?.code);

  const tableRows: TableRow[] = useMemo(
    () =>
      visibleNodes.map((n) => {
        const partners = partnersByPlayer.get(n.id) ?? [];
        return { ...n, partners: partners.length, topPartner: partners[0]?.node.name ?? null };
      }),
    [visibleNodes, partnersByPlayer],
  );

  const stats: Stat[] = useMemo(() => {
    const nodes = visibleNodes;
    const edges = visibleEdges;
    if (nodes.length === 0) return [];

    const result: Stat[] = [];

    // A country-wide bonus fact, not about any specific pairing: every
    // player's medals summed for the whole slice, deliberately unfiltered by
    // the "min events together" slider above -- a medal already won
    // shouldn't disappear because that slider hid a player's current edges.
    // Kept right after the player count (rather than at the end, with the
    // partnership stats) since it describes the country, not the graph.
    // Olympic and World Championships tallies are kept separate, same as on
    // the player card: they are not the same prestige, and merging them
    // would hide which is which.
    //
    // Each row here is a *player's own* medal count (correctly 1 each for
    // both members of a winning pair -- that is how many medals they
    // personally own). Summing that across the whole country counts every
    // team medal twice, once per teammate, so the country total needs
    // dividing by 2 to land back on medals-per-event -- the convention
    // official country medal tables use for team sports (one medal per
    // event, not one per athlete). Safe to assume exactly 2 credits per
    // event here: FIVB pairs are always same-federation, so both teammates
    // fall in this same country x gender slice.
    //
    // Rounded rather than divided outright: a teammate whose federation tag
    // has since drifted from their partner's (see the Schalk/Saxton case) can
    // leave a medal credited on just one side of this slice, which would
    // otherwise show as a stray ".5".
    const perEvent = (pick: (p: PlayerDetail) => MedalCounts | undefined): MedalCounts => {
      const total = { gold: 0, silver: 0, bronze: 0 };
      for (const p of details?.players ?? []) {
        const counts = pick(p);
        if (!counts) continue;
        total.gold += counts.gold;
        total.silver += counts.silver;
        total.bronze += counts.bronze;
      }
      return {
        gold: Math.round(total.gold / 2),
        silver: Math.round(total.silver / 2),
        bronze: Math.round(total.bronze / 2),
      };
    };

    // Three tiles at most, in ascending order of how many countries have one.
    // The tour tally is the same three colours rather than a total: a total
    // says 149 and loses that 73 of them were wins.
    const tiles: [label: string, counts: MedalCounts][] = [
      ['Olympics', perEvent((p) => p.olympics)],
      ['Worlds', perEvent((p) => p.worldChamps)],
      ['Tour podiums', perEvent((p) => p.tour)],
    ];
    for (const [label, counts] of tiles) {
      if (counts.gold + counts.silver + counts.bronze > 0) {
        result.push({ label, value: formatMedals(counts) });
      }
    }

    const degrees = nodes.map((n) => (partnersByPlayer.get(n.id)?.length ?? 0));
    const avg = degrees.reduce((a, b) => a + b, 0) / nodes.length;
    const longest = [...edges].sort((a, b) => b.t - a.t)[0];
    // Competition names, not legal ones — the same `short` the graph labels
    // use. A tile is not the place for 'Christopher St. John "Sinjin" Smith &
    // Carl John Henkel'; "Sinjin Smith & Henkel" is what anyone following the
    // sport would call them, and it fits.
    const longestNames = longest
      ? `${nodesById.get(longest.a)?.short ?? '?'} & ${nodesById.get(longest.b)?.short ?? '?'}`
      : '—';
    result.push(
      { label: 'Partnerships', value: edges.length.toLocaleString() },
      { label: 'Avg. partners', value: avg.toFixed(1), detail: 'per player' },
      {
        label: 'Longest pairing',
        value: longest ? `${longest.t}` : '—',
        detail: longest ? `${longestNames} · ${longest.f}–${longest.l}` : undefined,
      },
    );

    return result;
  }, [visibleNodes, visibleEdges, partnersByPlayer, nodesById, details]);

  const totalNodes = graph?.nodes.length ?? 0;
  const hidden = totalNodes - visibleNodes.length;
  const hero: Stat | undefined = graph
    ? {
        label: 'Players',
        value: visibleNodes.length.toLocaleString(),
        detail: hidden > 0 ? `of ${totalNodes.toLocaleString()} · ${graph.countryName}` : graph.countryName,
      }
    : undefined;

  const selectedNode = selectedId === null ? null : (nodesById.get(selectedId) ?? null);

  const selectPlayer = useCallback((id: number | null) => setSelectedId(id), []);

  /**
   * Selection from the search box, which unlike the graph, the table and the
   * partner list can reach a player the strength filter is currently hiding.
   *
   * Searching the visible set only would answer "no players match" for someone
   * who is in this country's data and merely filtered out — indistinguishable
   * from a typo, and unfixable without first guessing that the threshold is to
   * blame. So the search covers the whole slice and picking a hidden player
   * drops the threshold back to "All" to reveal them. The segmented control
   * moves with it, so the change is visible rather than silent.
   */
  const jumpToPlayer = useCallback(
    (player: SearchablePlayer) => {
      // A match from another slice: switch with the selection, the same move an
      // away partner makes. The graph, the table and the stats all follow the
      // new country, so this is a page change with a player already picked
      // rather than a selection that happens to be somewhere else.
      //
      // The test is whether the slice *differs*, not whether it is set. Every
      // search row carries one now — that changed when every row started naming
      // a country — and a presence check had quietly become "always true",
      // which reset the threshold on every pick, including a player standing
      // right there in the graph at the threshold the reader chose.
      if (player.slice.country !== country || player.slice.gender !== gender) {
        setCountry(player.slice.country);
        setGender(player.slice.gender);
        setMinTogether(1);
        setSelectedId(player.id);
        return;
      }
      if (!nodesById.has(player.id)) setMinTogether(1);
      setSelectedId(player.id);
    },
    [nodesById, country, gender],
  );

  // Matches the player card's height to the graph's actual rendered height
  // (see PartnershipGraph's onSize doc comment for why this can't be plain
  // CSS grid stretch).
  const [graphHeight, setGraphHeight] = useState<number | null>(null);
  const onGraphSize = useCallback((size: { height: number }) => setGraphHeight(size.height), []);

  // Clear a selection that does not exist in the newly loaded slice — but only
  // once the loaded slice is the one being asked for. Following an away
  // partner sets the country, the gender and the selection together, and for
  // the moment before the new graph arrives the old one is still in state;
  // judging the selection against it would throw away a player who is about to
  // be perfectly valid.
  useEffect(() => {
    if (selectedId === null || !graph) return;
    if (graph.country !== country || graph.gender !== gender) return;
    if (!nodesById.has(selectedId)) setSelectedId(null);
  }, [graph, nodesById, selectedId, country, gender]);

  if (error && !graph) {
    return (
      <div className="app">
        <div className="error-panel" role="alert">
          <h1>Data unavailable</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Beach Volleyball Partnership Graph</h1>
          <p>
            Who has played with whom in FIVB international beach volleyball — the World Tour, Beach Pro
            Tour, World Championships and Olympic Games.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {manifest && (
        <Controls
          manifest={manifest}
          country={country}
          gender={gender}
          onCountry={(code) => {
            setCountry(code);
            setSelectedId(null);
          }}
          onGender={(g) => {
            setGender(g);
            setSelectedId(null);
          }}
          minTogether={minTogether}
          onMinTogether={setMinTogether}
          players={graph?.nodes ?? []}
          onSelectPlayer={jumpToPlayer}
        />
      )}

      {/* Refetch keeps the frame: the previous render stays, dimmed. */}
      <main className={loading ? 'is-loading' : ''}>
        <StatTiles stats={stats} hero={hero} />

        <section className="graph-section">
          <div className="section-head">
            <div>
              <h2>
                {countryEntry?.name ?? country} · {gender === 'M' ? 'Men' : 'Women'}
              </h2>
              <p className="legend">
                <span className="key">
                  <svg width="30" height="12" aria-hidden="true">
                    <circle cx="6" cy="6" r="3" className="key-dot" />
                    <circle cx="21" cy="6" r="6" className="key-dot" />
                  </svg>
                  Circle size = tournaments entered
                </span>
                <span className="key">
                  <svg width="22" height="12" aria-hidden="true">
                    <line x1="2" y1="6" x2="20" y2="6" className="key-line" strokeWidth="1.5" />
                  </svg>
                  Line thickness = events played together
                </span>
                {hidden > 0 && (
                  <span className="key filtered">
                    Showing pairs with {minTogether}+ events together · {hidden.toLocaleString()}{' '}
                    {hidden === 1 ? 'player' : 'players'} hidden
                  </span>
                )}
              </p>
            </div>
            <button type="button" className="relayout" onClick={() => setLayoutKey((k) => k + 1)}>
              Re-tangle
            </button>
          </div>

          {visibleNodes.length > 0 ? (
            <PartnershipGraph
              nodes={visibleNodes}
              edges={visibleEdges}
              selectedId={selectedId}
              onSelect={selectPlayer}
              layoutKey={layoutKey}
              onSize={onGraphSize}
              pathIds={litNodes}
              pathEdges={litEdges}
            />
          ) : (
            <div className="graph-empty">
              {totalNodes > 0
                ? `No partnership here reaches ${minTogether} shared tournaments.`
                : 'No players for this selection.'}
            </div>
          )}

          {selectedNode && pathOpen && (
            <div className="card-slot" style={graphHeight ? { height: graphHeight } : undefined}>
              <PathPanel
                index={partnerships}
                nodes={visibleNodes}
                from={selectedNode}
                toId={pathTo}
                onPick={setPathTo}
                onSelectPlayer={(id) => {
                  setPathTo(null);
                  setPathOpen(false);
                  setSelectedId(id);
                }}
                onClose={() => {
                  setPathTo(null);
                  setPathOpen(false);
                }}
                country={graph?.country ?? country}
                gender={graph?.gender ?? gender}
              />
            </div>
          )}

          {selectedNode && !pathOpen && (
            <div className="card-slot" style={graphHeight ? { height: graphHeight } : undefined}>
              <PlayerCard
                node={selectedNode}
                detail={detailsById.get(selectedNode.id)}
                partners={partnersByPlayer.get(selectedNode.id) ?? []}
                away={awayRows}
                iso2Of={iso2Of}
                // From the graph, not the selection: the two differ for a
                // render while an away partner's slice loads.
                country={graph?.country ?? country}
                gender={graph?.gender ?? gender}
                countryName={countryEntry?.name ?? country}
                flag={flag}
                names={namesById}
                onSelectPartner={selectPlayer}
                onSelectAway={selectAwayPartner}
                onSelectFieldPlayer={selectFieldPlayer}
                onFindPath={() => setPathOpen(true)}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </section>

        <section className="table-section">
          <div className="section-head">
            <h2>All players</h2>
            <p className="muted">{plural(tableRows.length, 'player')}</p>
          </div>
          <TableView rows={tableRows} selectedId={selectedId} onSelect={selectPlayer} />
        </section>
      </main>

      <footer>
        <p>
          Source: <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{SOURCE_NAME}</a>.
          {manifest && ` Rebuilt weekly · ${manifest.totals.partnerships.toLocaleString()} partnerships across ${manifest.totals.players.toLocaleString()} players.`}
          {' '}Not affiliated with the FIVB.
        </p>
        <p className="caveat">
          Partnerships are counted per tournament entry. Only pairs where both players represent the
          same federation appear in a country’s graph.
        </p>
        <p className="caveat">
          Corrections, questions or partnership enquiries:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          {' · '}
          {/* A full page load, deliberately: /about/ is a standalone document
              that never boots the app (see aboutPage in ingest/prerender.ts). */}
          <a href={`${import.meta.env.BASE_URL}about/`}>About this project</a>
        </p>
        <p className="caveat">© 2026 Eduardo Picado. All rights reserved.</p>
      </footer>
    </div>
  );
}

