/**
 * The address of the tournament index, and the filter carried in its query.
 *
 * Split from the component for the same reason the rest of `lib/` is: these
 * are the parts with edge cases — a hand-typed season, a stale link to a
 * level that no longer exists, a path that only looks like the index — and
 * edge cases want unit tests rather than a browser.
 */

import { GENDERS } from '../schema';
import { TIER_GROUPS, type IndexFilter } from './tournamentIndex';

/** One path segment, plural against the singular tournament page. */
export const INDEX_PREFIX = 'tournaments';

export const indexPath = (base: string) => `${base}${INDEX_PREFIX}/`;

/**
 * True when this pathname is the index rather than a tournament or a slice.
 *
 * Matched exactly, never as a prefix: `/tournaments/` is the index and
 * `/tournament/gstaad-2019-women/` is a page, and the two differ by one
 * letter. A prefix match would also swallow anything published beneath the
 * index later.
 */
export function isIndexPath(pathname: string, base: string): boolean {
  const rest = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, ''))
    .replace(/index\.html$/, '')
    .replace(/^\/+|\/+$/g, '');
  return rest === INDEX_PREFIX;
}

/**
 * Read a filter out of the query string.
 *
 * Every field is validated against what the archive can offer rather than
 * merely parsed — `?season=1066` and `?gender=X` are both one keystroke away,
 * and `?level=Grand%20Slam` on a 2025 page is what an old link looks like.
 * `reconcile` repairs the rest; this only has to hand it something of the
 * right shape.
 */
export function filterFromParams(params: URLSearchParams, fallbackSeason: number): IndexFilter {
  const gender = GENDERS.find((g) => g === params.get('gender')) ?? 'M';
  const season = Number(params.get('season'));
  const group = TIER_GROUPS.find((g) => g === params.get('tier')) ?? null;
  return {
    gender,
    season: Number.isInteger(season) && season > 0 ? season : fallbackSeason,
    group,
    level: params.get('level'),
  };
}

/**
 * The query string for a filter, omitting anything at its default.
 *
 * The men's draw and an unset chip write nothing, so the commonest view has
 * the shortest URL and two readers who navigated differently to the same
 * slice end up at the same address.
 */
export function paramsFor(filter: IndexFilter): string {
  const params = new URLSearchParams();
  if (filter.gender !== 'M') params.set('gender', filter.gender);
  params.set('season', String(filter.season));
  if (filter.group) params.set('tier', filter.group);
  if (filter.level) params.set('level', filter.level);
  return params.toString();
}
