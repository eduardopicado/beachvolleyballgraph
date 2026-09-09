import { describe, expect, it } from 'vitest';
import type { TournamentMeta } from '../schema';
import {
  applyFilter,
  buildIndex,
  compareLevels,
  drawCounterpart,
  defaultSeason,
  groupsIn,
  levelsIn,
  nearestSeason,
  reconcile,
  seasonsFor,
  sliceOf,
  tierGroupOf,
  TIER_GROUPS,
  type IndexRow,
} from './tournamentIndex';

/**
 * A published row, with the fields a test cares about named.
 *
 * The nine-element form throughout, because that is what the ingest writes for
 * anything with a page — the shorter arities exist for rows with no code, and
 * those are exactly the rows the index drops.
 */
function meta(o: {
  name: string;
  season: number;
  tier?: TournamentMeta[2];
  offset?: number | null;
  code: string;
  level?: string | null;
  country?: string | null;
  span?: number | null;
  gender?: 'M' | 'W';
}): TournamentMeta {
  return [
    o.name,
    o.season,
    o.tier ?? 'world-tour',
    o.offset === undefined ? 100 : o.offset,
    o.code,
    o.level ?? null,
    o.country ?? 'CH',
    o.span ?? 3,
    o.gender ?? 'M',
  ];
}

/** Every code has a field unless a test says otherwise. */
const all = (_code: string) => true;

const index = (rows: Record<string, TournamentMeta>, hasField: (code: string) => boolean = all) =>
  buildIndex(rows, hasField);

describe('tierGroupOf', () => {
  it('folds both tour tiers into one group', () => {
    expect(tierGroupOf('world-tour')).toBe('tour');
    expect(tierGroupOf('beach-pro-tour')).toBe('tour');
  });

  it('leaves every other tier as a group of its own', () => {
    expect(tierGroupOf('olympics')).toBe('olympics');
    expect(tierGroupOf('world-champs')).toBe('world-champs');
    expect(tierGroupOf('age-group-wch')).toBe('age-group-wch');
  });
});

describe('buildIndex', () => {
  it('keeps only rows that carry a code, a gender and a field', () => {
    const rows = index(
      {
        1: meta({ name: 'Gstaad', season: 2019, code: 'MGST2019' }),
        // No code: an old row whose tuple stops at the tier.
        2: ['Rio', 1994, 'world-tour'],
        // A code but no gender: published before the field existed.
        3: ['Berlin', 1996, 'world-tour', 100, 'MBER1996'],
        // Code and gender, but FIVB publishes no field — a cancelled event.
        4: meta({ name: 'Kiev', season: 2003, code: 'MKIE2003' }),
      },
      (code) => code !== 'MKIE2003',
    );
    expect(rows.map((r) => r.name)).toEqual(['Gstaad']);
  });

  it('orders a season as a calendar reads, earliest first', () => {
    const rows = index({
      1: meta({ name: 'August', season: 2019, offset: 220, code: 'MAUG2019' }),
      2: meta({ name: 'March', season: 2019, offset: 70, code: 'MMAR2019' }),
      3: meta({ name: 'June', season: 2019, offset: 160, code: 'MJUN2019' }),
    });
    expect(rows.map((r) => r.name)).toEqual(['March', 'June', 'August']);
  });

  it('orders seasons oldest first, so each season is contiguous', () => {
    const rows = index({
      1: meta({ name: 'Later', season: 2019, offset: 10, code: 'MLAT2019' }),
      2: meta({ name: 'Earlier', season: 2005, offset: 300, code: 'MEAR2005' }),
    });
    expect(rows.map((r) => r.season)).toEqual([2005, 2019]);
  });

  it('puts a row with no date at the end of its own season, not at the epoch', () => {
    const rows = index({
      1: meta({ name: 'Undated', season: 2019, offset: null, code: 'MUND2019' }),
      2: meta({ name: 'March', season: 2019, offset: 70, code: 'MMAR2019' }),
      3: meta({ name: 'Older', season: 2018, offset: 70, code: 'MOLD2018' }),
    });
    expect(rows.map((r) => r.name)).toEqual(['Older', 'March', 'Undated']);
  });

  it('appends the code to every member of a slug collision', () => {
    const rows = index({
      1: meta({ name: 'Sydney', season: 2017, code: 'MSYD2017' }),
      2: meta({ name: 'Sydney', season: 2017, code: 'MMAN2017' }),
      3: meta({ name: 'Gstaad', season: 2017, code: 'MGST2017' }),
    });
    expect(rows.find((r) => r.slug?.includes('msyd'))?.slug).toBe('sydney-2017-men-msyd2017');
    expect(rows.find((r) => r.slug?.includes('mman'))?.slug).toBe('sydney-2017-men-mman2017');
    // The tournament that never clashed keeps its clean address.
    expect(rows.find((r) => r.name === 'Gstaad')?.slug).toBe('gstaad-2017-men');
  });

  it('rebuilds the end date from the span', () => {
    const [row] = index({ 1: meta({ name: 'Gstaad', season: 2019, offset: 100, span: 4, code: 'M' }) });
    expect(row!.start?.toISOString().slice(0, 10)).toBe('2019-04-11');
    expect(row!.end?.toISOString().slice(0, 10)).toBe('2019-04-15');
  });

  it('drops an end date that runs backwards rather than drawing a reversed range', () => {
    // MOST1995 ends 29 days before it starts (quirks §25).
    const [row] = index({ 1: meta({ name: 'Ostend', season: 1995, span: -29, code: 'MOST1995' }) });
    expect(row!.start).not.toBeNull();
    expect(row!.end).toBeNull();
  });

  it('keeps a one-day event, which is a span of zero rather than a missing one', () => {
    const [row] = index({ 1: meta({ name: 'One day', season: 2019, offset: 100, span: 0, code: 'M' }) });
    expect(row!.end?.getTime()).toBe(row!.start?.getTime());
  });
});

describe('drawCounterpart', () => {
  const find = (rows: readonly IndexRow[], code: string) => rows.find((r) => r.code === code)!;

  it('finds the same event in the other draw', () => {
    const rows = index({
      1: meta({ name: 'Guaruja', season: 2008, gender: 'M', code: 'MGUA2008' }),
      2: meta({ name: 'Guaruja', season: 2008, gender: 'W', code: 'WGUA2008' }),
    });
    expect(drawCounterpart(rows, find(rows, 'MGUA2008'))?.code).toBe('WGUA2008');
    expect(drawCounterpart(rows, find(rows, 'WGUA2008'))?.code).toBe('MGUA2008');
  });

  it('matches on name and season rather than the code', () => {
    // Espinho 2000 is MESP2000 against WPOR2000, and Rio 2016 is Rio2016M
    // against Rio2016W — a shape swapping the first letter does not even fit.
    // Two of the archive's 608 pairs, both lost by a code swap.
    const rows = index({
      1: meta({ name: 'Espinho', season: 2000, gender: 'M', code: 'MESP2000' }),
      2: meta({ name: 'Espinho', season: 2000, gender: 'W', code: 'WPOR2000' }),
      3: meta({ name: 'Rio de Janeiro 2016', season: 2016, gender: 'M', code: 'Rio2016M' }),
      4: meta({ name: 'Rio de Janeiro 2016', season: 2016, gender: 'W', code: 'Rio2016W' }),
    });
    expect(drawCounterpart(rows, find(rows, 'MESP2000'))?.code).toBe('WPOR2000');
    expect(drawCounterpart(rows, find(rows, 'Rio2016M'))?.code).toBe('Rio2016W');
  });

  it('has no counterpart for a single-draw event', () => {
    // 369 of the archive's events ran one draw only.
    const rows = index({ 1: meta({ name: 'Solo', season: 2019, gender: 'M', code: 'M1' }) });
    expect(drawCounterpart(rows, rows[0]!)).toBe(null);
  });

  it('refuses to guess when one draw holds two events of that name and season', () => {
    // Seven such groups: the under-19 and under-21 championships at one venue
    // in one year. There is no honest way to say which men's event the
    // women's page means, so it means neither.
    const rows = index({
      1: meta({ name: 'Phuket', season: 2021, gender: 'M', code: 'M191' }),
      2: meta({ name: 'Phuket', season: 2021, gender: 'M', code: 'M211' }),
      3: meta({ name: 'Phuket', season: 2021, gender: 'W', code: 'W191' }),
    });
    expect(drawCounterpart(rows, find(rows, 'W191'))).toBe(null);
    expect(drawCounterpart(rows, find(rows, 'M191'))).toBe(null);
  });

  it('does not reach across seasons or to a different event', () => {
    const rows = index({
      1: meta({ name: 'Gstaad', season: 2019, gender: 'M', code: 'MGST2019' }),
      2: meta({ name: 'Gstaad', season: 2018, gender: 'W', code: 'WGST2018' }),
      3: meta({ name: 'Vienna', season: 2019, gender: 'W', code: 'WVIE2019' }),
    });
    expect(drawCounterpart(rows, find(rows, 'MGST2019'))).toBe(null);
  });
});

describe('buildIndex and events not yet played', () => {
  const now = new Date('2026-09-09T00:00:00Z');
  // Day 300 of 2026 is late October, day 100 early April.
  const upcoming = (o: { name: string; code: string; season?: number; gender?: 'M' | 'W' }) =>
    meta({ season: 2026, offset: 300, ...o });
  const past = (o: { name: string; code: string; season?: number }) =>
    meta({ season: 2026, offset: 100, ...o });

  const build = (rows: Record<string, TournamentMeta>, played: string[]) =>
    buildIndex(rows, (code) => played.includes(code), now);

  it('lists an event still ahead of the calendar, unplayed and unlinked', () => {
    const rows = build({ 1: upcoming({ name: 'Alanya', code: 'MALN2026' }) }, []);
    expect(rows.map((r) => [r.name, r.played, r.slug])).toEqual([['Alanya', false, null]]);
  });

  it('still excludes an event with no field that is already in the past', () => {
    // 72 of the 78 fieldless rows are these: cancellations and postponements,
    // which FIVB names outright — "BPT Futures Negombo (postponed to 2025)".
    const rows = build({ 1: past({ name: 'Negombo (postponed)', code: 'MNEG2026' }) }, []);
    expect(rows).toEqual([]);
  });

  it('excludes an event with no field and no date, which cannot be called future', () => {
    const rows = build({ 1: meta({ name: 'Congress', season: 2010, offset: null, code: 'WC2010' }) }, []);
    expect(rows).toEqual([]);
  });

  it('marks a played event as played and gives it a page', () => {
    const rows = build({ 1: past({ name: 'Gstaad', code: 'MGST2026' }) }, ['MGST2026']);
    expect(rows[0]!.played).toBe(true);
    expect(rows[0]!.slug).toBe('gstaad-2026-men');
  });

  it('never lets an unplayed event change the address of a played one', () => {
    // The hazard: `tournamentSlugs` appends FIVB's code to every member of a
    // colliding group, so if an unplayed event joined that set, a page that
    // already exists and is already linked would silently move to a suffixed
    // URL because of a tournament that has not happened.
    const rows = build(
      {
        1: past({ name: 'Alanya', code: 'MALN2026' }),
        2: upcoming({ name: 'Alanya', code: 'MAL22026' }),
      },
      ['MALN2026'],
    );
    expect(rows.find((r) => r.code === 'MALN2026')?.slug).toBe('alanya-2026-men');
    expect(rows.find((r) => r.code === 'MAL22026')?.slug).toBe(null);
  });

  it('gives a season that holds only upcoming events', () => {
    // 2027 exists as a season the moment FIVB publishes the World
    // Championships into it, two years ahead.
    const rows = build(
      {
        1: past({ name: 'Gstaad', code: 'MGST2026' }),
        2: meta({ name: 'Netherlands', season: 2027, offset: 220, code: 'MWCH2027' }),
      },
      ['MGST2026'],
    );
    expect(seasonsFor(rows, 'M')).toEqual([2027, 2026]);
  });
});

describe('seasonsFor', () => {
  const rows = index({
    1: meta({ name: 'Rio', season: 1990, gender: 'M', code: 'MRIO1990' }),
    2: meta({ name: 'Rio', season: 1996, gender: 'M', code: 'MRIO1996' }),
    3: meta({ name: 'Rio', season: 1996, gender: 'W', code: 'WRIO1996' }),
    4: meta({ name: 'Osaka', season: 2001, gender: 'W', code: 'WOSA2001' }),
  });

  it('lists newest first', () => {
    expect(seasonsFor(rows, 'M')).toEqual([1996, 1990]);
  });

  it('offers a draw only the seasons it actually has', () => {
    // The women's tour has nothing before 1992; a rail built from every season
    // would offer five years that go nowhere.
    expect(seasonsFor(rows, 'W')).toEqual([2001, 1996]);
  });
});

describe('nearestSeason', () => {
  const rows = index({
    1: meta({ name: 'a', season: 1990, gender: 'M', code: 'M1' }),
    2: meta({ name: 'b', season: 1996, gender: 'M', code: 'M2' }),
    3: meta({ name: 'c', season: 2026, gender: 'M', code: 'M3' }),
    4: meta({ name: 'd', season: 1996, gender: 'W', code: 'W1' }),
    5: meta({ name: 'e', season: 2026, gender: 'W', code: 'W2' }),
  });

  it('returns a season that exists unchanged', () => {
    expect(nearestSeason(rows, 'M', 1996)).toBe(1996);
  });

  it('snaps to the closest published season', () => {
    expect(nearestSeason(rows, 'M', 1997)).toBe(1996);
    expect(nearestSeason(rows, 'M', 2020)).toBe(2026);
  });

  it('snaps within the draw, not the archive', () => {
    // 1990 is a men's season; the women's draw has nothing before 1996, and
    // reconcile would answer this with the newest season instead of the
    // nearest — a typed 1990 jumping to 2026 reads as rejection.
    expect(nearestSeason(rows, 'W', 1990)).toBe(1996);
  });

  it('clamps a year outside the archive to its nearest edge', () => {
    expect(nearestSeason(rows, 'M', 1066)).toBe(1990);
    expect(nearestSeason(rows, 'M', 9999)).toBe(2026);
  });

  it('breaks an exact tie towards the earlier season, so it cannot flicker', () => {
    // 1993 is three years from both 1990 and 1996.
    expect(nearestSeason(rows, 'M', 1993)).toBe(1990);
  });

  it('has no answer when the draw has no seasons', () => {
    expect(nearestSeason([], 'M', 2019)).toBe(null);
  });
});

describe('defaultSeason', () => {
  // A published archive that runs ahead of the calendar, which is the real
  // shape: FIVB lists tournaments before they are played.
  const rows = index({
    1: meta({ name: 'a', season: 2024, gender: 'M', code: 'M1' }),
    2: meta({ name: 'b', season: 2025, gender: 'M', code: 'M2' }),
    3: meta({ name: 'c', season: 2026, gender: 'M', code: 'M3' }),
    4: meta({ name: 'd', season: 2027, gender: 'M', code: 'M4' }),
    5: meta({ name: 'e', season: 2024, gender: 'W', code: 'W1' }),
  });

  const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it('opens on this calendar year, not the newest season published', () => {
    // The bug this fixes: the page opened on 2027, a season holding one
    // tournament that has not been played.
    expect(defaultSeason(rows, 'M', on('2026-09-09'))).toBe(2026);
  });

  it('still opens on this year in January, before the season has begun', () => {
    expect(defaultSeason(rows, 'M', on('2026-01-02'))).toBe(2026);
  });

  it('falls back to the nearest season when this year has none', () => {
    // The women's calendar in this fixture stops in 2024.
    expect(defaultSeason(rows, 'W', on('2026-09-09'))).toBe(2024);
  });

  it('falls back to the nearest season, not the newest one', () => {
    // 2025 is absent and 2027 is published, so "this year, else the newest"
    // would answer 2027 — three years past what was asked for — while the
    // nearest is 2024. Every other case here has the two agreeing, which is
    // exactly why this one is needed.
    expect(defaultSeason(rows, 'W', on('2025-06-01'))).toBe(2024);
    const sparse = index({
      1: meta({ name: 'a', season: 2024, gender: 'W', code: 'W1' }),
      2: meta({ name: 'b', season: 2030, gender: 'W', code: 'W2' }),
    });
    expect(defaultSeason(sparse, 'W', on('2025-06-01'))).toBe(2024);
  });

  it('opens on the last published season once the calendar runs past it', () => {
    expect(defaultSeason(rows, 'M', on('2031-05-01'))).toBe(2027);
  });

  it('has no answer for a draw with nothing published', () => {
    expect(defaultSeason([], 'M', on('2026-09-09'))).toBe(null);
  });
});

describe('groupsIn', () => {
  it('keeps the fixed chip order however the rows arrive', () => {
    // Dated so the calendar order is the exact reverse of the chip order —
    // otherwise the rows reach `groupsIn` already sorted the way the
    // assertion expects, and it passes without the fixed order doing anything.
    const rows = index({
      1: meta({ name: 'Youth', season: 2019, offset: 10, tier: 'age-group-wch', code: 'M1' }),
      2: meta({ name: 'Tour', season: 2019, offset: 20, tier: 'beach-pro-tour', code: 'M2' }),
      3: meta({ name: 'Games', season: 2019, offset: 30, tier: 'olympics', code: 'M3' }),
    });
    expect(rows.map((r) => r.name)).toEqual(['Youth', 'Tour', 'Games']);
    expect(groupsIn(rows)).toEqual(['olympics', 'tour', 'age-group-wch']);
    expect(groupsIn(rows).every((g) => TIER_GROUPS.includes(g))).toBe(true);
  });

  it('offers no chip for a group the slice does not hold', () => {
    const rows = index({ 1: meta({ name: 'Tour', season: 2019, code: 'M1' }) });
    expect(groupsIn(rows)).toEqual(['tour']);
  });
});

describe('compareLevels', () => {
  it('puts the level the season held most of first', () => {
    // 2025's men's draw, measured: Futures 29, Elite16 12, Challenge 7.
    const rows = index({
      1: meta({ name: 'a', season: 2025, level: 'Elite16', code: 'M1' }),
      2: meta({ name: 'b', season: 2025, level: 'Elite16', code: 'M2' }),
      3: meta({ name: 'c', season: 2025, level: 'Futures', code: 'M3' }),
      4: meta({ name: 'd', season: 2025, level: 'Futures', code: 'M4' }),
      5: meta({ name: 'e', season: 2025, level: 'Futures', code: 'M5' }),
      6: meta({ name: 'f', season: 2025, level: 'Challenge', code: 'M6' }),
    });
    expect(levelsIn(rows).map((l) => l.level)).toEqual(['Futures', 'Elite16', 'Challenge']);
  });

  it('breaks a tie alphabetically, so the row cannot reorder between renders', () => {
    // The 1996 women's season held a Grand Slam, an Open and a Challenger at
    // one event each.
    expect(
      [
        { level: 'Open', count: 1 },
        { level: 'Grand Slam', count: 1 },
        { level: 'Challenger', count: 1 },
      ]
        .sort(compareLevels)
        .map((l) => l.level),
    ).toEqual(['Challenger', 'Grand Slam', 'Open']);
  });

  it('counts only the levels present, never a fixed list of all of them', () => {
    const rows = index({ 1: meta({ name: 'a', season: 2019, level: '4-star', code: 'M1' }) });
    expect(levelsIn(rows)).toEqual([{ level: '4-star', count: 1 }]);
  });

  it('ignores a row with no level, which is how the Olympics are published', () => {
    const rows = index({
      1: meta({ name: 'Games', season: 2016, tier: 'olympics', level: null, code: 'M1' }),
    });
    expect(levelsIn(rows)).toEqual([]);
  });
});

describe('applyFilter', () => {
  const rows = index({
    1: meta({ name: 'Elite', season: 2025, level: 'Elite16', tier: 'beach-pro-tour', code: 'M1' }),
    2: meta({ name: 'Fut', season: 2025, level: 'Futures', tier: 'beach-pro-tour', code: 'M2' }),
    3: meta({ name: 'Worlds', season: 2025, level: null, tier: 'world-champs', code: 'M3' }),
    4: meta({ name: 'Older', season: 2024, level: 'Elite16', tier: 'beach-pro-tour', code: 'M4' }),
    5: meta({ name: 'Her', season: 2025, level: 'Elite16', tier: 'beach-pro-tour', gender: 'W', code: 'W1' }),
  });

  it('narrows to one season and one draw before any chip is touched', () => {
    expect(sliceOf(rows, 'M', 2025).map((r) => r.name).sort()).toEqual(['Elite', 'Fut', 'Worlds']);
  });

  it('narrows by tier group', () => {
    const got = applyFilter(rows, { gender: 'M', season: 2025, group: 'world-champs', level: null });
    expect(got.map((r) => r.name)).toEqual(['Worlds']);
  });

  it('narrows by level', () => {
    const got = applyFilter(rows, { gender: 'M', season: 2025, group: null, level: 'Elite16' });
    expect(got.map((r) => r.name)).toEqual(['Elite']);
  });

  it('never reaches across the draw', () => {
    const got = applyFilter(rows, { gender: 'W', season: 2025, group: null, level: null });
    expect(got.map((r) => r.name)).toEqual(['Her']);
  });
});

describe('reconcile', () => {
  const rows = index({
    1: meta({ name: 'Men 1990', season: 1990, gender: 'M', level: 'Open', code: 'M1' }),
    2: meta({ name: 'Men 2025', season: 2025, gender: 'M', level: 'Elite16', tier: 'beach-pro-tour', code: 'M2' }),
    3: meta({ name: 'Games', season: 2024, gender: 'M', tier: 'olympics', level: null, code: 'M3' }),
    4: meta({ name: 'Women 2025', season: 2025, gender: 'W', level: 'Futures', tier: 'beach-pro-tour', code: 'W1' }),
    // An Olympic season also runs a tour, and that is what makes the
    // contradiction below a real one: "Elite16" exists in 2024, just never
    // under "Olympics". Without this row the level would be dropped for want
    // of any level at all, and the group narrowing would go untested.
    5: meta({ name: 'Tour 2024', season: 2024, gender: 'M', level: 'Elite16', tier: 'beach-pro-tour', code: 'M4' }),
  });

  it('leaves a filter the archive can honour alone', () => {
    const filter = { gender: 'M', season: 2025, group: 'tour', level: 'Elite16' } as const;
    expect(reconcile(rows, filter)).toEqual(filter);
  });

  it('falls back to the newest season when the draw has nothing in the one asked for', () => {
    // Flipping to the women's draw on 1990, which is men-only.
    const got = reconcile(rows, { gender: 'W', season: 1990, group: null, level: null });
    expect(got.season).toBe(2025);
  });

  it('drops a tier group the new season does not hold', () => {
    const got = reconcile(rows, { gender: 'M', season: 2025, group: 'olympics', level: null });
    expect(got).toEqual({ gender: 'M', season: 2025, group: null, level: null });
  });

  it('drops a level the new season never held', () => {
    const got = reconcile(rows, { gender: 'M', season: 1990, group: null, level: 'Elite16' });
    expect(got).toEqual({ gender: 'M', season: 1990, group: null, level: null });
  });

  it('drops the level, not the group, when the two contradict each other', () => {
    // "Olympics" and "Elite16" can never both be true; the group is the
    // broader statement, so it is the one that survives.
    const got = reconcile(rows, { gender: 'M', season: 2024, group: 'olympics', level: 'Elite16' });
    expect(got).toEqual({ gender: 'M', season: 2024, group: 'olympics', level: null });
  });

  it('keeps the season it was given when the archive is empty', () => {
    const got = reconcile([] as IndexRow[], { gender: 'M', season: 2025, group: null, level: null });
    expect(got.season).toBe(2025);
  });
});
