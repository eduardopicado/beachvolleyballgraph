import { describe, expect, it } from 'vitest';
import { seasonEvents } from './results';
import type { ResultEntry, TournamentMeta } from '../schema';

const tournaments: Record<string, TournamentMeta> = {
  '1': ['Doha', 2024, 'beach-pro-tour', 65],
  '2': ['Paris', 2024, 'olympics', 209],
  '3': ['Gstaad', 2023, 'world-tour', 190],
  // No offset: a tournament whose date VIS could not parse.
  '4': ['Undated', 2024, 'beach-pro-tour'],
  // The five-element form carries an explicit null where the offset would be.
  '5': ['Undated with a code', 2024, 'beach-pro-tour', null, 'WUND2024'],
};

const entries: ResultEntry[] = [
  [2, 20, 1],
  [1, 20, 9],
  [4, 21, -2],
  [3, 20, 5],
];

const nameOf = (id: number) => ({ 20: 'Partner Twenty', 21: 'Partner Ttwenty-one' })[id] ?? null;

describe('seasonEvents', () => {
  it('keeps only the requested season', () => {
    expect(seasonEvents(entries, tournaments, 2023, nameOf).map((e) => e.name)).toEqual(['Gstaad']);
  });

  it('keeps the published order rather than re-sorting', () => {
    // The ingest already ordered these newest first; re-deriving it here would
    // be a second implementation of the same rule, free to disagree.
    expect(seasonEvents(entries, tournaments, 2024, nameOf).map((e) => e.no)).toEqual([2, 1, 4]);
  });

  it('reconstructs the date from the season and the offset', () => {
    const [paris] = seasonEvents(entries, tournaments, 2024, nameOf);
    expect(paris!.date?.toISOString().slice(0, 10)).toBe('2024-07-28');
  });

  it('leaves the date null when the tournament carried none', () => {
    const undated = seasonEvents(entries, tournaments, 2024, nameOf).find((e) => e.no === 4);
    expect(undated!.date).toBeNull();
  });

  it('treats an explicit null offset the same as a missing one', () => {
    // Publishing the code appended a fifth element, which means a dateless
    // tournament now carries `null` in the slot that used to be absent.
    // Reading that as 0 would date every one of them to 1 January.
    const [event] = seasonEvents([[5, 20, 9]], tournaments, 2024, nameOf);
    expect(event!.date).toBeNull();
  });

  it('handles a negative offset, which belongs to the season before its own year', () => {
    const early: Record<string, TournamentMeta> = { '9': ['Sydney', 2024, 'world-tour', -12] };
    const [event] = seasonEvents([[9, 20, 3]], early, 2024, nameOf);
    expect(event!.date?.toISOString().slice(0, 10)).toBe('2023-12-20');
  });

  it('carries the partner id even when nothing can name them', () => {
    const [event] = seasonEvents([[1, 99, 5]], tournaments, 2024, () => null);
    expect(event).toMatchObject({ partnerId: 99, partner: null });
  });

  it('drops an entry whose tournament is missing from the index', () => {
    expect(seasonEvents([[404, 20, 1]], tournaments, 2024, nameOf)).toEqual([]);
  });

  it('is empty for a player with no published results', () => {
    expect(seasonEvents(undefined, tournaments, 2024, nameOf)).toEqual([]);
  });
});

describe('seasonEvents — tournament level', () => {
  it('carries the level from the six-element form', () => {
    const events = seasonEvents(
      [[1, 99, 3]],
      { 1: ['Gstaad', 2019, 'world-tour', 180, 'MGST2019', '5-star'] },
      2019,
      () => 'Partner',
    );
    expect(events[0]!.level).toBe('5-star');
  });

  it('is null for a tournament published before the level existed', () => {
    // Five elements: the shape shipped by PR #55. A stale index must not throw
    // or invent a level, because the two files are published together and a
    // mismatch means one of them is old.
    const events = seasonEvents(
      [[1, 99, 3]],
      { 1: ['Gstaad', 2019, 'world-tour', 180, 'MGST2019'] },
      2019,
      () => 'Partner',
    );
    expect(events[0]!.level).toBeNull();
  });

  it('is null for the tiers that have no level below them', () => {
    const events = seasonEvents(
      [[1, 99, 1]],
      { 1: ['Olympic Games 2016', 2016, 'olympics', 220, 'MOLY2016'] },
      2016,
      () => 'Partner',
    );
    expect(events[0]!.level).toBeNull();
  });
});
