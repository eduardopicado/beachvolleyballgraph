/**
 * Site identity, shared by the app, the prerenderer and the ingest client.
 *
 * The contact address lives here rather than in three string literals because
 * it is genuinely load-bearing in two unrelated places: it is what a reader
 * (or a sponsor) clicks in the footer, and it is what identifies this project
 * to FIVB in the `User-Agent` of every VIS request. Changing it in one and
 * not the other means either a dead link on 265 pages or an unreachable
 * scraper — the second being the one that gets you null-routed.
 */

export const SITE_NAME = 'Beach Volleyball Partnership Graph';

/**
 * The production origin, hard-coded rather than read from `SITE_URL` at
 * runtime: this constant is imported by `ingest/vis.ts` to build the default
 * `User-Agent`, which has to resolve even when nobody has set `SITE_URL` —
 * a local run, a fork, or `deploy-cloudflare.yml` before it is configured.
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
