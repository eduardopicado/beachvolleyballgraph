/**
 * Serves `/tournaments/` — the index of every tournament with a page.
 *
 * A third sibling to `App` and `TournamentRoute`, mounted in `main.tsx` on the
 * same principle: this page fetches the tournament index and the manifest and
 * nothing else, and never builds a graph it does not draw.
 *
 * **The filter lives in the URL.** `?gender=W&season=2019&level=4-star` is a
 * link a reader can send and a page a crawler can index, and it means the back
 * button walks a reader's own filtering rather than leaving the site. The
 * alternative — component state — makes every filtered view of 40 seasons
 * unreachable from outside.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Manifest, TournamentsFile } from '../../shared/schema';
import { fetchManifest, fetchTournaments } from './lib/api';
import { tournamentPath } from '../../shared/slug';
import { filterFromParams, indexPath, paramsFor } from './lib/indexRoute';
import { buildIndex, defaultSeason, reconcile } from './lib/tournamentIndex';
import { TournamentIndex } from './components/TournamentIndex';

const BASE = import.meta.env.BASE_URL;

export default function TournamentIndexRoute() {
  const [tournaments, setTournaments] = useState<TournamentsFile | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState(() => location.search);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTournaments(), fetchManifest()])
      .then(([t, m]) => {
        if (cancelled) return;
        setTournaments(t);
        setManifest(m);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The back button walks the reader's own filtering, so the URL has to be
  // read again when it changes rather than only at mount.
  useEffect(() => {
    const onPop = () => setSearch(location.search);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const rows = useMemo(() => {
    if (!tournaments || !manifest) return [];
    const withoutField = new Set(manifest.withoutField ?? []);
    return buildIndex(tournaments.tournaments, (code) => !withoutField.has(code));
  }, [tournaments, manifest]);

  const filter = useMemo(() => {
    if (rows.length === 0) return null;
    const params = new URLSearchParams(search);
    // The draw has to be read before the season can be defaulted: which season
    // this year resolves to depends on which calendar is being asked about.
    const gender = filterFromParams(params, 0).gender;
    // A link to `?gender=W&season=1990` names a season the women's draw does
    // not have; `reconcile` snaps it to the nearest one it does, 1992, the
    // same answer a click on Women from 1990 gets.
    return reconcile(rows, filterFromParams(params, defaultSeason(rows, gender) ?? 0));
  }, [rows, search]);

  useEffect(() => {
    document.title = 'Tournaments — Beach Volleyball Partnership Graph';
  }, []);

  if (failed) {
    return (
      <main className="tournament-index">
        <p className="note">Could not load the tournament index.</p>
      </main>
    );
  }

  if (!filter) {
    return (
      <main className="tournament-index">
        <p className="note">Loading…</p>
      </main>
    );
  }

  return (
    <TournamentIndex
      rows={rows}
      filter={filter}
      onFilter={(next) => {
        const settled = reconcile(rows, next);
        const query = paramsFor(settled);
        history.pushState(null, '', `${indexPath(BASE)}${query ? `?${query}` : ''}`);
        setSearch(`?${query}`);
      }}
      tournamentHref={(slug) => tournamentPath(BASE, slug)}
      homeHref={BASE}
    />
  );
}
