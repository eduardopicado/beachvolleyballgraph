import { describe, expect, it } from 'vitest';
import { filterFromParams, indexPath, INDEX_PREFIX, isIndexPath, paramsFor } from './indexRoute';
import type { IndexFilter } from './tournamentIndex';

const q = (s: string) => new URLSearchParams(s);

describe('isIndexPath', () => {
  it('matches the index', () => {
    expect(isIndexPath('/tournaments/', '/')).toBe(true);
    expect(isIndexPath('/tournaments', '/')).toBe(true);
    expect(isIndexPath('/tournaments/index.html', '/')).toBe(true);
  });

  it('honours a deploy base', () => {
    expect(isIndexPath('/repo/tournaments/', '/repo/')).toBe(true);
    // A path that does not carry the base is read as if it were root-relative,
    // matching `tournamentSlugFromPath` and `slugFromPath`. Under a project
    // deploy the browser never serves this app at `/tournaments/` anyway, so
    // the leniency costs nothing and the three agreeing is worth more than
    // one of them being strict on its own.
    expect(isIndexPath('/tournaments/', '/repo/')).toBe(true);
  });

  it('does not match a tournament page, which differs by one letter', () => {
    expect(isIndexPath('/tournament/gstaad-2019-women/', '/')).toBe(false);
  });

  it('does not match as a prefix', () => {
    // Nothing is published beneath the index today; matching loosely would
    // silently swallow whatever is published there later.
    expect(isIndexPath('/tournaments/2019/', '/')).toBe(false);
  });

  it('does not match the home page or a country slice', () => {
    expect(isIndexPath('/', '/')).toBe(false);
    expect(isIndexPath('/brazil-men/', '/')).toBe(false);
  });
});

describe('indexPath', () => {
  it('hangs off the deploy base', () => {
    expect(indexPath('/')).toBe(`/${INDEX_PREFIX}/`);
    expect(indexPath('/repo/')).toBe(`/repo/${INDEX_PREFIX}/`);
  });
});

describe('filterFromParams', () => {
  it('reads a full filter', () => {
    expect(filterFromParams(q('gender=W&season=2019&tier=tour&level=4-star'), 2026)).toEqual({
      gender: 'W',
      season: 2019,
      group: 'tour',
      level: '4-star',
    });
  });

  it('falls back to the men-s draw and the newest season', () => {
    expect(filterFromParams(q(''), 2026)).toEqual({
      gender: 'M',
      season: 2026,
      group: null,
      level: null,
    });
  });

  it('rejects a gender that is not one', () => {
    expect(filterFromParams(q('gender=X'), 2026).gender).toBe('M');
  });

  it('rejects a season that is not a positive integer', () => {
    // All three are one keystroke away in the address bar.
    expect(filterFromParams(q('season=nineteen'), 2026).season).toBe(2026);
    expect(filterFromParams(q('season=2019.5'), 2026).season).toBe(2026);
    expect(filterFromParams(q('season=-3'), 2026).season).toBe(2026);
  });

  it('rejects a tier that is not a chip', () => {
    // "world-tour" is a real tier and deliberately not a group: the chips
    // fold both tour eras together.
    expect(filterFromParams(q('tier=world-tour'), 2026).group).toBe(null);
    expect(filterFromParams(q('tier=nonsense'), 2026).group).toBe(null);
  });

  it('passes a level through unchecked, for reconcile to judge against the season', () => {
    // Whether "Grand Slam" is real depends on the season, which this does not
    // know; validating here would need the archive and would duplicate it.
    expect(filterFromParams(q('season=2025&level=Grand Slam'), 2026).level).toBe('Grand Slam');
  });
});

describe('paramsFor', () => {
  const base: IndexFilter = { gender: 'M', season: 2026, group: null, level: null };

  it('writes nothing for the men-s draw or an unset chip', () => {
    expect(paramsFor(base)).toBe('season=2026');
  });

  it('writes every field that is set', () => {
    expect(paramsFor({ gender: 'W', season: 2019, group: 'tour', level: '4-star' })).toBe(
      'gender=W&season=2019&tier=tour&level=4-star',
    );
  });

  it('round-trips through filterFromParams', () => {
    const filters: IndexFilter[] = [
      base,
      { gender: 'W', season: 1996, group: null, level: null },
      { gender: 'M', season: 2024, group: 'olympics', level: null },
      { gender: 'W', season: 2025, group: 'tour', level: 'Elite16' },
    ];
    for (const filter of filters) {
      expect(filterFromParams(q(paramsFor(filter)), 2026)).toEqual(filter);
    }
  });
});
