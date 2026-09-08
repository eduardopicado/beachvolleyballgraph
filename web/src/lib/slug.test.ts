import { describe, expect, it } from 'vitest';
import type { Gender } from '../schema';
import {
  sliceSlug, slicePath, slugFromPath, slugify,
  tournamentSlug,
  tournamentSlugs,
} from './slug';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('United States')).toBe('united-states');
  });
  it('strips diacritics rather than dropping the letters', () => {
    expect(slugify('Côte d’Ivoire')).toBe('cote-d-ivoire');
    expect(slugify('Türkiye')).toBe('turkiye');
  });
  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugify('  Congo - Brazzaville!  ')).toBe('congo-brazzaville');
  });
});

describe('sliceSlug', () => {
  it('appends a readable gender', () => {
    expect(sliceSlug('Brazil', 'M')).toBe('brazil-men');
    expect(sliceSlug('Brazil', 'W')).toBe('brazil-women');
  });
});

describe('slicePath', () => {
  it('honours the deploy base', () => {
    expect(slicePath('/', 'Norway', 'M')).toBe('/norway-men/');
    expect(slicePath('/repo/', 'Norway', 'M')).toBe('/repo/norway-men/');
  });
});

describe('slugFromPath', () => {
  it('round-trips a slice path', () => {
    const path = slicePath('/repo/', 'Brazil', 'W');
    expect(slugFromPath(path, '/repo/')).toBe(sliceSlug('Brazil', 'W'));
  });

  it('returns null at the site root', () => {
    expect(slugFromPath('/', '/')).toBeNull();
    expect(slugFromPath('/repo/', '/repo/')).toBeNull();
    expect(slugFromPath('/repo/index.html', '/repo/')).toBeNull();
  });

  it('tolerates a missing trailing slash and an explicit index.html', () => {
    expect(slugFromPath('/brazil-men', '/')).toBe('brazil-men');
    expect(slugFromPath('/brazil-men/index.html', '/')).toBe('brazil-men');
  });

  it('does not mistake a base-less path for a slug-less root', () => {
    expect(slugFromPath('/norway-women/', '/')).toBe('norway-women');
  });
});

describe('tournamentSlug', () => {
  it('reads as the event, not as FIVB’s code', () => {
    expect(tournamentSlug('Gstaad', 2019, 'W')).toBe('gstaad-2019-women');
    expect(tournamentSlug('Stare Jablonki', 2008, 'M')).toBe('stare-jablonki-2008-men');
  });

  it('strips diacritics and punctuation the way slice slugs do', () => {
    expect(tournamentSlug('Pärnu', 2008, 'M')).toBe('parnu-2008-men');
    expect(tournamentSlug('Roseto degli Abruzzi', 2005, 'W')).toBe('roseto-degli-abruzzi-2005-women');
  });

  it('appends a disambiguator when given one', () => {
    expect(tournamentSlug('Sofia', 2021, 'M', 'MSOF2021')).toBe('sofia-2021-men-msof2021');
  });
});

describe('tournamentSlugs', () => {
  type Row = { name: string; season: number; gender: Gender; code: string };
  const slugsOf = (rows: Row[]) => {
    const map = tournamentSlugs(rows, (r) => r);
    return rows.map((r) => map.get(r)!);
  };

  it('leaves a tournament with no clash clean', () => {
    expect(
      slugsOf([
        { name: 'Gstaad', season: 2019, gender: 'W', code: 'WGST2019' },
        { name: 'Gstaad', season: 2018, gender: 'W', code: 'WGST2018' },
      ]),
    ).toEqual(['gstaad-2019-women', 'gstaad-2018-women']);
  });

  it('gives the code to every member of a clash, not just the later one', () => {
    // Otherwise one arbitrary member keeps the clean URL, and which one it is
    // depends on iteration order — so an unrelated event being added to the
    // archive could move a tournament's address.
    expect(
      slugsOf([
        { name: 'Torquay', season: 2022, gender: 'M', code: 'MAUS2022' },
        { name: 'Torquay', season: 2022, gender: 'M', code: 'MSYD2022' },
      ]),
    ).toEqual(['torquay-2022-men-maus2022', 'torquay-2022-men-msyd2022']);
  });

  it('handles a three-way clash', () => {
    // Sofia 2021 really is three events, in both draws.
    expect(
      slugsOf([
        { name: 'Sofia', season: 2021, gender: 'W', code: 'WSOF2021' },
        { name: 'Sofia', season: 2021, gender: 'W', code: 'WSFI2021' },
        { name: 'Sofia', season: 2021, gender: 'W', code: 'WSOI2021' },
      ]),
    ).toEqual(['sofia-2021-women-wsof2021', 'sofia-2021-women-wsfi2021', 'sofia-2021-women-wsoi2021']);
  });

  it('separates the two draws of one event without needing a code', () => {
    expect(
      slugsOf([
        { name: 'Gstaad', season: 2019, gender: 'M', code: 'MGST2019' },
        { name: 'Gstaad', season: 2019, gender: 'W', code: 'WGST2019' },
      ]),
    ).toEqual(['gstaad-2019-men', 'gstaad-2019-women']);
  });

  it('files a draw by the gender it was given, not by its code’s first letter', () => {
    // WWRS2022 is a field of 54 men under a `W` (quirks §23). Passed the
    // classification's own gender, it lands beside the other Warsaw men's
    // event and takes a code suffix because the two now clash.
    expect(
      slugsOf([
        { name: 'Warsaw', season: 2022, gender: 'M', code: 'MWAR2022' },
        { name: 'Warsaw', season: 2022, gender: 'M', code: 'WWRS2022' },
      ]),
    ).toEqual(['warsaw-2022-men-mwar2022', 'warsaw-2022-men-wwrs2022']);
  });
});
