/**
 * URL slugs for country x gender pages.
 *
 * Shared by the prerenderer (which writes `/brazil-men/index.html`) and the app
 * (which resolves that path back to a slice), so a link can never point at a
 * page the other side would not produce.
 */

import type { Gender } from '../schema';

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics: "Côte d'Ivoire" -> "Cote d'Ivoire"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const GENDER_SLUG: Record<Gender, string> = { M: 'men', W: 'women' };

/** e.g. ("Brazil", "M") -> "brazil-men" */
export function sliceSlug(countryName: string, gender: Gender): string {
  return `${slugify(countryName)}-${GENDER_SLUG[gender]}`;
}

/** Absolute site path for a slice, honouring the deploy base ("/" or "/repo/"). */
export function slicePath(base: string, countryName: string, gender: Gender): string {
  return `${base}${sliceSlug(countryName, gender)}/`;
}

/** Where every tournament page lives, under one path segment of its own. */
export const TOURNAMENT_PREFIX = 'tournament';

/**
 * e.g. ("Gstaad", 2019, "W") -> "gstaad-2019-women".
 *
 * Built from the venue name, the season and the gender rather than from
 * FIVB's code, because a code is unreadable — `WGST2019` says nothing to a
 * reader looking at a URL, and the whole point of a slug is that it does.
 *
 * **The gender must come from the classification, not from the code's first
 * letter.** `WWRS2022` is a field of 54 men (quirks §23), so reading the code
 * would file it under women and put it at a URL that contradicts the page.
 *
 * Ten of these collide, and `disambiguator` is how they are resolved — see
 * `tournamentSlugs` for why it is not applied unconditionally.
 */
/**
 * Does the event's own name already end with its season?
 *
 * True for the Olympics, which FIVB names "Paris 2024", and for a few others
 * like "BPT Finals Doha 2023" — 17 of the 1,610 published tournaments. Both
 * the slug and the heading have to know, or they print the year twice.
 */
export function nameCarriesSeason(name: string, season: number): boolean {
  return slugify(name).endsWith(`-${season}`);
}

export function tournamentSlug(
  name: string,
  season: number,
  gender: Gender,
  disambiguator?: string,
): string {
  const stem = slugify(name);
  // The season still has to be *in* the slug — two editions of an event named
  // without a year would otherwise collide — it just must not appear twice.
  const base = nameCarriesSeason(name, season) ? stem : `${stem}-${season}`;
  return `${base}-${GENDER_SLUG[gender]}` + (disambiguator ? `-${slugify(disambiguator)}` : '');
}

/**
 * Slugs for a whole set of tournaments, with FIVB's code appended only to the
 * ones that would otherwise collide.
 *
 * Measured on the published archive: 1,610 tournaments produce 1,598 distinct
 * name-season-gender slugs, so **10 groups covering 22 tournaments** need the
 * code. Two Sofia 2021 groups are three-way.
 *
 * The code is added to *every* member of a colliding group, never to just the
 * later ones. Appending it only to the loser would give one arbitrary member
 * the clean URL and make which one depends on iteration order — so the same
 * tournament's address could change when an unrelated event is added to the
 * archive. Every member of a clash carries its code; everything else stays
 * clean.
 *
 * Collisions are real events, not data faults: Sydney and Manly are both
 * "Sydney 2017" to VIS, and the two Phuket 2021 rows are the under-19 and
 * under-21 championships at one venue in one year.
 */
export function tournamentSlugs<T>(
  items: readonly T[],
  read: (item: T) => { name: string; season: number; gender: Gender; code: string },
): Map<T, string> {
  const bare = new Map<T, string>();
  const counts = new Map<string, number>();
  for (const item of items) {
    const { name, season, gender } = read(item);
    const slug = tournamentSlug(name, season, gender);
    bare.set(item, slug);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const out = new Map<T, string>();
  for (const item of items) {
    const slug = bare.get(item)!;
    out.set(item, (counts.get(slug) ?? 0) > 1 ? tournamentSlug(
      read(item).name,
      read(item).season,
      read(item).gender,
      read(item).code,
    ) : slug);
  }
  return out;
}

/** Absolute site path for a tournament page. */
export function tournamentPath(base: string, slug: string): string {
  return `${base}${TOURNAMENT_PREFIX}/${slug}/`;
}

/**
 * Resolve a pathname back to a slug, ignoring the deploy base and any
 * trailing "index.html". Returns null for the site root.
 */
export function slugFromPath(pathname: string, base: string): string | null {
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  rest = rest.replace(/index\.html$/, '').replace(/^\/+|\/+$/g, '');
  return rest === '' ? null : rest;
}
