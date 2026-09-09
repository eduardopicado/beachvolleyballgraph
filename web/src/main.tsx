import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TournamentRoute, { tournamentSlugFromPath } from './TournamentRoute';
import './theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

/*
 * Two pages, chosen once at mount. `App` is the graph and everything around
 * it; `TournamentRoute` is a single tournament, which shares none of that
 * state. Branching here rather than inside `App` keeps each one from carrying
 * the other's concerns — and keeps a tournament page from loading a graph it
 * never draws.
 */
const slug = tournamentSlugFromPath(location.pathname, import.meta.env.BASE_URL);

createRoot(root).render(
  <StrictMode>{slug ? <TournamentRoute slug={slug} /> : <App />}</StrictMode>,
);
