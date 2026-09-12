/**
 * Grouping a tournament's field by placement.
 *
 * Shared by the panel a player card opens and the tournament's own page, which
 * draw the same data in different frames — a dialog over a card, and a page.
 * The grouping is the part that must not differ between them: a rank is a
 * bracket, not a position (quirks §5, §15), so eight teams finish 9th and any
 * renderer that lists them separately invents an order FIVB does not publish.
 */

import type { ClassificationFile } from '../schema';

export type Band = [rank: number, teams: ClassificationFile['teams']];

/** The field, grouped by placement and ordered best first. */
export function bandsOf(teams: ClassificationFile['teams']): Band[] {
  const byRank = new Map<number, ClassificationFile['teams']>();
  for (const team of teams) {
    let group = byRank.get(team[0]);
    if (!group) byRank.set(team[0], (group = []));
    group.push(team);
  }
  return [...byRank.entries()].sort(
    // Placements ascending, then everything eliminated before the main draw,
    // which is what a negative rank means.
    ([x], [y]) => Number(x < 0) - Number(y < 0) || x - y,
  );
}
