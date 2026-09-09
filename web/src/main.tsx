import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TournamentRoute, { tournamentSlugFromPath } from './TournamentRoute';
import TournamentIndexRoute from './TournamentIndexRoute';
import { isIndexPath } from './lib/indexRoute';
import './theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

/*
 * Three pages, chosen once at mount. `App` is the graph and everything around
 * it; `TournamentRoute` is a single tournament; `TournamentIndexRoute` is the
 * list of all of them. None of the three shares the others' state, so
 * branching here rather than inside `App` keeps each free of the others'
 * concerns — and keeps a tournament page from loading a graph it never draws.
 *
 * The index is tested first because its path is a prefix of nothing and
 * cannot be mistaken for a slug, whereas leaving it to fall through would
 * have `App` treat "tournaments" as a country slice and quietly draw Brazil.
 */
const BASE = import.meta.env.BASE_URL;
const slug = tournamentSlugFromPath(location.pathname, BASE);

createRoot(root).render(
  <StrictMode>
    {isIndexPath(location.pathname, BASE) ? (
      <TournamentIndexRoute />
    ) : slug ? (
      <TournamentRoute slug={slug} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
