import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RecordBoard, RecordKey, RecordRow, RecordsFile } from '../../../shared/schema';
import { GENDERS, RECORD_KEYS } from '../../../shared/schema';
import { boardsFor, rowDetail } from './records';
import { genderFromParams, isRecordsPath, paramsForGender, recordsPagePath } from './recordsRoute';

const who = (id: number, federation = 'BRA') => ({ id, name: `Player ${id}`, federation });
const row = (rank: number, value: number, ...ids: number[]): RecordRow => ({ rank, value, who: ids.map((id) => who(id)) });
const held = (rank: number): RecordRow => ({ rank, withheld: true });

/** A file holding only the women's boards a test names; every other board is empty. */
function fileOf(boards: Partial<Record<RecordKey, RecordBoard>>): RecordsFile {
  const categories = {} as RecordsFile['categories'];
  for (const key of RECORD_KEYS) {
    categories[key] = { M: { rows: [], ties: 0 }, W: boards[key] ?? { rows: [], ties: 0 } };
  }
  return { top: 5, categories };
}

describe('boardsFor', () => {
  it('leaves an unconfirmed row off the page, keeping the ranks of the rows around it', () => {
    // A height board with unconfirmed rows between confirmed ones: 1, x, 3, x, 5.
    const file = fileOf({
      'tallest-champion': { rows: [row(1, 204, 1), held(2), row(3, 198, 3), held(4), row(5, 197, 5)], ties: 0 },
    });
    const [tallest] = boardsFor(file, 'W');
    expect(tallest!.rows.map((r) => r.rank)).toEqual([1, 3, 5]);
    expect(tallest!.rows.map((r) => r.value)).toEqual([204, 198, 197]);
  });

  it('drops a board with nothing confirmed on it, rather than drawing it empty', () => {
    const file = fileOf({
      'shortest-champion': { rows: [held(1), held(1), held(3)], ties: 0 },
      titles: { rows: [row(1, 61, 1)], ties: 0 },
    });
    expect(boardsFor(file, 'W').map((b) => b.key)).toEqual(['titles']);
  });

  it('keeps the file\'s category order', () => {
    const file = fileOf({
      titles: { rows: [row(1, 61, 1)], ties: 0 },
      tournaments: { rows: [row(1, 234, 2)], ties: 0 },
    });
    expect(boardsFor(file, 'W').map((b) => b.key)).toEqual(['tournaments', 'titles']);
  });

  it('says how many more share the last value, unless that value is one it hides', () => {
    const shown = fileOf({ partners: { rows: [row(1, 22, 1), row(2, 14, 2)], ties: 3 } });
    expect(boardsFor(shown, 'W')[0]!.ties).toBe(3);
    // "and 2 more at —" has no honest rendering.
    const hidden = fileOf({ 'tallest-champion': { rows: [row(1, 204, 1), held(2)], ties: 2 } });
    expect(boardsFor(hidden, 'W')[0]!.ties).toBe(0);
  });

  it('marks a shared rank as joint on every row that holds it', () => {
    const file = fileOf({ games: { rows: [row(1, 5, 1), row(1, 5, 2), row(3, 4, 3)], ties: 0 } });
    expect(boardsFor(file, 'W')[0]!.rows.map((r) => r.joint)).toEqual([true, true, false]);
  });

  it('marks a row joint with a hidden row at the same rank', () => {
    // A confirmed 198 sharing second with two unconfirmed 198s.
    const file = fileOf({
      'tallest-champion': { rows: [row(1, 204, 1), held(2), row(2, 198, 3), held(2), row(5, 197, 5)], ties: 0 },
    });
    expect(boardsFor(file, 'W')[0]!.rows.map((r) => [r.rank, r.joint])).toEqual([
      [1, false],
      [2, true],
      [5, false],
    ]);
  });

  it('marks the last row joint when candidates at its value were cut for space', () => {
    const file = fileOf({ tournaments: { rows: [row(1, 255, 1), row(2, 206, 2)], ties: 1 } });
    expect(boardsFor(file, 'W')[0]!.rows.map((r) => r.joint)).toEqual([false, true]);
  });

  it('marks nothing joint on a board with no ties', () => {
    const file = fileOf({ titles: { rows: [row(1, 61, 1), row(2, 50, 2), row(3, 47, 3)], ties: 0 } });
    expect(boardsFor(file, 'W')[0]!.rows.every((r) => !r.joint)).toBe(true);
  });
});

describe('rowDetail', () => {
  const name = (code: string) => ({ BRA: 'Brazil', CYP: 'Cyprus', FIN: 'Finland' })[code] ?? code;

  it('names the country alone where the row carries no seasons', () => {
    expect(rowDetail('tournaments', { rank: 1, value: 255, who: [who(1)] }, name)).toBe('Brazil');
  });

  it('adds the seasons where it does', () => {
    const r = { rank: 1, value: 85, who: [who(1), who(2)], first: 1995, last: 2007 };
    expect(rowDetail('pair-podiums', r, name)).toBe('Brazil · 1995–2007');
  });

  it('names a split pair\'s two countries, and a shared one once', () => {
    const r = { rank: 1, value: 157, who: [who(1, 'CYP'), who(2, 'FIN')], first: 2001, last: 2015 };
    expect(rowDetail('partnership', r, name)).toBe('Cyprus & Finland · 2001–2015');
  });

  it('describes a reunion by its gap, not by the whole span', () => {
    const r = { rank: 1, value: 16, who: [who(1), who(2)], first: 2003, last: 2024, gap: [2004, 2021] as [number, number] };
    expect(rowDetail('reunion', r, name)).toBe('Brazil · split after 2004, back in 2021');
  });
});

describe('the records route', () => {
  it('matches the page with or without a deploy base, and nothing near it', () => {
    expect(isRecordsPath('/records/', '/')).toBe(true);
    expect(isRecordsPath('/records', '/')).toBe(true);
    expect(isRecordsPath('/records/index.html', '/')).toBe(true);
    expect(isRecordsPath('/repo/records/', '/repo/')).toBe(true);
    expect(isRecordsPath('/records/extra/', '/')).toBe(false);
    expect(isRecordsPath('/brazil-men/', '/')).toBe(false);
    expect(isRecordsPath('/', '/')).toBe(false);
  });

  it('reads the draw, defaulting to men on anything else', () => {
    expect(genderFromParams(new URLSearchParams('gender=W'))).toBe('W');
    expect(genderFromParams(new URLSearchParams('gender=M'))).toBe('M');
    expect(genderFromParams(new URLSearchParams('gender=X'))).toBe('M');
    expect(genderFromParams(new URLSearchParams(''))).toBe('M');
  });

  it('writes nothing for the default draw', () => {
    expect(paramsForGender('M')).toBe('');
    expect(paramsForGender('W')).toBe('gender=W');
    expect(recordsPagePath('/repo/')).toBe('/repo/records/');
  });
});

/**
 * The rule the owner set — an unconfirmed record is not shown — checked on
 * what was actually published, where the withheld rows really are.
 */
describe('the published records, as the page shows them', () => {
  const file = JSON.parse(
    readFileSync(new URL('../../public/v1/records.json', import.meta.url), 'utf8'),
  ) as RecordsFile;

  it('never shows a withheld row', () => {
    for (const gender of GENDERS) {
      for (const board of boardsFor(file, gender)) {
        for (const r of board.rows) {
          expect(r, `${board.key} ${gender} #${r.rank}`).toHaveProperty('value');
          expect(r.who.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('shows every confirmed row the file publishes', () => {
    for (const gender of GENDERS) {
      const shown = boardsFor(file, gender).reduce((n, b) => n + b.rows.length, 0);
      const published = RECORD_KEYS.reduce(
        (n, k) => n + file.categories[k][gender].rows.filter((r) => !('withheld' in r)).length,
        0,
      );
      expect(shown, gender).toBe(published);
    }
  });
});
