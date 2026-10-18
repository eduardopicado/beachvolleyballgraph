/**
 * Whether an address is a tournament's page, and which one.
 *
 * Its own module rather than an export of `TournamentRoute.tsx` so that
 * `main.tsx` can choose a page without importing one: the entry chunk asks
 * this question of every address, and answering it must not pull the
 * tournament page's code into the graph page's download.
 */

/** The slug out of `/tournament/gstaad-2019-women/`, or null if this is not one. */
export function tournamentSlugFromPath(pathname: string, base: string): string | null {
  const rest = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, ''))
    .replace(/index\.html$/, '')
    .replace(/^\/+|\/+$/g, '');
  const [prefix, slug, ...extra] = rest.split('/');
  if (prefix !== 'tournament' || !slug || extra.length) return null;
  return slug;
}
