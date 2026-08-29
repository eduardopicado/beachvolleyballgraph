import { describe, expect, it } from 'vitest';
import { OLYMPIC_GAMES, olympicName } from './olympics.js';

describe('olympicName', () => {
  it('names every Games the archive holds', () => {
    // The eight editions with results in VIS today.
    expect(olympicName(1996)).toBe('Atlanta 1996');
    expect(olympicName(2004)).toBe('Athens 2004');
    expect(olympicName(2016)).toBe('Rio de Janeiro 2016');
    expect(olympicName(2024)).toBe('Paris 2024');
  });

  it('names London, which FIVB never does', () => {
    // FIVB files both 2012 draws as "Olympic Games 2012". The city is in the
    // tournament code and nowhere else, which is the reason this map exists.
    expect(olympicName(2012)).toBe('London 2012');
  });

  it('calls the Tokyo Games by their own name, not the year they were held', () => {
    // Postponed a year: the archive files them under season 2021, and they are
    // officially Tokyo 2020. The timeline shows the season in its gutter, so a
    // reader gets both.
    expect(olympicName(2021)).toBe('Tokyo 2020');
    expect(olympicName(2020)).toBeNull();
  });

  it('is ready for Los Angeles before the tournament exists', () => {
    // Entered ahead of time and keyed by season, so it does not depend on
    // guessing the code FIVB will invent for it.
    expect(olympicName(2028)).toBe('Los Angeles 2028');
  });

  it('gives nothing for a Games it has not been told about', () => {
    // Null rather than a guess: an unknown edition keeps whatever FIVB called
    // it, which is worse-looking but never wrong.
    expect(olympicName(2032)).toBeNull();
    expect(olympicName(1992)).toBeNull();
  });

  it('names exactly one Games per season', () => {
    // The whole key rests on this. Two editions in one season would silently
    // mislabel one of them.
    const seasons = Object.keys(OLYMPIC_GAMES).map(Number);
    expect(new Set(seasons).size).toBe(seasons.length);
    expect(new Set(Object.values(OLYMPIC_GAMES)).size).toBe(seasons.length);
  });
});
