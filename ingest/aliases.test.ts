import { describe, expect, it } from 'vitest';
import { newNamesFor, parseSparqlNames } from './aliases';

const sparql = (rows: Record<string, string>[]) => ({
  results: { bindings: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { value: v }]))) },
});

describe('parseSparqlNames', () => {
  it('keys by FIVB player number and splits the grouped fields', () => {
    const parsed = parseSparqlNames(
      sparql([{ fivb: '184611', label: 'Taryn Brasher', aliases: 'Taryn Kloth', birthNames: 'Taryn Kloth' }]),
    );
    expect(parsed.get(184611)).toEqual({
      label: 'Taryn Brasher',
      aliases: ['Taryn Kloth'],
      birthNames: ['Taryn Kloth'],
    });
  });

  /**
   * The FIVB id is a free-text external identifier on Wikidata — an editor can
   * type anything into it. A junk value that happens to parse as a number would
   * attach a stranger's former name to a real player, which is the one failure
   * this feature must not have.
   */
  it('refuses an id that is not a plain positive integer', () => {
    const parsed = parseSparqlNames(
      sparql([
        { fivb: '12345x', label: 'A' },
        { fivb: '', label: 'B' },
        { fivb: '-7', label: 'C' },
        { fivb: '1.5', label: 'D' },
        { fivb: ' 99 ', label: 'E' },
      ]),
    );
    expect([...parsed.keys()]).toEqual([99]);
  });

  it('merges two items claiming the same player rather than letting one win', () => {
    const parsed = parseSparqlNames(
      sparql([
        { fivb: '1', label: 'One', aliases: 'First' },
        { fivb: '1', label: 'One', aliases: 'Second' },
      ]),
    );
    expect(parsed.get(1)!.aliases).toEqual(['First', 'Second']);
  });

  it('survives a response that is not the shape it expects', () => {
    // Wikimedia serves an HTML error page under load; better an empty map than
    // a thrown ingest.
    expect(parseSparqlNames(null).size).toBe(0);
    expect(parseSparqlNames({}).size).toBe(0);
    expect(parseSparqlNames({ results: {} }).size).toBe(0);
    expect(parseSparqlNames('<html>rate limited</html>').size).toBe(0);
  });

  it('handles a player with no alias or birth name at all', () => {
    const parsed = parseSparqlNames(sparql([{ fivb: '5', label: 'Solo' }]));
    expect(parsed.get(5)).toEqual({ label: 'Solo', aliases: [], birthNames: [] });
  });
});

describe('newNamesFor', () => {
  it('keeps a changed surname', () => {
    expect(newNamesFor(['Taryn Brasher', 'Brasher'], ['Taryn Kloth'])).toEqual(['Taryn Kloth']);
  });

  it('keeps a stale Wikidata label, which is how Savvy Simo is found', () => {
    // Her item is still titled "Savannah Simo" with no alias — Wikidata is
    // behind FIVB. The label disagreeing with ours is the only signal there is.
    expect(newNamesFor(['Savannah Cory', 'Savvy'], ['Savannah Simo'])).toEqual(['Savannah Simo']);
  });

  it('drops a name that adds only a middle name', () => {
    // "Kerri Lee Walsh Jennings" is not a new way to find Kerri Walsh Jennings,
    // and indexing it costs bytes on 12,000 rows to no purpose.
    expect(newNamesFor(['Kerri Walsh Jennings', 'Walsh Jennings'], ['Kerri Lee Walsh Jennings'])).toEqual([]);
  });

  it('drops a variant the search already folds away', () => {
    expect(newNamesFor(['Helena Havelkova'], ['Helena Havelková'])).toEqual([]);
  });

  it('keeps a German transliteration, which folding does not bridge', () => {
    // Written expecting this to be dropped, and it was wrong: `foldAccents`
    // maps "ö" to "o", so "Kölliker" folds to "kolliker" while VIS's
    // "Koelliker" folds to "koelliker". Neither is a substring of the other, so
    // a reader typing the umlaut spelling finds nobody without this.
    expect(newNamesFor(['Denise Koelliker', 'Koelliker'], ['Denise Kölliker'])).toEqual([
      'Denise Kölliker',
    ]);
  });

  it('keeps a transliteration that changes the letters', () => {
    // "Osheiko" is genuinely unreachable from "Osheyko" — a reader typing what
    // they saw on a broadcast gets nothing without this.
    expect(newNamesFor(['Galyna Osheyko', 'Osheyko'], ['Halyna Osheiko'])).toEqual(['Halyna Osheiko']);
  });

  it('ignores short words, which match half the archive', () => {
    // "de", "van", initials. A name made only of these adds no way to find
    // anyone and would rank noise above the player being looked for.
    expect(newNamesFor(['Ana Silva', 'Silva'], ['Ana de Silva'])).toEqual([]);
  });

  it('does not repeat a name it has already taken', () => {
    expect(newNamesFor(['Kristen Cruz'], ['Kristen Nuss', 'Kristen Nuss', 'KRISTEN NUSS'])).toEqual([
      'Kristen Nuss',
    ]);
  });

  it('returns the name as written, not folded', () => {
    // The published value is what a reader would see if it were ever shown;
    // folding is the search index's business, not the data's.
    expect(newNamesFor(['Helena Grozer'], ['Helena Havelková'])).toEqual(['Helena Havelková']);
  });

  it('ignores blanks and whitespace', () => {
    expect(newNamesFor(['A Player'], ['', '   ', '\t'])).toEqual([]);
  });

  it('matches the short name too, so a graph label is not re-indexed', () => {
    expect(newNamesFor(['Eduarda Santos Lisboa', 'Duda'], ['Duda Lisboa'])).toEqual([]);
  });
});
