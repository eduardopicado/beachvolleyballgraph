import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { tournamentSlugFromPath } from './lib/tournamentRoute';
import { isIndexPath } from './lib/indexRoute';
import { isRecordsPath } from './lib/recordsRoute';
import './theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

/*
 * Four pages, chosen once at mount. `App` is the graph and everything around
 * it; `TournamentRoute` is a single tournament; `TournamentIndexRoute` is the
 * list of all of them; `RecordsRoute` is the archive's extremes. None of them
 * shares the others' state, so branching here rather than inside `App` keeps
 * each free of the others' concerns.
 *
 * Each is its own chunk, imported only once the address has chosen it. The
 * 1,600-odd tournament pages used to download the whole graph — the force
 * layout, the table, the player card — to draw a list of teams. The entry
 * chunk keeps only what choosing needs.
 *
 * Rendered after the import resolves rather than through `React.lazy`: every
 * page arrives with its prerendered HTML already in #root, and a Suspense
 * fallback would blank that while the chunk loads. Waiting leaves the static
 * page on screen until React has something to replace it with.
 *
 * The index and the records page are tested first because their paths are a
 * prefix of nothing and cannot be mistaken for a slug, whereas leaving either
 * to fall through would have `App` treat "tournaments" or "records" as a
 * country slice and quietly draw Brazil.
 */
const BASE = import.meta.env.BASE_URL;

async function page(): Promise<ReactElement> {
  if (isIndexPath(location.pathname, BASE)) {
    const { default: TournamentIndexRoute } = await import('./TournamentIndexRoute');
    return <TournamentIndexRoute />;
  }
  if (isRecordsPath(location.pathname, BASE)) {
    const { default: RecordsRoute } = await import('./RecordsRoute');
    return <RecordsRoute />;
  }
  const slug = tournamentSlugFromPath(location.pathname, BASE);
  if (slug) {
    const { default: TournamentRoute } = await import('./TournamentRoute');
    return <TournamentRoute slug={slug} />;
  }
  const { default: App } = await import('./App');
  return <App />;
}

void page().then((element) => createRoot(root).render(<StrictMode>{element}</StrictMode>));
