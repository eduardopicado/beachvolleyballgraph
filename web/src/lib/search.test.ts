import { describe, expect, it } from 'vitest';
import {
  foldAccents,
  groupOf,
  indexPlayers,
  searchPlayers,
  SEARCH_LIMIT,
  type SearchablePlayer,
  type Slice,
} from './search';

const HOME: Slice = { country: 'BRA', gender: 'M' };
const HOME_WOMEN: Slice = { country: 'BRA', gender: 'W' };
const ABROAD: Slice = { country: 'URU', gender: 'W' };

/**
 * Every player carries a slice — every search row names a country — so what
 * ranking turns on is how that slice compares to the page being viewed.
 */
const p = (id: number, name: string, tournaments = 10, slice: Slice = HOME, short?: string) =>
  indexPlayers([{ id, name, tournaments, slice, short }] as SearchablePlayer[])[0]!;

/** Result ids in order, which is what nearly every case here is about. */
const ids = (players: Parameters<typeof searchPlayers>[0], query: string, limit?: number) =>
  searchPlayers(players, query, HOME, limit).matches.map((m) => m.id);

describe('groupOf', () => {
  it('separates this page, the rest of the country, and everywhere else', () => {
    expect(groupOf(HOME, HOME)).toBe('home');
    expect(groupOf(HOME_WOMEN, HOME)).toBe('country');
    expect(groupOf(ABROAD, HOME)).toBe('elsewhere');
  });

  it('calls a compatriot of the other gender a compatriot, not a foreigner', () => {
    // The bug this exists for: home used to mean country *and* gender, so an
    // American woman was "elsewhere" on the United States men's page.
    expect(groupOf({ country: 'USA', gender: 'W' }, { country: 'USA', gender: 'M' })).toBe(
      'country',
    );
  });

  it('does not care which gender when the country already differs', () => {
    expect(groupOf({ country: 'GER', gender: 'M' }, HOME)).toBe('elsewhere');
    expect(groupOf({ country: 'GER', gender: 'W' }, HOME)).toBe('elsewhere');
  });
});

describe('searchPlayers', () => {
  const players = [
    p(1, 'Emanuel Rego', 291),
    p(2, 'Ricardo Alex Costa Santos', 281),
    p(3, 'Pedro Solberg', 263),
    p(4, 'Renato Andrew Lima de Carvalho', 12),
    p(5, 'Rego Junior', 3), // deliberately shares "Rego" with player 1
  ];

  it('matches an empty or whitespace query to nothing', () => {
    expect(searchPlayers(players, '', HOME)).toEqual({ matches: [], hidden: 0 });
    expect(searchPlayers(players, '   ', HOME)).toEqual({ matches: [], hidden: 0 });
  });

  it('is case-insensitive', () => {
    expect(ids(players, 'emanuel')).toEqual([1]);
    expect(ids(players, 'EMANUEL')).toEqual([1]);
  });

  it('ranks a name starting with the query above one that merely contains it', () => {
    // Player 5 "Rego Junior" starts with "Rego"; player 1 "Emanuel Rego" only
    // contains it partway through.
    expect(ids(players, 'Rego')).toEqual([5, 1]);
  });

  it('breaks ties within a rank group by tournament count', () => {
    // Ricardo, Renato and "Rego Junior" all start with "r" case-insensitively;
    // within that group, the more prominent player sorts first.
    const result = searchPlayers(players, 'R', HOME).matches;
    const starts = result.filter((m) => m.name.toLowerCase().startsWith('r'));
    expect(starts.map((m) => m.id)).toEqual([2, 4, 5]); // 281, 12, 3 tournaments
  });

  it('caps results at the limit', () => {
    const many = Array.from({ length: SEARCH_LIMIT + 12 }, (_, i) => p(i, `Test Player ${i}`, i));
    expect(ids(many, 'Test')).toHaveLength(SEARCH_LIMIT);
    expect(ids(many, 'Test', 3)).toHaveLength(3);
  });

  it('counts the matches the limit threw away', () => {
    // The cut is the search's real filter, and it used to be silent: against
    // the published index the median three-letter query matches 79 players.
    const many = Array.from({ length: SEARCH_LIMIT + 12 }, (_, i) => p(i, `Test Player ${i}`, i));
    expect(searchPlayers(many, 'Test', HOME).hidden).toBe(12);
    expect(searchPlayers(many, 'Test', HOME, 3).hidden).toBe(SEARCH_LIMIT + 9);
    expect(searchPlayers(many, 'Test', HOME, 500).hidden).toBe(0);
  });

  it('finds a mid-name substring, not just a prefix', () => {
    expect(ids(players, 'Costa')).toEqual([2]);
  });

  it('returns nothing for a query that matches no one', () => {
    expect(ids(players, 'Zzyzx')).toEqual([]);
  });

  it('finds an accented name from its plain-ASCII spelling', () => {
    // The whole reason folding exists: typing the accents is the unusual case,
    // and before it, "Barbara" matched nothing at all -- which reads as "she is
    // not in the data" rather than "type it with the accent".
    const accented = [p(1, 'Bárbara Seixas de Freitas'), p(2, 'Kristīne Puriņa')];
    expect(ids(accented, 'Barbara')).toEqual([1]);
    expect(ids(accented, 'Kristine')).toEqual([2]);
    expect(ids(accented, 'purina')).toEqual([2]);
  });

  it('still finds a name typed with its accents', () => {
    const accented = [p(1, 'Bárbara Seixas de Freitas')];
    expect(ids(accented, 'Bárbara')).toEqual([1]);
  });

  it('puts players from the page on screen above players from elsewhere', () => {
    // A reader on the Brazil page typing a name almost certainly means a
    // Brazilian one -- even when a more prominent player elsewhere matches.
    const away = p(9, 'Ana Patricia Silva Ramos', 200, ABROAD);
    const here = p(8, 'Ana Someone', 4);
    expect(ids([away, here], 'Ana')).toEqual([8, 9]);
  });

  /**
   * The regression this change exists for.
   *
   * Proximity used to be a tie-break *inside* the prefix and substring groups,
   * so any prefix match in the world outranked a local substring match.
   * Searching "silva" on the Brazil men's page really did put Silvana Hernandez
   * Barisone -- Uruguay, one tournament -- above Harley Marques Silva and his
   * 147, because "Silvana" begins with those five letters.
   */
  it('ranks a local substring above a prefix from another country', () => {
    const silvana = p(9, 'Silvana Hernandez Barisone', 1, ABROAD);
    const harley = p(2, 'Harley Marques Silva', 147);
    expect(ids([silvana, harley], 'Silva')).toEqual([2, 9]);
  });

  it('keeps prefix ahead of substring within one group', () => {
    // Proximity leading does not flatten the prefix rule, it only outranks it:
    // among players equally near, a prefix still comes first.
    const prefix = p(9, 'Costa Junior', 1);
    const substring = p(2, 'Ricardo Alex Costa Santos', 281);
    expect(ids([substring, prefix], 'Costa')).toEqual([9, 2]);
  });

  it('sorts the country in between, above everywhere else', () => {
    const away = p(9, 'Ana Elsewhere', 500, ABROAD);
    const compatriot = p(7, 'Ana Compatriot', 50, HOME_WOMEN);
    const here = p(8, 'Ana Here', 1);
    expect(ids([away, compatriot, here], 'Ana')).toEqual([8, 7, 9]);
  });

  it('labels every match with the group it was sorted into', () => {
    // The dropdown draws its headings straight off these, so they have to be
    // right on the rows and not merely right in the ordering.
    const matches = searchPlayers(
      [p(9, 'Ana Elsewhere', 500, ABROAD), p(7, 'Ana Compatriot', 50, HOME_WOMEN), p(8, 'Ana Here', 1)],
      'Ana',
      HOME,
    ).matches;
    expect(matches.map((m) => m.group)).toEqual(['home', 'country', 'elsewhere']);
  });

  it('keeps each group contiguous, so a run break is a group break', () => {
    // What lets the dropdown build its groups by walking the list once.
    const mixed = [
      p(1, 'Ana One', 1),
      p(2, 'Ana Two', 900, ABROAD),
      p(3, 'Ana Three', 800, HOME_WOMEN),
      p(4, 'Ana Four', 700, ABROAD),
      p(5, 'Ana Five', 2),
      p(6, 'Ana Six', 600, HOME_WOMEN),
    ];
    const seen = searchPlayers(mixed, 'Ana', HOME).matches.map((m) => m.group);
    expect(seen).toEqual(['home', 'home', 'country', 'country', 'elsewhere', 'elsewhere']);
  });

  it('is unchanged for a reader whose matches are all on their own page', () => {
    // The common case has to stay exactly as it was, headings and all: with one
    // group there is no boundary to draw.
    const only = [p(1, 'Ana One', 5), p(2, 'Ana Two', 50)];
    const matches = searchPlayers(only, 'Ana', HOME).matches;
    expect(matches.map((m) => m.id)).toEqual([2, 1]);
    expect(new Set(matches.map((m) => m.group))).toEqual(new Set(['home']));
  });

  it('reads the page from the argument, not from the players', () => {
    // Same list, different page: who counts as near changes with it.
    const list = [p(1, 'Ana Brazil', 5), p(2, 'Ana Uruguay', 5, ABROAD)];
    expect(searchPlayers(list, 'Ana', ABROAD).matches.map((m) => m.id)).toEqual([2, 1]);
  });
});

/**
 * The graph draws `short`, and until this the search matched only `name` — so
 * the one word a reader could see was the one word that found nobody. Eduarda
 * Santos Lisboa is "Duda" on every graph she appears in; 203 published players
 * are labelled with something their name does not contain.
 */
describe('the label the graph draws', () => {
  const duda = p(1, 'Eduarda Santos Lisboa', 104, HOME, 'Duda');

  it('finds a player by the name on their node', () => {
    expect(searchPlayers([duda], 'Duda', HOME).matches.map((m) => m.id)).toEqual([1]);
  });

  it('is folded like any other name', () => {
    const acc = p(2, 'Kevin Cès', 140, HOME, 'Cès K.');
    expect(searchPlayers([acc], 'ces', HOME).matches.map((m) => m.id)).toEqual([2]);
  });

  it('counts as a prefix, since it is the whole of what was on screen', () => {
    // Against a substring match on someone far more prominent: typing the label
    // exactly should not lose to a player who merely contains those letters.
    const other = p(2, 'Fernanda Dudamel', 300);
    const order = searchPlayers([other, duda], 'Duda', HOME).matches.map((m) => m.id);
    expect(order).toEqual([1, 2]);
  });

  it('still finds the player by their real name', () => {
    expect(searchPlayers([duda], 'Eduarda', HOME).matches.map((m) => m.id)).toEqual([1]);
    expect(searchPlayers([duda], 'Lisboa', HOME).matches.map((m) => m.id)).toEqual([1]);
  });

  it('is ignored when it only repeats the name', () => {
    // "P. Solberg" is already reachable by typing the name, so carrying it
    // would cost bytes in the published index and buy nothing.
    const plain = p(3, 'Pedro Solberg', 263, HOME, 'Solberg');
    expect(plain.foldedShort).toBeUndefined();
  });

  it('matches nothing extra for a player who has no label', () => {
    const plain = p(4, 'Ana Someone', 5);
    expect(plain.foldedShort).toBeUndefined();
    expect(searchPlayers([plain], 'zzz', HOME).matches).toEqual([]);
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

describe('former names', () => {
  const player = (id: number, name: string, alsoKnownAs?: string[]) => ({
    id,
    name,
    tournaments: 10,
    slice: { country: 'USA', gender: 'W' as const },
    alsoKnownAs,
  });
  const home = { country: 'USA', gender: 'W' as const };

  it('finds a player by the name she used to compete under', () => {
    // The case this exists for: fourteen titles won as Kloth, every one of them
    // now recorded under Brasher, and "Kloth" finding nobody.
    const index = indexPlayers([player(1, 'Taryn Brasher', ['Taryn Kloth'])]);
    expect(searchPlayers(index, 'kloth', home).matches.map((m) => m.id)).toEqual([1]);
  });

  it('still shows the current name on the row', () => {
    const index = indexPlayers([player(1, 'Taryn Brasher', ['Taryn Kloth'])]);
    expect(searchPlayers(index, 'kloth', home).matches[0]!.name).toBe('Taryn Brasher');
  });

  /**
   * A former name matches as a substring but never as a prefix.
   *
   * Someone typing "Kloth" should reach Taryn Brasher — but below anyone
   * actually called Kloth today, because a reader typing a name is usually
   * looking for the person who holds it. Ranking the two together would put a
   * renamed player ahead of her own namesakes.
   */
  it('ranks a current name above a former one', () => {
    const index = indexPlayers([
      player(1, 'Taryn Brasher', ['Taryn Kloth']),
      player(2, 'Mia Kloth-Jorgensen'),
    ]);
    expect(searchPlayers(index, 'kloth', home).matches.map((m) => m.id)).toEqual([2, 1]);
  });

  it('ignores an empty list rather than indexing an empty string', () => {
    // An empty alias folded to '' and stored would make every query match,
    // since ''.includes(q) is false but q.includes('') is not the test used.
    const index = indexPlayers([player(1, 'Someone', [])]);
    expect(index[0]!.foldedAka).toBeUndefined();
    expect(searchPlayers(index, 'zzz', home).matches).toEqual([]);
  });

  it('folds accents on a former name, like any other', () => {
    const index = indexPlayers([player(1, 'Helena Grozer', ['Helena Havelková'])]);
    expect(searchPlayers(index, 'havelkova', home).matches.map((m) => m.id)).toEqual([1]);
  });

  it('cannot match across the seam of two separate former names', () => {
    // They are joined with a space to build one folded string; a query must not
    // be able to span the join and match a name that never existed.
    const index = indexPlayers([player(1, 'A Player', ['First Name', 'Second Name'])]);
    expect(searchPlayers(index, 'nameseconds', home).matches).toEqual([]);
  });
});
