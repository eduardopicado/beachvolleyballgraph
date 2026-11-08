/**
 * Serves `/records/` — the archive's extremes.
 *
 * A fourth sibling to `App`, `TournamentRoute` and `TournamentIndexRoute`,
 * mounted in `main.tsx` on the same principle: it fetches `records.json` and
 * the manifest (for country names, which a record row carries only as a
 * federation code) and nothing else.
 *
 * The draw lives in the URL for the reason the index's filter does — see
 * `recordsRoute.ts`.
 */

import { useEffect, useState } from 'react';
import type { Gender, Manifest, RecordsFile } from '../../shared/schema';
import { GENDER_LABEL } from '../../shared/schema';
import { fetchManifest, fetchRecords } from './lib/api';
import { genderFromParams, paramsForGender, recordsPagePath } from './lib/recordsRoute';
import { Records } from './components/Records';

const BASE = import.meta.env.BASE_URL;

export default function RecordsRoute() {
  const [file, setFile] = useState<RecordsFile | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);
  const [gender, setGender] = useState<Gender>(() => genderFromParams(new URLSearchParams(location.search)));

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRecords(), fetchManifest()])
      .then(([r, m]) => {
        if (cancelled) return;
        setFile(r);
        setManifest(m);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPop = () => setGender(genderFromParams(new URLSearchParams(location.search)));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    // The draw is in the title because it is in the URL: two tabs open on the
    // two draws should not be indistinguishable in a tab bar.
    document.title = `Records — ${GENDER_LABEL[gender]} — Beach Volleyball Partnership Graph`;
  }, [gender]);

  if (failed) {
    return (
      <main className="records-page">
        <p className="note">Could not load the records.</p>
      </main>
    );
  }

  if (!file || !manifest) {
    return (
      <main className="records-page">
        <p className="note">Loading…</p>
      </main>
    );
  }

  return (
    <Records
      file={file}
      countries={manifest.countries}
      gender={gender}
      onGender={(next) => {
        if (next === gender) return;
        const query = paramsForGender(next);
        history.pushState(null, '', `${recordsPagePath(BASE)}${query ? `?${query}` : ''}`);
        setGender(next);
      }}
      base={BASE}
      homeHref={BASE}
      seasons={manifest.seasons}
    />
  );
}
