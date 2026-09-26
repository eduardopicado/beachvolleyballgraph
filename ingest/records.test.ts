import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildRecords,
  candidatesFor,
  CONFIRMED_HEIGHTS,
  DISPROVEN_HEIGHTS,
  HIGHLIGHTS,
  longestGap,
  pickHighlights,
  rankBoard,
  RECORD_FLOORS,
  recordsBelowFloor,
  type RecordPair,
  type RecordPlayer,
} from './records.js';
import {
  GENDERS,
  RECORD_KEYS,
  type Gender,
  type Highlight,
  type RecordKey,
  type RecordRow,
  type RecordsFile,
  type SearchEntry,
} from '../shared/schema.js';

const player = (id: number, over: Partial<RecordPlayer> = {}): RecordPlayer => ({
  id,
  name: `Player ${id}`,
  federation: 'BRA',
  gender: 'M',
  tournaments: 10,
  first: 2010,
  last: 2015,
  partners: 2,
  tourGold: 0,
  worldGold: 0,
  olympicGames: 0,
  height: null,
  ...over,
});

const pair = (a: number, b: number, over: Partial<RecordPair> = {}): RecordPair => ({
  a: { id: a, name: `Player ${a}`, federation: 'BRA' },
  b: { id: b, name: `Player ${b}`, federation: 'BRA' },
  gender: 'M',
  tournaments: 20,
  first: 2010,
  last: 2015,
  seasons: [2010, 2011, 2012, 2013, 2014, 2015],
  decoration: { podiums: 0, titles: 0, olympicAndWorlds: 0 },
  ...over,
});

const values = (rows: RecordRow[]) => rows.map((r) => ('value' in r ? r.value : undefined));
const ids = (rows: RecordRow[]) => rows.map((r) => ('who' in r ? r.who.map((w) => w.id) : undefined));

describe('longestGap', () => {
  it('finds the widest run of idle seasons and the seasons either side of it', () => {
    // Solberg Salgado and Seixas: 2003, 2004, then nothing until 2021.
    expect(longestGap([2003, 2004, 2021, 2022, 2023, 2024])).toEqual({ idle: 16, gap: [2004, 2021] });
  });

  it('is null for a partnership with no idle season', () => {
    expect(longestGap([2010, 2011, 2012])).toBeNull();
    expect(longestGap([2010])).toBeNull();
    expect(longestGap([])).toBeNull();
  });

  it('keeps the first of two equal gaps', () => {
    expect(longestGap([2000, 2003, 2006])).toEqual({ idle: 2, gap: [2000, 2003] });
  });
});

describe('candidatesFor', () => {
  const players = [
    player(1, { tournaments: 50, first: 1991, last: 2019, partners: 7, tourGold: 3, olympicGames: 2, height: 190 }),
    player(2, { tournaments: 0, first: 2010, last: 2010, partners: 0, height: null }),
    player(3, { tournaments: 5, first: 2000, last: 2001, worldGold: 1, height: 165 }),
  ];
  const pairs = [
    pair(1, 3, { tournaments: 30, first: 2000, last: 2019, seasons: [2000, 2001, 2019] }),
    pair(1, 2, { tournaments: 1, first: 2010, last: 2010, seasons: [2010], decoration: { podiums: 2, titles: 1, olympicAndWorlds: 1 } }),
  ];

  it('measures a career as years between first and last season', () => {
    // 1991 to 2019 is 28, whatever happened in between; a single season is
    // no career at all and player 2 is left out.
    expect(candidatesFor('career', players, pairs).map((c) => [c.who[0]!.id, c.value])).toEqual([
      [1, 28],
      [3, 1],
    ]);
  });

  it('leaves out a player with nothing to rank', () => {
    // Zero tournaments, no partners, no height: player 2 is on no player board.
    for (const key of ['tournaments', 'partners', 'titles', 'games', 'tallest', 'shortest'] as const) {
      expect(candidatesFor(key, players, pairs).some((c) => c.who[0]!.id === 2)).toBe(false);
    }
  });

  it('only considers world champions for the shortest-champion board', () => {
    expect(candidatesFor('shortest-champion', players, pairs).map((c) => c.who[0]!.id)).toEqual([3]);
  });

  it('names both halves of a pair, with the seasons they span', () => {
    const [longest] = candidatesFor('partnership', players, pairs);
    expect(longest).toEqual({ value: 30, who: [pairs[0]!.a, pairs[0]!.b], first: 2000, last: 2019 });
  });

  it('measures a reunion as the idle years, and says which', () => {
    expect(candidatesFor('reunion', players, pairs)).toEqual([
      { value: 17, who: [pairs[0]!.a, pairs[0]!.b], first: 2000, last: 2019, gap: [2001, 2019] },
    ]);
  });

  it('reads the three pair decorations from the pair, not the players', () => {
    expect(candidatesFor('pair-podiums', players, pairs).map((c) => c.value)).toEqual([2]);
    expect(candidatesFor('pair-titles', players, pairs).map((c) => c.value)).toEqual([1]);
    expect(candidatesFor('pair-olympic-worlds', players, pairs).map((c) => c.value)).toEqual([1]);
  });
});

describe('rankBoard', () => {
  const c = (value: number, ...who: number[]) => ({
    value,
    who: who.map((id) => ({ id, name: `P${id}`, federation: 'X' })),
  });

  it('ranks largest first and cuts at top', () => {
    const { board } = rankBoard([c(3, 1), c(9, 2), c(5, 3), c(7, 4)], { top: 3, ascending: false, gate: null });
    expect(values(board.rows)).toEqual([9, 7, 5]);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('ranks smallest first when asked', () => {
    const { board } = rankBoard([c(3, 1), c(9, 2), c(5, 3)], { top: 2, ascending: true, gate: null });
    expect(values(board.rows)).toEqual([3, 5]);
  });

  it('lists a tie by id, so the file is the same every run', () => {
    const { board } = rankBoard([c(5, 30), c(5, 10), c(5, 20)], { top: 3, ascending: false, gate: null });
    expect(ids(board.rows)).toEqual([[10], [20], [30]]);
    const pairs = rankBoard([c(5, 10, 40), c(5, 10, 30)], { top: 2, ascending: false, gate: null });
    expect(ids(pairs.board.rows)).toEqual([[10, 30], [10, 40]]);
  });

  it('gives equal values the same rank, and the next value the place it would have had', () => {
    // Nat Cook and Laura Ludwig, five Olympic Games each: both first, and the
    // next woman third. The id still orders the two rows; it no longer ranks them.
    const { board } = rankBoard([c(4, 3), c(5, 2), c(9, 1), c(5, 4)], { top: 4, ascending: false, gate: null });
    expect(values(board.rows)).toEqual([9, 5, 5, 4]);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('shares a rank at the top of the board too', () => {
    const { board } = rankBoard([c(5, 2), c(5, 1), c(4, 3)], { top: 3, ascending: false, gate: null });
    expect(board.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('shares a rank the same way on a board ranked smallest first', () => {
    const { board } = rankBoard([c(150, 3), c(149, 2), c(149, 1)], { top: 3, ascending: true, gate: null });
    expect(board.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('shares a rank between withheld rows, so confirming one later does not reshape the board', () => {
    // Toufar and Kuliš, 149 cm apiece and neither confirmed.
    const { board, withheld } = rankBoard([c(149, 1), c(149, 2), c(150, 3)], {
      top: 3,
      ascending: true,
      gate: new Set([3]),
    });
    expect(board.rows).toEqual([
      { rank: 1, withheld: true },
      { rank: 1, withheld: true },
      { rank: 3, value: 150, who: [{ id: 3, name: 'P3', federation: 'X' }] },
    ]);
    expect(withheld.map((w) => w.rank)).toEqual([1, 1]);
  });

  it('counts the candidates cut while sharing the last shown value', () => {
    const { board } = rankBoard([c(9, 1), c(4, 2), c(4, 3), c(4, 4), c(3, 5)], { top: 2, ascending: false, gate: null });
    expect(values(board.rows)).toEqual([9, 4]);
    expect(board.ties).toBe(2);
  });

  it('counts no ties for an empty board', () => {
    expect(rankBoard([], { top: 5, ascending: false, gate: null }).board).toEqual({ rows: [], ties: 0 });
  });

  it('withholds a gated row in place, keeping its rank and dropping its value', () => {
    const gate = new Set([2]);
    const { board, withheld } = rankBoard([c(149, 1), c(150, 2), c(157, 3)], { top: 3, ascending: true, gate });
    expect(board.rows).toEqual([
      { rank: 1, withheld: true },
      { rank: 2, value: 150, who: [{ id: 2, name: 'P2', federation: 'X' }] },
      { rank: 3, withheld: true },
    ]);
    expect(withheld.map((w) => [w.rank, w.value])).toEqual([
      [1, 149],
      [3, 157],
    ]);
  });

  it('withholds a pair row unless both halves are confirmed', () => {
    const { board } = rankBoard([c(200, 1, 2)], { top: 1, ascending: false, gate: new Set([1]) });
    expect(board.rows).toEqual([{ rank: 1, withheld: true }]);
  });
});

describe('buildRecords', () => {
  const men = [player(1, { tournaments: 9, height: 200 }), player(2, { tournaments: 7, height: 150 })];
  const women = [player(3, { gender: 'W', tournaments: 8, height: 180 })];

  it('splits every category by gender', () => {
    const { file } = buildRecords([...men, ...women], [], { confirmedHeights: new Set([1, 2, 3]) });
    expect(Object.keys(file.categories).sort()).toEqual([...RECORD_KEYS].sort());
    for (const key of RECORD_KEYS) expect(Object.keys(file.categories[key]).sort()).toEqual([...GENDERS].sort());
    expect(ids(file.categories.tournaments.M.rows)).toEqual([[1], [2]]);
    expect(ids(file.categories.tournaments.W.rows)).toEqual([[3]]);
  });

  it('gates only the height boards, on the confirmed list', () => {
    const { file, withheld } = buildRecords(men, [], { confirmedHeights: new Set([1]) });
    expect(file.categories.tallest.M.rows).toEqual([
      { rank: 1, value: 200, who: [{ id: 1, name: 'Player 1', federation: 'BRA' }] },
      { rank: 2, withheld: true },
    ]);
    expect(file.categories.shortest.M.rows[0]).toEqual({ rank: 1, withheld: true });
    // The same player is unconfirmed everywhere and still ranks on tournaments.
    expect(ids(file.categories.tournaments.M.rows)).toEqual([[1], [2]]);
    expect(withheld.map((w) => `${w.key} ${w.gender} #${w.rank}`).sort()).toEqual([
      'shortest M #1',
      'tallest M #2',
    ]);
  });

  it('defaults to the checked-in confirmed list and five rows', () => {
    const { file } = buildRecords([player(136385, { height: 215 }), player(999, { height: 216 })], []);
    expect(file.top).toBe(5);
    expect(file.categories.tallest.M.rows).toEqual([
      { rank: 1, withheld: true },
      { rank: 2, value: 215, who: [{ id: 136385, name: 'Player 136385', federation: 'BRA' }] },
    ]);
    expect(CONFIRMED_HEIGHTS.has(136385)).toBe(true);
  });

  describe('a disproven height', () => {
    // Toufar and Kuliš at 149 on a board where the next man is 165: the case
    // this exists for. Player 3 is confirmed; 1 and 2 are the typo pair.
    const typos = [
      player(1, { height: 149, tournaments: 6 }),
      player(2, { height: 149, tournaments: 5 }),
      player(3, { height: 165, tournaments: 4 }),
    ];

    it('is off the height boards, so the next confirmed player takes the rank it held', () => {
      const { file, withheld } = buildRecords(typos, [], {
        confirmedHeights: new Set([3]),
        disprovenHeights: new Set([1, 2]),
      });
      expect(file.categories.shortest.M.rows).toEqual([
        { rank: 1, value: 165, who: [{ id: 3, name: 'Player 3', federation: 'BRA' }] },
      ]);
      expect(file.categories.tallest.M.rows).toEqual(file.categories.shortest.M.rows);
      // Not withheld either: withholding is for unchecked, this is checked and false.
      expect(withheld).toEqual([]);
    });

    it('still counts on every board that is not about height', () => {
      const { file } = buildRecords(typos, [], {
        confirmedHeights: new Set([3]),
        disprovenHeights: new Set([1, 2]),
      });
      expect(ids(file.categories.tournaments.M.rows)).toEqual([[1], [2], [3]]);
    });

    it('without the list, blocks the board as a withheld rank', () => {
      // The state this replaces, pinned so the difference above is visible.
      const { file } = buildRecords(typos, [], { confirmedHeights: new Set([3]), disprovenHeights: new Set() });
      expect(file.categories.shortest.M.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
      expect(file.categories.shortest.M.rows[0]).toEqual({ rank: 1, withheld: true });
    });
  });

  it('never has a player on both the confirmed and the disproven list, and every entry names a source', () => {
    for (const id of DISPROVEN_HEIGHTS.keys()) expect(CONFIRMED_HEIGHTS.has(id), `player ${id}`).toBe(false);
    for (const [id, source] of [...CONFIRMED_HEIGHTS, ...DISPROVEN_HEIGHTS]) {
      expect(source.trim().length, `player ${id}`).toBeGreaterThan(0);
    }
  });
});

describe('recordsBelowFloor', () => {
  const healthy = (): RecordsFile => {
    const many = Array.from({ length: 6 }, (_, i) =>
      player(i + 1, {
        tournaments: 300 - i,
        first: 1990,
        last: 2020 - i,
        partners: 30 - i,
        tourGold: 80 - i,
        olympicGames: 6 - (i % 3),
        height: 180 + i,
        worldGold: 1,
      }),
    );
    const pairs = Array.from({ length: 6 }, (_, i) =>
      pair(i + 1, i + 10, {
        tournaments: 200 - i,
        first: 1990,
        last: 2020,
        seasons: [1990, 2000 + i, 2020],
        decoration: { podiums: 90 - i, titles: 50 - i, olympicAndWorlds: 8 - i },
      }),
    );
    const both = [...many, ...many.map((p) => ({ ...p, id: p.id + 100, gender: 'W' as const }))];
    const bothPairs = [
      ...pairs,
      ...pairs.map((q) => ({ ...q, gender: 'W' as const, a: { ...q.a, id: q.a.id + 100 }, b: { ...q.b, id: q.b.id + 100 } })),
    ];
    return buildRecords(both, bothPairs, { confirmedHeights: new Set() }).file;
  };

  it('passes a file whose every leader clears its floor', () => {
    expect(recordsBelowFloor(healthy())).toEqual([]);
  });

  it('names the board whose leader fell under the floor', () => {
    const file = healthy();
    const lead = file.categories.tournaments.W.rows[0]!;
    if ('value' in lead) lead.value = RECORD_FLOORS.tournaments - 1;
    expect(recordsBelowFloor(file)).toEqual([
      `tournaments W: leader holds ${RECORD_FLOORS.tournaments - 1}, floor is ${RECORD_FLOORS.tournaments}`,
    ]);
  });

  it('names an empty board', () => {
    const file = healthy();
    file.categories['pair-titles'].M.rows = [];
    expect(recordsBelowFloor(file)).toEqual(['pair-titles M: no rows at all']);
  });

  it('has no floor for the height boards, which may legitimately be all withheld', () => {
    const file = healthy();
    expect(file.categories.shortest.M.rows.every((r) => 'withheld' in r)).toBe(true);
    expect(recordsBelowFloor(file)).toEqual([]);
  });
});

/**
 * What was actually published, read back.
 *
 * The rules above are pinned on fixtures; this is where they are checked
 * against the tree, so a row can never name a player with no page, a withheld
 * rank can never leak its value, and the leaders stay inside what the archive
 * can plausibly hold.
 */
describe('the published records', () => {
  const DATA = new URL('../web/public/v1/', import.meta.url);
  const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
  const file = read('records.json') as RecordsFile;

  const publishedOn = new Map<number, string>();
  for (const [key, entries] of Object.entries(read('search.json').slices as Record<string, SearchEntry[]>)) {
    for (const [id] of entries) publishedOn.set(id, key);
  }

  it('covers every category and both genders', () => {
    expect(Object.keys(file.categories).sort()).toEqual([...RECORD_KEYS].sort());
    expect(file.top).toBe(5);
    expect(publishedOn.size).toBeGreaterThan(10_000);
  });

  it('names only players who have a page, on the slice the file says', () => {
    let named = 0;
    for (const key of RECORD_KEYS) {
      for (const gender of GENDERS) {
        for (const row of file.categories[key][gender].rows) {
          if ('withheld' in row) continue;
          for (const who of row.who) {
            named++;
            expect(publishedOn.get(who.id), `${key} ${gender}: ${who.name}`).toBe(`${who.federation}-${gender}`);
          }
        }
      }
    }
    expect(named).toBeGreaterThan(100);
  });

  it('ranks every board from 1, sharing a rank only between equal values, and keeps a withheld row to its rank alone', () => {
    for (const key of RECORD_KEYS) {
      for (const gender of GENDERS) {
        const rows = file.categories[key][gender].rows;
        const where = `${key} ${gender}`;
        rows.forEach((row, i) => {
          // Either the rank the row's place gives it, or a share of the row above's.
          if (i === 0) expect(row.rank, where).toBe(1);
          else expect([rows[i - 1]!.rank, i + 1], `${where} #${i + 1}`).toContain(row.rank);
          const above = rows[i - 1];
          if (i > 0 && 'value' in row && above && 'value' in above) {
            expect(row.rank === above.rank, `${where} #${i + 1}: shared rank iff equal value`).toBe(
              row.value === above.value,
            );
          }
        });
        expect(rows.length).toBeLessThanOrEqual(file.top);
        for (const row of rows) {
          if ('withheld' in row) expect(Object.keys(row).sort()).toEqual(['rank', 'withheld']);
        }
      }
    }
  });

  it('withholds nothing off a board that has no gate', () => {
    for (const key of RECORD_KEYS) {
      if (key === 'tallest' || key === 'shortest' || key === 'shortest-champion') continue;
      for (const gender of GENDERS) {
        expect(file.categories[key][gender].rows.some((r) => 'withheld' in r), `${key} ${gender}`).toBe(false);
      }
    }
  });

  it('publishes a height only for a player on the confirmed list', () => {
    for (const key of ['tallest', 'shortest', 'shortest-champion'] as const) {
      for (const gender of GENDERS) {
        for (const row of file.categories[key][gender].rows) {
          if ('withheld' in row) continue;
          for (const who of row.who) expect(CONFIRMED_HEIGHTS.has(who.id), `${key} ${gender}: ${who.name}`).toBe(true);
        }
      }
    }
  });

  it('clears every floor', () => {
    expect(recordsBelowFloor(file)).toEqual([]);
  });

  it('agrees with the graph on the most-played player', () => {
    // The one leader whose value is read straight off another file: the
    // busiest node in the archive is the top of the tournaments board.
    const lead = file.categories.tournaments.M.rows[0]!;
    expect('value' in lead).toBe(true);
    if (!('value' in lead)) return;
    const slice = read(`graphs/${lead.who[0]!.federation}-M.json`);
    const node = slice.nodes.find((n: { id: number }) => n.id === lead.who[0]!.id);
    expect(node.tournaments).toBe(lead.value);
    const busiest = Math.max(...slice.nodes.map((n: { tournaments: number }) => n.tournaments));
    expect(lead.value).toBe(busiest);
  });
});

describe('pickHighlights', () => {
  /** A file with just the boards a test names, so nothing else can satisfy an assertion. */
  const fileOf = (boards: Partial<Record<RecordKey, Partial<Record<Gender, RecordRow[]>>>>): RecordsFile => {
    const categories = {} as RecordsFile['categories'];
    for (const key of RECORD_KEYS) {
      categories[key] = { M: { rows: [], ties: 0 }, W: { rows: [], ties: 0 } };
      for (const gender of GENDERS) {
        const rows = boards[key]?.[gender];
        if (rows) categories[key][gender] = { rows, ties: 0 };
      }
    }
    return { top: 5, categories };
  };

  const who = (id: number) => ({ id, name: `Player ${id}`, federation: 'BRA' });

  it('takes rank 1 of each named board, in the order the list names them', () => {
    const file = fileOf({
      titles: { W: [{ rank: 1, value: 61, who: [who(1)] }, { rank: 2, value: 40, who: [who(9)] }] },
      tournaments: { M: [{ rank: 1, value: 255, who: [who(2)] }] },
    });
    expect(
      pickHighlights(file, [
        { key: 'tournaments', gender: 'M' },
        { key: 'titles', gender: 'W' },
      ]),
    ).toEqual([
      { key: 'tournaments', gender: 'M', value: 255, who: [who(2)] },
      { key: 'titles', gender: 'W', value: 61, who: [who(1)] },
    ]);
  });

  it('carries the seasons where the row has them and leaves the field off where it does not', () => {
    const file = fileOf({
      partnership: { M: [{ rank: 1, value: 159, who: [who(1), who(2)], first: 2009, last: 2024 }] },
      tournaments: { M: [{ rank: 1, value: 255, who: [who(3)] }] },
    });
    const [together, alone] = pickHighlights(file, [
      { key: 'partnership', gender: 'M' },
      { key: 'tournaments', gender: 'M' },
    ]);
    expect(together).toMatchObject({ first: 2009, last: 2024 });
    expect(alone).not.toHaveProperty('first');
    expect(alone).not.toHaveProperty('last');
  });

  it('drops a second card that would open a player already on the strip', () => {
    // Emanuel Rego, who leads four boards today.
    const file = fileOf({
      tournaments: { M: [{ rank: 1, value: 255, who: [who(1)] }] },
      titles: { M: [{ rank: 1, value: 73, who: [who(1)] }] },
    });
    expect(
      pickHighlights(file, [
        { key: 'tournaments', gender: 'M' },
        { key: 'titles', gender: 'M' },
      ]).map((h) => h.key),
    ).toEqual(['tournaments']);
  });

  it('does not retire the half of a pair the card never opens', () => {
    // Behar & Bede opens Behar; Shelda may still lead a board of her own.
    const file = fileOf({
      'pair-podiums': { W: [{ rank: 1, value: 85, who: [who(1), who(2)], first: 1995, last: 2007 }] },
      titles: { W: [{ rank: 1, value: 61, who: [who(2)] }] },
    });
    expect(
      pickHighlights(file, [
        { key: 'pair-podiums', gender: 'W' },
        { key: 'titles', gender: 'W' },
      ]).map((h) => h.key),
    ).toEqual(['pair-podiums', 'titles']);
  });

  it('skips a withheld leader rather than publishing a rank with no name', () => {
    const file = fileOf({
      shortest: { W: [{ rank: 1, withheld: true }] },
      titles: { W: [{ rank: 1, value: 61, who: [who(1)] }] },
    });
    expect(
      pickHighlights(file, [
        { key: 'shortest', gender: 'W' },
        { key: 'titles', gender: 'W' },
      ]).map((h) => h.key),
    ).toEqual(['titles']);
  });

  it('skips a board whose record is shared, since one card cannot name both holders', () => {
    const file = fileOf({
      games: { W: [{ rank: 1, value: 5, who: [who(1)] }, { rank: 1, value: 5, who: [who(2)] }] },
      titles: { W: [{ rank: 1, value: 61, who: [who(3)] }, { rank: 2, value: 50, who: [who(4)] }] },
    });
    expect(
      pickHighlights(file, [
        { key: 'games', gender: 'W' },
        { key: 'titles', gender: 'W' },
      ]).map((h) => h.key),
    ).toEqual(['titles']);
  });

  it('skips an empty board', () => {
    expect(pickHighlights(fileOf({}), [{ key: 'tournaments', gender: 'M' }])).toEqual([]);
  });

  it('names six boards, three solo and three pair, three of each draw', () => {
    // The strip's shape, asserted where it is decided rather than trusted to
    // stay true — a seventh card or a fourth men's board is an edit to
    // HIGHLIGHTS that should have to change a test.
    const pairKeys = new Set<RecordKey>(['partnership', 'span', 'reunion', 'pair-podiums', 'pair-titles', 'pair-olympic-worlds']);
    expect(HIGHLIGHTS).toHaveLength(6);
    expect(HIGHLIGHTS.filter((h) => pairKeys.has(h.key))).toHaveLength(3);
    expect(HIGHLIGHTS.filter((h) => h.gender === 'M')).toHaveLength(3);
  });
});

/**
 * The strip, read back off what was published.
 *
 * `pickHighlights` is pinned on fixtures above; this is the part fixtures
 * cannot reach — that the list in HIGHLIGHTS still names boards the real
 * archive fills, and that six cards actually survive the de-duplication rule
 * rather than four.
 */
describe('the published highlights', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../web/public/v1/manifest.json', import.meta.url), 'utf8'),
  ) as { highlights?: Highlight[]; countries: { code: string; genders: Record<string, unknown> }[] };

  it('publishes a card for every board in HIGHLIGHTS', () => {
    expect(manifest.highlights).toBeDefined();
    expect(manifest.highlights).toHaveLength(HIGHLIGHTS.length);
  });

  it('opens a different player on every card', () => {
    const opens = manifest.highlights!.map((h) => h.who[0]!.id);
    expect(new Set(opens).size).toBe(opens.length);
  });

  it('sends every card to a slice that exists', () => {
    for (const h of manifest.highlights!) {
      const lead = h.who[0]!;
      const country = manifest.countries.find((c) => c.code === lead.federation);
      expect(country, `${lead.name} (${lead.federation})`).toBeDefined();
      expect(country!.genders[h.gender], `${lead.name} on ${lead.federation}-${h.gender}`).toBeDefined();
    }
  });
});
