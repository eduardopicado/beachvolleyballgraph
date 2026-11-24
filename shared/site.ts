/**
 * Site identity, shared by the app, the prerenderer and the ingest client.
 *
 * The contact address lives here rather than in three string literals because
 * it is genuinely load-bearing in two unrelated places: it is what a reader
 * (or a sponsor) clicks in the footer, and it is what identifies this project
 * to FIVB in the `User-Agent` of every VIS request. Changing it in one and
 * not the other means either a dead link on every page or an unreachable
 * scraper — the second being the one that gets you null-routed.
 */

import { GENDER_LABEL, type Gender } from './schema';

/**
 * The display name: page titles, link previews, llms.txt, the structured data.
 * Not the identity FIVB sees — the VIS `User-Agent` names the project by its
 * repository slug, and the address below stays. Every copy of the name reads
 * this constant except `web/index.html`, which cannot import it and which
 * prerender.ts overwrites on every page it writes.
 *
 * It names the sport because it is often all there is: a tab, a bookmark or
 * a link preview shows the name with nothing around it, and "Beach Partners"
 * alone could be a travel agent. It also matches the address. It follows
 * every page title ("Brazil Men — Beach Volleyball Partners"), so it is kept
 * to three words; it fits the phone bar on one line down to 320px.
 *
 * Careful when searching: the old name, "Beach Volleyball Partnership Graph",
 * contains this one ("Partners" is the start of "Partnership").
 */
export const SITE_NAME = 'Beach Volleyball Partners';

/**
 * The opening view: the country with the most players, men's draw. Here
 * rather than in App.tsx because `/about/` draws its legend from the same
 * graph, so the sizes it explains are the ones a reader arriving at `/` has
 * just seen.
 */
export const DEFAULT_COUNTRY = 'BRA';
export const DEFAULT_GENDER: Gender = 'M';

/**
 * The production origin, hard-coded rather than read from `SITE_URL` at
 * runtime: this constant is imported by `ingest/vis.ts` to build the default
 * `User-Agent`, which has to resolve even when nobody has set `SITE_URL` —
 * a local run, a fork, or a deploy before `SITE_URL` is configured.
 * `SITE_URL` at build time can still override the site's own canonical URLs;
 * this is only the fallback identity FIVB sees.
 */
export const SITE_URL = 'https://beachvolleyball.com.br';

/**
 * An alias, deliberately, not a personal mailbox: this string is sent to a
 * third party on every ingest run and published on every page, so it should
 * be something that can be rotated without touching a personal address.
 */
export const CONTACT_EMAIL = 'beachgraph@picado.com.br';

/** Where the data comes from. Credited on every page and in the About text. */
export const SOURCE_NAME = 'FIVB VIS Web Service';
export const SOURCE_URL = 'https://www.fivb.org/VisSDK/VisWebService/';

/**
 * The title and description of a country x gender page.
 *
 * Written twice until now — once by the prerenderer into the static HTML,
 * once by the app into the head as a reader switches slices — and the two
 * have to match: the static copy is what a crawler indexes and what a link
 * preview shows, the live one is what the tab says after a switch. Two
 * template literals agreed only because both were edited together.
 */
export function sliceHead(
  countryName: string,
  gender: Gender,
  counts: { players: number; partnerships: number },
  from: number,
): { title: string; description: string } {
  const label = GENDER_LABEL[gender];
  return {
    title: `${countryName} ${label} — ${SITE_NAME}`,
    description: `Every ${label.toLowerCase()}'s beach volleyball player from ${countryName} who has competed on the FIVB World Tour, Beach Pro Tour, World Championships or Olympic Games — ${counts.players} players and ${counts.partnerships} partnerships since ${from}.`,
  };
}
