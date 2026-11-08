/**
 * Whether an address is a tournament's page, which one, and what the
 * prerenderer wrote into that page about it.
 *
 * Its own module rather than an export of `TournamentRoute.tsx` so that
 * `main.tsx` can choose a page without importing one: the entry chunk asks
 * this question of every address, and answering it must not pull the
 * tournament page's code into the graph page's download.
 */

import type { TournamentPageFacts } from '../../../shared/schema';
import { TOURNAMENT_FACTS_ID } from '../../../shared/schema';

/** The slug out of `/tournament/gstaad-2019-women/`, or null if this is not one. */
export function tournamentSlugFromPath(pathname: string, base: string): string | null {
  const rest = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, ''))
    .replace(/index\.html$/, '')
    .replace(/^\/+|\/+$/g, '');
  const [prefix, slug, ...extra] = rest.split('/');
  if (prefix !== 'tournament' || !slug || extra.length) return null;
  return slug;
}

/**
 * The facts the prerenderer wrote into this page, if it wrote any for this
 * address. A mismatched slug would be a page served under the wrong path; the
 * fetch is the safe answer to that as much as to no facts at all.
 */
export function readFacts(slug: string, doc: Pick<Document, 'getElementById'> = document): TournamentPageFacts | null {
  const text = doc.getElementById(TOURNAMENT_FACTS_ID)?.textContent;
  if (!text) return null;
  try {
    const facts = JSON.parse(text) as TournamentPageFacts;
    return facts.slug === slug ? facts : null;
  } catch {
    return null;
  }
}
