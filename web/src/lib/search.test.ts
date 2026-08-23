import { describe, expect, it } from 'vitest';
import { foldAccents, indexPlayers, searchPlayers, type SearchablePlayer } from './search';
import type { Gender } from '../schema';

/**
 * `elsewhere` is what ranking turns on, not the presence of a slice: every
 * player carries a slice now, because every search row names a country.
 */
const p = (id: number, name: string, tournaments = 10, elsewhere = false) =>
  indexPlayers([
    { id, name, tournaments, slice: { country: 'BRA', gender: 'M' as Gender }, elsewhere },
  ] as SearchablePlayer[])[0]!;

describe('searchPlayers', () => {
  const players = [
    p(1, 'Emanuel Rego', 291),
    p(2, 'Ricardo Alex Costa Santos', 281),
    p(3, 'Pedro Solberg', 263),
    p(4, 'Renato Andrew Lima de Carvalho', 12),
    p(5, 'Rego Junior', 3), // deliberately shares "Rego" with player 1
  ];

  it('matches an empty or whitespace query to nothing', () => {
    expect(searchPlayers(players, '')).toEqual([]);
    expect(searchPlayers(players, '   ')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(searchPlayers(players, 'emanuel').map((m) => m.id)).toEqual([1]);
    expect(searchPlayers(players, 'EMANUEL').map((m) => m.id)).toEqual([1]);
  });

  it('ranks a name starting with the query above one that merely contains it', () => {
    // "Rego" starts player 1's surname-first... actually starts neither full
    // name, so use a query that distinguishes prefix vs substring directly.
    const result = searchPlayers(players, 'Rego');
    // Player 5 "Rego Junior" starts with "Rego"; player 1 "Emanuel Rego" only
    // contains it partway through.
    expect(result.map((m) => m.id)).toEqual([5, 1]);
  });

  it('breaks ties within a rank group by tournament count', () => {
    // Ricardo, Renato and "Rego Junior" all start with "r" case-insensitively;
    // within that group, the more prominent player sorts first.
    const result = searchPlayers(players, 'R');
    const starts = result.filter((m) => m.name.toLowerCase().startsWith('r'));
    expect(starts.map((m) => m.id)).toEqual([2, 4, 5]); // 281, 12, 3 tournaments
  });

  it('caps results at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => p(i, `Test Player ${i}`, i));
    expect(searchPlayers(many, 'Test')).toHaveLength(8);
    expect(searchPlayers(many, 'Test', 3)).toHaveLength(3);
  });

  it('finds a mid-name substring, not just a prefix', () => {
    expect(searchPlayers(players, 'Costa').map((m) => m.id)).toEqual([2]);
  });

  it('returns nothing for a query that matches no one', () => {
    expect(searchPlayers(players, 'Zzyzx')).toEqual([]);
  });

  it('finds an accented name from its plain-ASCII spelling', () => {
    // The whole reason this exists: typing the accents is the unusual case,
    // and before folding, "Barbara" matched nothing at all -- which reads as
    // "she is not in the data" rather than "type it with the accent".
    const accented = [p(1, 'Bárbara Seixas de Freitas'), p(2, 'Kristīne Puriņa')];
    expect(searchPlayers(accented, 'Barbara').map((m) => m.id)).toEqual([1]);
    expect(searchPlayers(accented, 'Kristine').map((m) => m.id)).toEqual([2]);
    expect(searchPlayers(accented, 'purina').map((m) => m.id)).toEqual([2]);
  });

  it('still finds a name typed with its accents', () => {
    const accented = [p(1, 'Bárbara Seixas de Freitas')];
    expect(searchPlayers(accented, 'Bárbara').map((m) => m.id)).toEqual([1]);
  });

  it('puts players from the slice on screen above players from elsewhere', () => {
    // A reader on the Brazil page typing a name almost certainly means a
    // Brazilian one -- even when a more prominent player elsewhere matches.
    const elsewhere = p(9, 'Ana Patricia Silva Ramos', 200, true);
    const here = p(8, 'Ana Someone', 4);
    expect(searchPlayers([elsewhere, here], 'Ana').map((m) => m.id)).toEqual([8, 9]);
  });

  it('still ranks a prefix from elsewhere above a substring on screen', () => {
    // Slice is a tie-break inside a match group, not a filter over them.
    const elsewhere = p(9, 'Costa Junior', 1, true);
    const here = p(2, 'Ricardo Alex Costa Santos', 281);
    expect(searchPlayers([here, elsewhere], 'Costa').map((m) => m.id)).toEqual([9, 2]);
  });
});

describe('foldAccents', () => {
  it('strips diacritics and case', () => {
    expect(foldAccents('João')).toBe('joao');
    expect(foldAccents('ÅSA-Märta')).toBe('asa-marta');
  });

  it('leaves a plain name alone', () => {
    expect(foldAccents('Emanuel Rego')).toBe('emanuel rego');
  });
});
