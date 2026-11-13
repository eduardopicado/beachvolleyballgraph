import { describe, expect, it } from 'vitest';
import type { EntryTeam } from '../../../shared/schema';
import { BY_COUNTRY, ENTRY_ORDER, hasEntryPoints, nextEntrySort, openingSort, sortEntries } from './entrySort';

/*
 * Seven rows of the Corigliano Rossano 2026 women's list as FIVB published it
 * on 17 September 2026, in its order, with two edits that the real list lacks:
 * a team with no technical points (row 7), and a second Czech team ahead of the
 * first so a tie on country has an order to keep.
 */
const NAMES: Record<number, string> = {
  1: 'Giulia Gavio',
  2: 'Carolina Sallaberry Cavalcanti',
  3: 'Rika Dieckmann',
  4: 'Sarah Schulz',
  5: 'Céline Collette',
  6: 'Marion Bernard',
  7: 'Adela Necesana',
  8: 'Adela Vorasicka',
  9: 'Tereza Kafkova',
  10: 'Michaela Stankova',
  11: 'Halle Hunt',
  12: 'Tessa Van Winkle',
  13: 'barbora Simkova',
  14: 'Monika Hola',
};
const TEAMS: EntryTeam[] = [
  [1, 2, 'BRA', 740, 1220],
  [3, 4, 'GER', 644, 1046],
  [11, 12, 'USA', 416, 556],
  [5, 6, 'FRA', 352, 514],
  [7, 8, 'CZE', 138, 201],
  [9, 10, 'CZE', 76, 76],
  [13, 14, 'CZE', 16, null],
];
const nameOf = (id: number) => NAMES[id]!;
const order = (key: Parameters<typeof nextEntrySort>[1], desc: boolean) =>
  sortEntries(TEAMS, { key, desc }, nameOf).map((r) => r.at);

describe('sortEntries', () => {
  it('opens in FIVB order, which is the order the file is in', () => {
    expect(sortEntries(TEAMS, ENTRY_ORDER, nameOf).map((r) => r.at)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(order('entry', false)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('keeps each team’s place in FIVB order whatever the sort', () => {
    const byCountry = sortEntries(TEAMS, { key: 'fed', desc: false }, nameOf);
    expect(byCountry.map((r) => [r.team[2], r.at])).toEqual([
      ['BRA', 1],
      ['CZE', 5],
      ['CZE', 6],
      ['CZE', 7],
      ['FRA', 4],
      ['GER', 2],
      ['USA', 3],
    ]);
  });

  it('breaks a tie in FIVB order, in both directions of the column', () => {
    // The three Czech teams stay 5, 6, 7 when the countries run Z–A too.
    expect(order('fed', true)).toEqual([3, 2, 4, 5, 6, 7, 1]);
  });

  it('sorts players on the first name in the row, folding accents and case', () => {
    // Adela, barbora, Céline, Giulia, Halle, Rika, Tereza.
    expect(order('team', false)).toEqual([5, 7, 4, 1, 3, 2, 6]);
  });

  it('sorts technical points high to low, with a missing figure last both ways', () => {
    expect(order('tech', true)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(order('tech', false)).toEqual([6, 5, 4, 3, 2, 1, 7]);
  });

  it('leaves the list it was given alone', () => {
    const before = TEAMS.map((t) => t[0]);
    sortEntries(TEAMS, { key: 'team', desc: true }, nameOf);
    expect(TEAMS.map((t) => t[0])).toEqual(before);
  });
});

describe('nextEntrySort', () => {
  it('flips the column already sorted', () => {
    expect(nextEntrySort(ENTRY_ORDER, 'entry')).toEqual({ key: 'entry', desc: false });
    expect(nextEntrySort({ key: 'fed', desc: false }, 'fed')).toEqual({ key: 'fed', desc: true });
  });

  it('starts points high to low and names A–Z', () => {
    expect(nextEntrySort(ENTRY_ORDER, 'tech')).toEqual({ key: 'tech', desc: true });
    expect(nextEntrySort(ENTRY_ORDER, 'team')).toEqual({ key: 'team', desc: false });
    expect(nextEntrySort({ key: 'team', desc: true }, 'fed')).toEqual({ key: 'fed', desc: false });
    expect(nextEntrySort({ key: 'fed', desc: false }, 'entry')).toEqual(ENTRY_ORDER);
  });
});

describe('a list with no points yet', () => {
  // Itapema 2026 women's shape on 8 November: every figure missing, and the
  // file in player-id order, which is the ingest's last tie-break and means
  // nothing to a reader.
  const BARE: EntryTeam[] = [
    [13, 14, 'CZE', null, null],
    [11, 12, 'USA', null, null],
    [7, 8, 'CZE', null, null],
    [1, 2, 'BRA', null, null],
    [9, 10, 'CZE', null, null],
  ];

  it('opens by country, and a list with points in FIVB order', () => {
    expect(hasEntryPoints(BARE)).toBe(false);
    expect(openingSort(BARE)).toEqual(BY_COUNTRY);
    expect(hasEntryPoints(TEAMS)).toBe(true);
    expect(openingSort(TEAMS)).toEqual(ENTRY_ORDER);
  });

  it('counts one published figure as points, and a list of none as none', () => {
    expect(hasEntryPoints([...BARE, [3, 4, 'GER', 0, null]])).toBe(true);
    expect(hasEntryPoints([])).toBe(false);
  });

  it('breaks a tie within a country by name, not by file order', () => {
    const rows = sortEntries(BARE, BY_COUNTRY, nameOf);
    // Adela, barbora, Tereza: the three Czech teams by their first name.
    expect(rows.map((r) => nameOf(r.team[0]))).toEqual([
      'Giulia Gavio',
      'Adela Necesana',
      'barbora Simkova',
      'Tereza Kafkova',
      'Halle Hunt',
    ]);
  });

  it('still breaks a tie by FIVB order once the list has one', () => {
    // The Czech teams in TEAMS run Adela, Tereza, barbora in FIVB order, which
    // is not A–Z: the name tie-break must not reach a list with points.
    expect(sortEntries(TEAMS, BY_COUNTRY, nameOf).map((r) => r.at)).toEqual([1, 5, 6, 7, 4, 2, 3]);
  });
});
