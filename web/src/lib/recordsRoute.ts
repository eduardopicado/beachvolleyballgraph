/**
 * The address of the records page, and the draw carried in its query.
 *
 * The same shape as `indexRoute.ts`, and for the same reason: the draw lives
 * in the URL, so `/records/?gender=W` is a link a reader can send, and the
 * back button walks a reader's own switching rather than leaving the site.
 */

import type { Gender } from '../../../shared/schema';
import { GENDERS } from '../../../shared/schema';
import { isPagePath } from './indexRoute';

export const RECORDS_PREFIX = 'records';

/** The page, not the data file — that is `recordsPath` in schema.ts. */
export const recordsPagePath = (base: string) => `${base}${RECORDS_PREFIX}/`;

export const isRecordsPath = (pathname: string, base: string) => isPagePath(pathname, base, RECORDS_PREFIX);

/** The men's draw unless the query names the other; anything unreadable is the default. */
export function genderFromParams(params: URLSearchParams): Gender {
  return GENDERS.find((g) => g === params.get('gender')) ?? 'M';
}

/** The query for a draw, empty at the default so the commonest view has the shortest URL. */
export const paramsForGender = (gender: Gender) => (gender === 'M' ? '' : 'gender=W');
