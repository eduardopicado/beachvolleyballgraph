/**
 * Resolves `/tournament/<slug>/` to a tournament and draws its page.
 *
 * A sibling of `App` rather than a branch inside it. `App` is the graph — a
 * slice, a card, a search box, a path finder — and every one of those is state
 * a tournament page has no use for. Mounting one or the other in `main.tsx`
 * keeps each free of the other's concerns, and keeps this page cheap: it
 * reads its own facts from the prerendered HTML (`TournamentPageFacts`) and
 * fetches one classification or entry list, and nothing else.
 *
 * **Without those facts it resolves the slug itself**, which is what the rest
 * of this comment describes: the dev server prerenders nothing, and a page
 * cached from before the facts existed has none.
 *
 * **The slug is resolved by rebuilding every slug, not by looking one up.**
 * There is no published slug->tournament map, and there should not be: a slug
 * is a function of name, season and gender, all three already in
 * `tournaments.json`, and a second file naming them again is a second thing to
 * keep in step. Rebuilding 1,610 slugs to match one is a few milliseconds
 * against a fetch that already happened.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Gender, Manifest, SeriesFile, Tier, TournamentsFile } from '../../shared/schema';
import { readFacts } from './lib/tournamentRoute';
import { fetchManifest, fetchSeries, fetchSeriesIndex, fetchTournaments } from './lib/api';
import { sliceSlug, tournamentPath } from '../../shared/slug';
import { indexPath, paramsFor } from './lib/indexRoute';
import { buildIndex, drawCounterpart } from './lib/tournamentIndex';
import { useClassification } from './lib/useClassification';
import { useEntries } from './lib/useEntries';
import { TournamentPage, type TournamentPageData } from './components/TournamentPage';

const BASE = import.meta.env.BASE_URL;

/*
 * FIVB's photographs, only in a build with `TOURNAMENT_PHOTOS=1`. The constant
 * is replaced at build time, so without the switch this is `false ? … : null`
 * and the import — the strip, its stylesheet, the photo file's address — is
 * dropped from the bundle rather than shipped and hidden (TournamentPhotos.tsx).
 */
const TournamentPhotos = __TOURNAMENT_PHOTOS__ ? lazy(() => import('./components/TournamentPhotos')) : null;

/** One tournament as this page uses it, from the facts or from the index. */
interface Resolved {
  code: string;
  name: string;
  season: number;
  gender: Gender;
  tier: Tier;
  level: string | null;
  country: string | null;
  start: Date | null;
  end: Date | null;
  played: boolean;
  counterpart: { gender: Gender; slug: string } | null;
  /** Country name and ISO-2 for a federation, where it has a published page. */
  federation: (code: string) => readonly [name: string, iso2: string | null] | undefined;
}

export default function TournamentRoute({ slug }: { slug: string }) {
  const facts = useMemo(() => readFacts(slug), [slug]);
  const [tournaments, setTournaments] = useState<TournamentsFile | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (facts) return;
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
  }, [facts]);

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

  /** The tournament this slug names: from the facts, or found in the index. */
  const found = useMemo((): Resolved | null => {
    if (facts) {
      const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
      return {
        ...facts,
        start: day(facts.start),
        end: day(facts.end),
        federation: (code) => facts.federations[code],
      };
    }
    const row = rows.find((r) => r.slug === slug);
    if (!row || !manifest) return null;
    const other = drawCounterpart(rows, row);
    const byCode = new Map(manifest.countries.map((c) => [c.code, [c.name, c.iso2] as const]));
    return {
      ...row,
      counterpart: other && { gender: other.gender, slug: other.slug },
      federation: (code) => byCode.get(code),
    };
  }, [facts, rows, slug, manifest]);

  // Each file only for the events that have one. A played event has a
  // classification and no entry list; one still to be decided has the
  // reverse. Asking for the other is a guaranteed 404 — and the classification
  // was being asked for on every entry-list page, where the page then ignores
  // it anyway (TournamentPage draws the entry list whenever `entries` is set).
  const classification = useClassification(found?.played ? found.code : null);
  const entries = useEntries(found && !found.played ? found.code : null);

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

  const iso2Of = useMemo(() => (federation: string) => found?.federation(federation)?.[1] ?? null, [found]);

  if (failed) {
    return (
      <main className="tournament-page">
        <p className="note">Could not load the tournament index.</p>
      </main>
    );
  }

  if (!facts && (!tournaments || !manifest)) {
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
        // Every listed event has a page now, an unplayed one included, so the
        // switch works across a draw whose half is still to be played.
        found.counterpart && { gender: found.counterpart.gender, href: tournamentPath(BASE, found.counterpart.slug) }
      }
      entries={entries}
      series={series}
      code={found.code}
      photos={
        // Only from the facts: the prerenderer counts the photo file, so a
        // page without one never asks for it.
        TournamentPhotos && facts?.photos ? (
          <Suspense fallback={null}>
            <TournamentPhotos code={found.code} count={facts.photos} />
          </Suspense>
        ) : undefined
      }
      editionHref={(slug) => tournamentPath(BASE, slug)}
      onSelectPlayer={(id, slice) => {
        // A full navigation rather than client-side state: the graph lives in
        // `App`, which is not mounted here, and its page is prerendered.
        const country = found.federation(slice.country);
        if (!country) return;
        location.href = `${BASE}${sliceSlug(country[0], slice.gender)}/?player=${id}`;
      }}
    />
  );
}
