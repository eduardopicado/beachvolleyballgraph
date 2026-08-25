/**
 * Which federation a partnership actually represented, event by event.
 *
 * A player's federation in VIS is a snapshot of today. Using it to describe a
 * partnership from twenty years ago states something false — Pedro Solberg and
 * Tiago De J Santos played one event together in 2005, both Brazilian, and the
 * card attributed it to Qatar because that is where Tiago went in 2013.
 *
 * FIVB stamps a federation on the team entry itself, and that is the thing
 * that was true at the time. This resolves it, because the raw field is not
 * always unambiguous: a team row exists per pair *per tournament*, a pair can
 * be entered twice for one event (qualification and main draw, or an entry
 * withdrawn and re-made), and those duplicate rows occasionally disagree.
 */

/**
 * Codes that are not a country.
 *
 * `ZZZ` is VIS's own placeholder. `FIV` appears on entries administered by
 * FIVB rather than by a member federation. Neither should ever win a conflict
 * against a real federation, and neither should be shown to a reader as the
 * country a pair represented.
 *
 * Deliberately a list rather than "anything not in the federation index":
 * a code missing from the index is more likely a gap in our lookup than a
 * placeholder, and silently discarding it would lose real history.
 */
export const PLACEHOLDER_FEDERATIONS = new Set(['ZZZ', 'FIV', '', 'XXX']);

export interface FederationConflict {
  /** Tournament number, and the pair, so the row can be found again. */
  tournament: string;
  a: number;
  b: number;
  season: number;
  /** Every code the duplicate rows carried, as they came from VIS. */
  saw: string[];
  chose: string;
  why: 'placeholder' | 'season-majority' | 'arbitrary';
}

/**
 * Pick one federation for a pair at one event.
 *
 * The rule, in order:
 *
 *  1. Ignore placeholders. Almost always this leaves exactly one code.
 *  2. Otherwise prefer the code that the two players' *other* entries that
 *     season carry. This is what keeps a legend out of the wrong country:
 *     Taiana Lima has exactly two non-Brazilian rows in the archive, both
 *     tagged AZE on 2010 events she entered with Vivian Cunha, who moved to
 *     Azerbaijan in 2015. The AZE rows carry higher team ids than Vivian's
 *     genuine 2015 Azerbaijani entries, so they were written later — a
 *     retroactive edit reaching back onto old entries. Every other 2010 row
 *     for both women says BRA, so BRA wins and Taiana stays Brazilian.
 *  3. Failing that, the alphabetically first, so a rebuild is reproducible.
 *
 * A tie broken at step 3 is a genuine unknown and the caller is expected to
 * report it rather than swallow it: four events in the published archive reach
 * step 2, and if a future edit creates a fifth we want to look at it rather
 * than find out from a screenshot.
 */
export function resolveFederation(
  codes: readonly string[],
  seasonCodes: ReadonlyMap<string, number>,
): { code: string; why: FederationConflict['why'] | 'only' } | null {
  const seen = [...new Set(codes.map((c) => c.trim().toUpperCase()))].filter((c) => c);
  if (seen.length === 0) return null;

  const real = seen.filter((c) => !PLACEHOLDER_FEDERATIONS.has(c));
  if (real.length === 0) return null;
  // `only` means nothing had to be decided — the overwhelming majority of
  // entries, and the caller reports everything else.
  if (real.length === 1) return { code: real[0]!, why: seen.length === 1 ? 'only' : 'placeholder' };

  // More than one real code. Let the pair's own season break the tie.
  const ranked = [...real].sort(
    (x, y) => (seasonCodes.get(y) ?? 0) - (seasonCodes.get(x) ?? 0) || x.localeCompare(y),
  );
  const best = ranked[0]!;
  const runnerUp = ranked[1]!;
  const decided = (seasonCodes.get(best) ?? 0) > (seasonCodes.get(runnerUp) ?? 0);
  return { code: best, why: decided ? 'season-majority' : 'arbitrary' };
}

/** Collapse `[season, fed]` pairs into the shape the card reads. */
export function federationSpans(
  bySeason: ReadonlyMap<number, string>,
): [season: number, fed: string][] {
  return [...bySeason.entries()].sort((a, b) => a[0] - b[0]);
}
