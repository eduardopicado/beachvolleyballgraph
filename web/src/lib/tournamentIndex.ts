/**
 * Every published tournament, arranged so that one can be found.
 *
 * The graph answers "who played with whom" and a tournament page answers "what
 * happened at this event". Neither answers "what events are there" — a reader
 * could only reach a tournament page by opening a player first and clicking
 * through their timeline, so 1,610 pages had exactly one way in, and it ran
 * through a person.
 *
 * **One season at a time, and one draw.** 1,610 rows in a single list is not an
 * index, it is a haystack; and the men's and women's calendars run in parallel
 * rather than interleaving, so showing both at once doubles the page to say the
 * same thing twice. The reader picks a year and a draw and gets between 1 and
 * 52 rows — the whole calendar of that season, which is a list a person can
 * actually read.
 *
 * Kept separate from the component for the usual reason: which chips a season
 * offers, and what happens to a chip when the season changes underneath it, are
 * decisions with edge cases, and edge cases want unit tests rather than a
 * browser.
 */

import type { Gender, Tier, TournamentMeta } from '../schema';
import { TOUR_TIERS } from '../schema';
import { readTournament } from './tournamentMeta';
import { tournamentSlugs } from './slug';

/**
 * The four kinds of event the top chip row offers.
 *
 * Not the same list as `Tier`, and deliberately so: the World Tour and the
 * Beach Pro Tour are one thing to a reader — the tour — and became two tiers
 * only because FIVB rebranded in 2022. A reader looking for "tour events in
 * 2019" should not have to know that the answer lives under a different name
 * than it does in 2023.
 */
export type TierGroup = 'olympics' | 'world-champs' | 'tour' | 'age-group-wch';

/**
 * Chip order, fixed rather than derived.
 *
 * Ordered by what a reader is most likely to be looking for, not by how many
 * tournaments each holds — which would put the tour's 1,478 first and the
 * Olympics' 16 last, burying the one row of a season that everybody knows the
 * name of.
 */
export const TIER_GROUPS: readonly TierGroup[] = [
  'olympics',
  'world-champs',
  'tour',
  'age-group-wch',
];

export const TIER_GROUP_LABEL: Record<TierGroup, string> = {
  olympics: 'Olympics',
  'world-champs': 'Worlds',
  tour: 'Tour',
  'age-group-wch': 'Youth',
};

/** Which chip a tier belongs under. */
export function tierGroupOf(tier: Tier): TierGroup {
  // `TOUR_TIERS` rather than listing the two here: the ingest counts tour
  // podiums off that same set and the card filters off it, and a third copy
  // would eventually disagree with both (see its comment in schema.ts).
  if (TOUR_TIERS.has(tier)) return 'tour';
  return tier as Exclude<Tier, 'world-tour' | 'beach-pro-tour'>;
}

/** One row of the index — a tournament, with everything the list draws. */
export interface IndexRow {
  /** The page it links to, built over the same set the prerenderer uses. */
  slug: string;
  /** FIVB's own code, which is what addresses the published classification. */
  code: string;
  name: string;
  season: number;
  gender: Gender;
  tier: Tier;
  group: TierGroup;
  level: string | null;
  /** ISO-2 of the venue's country; null where VIS has none usable (§25). */
  country: string | null;
  start: Date | null;
  end: Date | null;
}

/** Rebuild the calendar date a signed day offset stands for. */
function dateOf(season: number, offset: number | null): Date | null {
  return offset === null ? null : new Date(Date.UTC(season, 0, 1) + offset * 86_400_000);
}

/**
 * Every tournament that has a page, in calendar order within each season.
 *
 * `hasField` is the same predicate the prerenderer applies, and it must stay
 * that way: `tournamentSlugs` appends FIVB's code to every member of a
 * colliding group, so a set that differs by one row can resolve a collision
 * differently and send this index at a URL that was never written. The two
 * sides share the fact rather than each deciding it — see `Manifest.withoutField`.
 *
 * Ascending by date inside a season, which is the order a calendar is read in.
 * The rest of the site reads most-recent-first, and that is right for a career:
 * a timeline is a history, where the newest row is the one you came for. A
 * season is not a history, it is a schedule, and a schedule that starts in
 * December is a schedule read backwards.
 */
export function buildIndex(
  tournaments: Record<string, TournamentMeta>,
  hasField: (code: string) => boolean,
): IndexRow[] {
  const facts = Object.values(tournaments)
    .map(readTournament)
    .filter(
      (t): t is ReturnType<typeof readTournament> & { code: string; gender: Gender } =>
        !!t.code && !!t.gender && hasField(t.code),
    );

  const slugs = tournamentSlugs(facts, (t) => ({
    name: t.name,
    season: t.season,
    gender: t.gender,
    code: t.code,
  }));

  return facts
    .map((t) => {
      const start = dateOf(t.season, t.startOffset);
      return {
        slug: slugs.get(t)!,
        code: t.code,
        name: t.name,
        season: t.season,
        gender: t.gender,
        tier: t.tier,
        group: tierGroupOf(t.tier),
        level: t.level,
        country: t.country,
        start,
        // Null when the span is missing or runs backwards — MOST1995 ends 29
        // days before it starts (quirks §25), and a range drawn from that
        // would read as an event that finished the previous month.
        end:
          start && t.span !== null && t.span >= 0 ? dateOf(t.season, (t.startOffset ?? 0) + t.span) : null,
      };
    })
    .sort(
      (a, b) =>
        a.season - b.season ||
        // A row with no date sorts last within its season rather than at the
        // epoch, where it would open a calendar it has no place in.
        (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The seasons that have anything in the given draw, newest first.
 *
 * Per gender rather than once for the whole archive, because the two calendars
 * do not start together: the women's tour has nothing before 1992, so a rail
 * built from every season would offer a reader on the women's index five years
 * that go nowhere.
 */
export function seasonsFor(rows: readonly IndexRow[], gender: Gender): number[] {
  const seasons = new Set<number>();
  for (const row of rows) if (row.gender === gender) seasons.add(row.season);
  return [...seasons].sort((a, b) => b - a);
}

/**
 * The published season closest to the one asked for.
 *
 * The season field is typed into, so it sees half-finished and simply wrong
 * years on the way to a real one: `202`, `1066`, and — the case that matters —
 * 1990 on the women's draw, which has nothing before 1992. `reconcile` would
 * answer all three with the newest season, and jumping from a typed 1990 to
 * 2026 reads as the control rejecting you rather than helping.
 *
 * Ties go to the earlier season, which only arises for a year exactly between
 * two published ones — and the choice matters less than its being fixed, since
 * an unstable answer would move the list while a reader is still typing.
 */
export function nearestSeason(rows: readonly IndexRow[], gender: Gender, wanted: number): number | null {
  const seasons = seasonsFor(rows, gender);
  if (seasons.length === 0) return null;
  return seasons.reduce((best, season) =>
    Math.abs(season - wanted) < Math.abs(best - wanted) ||
    (Math.abs(season - wanted) === Math.abs(best - wanted) && season < best)
      ? season
      : best,
  );
}

/** The tier chips this slice can offer, in the fixed order above. */
export function groupsIn(rows: readonly IndexRow[]): TierGroup[] {
  const present = new Set(rows.map((r) => r.group));
  return TIER_GROUPS.filter((g) => present.has(g));
}

/** A level and how many tournaments of the slice carry it. */
export interface LevelCount {
  level: string;
  count: number;
}

/**
 * Order the level chips of one season.
 *
 * The hard constraint is in `LEVEL_BY_TYPE` (ingest/tiers.ts): FIVB renumbered
 * its hierarchy twice — Open/Challenger/Satellite, then 1-to-5-star, then
 * Elite16/Challenge/Futures — and no mapping across those eras survives, so
 * these are era-native labels and *not* a scale. Anything that ranks a
 * "Grand Slam" against a "4-star" is inventing a fact the archive does not
 * hold.
 *
 * Within one season the labels do come from a single era, which is the whole
 * reason this row is per-season. What is still missing is any published field
 * saying which of that season's levels sits above which — so the order here is
 * the one fact the archive does hold: how much of the season each level was.
 *
 * The obvious alternative was rarity, on the theory that the top level is
 * always the smallest. It is a good story and the data refuses it: 2025's
 * Elite16 (12 events) is not rarer than its Challenge (7), 2005's Open (11)
 * outnumbers its Satellite (10) while ranking above it, and 2019's star
 * ratings come out shuffled entirely. Ordering by rarity would state a
 * hierarchy the archive contradicts three seasons out of four.
 *
 * Alphabetical is honest too, and was rejected only because it is arbitrary
 * where this is not: "Challenge, Elite16, Futures" tells a reader nothing,
 * while "Futures, Elite16, Challenge" says what the 2025 season was mostly
 * made of. Ties break alphabetically so the row cannot reorder between
 * renders — 1996's women's season held a Grand Slam, an Open and a Challenger
 * at one event each.
 */
export function compareLevels(a: LevelCount, b: LevelCount): number {
  return b.count - a.count || a.level.localeCompare(b.level);
}

/**
 * The level chips this slice can offer.
 *
 * Only the levels actually present: a 2025 reader is offered Elite16,
 * Challenge and Futures, and a 2019 reader six star ratings, because those are
 * what those seasons held. A fixed list of all fifteen would be mostly dead
 * chips in every season.
 */
export function levelsIn(rows: readonly IndexRow[]): LevelCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.level) counts.set(row.level, (counts.get(row.level) ?? 0) + 1);
  }
  return [...counts]
    .map(([level, count]) => ({ level, count }))
    .sort(compareLevels);
}

/** What the reader has narrowed to. Season and draw are always set. */
export interface IndexFilter {
  gender: Gender;
  season: number;
  group: TierGroup | null;
  level: string | null;
}

/** The rows of one season and draw, before the chips narrow them further. */
export function sliceOf(rows: readonly IndexRow[], gender: Gender, season: number): IndexRow[] {
  return rows.filter((r) => r.gender === gender && r.season === season);
}

/** Apply the chips to a slice. */
export function applyFilter(rows: readonly IndexRow[], filter: IndexFilter): IndexRow[] {
  return sliceOf(rows, filter.gender, filter.season).filter(
    (r) => (!filter.group || r.group === filter.group) && (!filter.level || r.level === filter.level),
  );
}

/**
 * Drop the parts of a filter the archive cannot honour, so no combination of
 * clicks can leave a reader looking at an empty page with every chip lit.
 *
 * Every one of these is reachable in two clicks. Flipping to the women's draw
 * on 1990 asks for a season that has no women's tournaments at all; flipping
 * while "Elite16" is selected asks for a level that season never held; picking
 * "Olympics" in a non-Olympic year asks for a tier group that is not there. The
 * alternative — disabling every control that would come up empty — means
 * computing the result of every possible click on every render, and it still
 * leaves the reader stranded when the season changes underneath a chip.
 *
 * Narrowest thing first: a level is more specific than a tier group, so a
 * filter that has both and can keep only one keeps the group.
 */
export function reconcile(rows: readonly IndexRow[], filter: IndexFilter): IndexFilter {
  const seasons = seasonsFor(rows, filter.gender);
  // An empty archive has no season to fall back to; keep what was asked for
  // rather than inventing one, and let the caller render "nothing published".
  const season = seasons.includes(filter.season) ? filter.season : (seasons[0] ?? filter.season);

  const slice = sliceOf(rows, filter.gender, season);
  const group = filter.group && groupsIn(slice).includes(filter.group) ? filter.group : null;

  // Levels are read after the group is settled, because the group narrows
  // which levels are still on offer: "Elite16" plus "Olympics" is a pair of
  // chips that can never both be true.
  const withinGroup = group ? slice.filter((r) => r.group === group) : slice;
  const level =
    filter.level && levelsIn(withinGroup).some((l) => l.level === filter.level)
      ? filter.level
      : null;

  return { gender: filter.gender, season, group, level };
}
