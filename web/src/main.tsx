import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { tournamentSlugFromPath } from './lib/tournamentRoute';
import { isIndexPath } from './lib/indexRoute';
import { isRecordsPath } from './lib/recordsRoute';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
// Our own copy of the font, not the package's default jsDelivr URL: a reader
// on Windows should not have their visit announced to a third-party CDN for a
// set of flags, and the site should not stop drawing them the day that CDN
// path moves. Vite fingerprints it and serves it from /assets/.
import flagFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import './theme.css';
// Not used by the app: the standalone documents prerender.ts writes borrow the
// app's one stylesheet, and this is their part of it.
import './StaticPage.css';

/*
 * Flags on Windows. Every flag on the site is an emoji — regional-indicator
 * pairs from `flagEmoji` — and Windows ships no glyphs for them, so Chrome and
 * Edge there draw the two letters instead: "BR" beside Brazil, in the country
 * picker, every classification and the tournament index. Not a bug Chromium
 * intends to fix; it defers to the OS.
 *
 * This loads a 78 KB font holding nothing but flags, and only where it is
 * needed: the polyfill draws one flag to a canvas, and injects the @font-face
 * only if the browser renders colour emoji but not that flag. Everywhere else
 * — macOS, iOS, Android, Linux, Firefox on Windows — it does nothing and the
 * font is never fetched. The face is declared with a `unicode-range` covering
 * only the flag code points, so putting it first in `--font` (theme.css) takes
 * no other character away from the system font.
 *
 * Called before the first render so the flags in the first paint already use
 * it; `font-display: swap` means the letters show for the instant before the
 * font arrives rather than blank space.
 */
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFontUrl);

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
