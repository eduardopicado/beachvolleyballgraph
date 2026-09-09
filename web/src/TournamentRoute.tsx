/**
 * Resolves `/tournament/<slug>/` to a tournament and draws its page.
 *
 * A sibling of `App` rather than a branch inside it. `App` is the graph — a
 * slice, a card, a search box, a path finder — and every one of those is state
 * a tournament page has no use for. Mounting one or the other in `main.tsx`
 * keeps each free of the other's concerns, and keeps this page cheap: it
 * fetches the tournament index and one classification, and nothing else.
 *
 * **The slug is resolved by rebuilding every slug, not by looking one up.**
 * There is no published slug->tournament map, and there should not be: a slug
 * is a function of name, season and gender, all three already in
 * `tournaments.json`, and a second file naming them again is a second thing to
 * keep in step. Rebuilding 1,610 slugs to match one is a few milliseconds
 * against a fetch that already happened.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Manifest, SeriesFile, TournamentsFile } from './schema';
import { fetchManifest, fetchSeries, fetchSeriesIndex, fetchTournaments } from './lib/api';
import { sliceSlug, tournamentPath } from './lib/slug';
import { indexPath, paramsFor } from './lib/indexRoute';
import { buildIndex, drawCounterpart } from './lib/tournamentIndex';
import { useClassification } from './lib/useClassification';
import { TournamentPage, type TournamentPageData } from './components/TournamentPage';

const BASE = import.meta.env.BASE_URL;

/** The slug out of `/tournament/gstaad-2019-women/`, or null if this is not one. */
export function tournamentSlugFromPath(pathname: string, base: string): string | null {
  const rest = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, ''))
    .replace(/index\.html$/, '')
    .replace(/^\/+|\/+$/g, '');
  const [prefix, slug, ...extra] = rest.split('/');
  if (prefix !== 'tournament' || !slug || extra.length) return null;
  return slug;
}

export default function TournamentRoute({ slug }: { slug: string }) {
  const [tournaments, setTournaments] = useState<TournamentsFile | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);

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

  /*
   * Every addressable tournament, built by the function the index and the
   * prerenderer both use.
   *
   * This used to rebuild the set and its slugs inline, which worked and was a
   * third copy of a rule that must not drift: `tournamentSlugs` appends FIVB's
   * code to every member of a colliding group, so three callers deciding the
   * set independently is three chances for one of them to address a page the
   * others never wrote.
   */
  const rows = useMemo(() => {
    if (!tournaments || !manifest) return [];
    const withoutField = new Set(manifest.withoutField ?? []);
    return buildIndex(tournaments.tournaments, (code) => !withoutField.has(code));
  }, [tournaments, manifest]);

  /** The row this slug names. */
  const found = useMemo(() => rows.find((r) => r.slug === slug) ?? null, [rows, slug]);

  /** The same event's other draw, when it ran one. */
  const counterpart = useMemo(() => (found ? drawCounterpart(rows, found) : null), [rows, found]);

  const classification = useClassification(found?.code ?? null);

  /*
   * The series this edition belongs to, in two steps: the small index says
   * which, and only then is a series file fetched. Most tournaments are in
   * none and stop after the index — and a failure at either step leaves the
   * page without its edition list rather than without its classification,
   * which is the half that matters.
   */
  const [series, setSeries] = useState<SeriesFile[]>([]);
  useEffect(() => {
    const code = found?.code;
    if (!code) return;
    let cancelled = false;
    fetchSeriesIndex()
      .then((index) => {
        const slugs = index.of[code] ?? [];
        return slugs.length ? Promise.all(slugs.map(fetchSeries)) : [];
      })
      .then((files) => !cancelled && setSeries(files))
      .catch(() => !cancelled && setSeries([]));
    return () => {
      cancelled = true;
    };
  }, [found?.code]);

  useEffect(() => {
    if (found) document.title = `${found.name} ${found.season} — Beach Volleyball Partnership Graph`;
  }, [found]);

  const iso2Of = useMemo(() => {
    const byCode = new Map((manifest?.countries ?? []).map((c) => [c.code, c.iso2]));
    return (federation: string) => byCode.get(federation) ?? null;
  }, [manifest]);

  if (failed) {
    return (
      <main className="tournament-page">
        <p className="note">Could not load the tournament index.</p>
      </main>
    );
  }

  if (!tournaments || !manifest) {
    return (
      <main className="tournament-page">
        <p className="note">Loading…</p>
      </main>
    );
  }

  if (!found) {
    // A prerendered page exists for every addressable tournament, so this is
    // a hand-typed or stale URL rather than a routing failure.
    return (
      <main className="tournament-page">
        <h1>No such tournament</h1>
        <p className="note">
          Nothing in the archive is published at this address. <a href={BASE}>Start from the graph</a>.
        </p>
      </main>
    );
  }

  // The dates arrive already rebuilt: `buildIndex` applies the same rules this
  // used to repeat, including dropping a span that runs backwards — MOST1995
  // ends 29 days before it starts (quirks §25).
  const data: TournamentPageData = {
    name: found.name,
    season: found.season,
    tier: found.tier,
    level: found.level,
    gender: found.gender,
    country: found.country,
    start: found.start,
    end: found.end,
  };

  return (
    <TournamentPage
      tournament={data}
      state={classification}
      iso2Of={iso2Of}
      homeHref={BASE}
      indexHref={`${indexPath(BASE)}?${paramsFor({
        gender: found.gender,
        season: found.season,
        group: null,
        level: null,
      })}`}
      counterpart={
        // No link to a draw with no page: the other half of an event still to
        // be played has no field published, so there is nothing to open. The
        // switch is absent rather than dead.
        counterpart?.slug
          ? { gender: counterpart.gender, href: tournamentPath(BASE, counterpart.slug) }
          : null
      }
      series={series}
      code={found.code}
      editionHref={(slug) => tournamentPath(BASE, slug)}
      onSelectPlayer={(id, slice) => {
        // A full navigation rather than client-side state: the graph lives in
        // `App`, which is not mounted here, and its page is prerendered.
        const entry = manifest.countries.find((c) => c.code === slice.country);
        if (!entry) return;
        location.href = `${BASE}${sliceSlug(entry.name, slice.gender)}/?player=${id}`;
      }}
    />
  );
}
