import { describe, expect, it } from 'vitest';
import { readTournament } from './tournamentMeta';
import type { TournamentMeta } from '../schema';

describe('readTournament', () => {
  it('reads the longest form, gender included', () => {
    const meta: TournamentMeta = [
      'Gstaad', 2019, 'world-tour', 190, 'WGST2019', '5-star', 'CH', 5, 'W',
    ];
    expect(readTournament(meta)).toEqual({
      name: 'Gstaad',
      season: 2019,
      tier: 'world-tour',
      startOffset: 190,
      code: 'WGST2019',
      level: '5-star',
      country: 'CH',
      span: 5,
      gender: 'W',
    });
  });

  it('gives null for every field a shorter form does not carry', () => {
    // The three-element form: the oldest rows, with no date and no code.
    const facts = readTournament(['Ancient', 1987, 'world-tour']);
    expect(facts.name).toBe('Ancient');
    expect(facts.startOffset).toBeNull();
    expect(facts.code).toBeNull();
    expect(facts.level).toBeNull();
    expect(facts.country).toBeNull();
    expect(facts.span).toBeNull();
    expect(facts.gender).toBeNull();
  });

  it('does not mistake the eight-element form for one carrying a gender', () => {
    // The tree as published between the commit that added `country` and the
    // one that added `gender`.
    //
    // This pins the *answer*, not the mechanism: `meta[8] ?? null` gives null
    // for a short tuple whether or not the length is checked first, so
    // removing that check breaks nothing here and the check is house style
    // rather than a guard. What must not change is that a tree too old to
    // carry a draw says so, instead of being read as one gender or the other.
    const meta: TournamentMeta = ['Doha', 2019, 'world-tour', 65, 'MDOH2019', '4-star', 'QA', 3];
    expect(readTournament(meta).gender).toBeNull();
    expect(readTournament(meta).span).toBe(3);
  });

  it('keeps an explicit null distinct from a missing slot', () => {
    // The Olympics carry no level, so the slot is written as null to hold the
    // place for the fields after it.
    const meta: TournamentMeta = [
      'Paris 2024', 2024, 'olympics', 209, 'MPAR2024', null, 'FR', 10, 'M',
    ];
    const facts = readTournament(meta);
    expect(facts.level).toBeNull();
    expect(facts.country).toBe('FR');
    expect(facts.gender).toBe('M');
  });
});
