import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIVB_ORGANIZER_TYPE, levelFor, TIER_BY_TYPE, tierFor } from './tiers';

describe('tierFor', () => {
  it('admits the Olympic Games and nothing else Olympic-adjacent', () => {
    // The tier used to hold three competitions, and nothing asserted any of
    // them — it could be changed in either direction without a single
    // failure, which is how the other two went unnoticed.
    expect(tierFor(FIVB_ORGANIZER_TYPE, '5')).toBe('olympics');

    // Type 43 is the *Youth* Games: an age-group event that would put U19
    // competition in the senior graph, and that INCLUDE_AGE_GROUP could not
    // reach because it was never tagged age-group-wch.
    expect(tierFor(FIVB_ORGANIZER_TYPE, '43')).toBeNull();

    // Type 49 is the qualification tournament, where several teams "win" —
    // the 2019 edition has two teams at Rank 1 and two at Rank 3 per draw,
    // because it hands out berths rather than crowning a champion.
    expect(tierFor(FIVB_ORGANIZER_TYPE, '49')).toBeNull();
  });

  it('classifies each recognised tier from an FIVB-organized tournament', () => {
    expect(tierFor(FIVB_ORGANIZER_TYPE, '5')).toBe('olympics');
    expect(tierFor(FIVB_ORGANIZER_TYPE, '4')).toBe('world-champs');
    expect(tierFor(FIVB_ORGANIZER_TYPE, '13')).toBe('age-group-wch');
    expect(tierFor(FIVB_ORGANIZER_TYPE, '0')).toBe('world-tour');
    expect(tierFor(FIVB_ORGANIZER_TYPE, '42')).toBe('world-tour'); // the real 1-star
    expect(tierFor(FIVB_ORGANIZER_TYPE, '52')).toBe('beach-pro-tour');
  });

  it('excludes anything not organized by FIVB, regardless of Type', () => {
    for (const organizerType of ['0', '2', '3', '4', '5', undefined]) {
      expect(tierFor(organizerType, '0')).toBeNull(); // even a real World Tour Type code
    }
  });

  it('excludes Type 15 (National Tour) even when OrganizerType claims FIVB', () => {
    // FIVB's own schema names Type 15 "NationalTour" outright (the real
    // 1-star is 42) -- and OrganizerType on National Tour records is not a
    // reliable enough signal to filter by; plenty of confirmed domestic tour
    // stops (Australia, Argentina, Poland, more) carry OrganizerType 1.
    // Regression test for exactly that: this must stay excluded no matter
    // what OrganizerType says.
    expect(tierFor(FIVB_ORGANIZER_TYPE, '15')).toBeNull();
    expect(tierFor('5', '15')).toBeNull();
  });

  it('excludes the other National Tour age-group variants too', () => {
    for (const type of ['16', '17', '18', '19' /* also snow, but still excluded */, '20', '21', '28', '29', '30', '46']) {
      expect(tierFor(FIVB_ORGANIZER_TYPE, type)).toBeNull();
    }
  });

  it('excludes continental championships, seminars, snow volleyball and King of the Court', () => {
    for (const type of ['7', '8', '9', '11', '12', '34', '35', '36', '44', '45', '47', '48', '50', '55']) {
      expect(tierFor(FIVB_ORGANIZER_TYPE, type)).toBeNull();
    }
  });

  it('excludes an unrecognised or missing Type', () => {
    expect(tierFor(FIVB_ORGANIZER_TYPE, '999')).toBeNull();
    expect(tierFor(FIVB_ORGANIZER_TYPE, undefined)).toBeNull();
  });

  it('respects INCLUDE_AGE_GROUP', async () => {
    const original = process.env.INCLUDE_AGE_GROUP;
    process.env.INCLUDE_AGE_GROUP = 'false';
    // INCLUDE_AGE_GROUP is read once at module load, so exercising a
    // different value means forcing a fresh module instance rather than
    // reusing the one already imported at the top of this file.
    vi.resetModules();
    const { tierFor: tierForExcluded } = await import('./tiers.js');
    expect(tierForExcluded(FIVB_ORGANIZER_TYPE, '13')).toBeNull();
    process.env.INCLUDE_AGE_GROUP = original;
  });

  afterEach(() => {
    vi.resetModules();
  });
});

describe('levelFor', () => {
  it('names each level the way FIVB does, era by era', () => {
    // Checked against FIVB's own enum, not inferred from tournament names —
    // https://www.fivb.org/VisSDK/VisWebService/BeachTournamentType.html
    expect(levelFor('0')).toBe('Grand Slam');
    expect(levelFor('38')).toBe('5-star');
    expect(levelFor('39')).toBe('4-star');
    expect(levelFor('42')).toBe('1-star');
    expect(levelFor('52')).toBe('Elite16');
    expect(levelFor('53')).toBe('Futures');
  });

  it('does not confuse Major Series with the 5-star that replaced it', () => {
    // Type 32 is the 2015-16 branding; Type 38 is `WorldTour5Star`, which this
    // repo mislabelled "Major" for months. Two different things, two levels.
    expect(levelFor('32')).toBe('Major Series');
    expect(levelFor('38')).toBe('5-star');
  });

  it('has no level for a tier that has none below it', () => {
    expect(levelFor('5')).toBeNull(); // Olympic Games
    expect(levelFor('4')).toBeNull(); // World Championships
    expect(levelFor('26')).toBeNull(); // U21 World Championships
  });

  it('is null for a type outside the allowlist entirely', () => {
    expect(levelFor('15')).toBeNull(); // National Tour
    expect(levelFor('50')).toBeNull(); // King of the Court
    expect(levelFor(undefined)).toBeNull();
  });

  /**
   * The levels are labels, not a scale. Two eras used a *word* for their top
   * rung and one used a number, so anything sorting these would be inventing
   * a hierarchy FIVB itself abandoned twice.
   */
  it('every level a qualifying tour type can carry is a non-empty label', () => {
    for (const [type, tier] of Object.entries(TIER_BY_TYPE)) {
      const level = levelFor(type);
      if (tier === 'world-tour' || tier === 'beach-pro-tour') {
        expect(level, `type ${type} is a tour event and should carry a level`).toBeTruthy();
      } else {
        expect(level, `type ${type} is not a tour event and should not`).toBeNull();
      }
    }
  });
});
