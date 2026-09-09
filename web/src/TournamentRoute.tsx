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
import type { Gender, Manifest, SeriesFile, TournamentsFile } from './schema';
import { fetchManifest, fetchSeries, fetchSeriesIndex, fetchTournaments } from './lib/api';
import { readTournament } from './lib/tournamentMeta';
import { tournamentPath, tournamentSlugs } from './lib/slug';
import { sliceSlug } from './lib/slug';
import { useClassification } from './lib/useClassification';
import { useEntries } from './lib/useEntries';
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

/** Reconstruct the calendar date a day offset stands for. */
function dateOf(season: number, offset: number | null): Date | null {
  return offset === null ? null : new Date(Date.UTC(season, 0, 1) + offset * 86_400_000);
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

  /** The row this slug names, with its facts already read out of the tuple. */
  const found = useMemo(() => {
    if (!tournaments) return null;
    const rows = Object.entries(tournaments.tournaments).map(([no, meta]) => ({
      no,
      ...readTournament(meta),
    }));
    // Only rows that can have a page: one with no code has no classification
    // to show, and one with no gender comes from a tree published before that
    // field existed, so its slug cannot be built.
    const addressable = rows.filter(
      (r): r is typeof r & { code: string; gender: Gender } => !!r.code && !!r.gender,
    );
    const slugs = tournamentSlugs(addressable, (r) => ({
      name: r.name,
      season: r.season,
      gender: r.gender,
      code: r.code,
    }));
    for (const row of addressable) if (slugs.get(row) === slug) return row;
    return null;
  }, [tournaments, slug]);

  const classification = useClassification(found?.code ?? null);

  // Only for an event with no field: a played one has a classification, and
  // fetching an entry list that was never written would be a guaranteed 404.
  //
  // `played` is read from the manifest rather than carried on the row: this
  // route resolves a slug out of the tuple index and has no other reason to
  // know which tournaments have a field.
  const played = !found || !(manifest?.withoutField ?? []).includes(found.code);
  const entries = useEntries(found && !played ? found.code : null);

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

  const data: TournamentPageData = {
    name: found.name,
    season: found.season,
    tier: found.tier,
    level: found.level,
    gender: found.gender,
    country: found.country,
    start: dateOf(found.season, found.startOffset),
    // Null when the span is missing or runs backwards: MOST1995 ends 29 days
    // before it starts (quirks §25) and a reversed range is worse than none.
    end:
      found.span !== null && found.span >= 0 && found.startOffset !== null
        ? dateOf(found.season, found.startOffset + found.span)
        : null,
  };

  return (
    <TournamentPage
      tournament={data}
      state={classification}
      iso2Of={iso2Of}
      homeHref={BASE}
      entries={entries}
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
