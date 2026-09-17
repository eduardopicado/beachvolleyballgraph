/**
 * Strip diacritics and case, so "Joao" finds "João" and "Ozols" finds "Ozols"
 * however either is typed.
 *
 * Beach volleyball is played almost everywhere, and this archive is full of
 * names a reader cannot reasonably be expected to reproduce exactly:
 * "Bárbara Seixas de Freitas", "Márton Szabó", "Kristīne Puriņa". Typing the
 * plain-ASCII form is the normal case, not the degraded one — before this,
 * searching "Barbara" found nothing at all, which is indistinguishable from
 * "she isn't in the data".
 *
 * NFD splits a precomposed letter into its base plus a combining mark, which
 * `\p{Diacritic}` then removes. Deliberately *not* symmetric with a locale
 * collator: `localeCompare` with sensitivity options can only compare whole
 * strings, and this needs substring matching.
 *
 * Lives here rather than in the app's search module because the ingest folds
 * with it too — to build the search index, and to match player aliases — and
 * the two sides have to fold identically or a name indexed one way is looked
 * up another. Anything that changes this function changes what is published.
 */
export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
