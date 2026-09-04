import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SearchEntry } from '../web/src/schema.js';
import {
  aggregateMedals,
  aggregatePartnerships,
  aggregateTourPodiums,
  bestFinishByPair,
  medalTournaments,
  normalisePlayers,
  finishedWithoutResults,
  normaliseTournaments,
  orderResults,
  pairKey,
  awayPartnersByPlayer,
  sliceByCountryAndGender,
  seasonFor,
  seasonRange,
  startOffsetFor,
  tidyName,
  tidyBirthPlace,
  timelineFiltersByPlayer,
  olympicGamesByPlayer,
} from './build.js';
import type { VisRow } from './vis.js';

const tournament = (no: string, season: number): VisRow => ({
  No: no,
  Season: String(season),
  Type: '52', // Beach Pro Tour Elite16
  OrganizerType: '1', // FIVB
  Version: '1',
});

const player = (no: number, gender: '0' | '1', fed: string): VisRow => ({
  No: String(no),
  FirstName: `First${no}`,
  LastName: `Last${no}`,
  Gender: gender,
  FederationCode: fed,
});

const entry = (tour: string, a: number, b: number): VisRow => ({
  NoTournament: tour,
  NoPlayer1: String(a),
  NoPlayer2: String(b),
});

/** An entry that finished somewhere, for the best-finish tests. */
const placed = (tour: string, a: number, b: number, rank: number): VisRow => ({
  ...entry(tour, a, b),
  Rank: String(rank),
});

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey(7, 3)).toBe(pairKey(3, 7));
    expect(pairKey(3, 7)).toBe('3:7');
  });

  it('orders numerically, not lexically', () => {
    // "10" < "9" as strings; the key must not depend on that.
    expect(pairKey(9, 10)).toBe('9:10');
  });
});

describe('normaliseTournaments', () => {
  it('carries FIVB\'s own tournament code through', () => {
    // The only stable public handle on a tournament: FIVB retired its
    // per-tournament pages, so this is what an outside reference can join on.
    const kept = normaliseTournaments([{ ...tournament('1', 2026), Code: 'WBUS2026' }]);
    expect(kept.get('1')!.code).toBe('WBUS2026');
  });

  it('leaves the code empty rather than inventing one', () => {
    expect(normaliseTournaments([tournament('1', 2026)]).get('1')!.code).toBe('');
  });

  it('keeps FIVB-organized events on the allowlist', () => {
    const kept = normaliseTournaments([tournament('1', 2024)]);
    expect([...kept.keys()]).toEqual(['1']);
    expect(kept.get('1')!.tier).toBe('beach-pro-tour');
  });

  it('drops confederation and national events', () => {
    const rows: VisRow[] = [
      { ...tournament('2', 2024), OrganizerType: '2' }, // CEV etc.
      { ...tournament('3', 2024), OrganizerType: '5' }, // national federation
      { ...tournament('4', 2024), OrganizerType: '1', Type: '42' }, // FIVB 1-star: kept
      { ...tournament('5', 2024), OrganizerType: '5', Type: '15' }, // national tour: dropped
      // Type 15 is National Tour by FIVB's own schema, not "1-star" — dropped
      // even when OrganizerType claims FIVB, since that field isn't reliable
      // on National Tour records. Regression case for that specific bug.
      { ...tournament('6', 2024), OrganizerType: '1', Type: '15' },
    ];
    expect([...normaliseTournaments(rows).keys()]).toEqual(['4']);
  });

  it('drops tournaments VIS marked as cancelled, however it spelled it', () => {
    // Real names from the archive. VIS has no status field for this — the
    // cancellation lives in the display name, with the spelling, spacing and
    // punctuation all varying, plus Spanish-language records.
    const names = [
      'Hamburg (canceled)',
      'Mangaung(Cancelled)',
      'CEV Lille Masters - canceled',
      'Cancelled',
      'Rio de Janeiro (cancelado)',
      'Madrid (cancelada)',
    ];
    const rows = names.map((Name, i) => ({ ...tournament(String(200 + i), 2020), Name }));
    expect(normaliseTournaments(rows).size).toBe(0);
  });

  it('keeps a postponed tournament — it may still be played', () => {
    // Deliberately not treated as cancelled. A postponed event that never
    // happens contributes no players anyway (no results, no rank), so
    // dropping it would assert something the data does not say.
    const rows = [{ ...tournament('300', 2020), Name: 'Doha (postponed)' }];
    expect([...normaliseTournaments(rows).keys()]).toEqual(['300']);
  });

  it('does not mistake an ordinary tournament name for a cancellation', () => {
    const rows = [
      { ...tournament('301', 2024), Name: 'Gstaad' },
      { ...tournament('302', 2024), Name: 'Rio de Janeiro' },
      { ...tournament('303', 2024), Name: '' },
      { ...tournament('304', 2024) }, // no Name attribute at all
    ];
    expect(normaliseTournaments(rows).size).toBe(4);
  });

  it('renames a championship after its host, whatever FIVB called it', () => {
    // The wiring, not the maps: olympics.test.ts and worlds.test.ts already
    // check what each map holds, and both would still pass if the build never
    // consulted one of them. Names are the real ones from VIS.
    const rows = [
      { ...tournament('1', 2012), Type: '5', Name: 'Olympic Games 2012' },
      { ...tournament('2', 2025), Type: '4', Name: 'FIVB Beach Volleyball World Championships' },
    ];
    const kept = normaliseTournaments(rows);
    expect(kept.get('1')!.name).toBe('London 2012');
    expect(kept.get('2')!.name).toBe('Adelaide');
  });

  it('leaves every other tier named as FIVB named it', () => {
    // A tour stop in an Olympic season must not pick up the Games' name, and
    // a championship season the maps have not been told about keeps FIVB's.
    const rows = [
      { ...tournament('1', 2012), Name: 'Gstaad' }, // Beach Pro Tour, London year
      { ...tournament('2', 2029), Type: '4', Name: 'FIVB Beach Volleyball World Championships' },
    ];
    const kept = normaliseTournaments(rows);
    expect(kept.get('1')!.name).toBe('Gstaad');
    expect(kept.get('2')!.name).toBe('FIVB Beach Volleyball World Championships');
  });

  it('drops snow volleyball, seminars and multi-sport games', () => {
    const rows = ['36', '35', '44', '50'].map((t, i) => ({
      ...tournament(String(100 + i), 2024),
      Type: t,
    }));
    expect(normaliseTournaments(rows).size).toBe(0);
  });
});

describe('tidyName', () => {
  it('trims and collapses the whitespace VIS leaves in the field', () => {
    // Tande's row really is stored with a leading space.
    expect(tidyName(' Ramos Alexandre "Tande" Samuel')).toBe('Ramos Alexandre "Tande" Samuel');
    expect(tidyName('Paulo  Roberto   Moreira')).toBe('Paulo Roberto Moreira');
  });

  it('title-cases a name where every word shouts', () => {
    expect(tidyName('ARIDSON RODRIGUES ANDRADE')).toBe('Aridson Rodrigues Andrade');
    expect(tidyName('DELVINO ANDRADE SOUTO GONÇALVES')).toBe('Delvino Andrade Souto Gonçalves');
    expect(tidyName('ONUR ÖZKOL')).toBe('Onur Özkol');
  });

  it('leaves a partly-capitalised name alone, because the capitals mark the surname', () => {
    // The whole point of the whole-name rule: these say which word is the
    // family name, and it is the only place that row says it.
    expect(tidyName('Katharina HETZENDORFER')).toBe('Katharina HETZENDORFER');
    expect(tidyName('MUKUNZI Christ Ornel')).toBe('MUKUNZI Christ Ornel');
    expect(tidyName('Lucilia ROSA LEMOS')).toBe('Lucilia ROSA LEMOS');
  });

  it('capitalises after a hyphen or apostrophe, not just at the word start', () => {
    expect(tidyName('HSIN-TUNG CHUANG')).toBe('Hsin-Tung Chuang');
    expect(tidyName("MARIA D'ALMEIDA")).toBe("Maria D'Almeida");
  });

  it('leaves initialisms and short-word names as they are', () => {
    // "A.J." must not become "A.j.", and a name with no substantial word is
    // more likely an initialism than a shout.
    expect(tidyName('A.J. JOHNSON')).toBe('A.J. Johnson');
    expect(tidyName('KK')).toBe('KK');
  });

  it('does not lowercase particles, because the same word differs by culture', () => {
    // "de Pina" is the strictly correct Portuguese form and we knowingly do not
    // produce it — the same DE is capitalised in Flemish, and LE two rows away
    // is a Malaysian name rather than a French particle.
    expect(tidyName('ADLA MARINA TAVARES DE PINA')).toBe('Adla Marina Tavares De Pina');
    expect(tidyName('OOI TIAN LE')).toBe('Ooi Tian Le');
  });

  it('leaves an ordinary name untouched', () => {
    expect(tidyName('Alexandre Ramos Samuel')).toBe('Alexandre Ramos Samuel');
    expect(tidyName('')).toBe('');
  });
});

describe('tidyBirthPlace', () => {
  it('keeps a birth place as VIS wrote it', () => {
    // Four conventions, none of them fixable, all of them shown verbatim:
    // nothing separates a city from a province, and nothing says which country
    // a bare "Berlin" is in.
    expect(tidyBirthPlace('Curitiba, PR')).toBe('Curitiba, PR');
    expect(tidyBirthPlace('Berlin')).toBe('Berlin');
    expect(tidyBirthPlace('Juiz de Fora (BRA)')).toBe('Juiz de Fora (BRA)');
    expect(tidyBirthPlace('Resende-Rio de Janeiro')).toBe('Resende-Rio de Janeiro');
  });

  it('keeps a district or department number, which is a real answer', () => {
    // The reason the rules are narrow rather than "reject anything with a
    // digit": these are 6 of the 16 published records containing one, and all
    // of them say where somebody was born.
    expect(tidyBirthPlace('Paris 14e')).toBe('Paris 14e');
    expect(tidyBirthPlace('Praha 4')).toBe('Praha 4');
    expect(tidyBirthPlace('Sèvres (92)')).toBe('Sèvres (92)');
    expect(tidyBirthPlace('St Brieul (12)')).toBe('St Brieul (12)');
    expect(tidyBirthPlace('Auckland N2')).toBe('Auckland N2');
    expect(tidyBirthPlace('Steyr 1007')).toBe('Steyr 1007');
  });

  it('drops a date typed into the birth place field', () => {
    // All four published cases, each punctuated differently.
    expect(tidyBirthPlace('21.08.77')).toBeNull();
    expect(tidyBirthPlace('03/09/1988')).toBeNull();
    expect(tidyBirthPlace('06-05-1991')).toBeNull();
    expect(tidyBirthPlace('17/01/1992')).toBeNull();
  });

  it('drops a date only when the whole value is one', () => {
    // No published record tells the anchored rule from an unanchored one today
    // — both drop the same four. The anchor is a guard against a value that
    // mixes a real place with a date, which is exactly the shape this field
    // keeps producing, so it is pinned here rather than left to be loosened by
    // someone who checks only that the four still go.
    expect(tidyBirthPlace('Sao Paulo 12/05/1990')).toBe('Sao Paulo 12/05/1990');
    expect(tidyBirthPlace('12/05/1990')).toBeNull();
  });

  it('drops a bare postcode', () => {
    expect(tidyBirthPlace('30019')).toBeNull();
    expect(tidyBirthPlace('98278')).toBeNull();
  });

  it('drops an internal note that should never have left the database', () => {
    expect(tidyBirthPlace('to be Merged with (#164181) as')).toBeNull();
  });

  it('normalises capitals and strips the quotes FIVB stored', () => {
    // 444 published birth places shout; "9 de JULIO" is a real Argentine town
    // wearing quotation marks.
    expect(tidyBirthPlace('BUENOS AIRES')).toBe('Buenos Aires');
    expect(tidyBirthPlace('"9 de JULIO"')).toBe('9 de Julio');
    expect(tidyBirthPlace('  Roma  ')).toBe('Roma');
  });

  it('normalises a value that has no capitals either', () => {
    // The mirror of the shout rule, and the same failure: a free-text box
    // filled in with caps lock in the other state. 102 published places have no
    // capital anywhere.
    expect(tidyBirthPlace('rio de janeiro')).toBe('Rio de Janeiro');
    expect(tidyBirthPlace('buenos aires')).toBe('Buenos Aires');
    expect(tidyBirthPlace('salvador')).toBe('Salvador');
    expect(tidyBirthPlace('st-gallen')).toBe('St-Gallen');
  });

  it('keeps a particle lower case, but only between two words', () => {
    // "el" is a particle in the middle and the start of a name at the front;
    // a trailing token is far likelier to be a region than a preposition. So
    // first and last are always capitalised, which is also what makes the rule
    // safe on a one-word value.
    expect(tidyBirthPlace('santiago de cuba')).toBe('Santiago de Cuba');
    expect(tidyBirthPlace('yacoub el mansour')).toBe('Yacoub el Mansour');
    expect(tidyBirthPlace('pione di sacco')).toBe('Pione di Sacco');
    expect(tidyBirthPlace('el jadida')).toBe('El Jadida');
    expect(tidyBirthPlace('de')).toBe('De');
  });

  it('leaves a value that already carries mixed capitals', () => {
    // Mixed case is a choice somebody made; only a uniformly-cased value has
    // lost the information. Touching these would mean deciding that
    // "St-jean-sur-richelieu" is wrong and "St-Gallen" is right, which is a
    // different and much less certain rule.
    expect(tidyBirthPlace('St-Gallen')).toBe('St-Gallen');
    expect(tidyBirthPlace('Adelaide, SA')).toBe('Adelaide, SA');
    expect(tidyBirthPlace('Arendal, norway')).toBe('Arendal, norway');
  });

  it('capitalises after a bracket or a comma, not only after a hyphen', () => {
    // FIVB stores these as single space-free tokens, so de-shouting them used
    // to lower-case everything past the punctuation: "Poltana (urss)" and
    // "Aktau,kazakhstan" were published that way, which reads as a different
    // mistake from the one being fixed.
    expect(tidyBirthPlace('Poltana (URSS)')).toBe('Poltana (Urss)');
    expect(tidyBirthPlace('AKTAU,KAZAKHSTAN')).toBe('Aktau,Kazakhstan');
    expect(tidyBirthPlace('camaguan (edo) guarico')).toBe('Camaguan (Edo) Guarico');
  });

  it('still protects a short code in either direction', () => {
    // The length gate only has to hold where a code can exist, which is the
    // upper-case direction — a value with no capitals cannot be hiding one.
    expect(tidyBirthPlace('Curitiba, PR')).toBe('Curitiba, PR');
    expect(tidyBirthPlace('Juiz de Fora (BRA)')).toBe('Juiz de Fora (BRA)');
    expect(tidyBirthPlace('TN')).toBe('TN');
  });

  it('is null for the 46% who have nothing', () => {
    expect(tidyBirthPlace('')).toBeNull();
    expect(tidyBirthPlace(undefined)).toBeNull();
    expect(tidyBirthPlace('   ')).toBeNull();
  });
});

describe('normalisePlayers', () => {
  it('converts VIS units and rejects impossible values', () => {
    const map = normalisePlayers([
      { ...player(1, '0', 'BRA'), Height: '1980000', Weight: '85000000', Birthdate: '1990-05-04' },
      { ...player(2, '1', 'USA'), Height: '', Weight: '', Birthdate: '' },
      { ...player(3, '1', 'GER'), Height: '0', Birthdate: '0001-01-01' },
    ]);
    expect(map.get(1)).toMatchObject({ height: 198, weight: 85, dob: '1990-05-04', gender: 'M' });
    expect(map.get(2)).toMatchObject({ height: null, weight: null, dob: null, gender: 'W' });
    expect(map.get(3)).toMatchObject({ height: null, dob: null });
  });

  it('drops players with no usable gender', () => {
    expect(normalisePlayers([{ ...player(9, '0', 'BRA'), Gender: '' }]).size).toBe(0);
  });

  it('aliases a withdrawn federation code to the one it merged into', () => {
    // CUR (withdrawn) and AHO both represent Curaçao; without the alias they'd
    // form two separate country entries for the same real place.
    const map = normalisePlayers([player(10, '0', 'CUR')]);
    expect(map.get(10)!.federation).toBe('AHO');
  });

  it('drops players under an excluded federation code entirely', () => {
    // FIV doesn't resolve to a real, confidently-identifiable country
    // (quirks §7) — SMA used to be here too, but it does resolve: see below.
    const map = normalisePlayers([player(11, '0', 'FIV')]);
    expect(map.size).toBe(0);
  });

  it('resolves SMA to Saint-Martin rather than dropping it', () => {
    // Verified against BirthPlace, not guessed (quirks §7): SMA's real
    // player sample reads "Saint Martin", not "unverifiable".
    const map = normalisePlayers([player(13, '0', 'SMA')]);
    expect(map.get(13)!.federation).toBe('SMA');
  });

  it('drops FIVB’s own test and dummy accounts', () => {
    // Real shapes from the archive, across three federations.
    const map = normalisePlayers([
      { ...player(20, '0', 'AUT'), FirstName: 'Dummy2', LastName: 'Dummy2' },
      { ...player(21, '0', 'FRA'), FirstName: 'Dev-Test-Firstname', LastName: 'Dev-Test-Lastname' },
      { ...player(22, '1', 'ITA'), FirstName: 'TEST LVF', LastName: 'TEST LVF' },
      { ...player(23, '0', 'IND'), FirstName: 'Test1', LastName: 'Test1' },
    ]);
    expect(map.size).toBe(0);
  });

  it('keeps a real player whose team name merely contains “test”', () => {
    // Erika Riedl (135343, JAM) is why the rule reads the name and not
    // `TeamName`: hers is "Riedl-Test". Matching that field drops an athlete.
    const map = normalisePlayers([
      { ...player(24, '1', 'JAM'), FirstName: 'Erika', LastName: 'Riedl', TeamName: 'Riedl-Test' },
    ]);
    expect(map.get(24)).toMatchObject({ name: 'Erika Riedl', short: 'Riedl-Test' });
  });

  it('keeps real surnames that a looser pattern would swallow', () => {
    // The word boundaries are load-bearing, not decoration.
    const map = normalisePlayers([
      { ...player(25, '0', 'ITA'), FirstName: 'Marco', LastName: 'Testa' },
      { ...player(26, '0', 'BRA'), FirstName: 'Paulo', LastName: 'Teste' },
      { ...player(27, '0', 'ENG'), FirstName: 'John', LastName: 'Dummett' },
      { ...player(28, '0', 'ITA'), FirstName: 'Mario', LastName: 'Contesta' },
    ]);
    expect([...map.values()].map((p) => p.name)).toEqual([
      'Marco Testa',
      'Paulo Teste',
      'John Dummett',
      'Mario Contesta',
    ]);
  });

  it('strips a competition status out of the name and the short label', () => {
    // Hovland's record exactly: appended to `LastName` behind a double space,
    // and standing alone as the whole of `TeamName`. Both fields have to be
    // handled — stripping only the surname leaves the graph label reading
    // "Suspended", which is the defect readers actually saw.
    const map = normalisePlayers([
      {
        ...player(13, '0', 'USA'),
        FirstName: 'Tim "The Hov"',
        LastName: 'Hovland  SUSPENDED',
        TeamName: 'Suspended',
      },
    ]);
    expect(map.get(13)).toMatchObject({ name: 'Tim "The Hov" Hovland', short: 'Hovland' });
  });

  it('leaves a populated team name alone', () => {
    // Frohoff's record: the surname carries the status, `TeamName` does not.
    // The strip must not cost him the label VIS got right.
    const map = normalisePlayers([
      { ...player(14, '0', 'USA'), FirstName: 'Brent', LastName: 'Frohoff  SUSPENDED', TeamName: 'Frohoff' },
    ]);
    expect(map.get(14)).toMatchObject({ name: 'Brent Frohoff', short: 'Frohoff' });
  });
});

describe('aggregatePartnerships', () => {
  const tournaments = normaliseTournaments([
    tournament('t1', 2023),
    tournament('t2', 2024),
    tournament('t3', 2025),
  ]);
  const players = normalisePlayers([
    player(1, '0', 'BRA'),
    player(2, '0', 'BRA'),
    player(3, '0', 'NOR'),
  ]);

  it('weights an edge by distinct tournaments and tracks the season span', () => {
    const { partnerships } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t2', 2, 1), entry('t3', 1, 2)],
      tournaments,
      players,
    );
    const pair = partnerships.get('1:2')!;
    expect(pair.tournaments.size).toBe(3);
    expect(pair.firstSeason).toBe(2023);
    expect(pair.lastSeason).toBe(2025);
  });

  it('counts a pair once when it appears in both qualification and main draw', () => {
    const { partnerships, rejects } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t1', 1, 2)],
      tournaments,
      players,
    );
    expect(partnerships.get('1:2')!.tournaments.size).toBe(1);
    expect(rejects.duplicateEntry).toBe(1);
  });

  it('rejects self-pairs, blank sides and out-of-scope tournaments', () => {
    const { partnerships, rejects } = aggregatePartnerships(
      [
        entry('t1', 1, 1),
        { NoTournament: 't1', NoPlayer1: '1', NoPlayer2: '' },
        { NoTournament: 't1', NoPlayer1: '1', NoPlayer2: '0' },
        entry('unknown-tournament', 1, 2),
        entry('t1', 1, 999), // player not in VIS
      ],
      tournaments,
      players,
    );
    expect(partnerships.size).toBe(0);
    expect(rejects).toMatchObject({
      selfPair: 1,
      missingPlayer: 2,
      outOfScopeTournament: 1,
      unknownPlayer: 1,
    });
  });

  it('counts an appearance for every player of a valid entry', () => {
    const { appearances } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t2', 1, 3)],
      tournaments,
      players,
    );
    expect(appearances.get(1)!.size).toBe(2);
    expect(appearances.get(2)!.size).toBe(1);
  });

  it('rejects a team entry with Rank 0 -- registered but never played', () => {
    const { partnerships, appearances, rejects } = aggregatePartnerships(
      [{ ...entry('t1', 1, 2), Rank: '0' }],
      tournaments,
      players,
    );
    expect(partnerships.size).toBe(0);
    expect(appearances.size).toBe(0);
    expect(rejects.didNotPlay).toBe(1);
  });

  it('treats a blank Rank the same as 0 -- the shape a withdrawn row actually has', () => {
    const { rejects } = aggregatePartnerships([{ ...entry('t1', 1, 2), Rank: '' }], tournaments, players);
    expect(rejects.didNotPlay).toBe(1);
  });

  it('keeps a negative Rank -- a real qualification/quota elimination, not a no-show', () => {
    const { partnerships } = aggregatePartnerships(
      [{ ...entry('t1', 1, 2), Rank: '-2' }, { ...entry('t2', 1, 2), Rank: '-25' }],
      tournaments,
      players,
    );
    expect(partnerships.get('1:2')!.tournaments.size).toBe(2);
  });

  it('keeps a real positive Rank', () => {
    const { partnerships } = aggregatePartnerships(
      [{ ...entry('t1', 1, 2), Rank: '4' }],
      tournaments,
      players,
    );
    expect(partnerships.get('1:2')!.tournaments.size).toBe(1);
  });

  it('resolves a cancelled-then-replaced registration to just the team that played', () => {
    // The real-world shape this exists for: player 1 registers with player 2,
    // that registration is superseded before the tournament by a re-pairing
    // with player 3, and VIS keeps both rows -- the first with Rank 0, the
    // second with a real result. Without this filter both would count as
    // real partnerships for the same tournament, double-crediting player 1.
    const { partnerships, appearances } = aggregatePartnerships(
      [
        { ...entry('t1', 1, 2), Rank: '0' }, // withdrawn before playing
        { ...entry('t1', 1, 3), Rank: '9' }, // the team that actually competed
      ],
      normaliseTournaments([tournament('t1', 2023)]),
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA'), player(3, '0', 'BRA')]),
    );
    expect(partnerships.has('1:2')).toBe(false);
    expect(partnerships.get('1:3')!.tournaments.size).toBe(1);
    // Player 1's own appearance count reflects the one tournament they
    // actually played, not two.
    expect(appearances.get(1)!.size).toBe(1);
  });
});

describe('aggregatePartnerships results', () => {
  const dated = (no: string, season: number, month: string): VisRow => ({
    ...tournament(no, season),
    StartDateMainDraw: `${season}-${month}-01`,
  });

  it('records one row per player per entry, from both sides', () => {
    const { results } = aggregatePartnerships(
      [{ ...entry('5', 1, 2), Rank: '9' }],
      normaliseTournaments([tournament('5', 2024)]),
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]),
    );
    expect(results.get(1)).toEqual([[5, 2, 9]]);
    expect(results.get(2)).toEqual([[5, 1, 9]]);
  });

  it('orders a career newest first, and within a season by the latest event', () => {
    const tournaments = normaliseTournaments([
      dated('1', 2023, '07'),
      dated('2', 2024, '03'),
      dated('3', 2024, '09'),
    ]);
    const { results } = aggregatePartnerships(
      [
        { ...entry('1', 1, 2), Rank: '5' },
        { ...entry('2', 1, 2), Rank: '9' },
        { ...entry('3', 1, 2), Rank: '1' },
      ],
      tournaments,
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]),
    );
    expect(results.get(1)!.map(([no]) => no)).toEqual([3, 2, 1]);
  });

  it('sorts a season without dates last within it, not first', () => {
    const tournaments = normaliseTournaments([dated('1', 2024, '05'), tournament('2', 2024)]);
    const { results } = aggregatePartnerships(
      [
        { ...entry('2', 1, 2), Rank: '9' },
        { ...entry('1', 1, 2), Rank: '5' },
      ],
      tournaments,
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]),
    );
    expect(results.get(1)!.map(([no]) => no)).toEqual([1, 2]);
  });

  it('collapses a pair that entered qualification and the main draw, keeping the placement', () => {
    // The same shape `rejects.duplicateEntry` counts: two played rows for one
    // pair in one tournament. The main draw is the result, so the higher rank
    // wins -- otherwise a title would read as a qualification exit.
    const { results } = aggregatePartnerships(
      [
        { ...entry('5', 1, 2), Rank: '-25' },
        { ...entry('5', 1, 2), Rank: '3' },
      ],
      normaliseTournaments([tournament('5', 2024)]),
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]),
    );
    expect(results.get(1)).toEqual([[5, 2, 3]]);
  });

  it('keeps both rows when one player entered a tournament with two partners', () => {
    // 43 players in the archive have exactly this, and the partner list counts
    // the tournament on both pairings -- so an expanded season has to show it
    // twice or its rows will not add up to the tallies above them.
    const { results } = aggregatePartnerships(
      [
        { ...entry('9', 1, 2), Rank: '3' },
        { ...entry('9', 1, 3), Rank: '2' },
      ],
      normaliseTournaments([tournament('9', 2024)]),
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA'), player(3, '0', 'BRA')]),
    );
    expect(results.get(1)).toEqual([
      [9, 2, 3],
      [9, 3, 2],
    ]);
  });

  it('leaves out a row that never played', () => {
    const { results } = aggregatePartnerships(
      [{ ...entry('5', 1, 2), Rank: '0' }],
      normaliseTournaments([tournament('5', 2024)]),
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]),
    );
    expect(results.size).toBe(0);
  });

  it('keeps a cross-federation entry, which the graph drops', () => {
    const { results } = aggregatePartnerships(
      [{ ...entry('7', 1, 2), Rank: '5' }],
      normaliseTournaments([tournament('7', 2024)]),
      normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'NED')]),
    );
    expect(results.get(1)).toEqual([[7, 2, 5]]);
    expect(results.get(2)).toEqual([[7, 1, 5]]);
  });
});

describe('orderResults', () => {
  const tournaments = normaliseTournaments([
    { ...tournament('1', 2024), StartDateMainDraw: '2024-06-01' },
    { ...tournament('2', 2024), StartDateMainDraw: '2023-12-20' }, // opens the season early
    { ...tournament('3', 2024) },
    { ...tournament('4', 2023), StartDateMainDraw: '2023-06-01' },
  ]);

  it('puts a December event that opens a season below the season it belongs to', () => {
    // Its offset is negative, so it sorts last in 2024 -- and still above the
    // whole of 2023, which is the point of keeping the offset signed.
    const ordered = orderResults(
      [
        [4, 9, 5],
        [2, 9, 5],
        [1, 9, 5],
      ],
      tournaments,
    );
    expect(ordered.map(([no]) => no)).toEqual([1, 2, 4]);
  });

  it('breaks a tie on tournament number so the order is stable', () => {
    const same = normaliseTournaments([
      { ...tournament('10', 2024), StartDateMainDraw: '2024-06-01' },
      { ...tournament('11', 2024), StartDateMainDraw: '2024-06-01' },
    ]);
    expect(
      orderResults(
        [
          [10, 1, 5],
          [11, 1, 5],
        ],
        same,
      ).map(([no]) => no),
    ).toEqual([11, 10]);
  });

  it('does not mutate its input', () => {
    const input: [number, number, number][] = [
      [4, 9, 5],
      [1, 9, 5],
    ];
    orderResults(input, tournaments);
    expect(input.map(([no]) => no)).toEqual([4, 1]);
  });
});

describe('seasonRange', () => {
  it('reads a two-digit end, which is the only form VIS uses', () => {
    // All 70 ranged rows look like these six.
    expect(seasonRange('1987-91')).toEqual({ from: 1987, to: 1991 });
    expect(seasonRange('1995-96')).toEqual({ from: 1995, to: 1996 });
  });

  it('rolls the century forward rather than reading an empty span', () => {
    // No row looks like this today. Without the roll it would parse as
    // 1999-1900, which is empty, and every date would fall outside it.
    expect(seasonRange('1999-00')).toEqual({ from: 1999, to: 2000 });
  });

  it('is null for a plain year, which is 9,200 rows of 9,270', () => {
    expect(seasonRange('2024')).toBeNull();
    expect(seasonRange('')).toBeNull();
    expect(seasonRange(undefined)).toBeNull();
  });
});

describe('seasonFor', () => {
  const row = (season: string, start?: string): VisRow => ({
    No: '1',
    Season: season,
    ...(start ? { StartDateMainDraw: start } : {}),
  });

  it('dates a ranged season by when the event was actually played', () => {
    // The four annual Rio events all sat in VIS season "1987-91" and all
    // published as 1987. Their codes — MRIO1988 to MRIO1991 — said otherwise,
    // and so did their dates.
    expect(seasonFor(row('1987-91', '1988-02-20'))).toBe(1988);
    expect(seasonFor(row('1987-91', '1991-02-12'))).toBe(1991);
    expect(seasonFor(row('1995-96', '1996-01-01'))).toBe(1996);
  });

  it('leaves a single-year season alone even when the date disagrees', () => {
    // The asymmetry is the point. A southern season opens in the previous
    // December, so this row is filed exactly right and `startOffset` goes
    // negative to say so. Only a range has lost information.
    expect(seasonFor(row('2020', '2019-12-06'))).toBe(2020);
    expect(seasonFor(row('2024', '2024-05-02'))).toBe(2024);
  });

  it('keeps the range start when the date falls outside the range', () => {
    // A date outside the span it is meant to disambiguate is not a better
    // answer than the span. No published row is like this; the bound is here
    // so a future bad date cannot move an event decades.
    expect(seasonFor(row('1987-91', '2015-06-01'))).toBe(1987);
    expect(seasonFor(row('1987-91', '1980-06-01'))).toBe(1987);
    expect(seasonFor(row('1987-91'))).toBe(1987);
  });

  it('is null when there is no usable season at all', () => {
    expect(seasonFor(row(''))).toBeNull();
    expect(seasonFor(row('not-a-year'))).toBeNull();
  });
});

describe('startOffsetFor', () => {
  it('counts days from 1 January of the season', () => {
    expect(startOffsetFor('2024-01-01', 2024)).toBe(0);
    expect(startOffsetFor('2024-05-02', 2024)).toBe(122);
  });

  it('goes negative for a season that opens in the previous calendar year', () => {
    // The reason this is an offset rather than a day-of-year: as day 340 a
    // December opener would sort behind the January events that followed it.
    expect(startOffsetFor('2019-12-06', 2020)).toBe(-26);
  });

  it('is null for a missing or unparseable date', () => {
    expect(startOffsetFor(undefined, 2024)).toBeNull();
    expect(startOffsetFor('', 2024)).toBeNull();
    expect(startOffsetFor('not-a-date', 2024)).toBeNull();
  });
});

describe('bestFinishByPair', () => {
  const key = pairKey(1, 2);

  it('keeps the lowest placement, not the latest or the first', () => {
    const results = new Map([
      [1, [[10, 2, 17] as const, [11, 2, 5] as const, [12, 2, 9] as const].map((e) => [...e] as [number, number, number])],
    ]);
    expect(bestFinishByPair(results).get(key)).toBe(5);
  });

  it('reads the pair the same way round whichever player it arrives on', () => {
    const fromOne = bestFinishByPair(new Map([[1, [[10, 2, 3] as [number, number, number]]]]));
    const fromTwo = bestFinishByPair(new Map([[2, [[10, 1, 3] as [number, number, number]]]]));
    expect(fromOne.get(key)).toBe(3);
    expect(fromTwo.get(key)).toBe(3);
  });

  it('ignores eliminations before the main draw', () => {
    // -25 and below is qualification, -2 a confederation quota. Neither is a
    // placement, and treating either as a number would rank a pair who never
    // reached a main draw *above* one that finished 33rd.
    const results = new Map([
      [1, [[10, 2, -25] as [number, number, number], [11, 2, -2] as [number, number, number]]],
    ]);
    expect(bestFinishByPair(results).has(key)).toBe(false);
  });

  it('says nothing at all rather than picking a negative as the best of them', () => {
    const results = new Map([
      [1, [[10, 2, -25] as [number, number, number], [11, 2, 33] as [number, number, number]]],
    ]);
    expect(bestFinishByPair(results).get(key)).toBe(33);
  });

  it('does not let a missing rank become a result', () => {
    // The trap this function was written around: a row with no `Rank` parses
    // to NaN, and every comparison against NaN is false — so `rank <= 0` does
    // not skip it and `NaN < undefined` on an empty slot is enough to store
    // it. A pair would publish "best NaN".
    const results = new Map([
      [1, [[10, 2, Number.NaN] as [number, number, number]]],
    ]);
    expect(bestFinishByPair(results).has(key)).toBe(false);
  });

  it('keeps two partners of the same player apart', () => {
    const results = new Map([
      [1, [[10, 2, 5] as [number, number, number], [11, 3, 1] as [number, number, number]]],
    ]);
    const best = bestFinishByPair(results);
    expect(best.get(pairKey(1, 2))).toBe(5);
    expect(best.get(pairKey(1, 3))).toBe(1);
  });
});

describe('a partnership\u2019s best finish, end to end', () => {
  const tournaments = normaliseTournaments([tournament('t1', 2023), tournament('t2', 2024)]);

  it('reaches the graph edge as `r`', () => {
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]);
    const { partnerships, appearances } = aggregatePartnerships(
      [placed('t1', 1, 2, 9), placed('t2', 1, 2, 2)],
      tournaments,
      people,
    );
    const [slice] = sliceByCountryAndGender(partnerships, appearances, people, tournaments);
    expect(slice!.edges[0]!.r).toBe(2);
  });

  it('reaches an away partner as `r` too, so the two lists agree', () => {
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'ARG')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [placed('t1', 1, 2, 9), placed('t2', 1, 2, 2)],
      tournaments,
      people,
    );
    const away = awayPartnersByPlayer(partnerships, people, tournaments, ownFederation);
    expect(away.get(1)![0]!.r).toBe(2);
    expect(away.get(2)![0]!.r).toBe(2);
  });

  it('omits the field entirely when the pair never reached a main draw', () => {
    // Not 0, and not -25: the card renders any number it is given, and a pair
    // who only ever played qualification has no finish to render.
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]);
    const { partnerships, appearances } = aggregatePartnerships(
      [placed('t1', 1, 2, -25)],
      tournaments,
      people,
    );
    const [slice] = sliceByCountryAndGender(partnerships, appearances, people, tournaments);
    expect(slice!.edges[0]).not.toHaveProperty('r');
  });

  it('prefers the main draw over the qualification the pair came through', () => {
    // One event, two rows: `noteResult` keeps the higher rank as the result,
    // and the best finish has to be computed from what survives that. A
    // best-so-far accumulated during the loop would have banked the -25.
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]);
    const { partnerships, appearances } = aggregatePartnerships(
      [placed('t1', 1, 2, -25), placed('t1', 1, 2, 17)],
      tournaments,
      people,
    );
    const [slice] = sliceByCountryAndGender(partnerships, appearances, people, tournaments);
    expect(slice!.edges[0]!.r).toBe(17);
  });
});

describe('awayPartnersByPlayer', () => {
  const tournaments = normaliseTournaments([tournament('t1', 2023), tournament('t2', 2024)]);

  it('records a partnership split across federations on both players', () => {
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'ARG')]);
    const { partnerships, ownFederation } = aggregatePartnerships([entry('t1', 1, 2), entry('t2', 1, 2)], tournaments, people);
    const away = awayPartnersByPlayer(partnerships, people, tournaments, ownFederation);

    expect(away.get(1)).toEqual([
      {
        id: 2,
        name: 'First2 Last2',
        fed: 'ARG',
        gender: 'M',
        t: 2,
        f: 2023,
        l: 2024,
        // The same per-season shape a graph edge carries, so the card can run
        // both through one timeline.
        s: [
          [2023, 1],
          [2024, 1],
        ],
      },
    ]);
    // And symmetrically — the Argentine's card is just as empty without it.
    expect(away.get(2)![0]).toMatchObject({ id: 1, fed: 'BRA' });
  });

  it('ignores a partnership the graph already shows', () => {
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]);
    const { partnerships, ownFederation } = aggregatePartnerships([entry('t1', 1, 2)], tournaments, people);
    expect(awayPartnersByPlayer(partnerships, people, tournaments, ownFederation).size).toBe(0);
  });

  it('treats a different gender under the same federation as away too', () => {
    // Slices are country x gender, so this pair is dropped by the same rule.
    // Carrying the partner's gender is what lets the card link to the right
    // slice rather than guessing.
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '1', 'BRA')]);
    const { partnerships, ownFederation } = aggregatePartnerships([entry('t1', 1, 2)], tournaments, people);
    expect(awayPartnersByPlayer(partnerships, people, tournaments, ownFederation).get(1)).toMatchObject([{ id: 2, gender: 'W' }]);
  });

  it('orders a player\'s away partners by tournaments together, then name', () => {
    const people = normalisePlayers([
      player(1, '0', 'BRA'),
      player(2, '0', 'ARG'),
      player(3, '0', 'ARG'),
    ]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [entry('t1', 1, 2), entry('t1', 1, 3), entry('t2', 1, 3)],
      tournaments,
      people,
    );
    expect(awayPartnersByPlayer(partnerships, people, tournaments, ownFederation).get(1)!.map((a) => [a.id, a.t])).toEqual([
      [3, 2],
      [2, 1],
    ]);
  });

  it('skips players with no federation on file', () => {
    const people = normalisePlayers([player(1, '0', 'BRA'), { ...player(2, '0', 'ARG'), FederationCode: '' }]);
    const { partnerships, ownFederation } = aggregatePartnerships([entry('t1', 1, 2)], tournaments, people);
    expect(awayPartnersByPlayer(partnerships, people, tournaments, ownFederation).size).toBe(0);
  });
});

describe('sliceByCountryAndGender', () => {
  const tournaments = normaliseTournaments([tournament('t1', 2023), tournament('t2', 2024)]);
  const players = normalisePlayers([
    player(1, '0', 'BRA'),
    player(2, '0', 'BRA'),
    player(3, '1', 'BRA'), // same country, different gender
    player(4, '0', 'NOR'),
    player(5, '1', 'BRA'),
  ]);

  const run = (rows: VisRow[], minNodes = 2) => {
    const { partnerships, appearances } = aggregatePartnerships(rows, tournaments, players);
    return sliceByCountryAndGender(partnerships, appearances, players, tournaments, minNodes);
  };

  it('separates men and women of the same country', () => {
    const slices = run([entry('t1', 1, 2), entry('t1', 3, 5)]);
    expect(slices.map((s) => `${s.country}-${s.gender}`).sort()).toEqual(['BRA-M', 'BRA-W']);
  });

  it('drops an edge whose endpoints are in different countries', () => {
    const slices = run([entry('t1', 1, 2), entry('t2', 2, 4)]);
    const bra = slices.find((s) => s.country === 'BRA' && s.gender === 'M')!;
    // Both players remain as nodes; only the cross-national edge is dropped.
    expect(bra.nodes.map((n) => n.id).sort()).toEqual([1, 2]);
    expect(bra.edges).toHaveLength(1);
    expect(bra.edges[0]).toMatchObject({ a: 1, b: 2 });
    // Norway has a single player, below the minimum, so no slice is emitted.
    expect(slices.some((s) => s.country === 'NOR')).toBe(false);
  });

  it('derives node tournament counts and season span from appearances', () => {
    const slices = run([entry('t1', 1, 2), entry('t2', 1, 2)]);
    const node = slices[0]!.nodes.find((n) => n.id === 1)!;
    expect(node).toMatchObject({ tournaments: 2, first: 2023, last: 2024 });
  });

  describe('per-season breakdown', () => {
    // Seasons deliberately out of order, and 2023 deliberately doubled: the
    // breakdown has to sort and to tally, not just list what it was handed.
    const seasons = normaliseTournaments([
      tournament('a', 2024),
      tournament('b', 2023),
      tournament('c', 2023),
      tournament('d', 2026),
    ]);
    const two = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'BRA')]);
    const sliceOf = (rows: VisRow[]) => {
      const { partnerships, appearances } = aggregatePartnerships(rows, seasons, two);
      return sliceByCountryAndGender(partnerships, appearances, two, seasons, 2)[0]!;
    };

    it('carries the offset of the last event the pair played that season', () => {
      // `a` is 2024, `b`/`c` are 2023 — so the 2023 row must take the later
      // of the two dates, not whichever happened to be seen first. The card
      // lists seasons newest first and orders partners inside one the same
      // way, so a partnership is positioned by when it was most recently
      // played, not when it started.
      const dated = normaliseTournaments([
        { ...tournament('a', 2024), StartDateMainDraw: '2024-05-02' },
        { ...tournament('b', 2023), StartDateMainDraw: '2023-08-20' },
        { ...tournament('c', 2023), StartDateMainDraw: '2023-03-10' },
      ]);
      const { partnerships, appearances } = aggregatePartnerships(
        [entry('a', 1, 2), entry('b', 1, 2), entry('c', 1, 2)],
        dated,
        two,
      );
      const edge = sliceByCountryAndGender(partnerships, appearances, two, dated, 2)[0]!.edges[0]!;
      expect(edge.s).toEqual([
        [2023, 2, 231], // 20 August, not 10 March
        [2024, 1, 122],
      ]);
    });

    it('omits the offset when a tournament has no usable date', () => {
      const slice = sliceOf([entry('b', 1, 2)]);
      expect(slice.edges[0]!.s).toEqual([[2023, 1]]);
    });

    it('tallies tournaments per season, ascending', () => {
      const slice = sliceOf([entry('a', 1, 2), entry('b', 1, 2), entry('c', 1, 2)]);
      expect(slice.edges[0]!.s).toEqual([
        [2023, 2],
        [2024, 1],
      ]);
    });

    it('leaves gap years out rather than filling them with zeroes', () => {
      // 2023 then 2026, nothing between. A timeline should show two rows, not
      // four — the pair genuinely did not play together in 2024 or 2025.
      const slice = sliceOf([entry('b', 1, 2), entry('d', 1, 2)]);
      expect(slice.edges[0]!.s).toEqual([
        [2023, 1],
        [2026, 1],
      ]);
    });

    it('stays consistent with the aggregates it duplicates', () => {
      // t, f and l are all derivable from s. They are stored separately for
      // render cost, so the one risk worth a test is the two disagreeing.
      const edge = sliceOf([entry('a', 1, 2), entry('b', 1, 2), entry('c', 1, 2), entry('d', 1, 2)]).edges[0]!;
      const s = edge.s!;
      expect(s.reduce((sum, [, n]) => sum + n, 0)).toBe(edge.t);
      expect(s[0]![0]).toBe(edge.f);
      expect(s[s.length - 1]![0]).toBe(edge.l);
    });

    it('counts a pair entering qualification and main draw of one event once', () => {
      // The same rule the aggregate totals follow: edges hold a set of
      // tournament numbers, so a duplicate entry must not inflate the season.
      const slice = sliceOf([entry('b', 1, 2), entry('b', 1, 2)]);
      expect(slice.edges[0]!.s).toEqual([[2023, 1]]);
      expect(slice.edges[0]!.t).toBe(1);
    });
  });

  it('orders nodes by id, not by a mutable field like tournament count', () => {
    // Three players, all BRA-M. Player 20 is by far the most active (3
    // tournaments), 10 the least (1) — the opposite of ascending id order.
    // Under the old "most active first" sort this would come back as
    // [20, 15, 10]; a single new tournament for any one of them would then
    // reorder the whole array. Sorting by id is immune to that.
    const p = normalisePlayers([player(10, '0', 'BRA'), player(15, '0', 'BRA'), player(20, '0', 'BRA')]);
    const t = normaliseTournaments([tournament('t1', 2023), tournament('t2', 2024), tournament('t3', 2025)]);
    const { partnerships, appearances } = aggregatePartnerships(
      [entry('t1', 10, 20), entry('t2', 15, 20), entry('t3', 15, 20)],
      t,
      p,
    );
    const slices = sliceByCountryAndGender(partnerships, appearances, p, t, 2);
    const bra = slices.find((s) => s.country === 'BRA' && s.gender === 'M')!;
    expect(bra.nodes.map((n) => n.id)).toEqual([10, 15, 20]);
  });

  it('orders edges by their (a, b) pair, the same immutable key used to build it', () => {
    const p = normalisePlayers([
      player(10, '0', 'BRA'),
      player(15, '0', 'BRA'),
      player(20, '0', 'BRA'),
      player(30, '0', 'BRA'),
    ]);
    const t = normaliseTournaments([tournament('t1', 2023)]);
    // Written out of order, and the pair with the most shared tournaments
    // (10-30, entered twice) is listed last — it would sort first under the
    // old "strongest partnership first" order.
    const { partnerships, appearances } = aggregatePartnerships(
      [entry('t1', 20, 30), entry('t1', 10, 15), entry('t1', 10, 30)],
      t,
      p,
    );
    const slices = sliceByCountryAndGender(partnerships, appearances, p, t, 2);
    const bra = slices.find((s) => s.country === 'BRA' && s.gender === 'M')!;
    expect(bra.edges.map((e) => `${e.a}-${e.b}`)).toEqual(['10-15', '10-30', '20-30']);
  });

  it('honours the minimum node count', () => {
    expect(run([entry('t1', 1, 2)], 3)).toHaveLength(0);
    expect(run([entry('t1', 1, 2)], 2)).toHaveLength(1);
  });
});

describe('medalTournaments', () => {
  it('keeps only real Olympic Games and World Championships events', () => {
    const rows: VisRow[] = [
      { No: '1', OrganizerType: '1', Type: '5' }, // Olympic Games
      { No: '2', OrganizerType: '1', Type: '4' }, // World Championships
      { No: '3', OrganizerType: '1', Type: '43' }, // Youth Olympic Games — no Olympic medal
      { No: '4', OrganizerType: '1', Type: '49' }, // Olympic Qualification Tournament — no medal at all
      { No: '5', OrganizerType: '1', Type: '52' }, // Beach Pro Tour Elite16 — not a medal event
      { No: '6', OrganizerType: '5', Type: '5' }, // Type 5, but not FIVB-organized
    ];
    const map = medalTournaments(rows);
    expect(map.get('1')).toBe('olympics');
    expect(map.get('2')).toBe('world-champs');
    expect(map.has('3')).toBe(false);
    expect(map.has('4')).toBe(false);
    expect(map.has('5')).toBe(false);
    expect(map.has('6')).toBe(false);
  });
});

describe('aggregateMedals', () => {
  const olympics = medalTournaments([{ No: 't1', OrganizerType: '1', Type: '5' }]);
  const worlds = medalTournaments([{ No: 't2', OrganizerType: '1', Type: '4' }]);
  const both = new Map([...olympics, ...worlds]);

  it('credits both players on gold, silver and bronze rows and ignores 4th place', () => {
    const rows: VisRow[] = [
      { ...entry('t1', 1, 2), Rank: '1' },
      { ...entry('t1', 3, 4), Rank: '2' },
      { ...entry('t1', 5, 6), Rank: '3' },
      { ...entry('t1', 7, 8), Rank: '4' }, // 4th place — no medal
    ];
    const byPlayer = aggregateMedals(rows, both);
    expect(byPlayer.get(1)!.olympics).toEqual({ gold: 1, silver: 0, bronze: 0 });
    expect(byPlayer.get(2)!.olympics).toEqual({ gold: 1, silver: 0, bronze: 0 });
    expect(byPlayer.get(3)!.olympics).toEqual({ gold: 0, silver: 1, bronze: 0 });
    expect(byPlayer.get(5)!.olympics).toEqual({ gold: 0, silver: 0, bronze: 1 });
    expect(byPlayer.has(7)).toBe(false);
  });

  it('keeps Olympic and World Championships tallies separate per player', () => {
    const rows: VisRow[] = [
      { ...entry('t1', 1, 2), Rank: '1' }, // Olympic gold
      { ...entry('t2', 1, 9), Rank: '2' }, // same player, World Champs silver
    ];
    const byPlayer = aggregateMedals(rows, both);
    expect(byPlayer.get(1)!.olympics).toEqual({ gold: 1, silver: 0, bronze: 0 });
    expect(byPlayer.get(1)!['world-champs']).toEqual({ gold: 0, silver: 1, bronze: 0 });
  });

  it('ignores rows outside any medal-eligible tournament', () => {
    const nonMedal = medalTournaments([{ No: 't3', OrganizerType: '1', Type: '52' }]);
    const rows: VisRow[] = [{ ...entry('t3', 1, 2), Rank: '1' }];
    expect(aggregateMedals(rows, nonMedal).size).toBe(0);
  });
});

describe('aggregateTourPodiums', () => {
  /** One tournament of each tier, so the filter can be checked from both sides. */
  const byTier = normaliseTournaments([
    { ...tournament('1', 2024), Type: '52' }, // Elite16 -> beach-pro-tour
    { ...tournament('2', 2015), Type: '32' }, // Major Series -> world-tour
    { ...tournament('3', 2024), Type: '5' }, // Olympic Games
    { ...tournament('4', 2023), Type: '4' }, // World Championships
    { ...tournament('5', 2024), Type: '26' }, // U21 World Championships
  ]);

  it('credits both players of a podium team and ignores 4th', () => {
    const counts = aggregateTourPodiums(
      [
        { ...entry('1', 1, 2), Rank: '1' },
        { ...entry('1', 3, 4), Rank: '2' },
        { ...entry('1', 5, 6), Rank: '3' },
        { ...entry('1', 7, 8), Rank: '4' },
      ],
      byTier,
    );
    expect(counts.get(1)).toEqual({ gold: 1, silver: 0, bronze: 0 });
    expect(counts.get(2)).toEqual({ gold: 1, silver: 0, bronze: 0 });
    expect(counts.get(3)).toEqual({ gold: 0, silver: 1, bronze: 0 });
    expect(counts.get(6)).toEqual({ gold: 0, silver: 0, bronze: 1 });
    expect(counts.has(7)).toBe(false);
  });

  it('mixes the two tour eras into one tally', () => {
    // A 2015 Major Series title and a 2024 Elite16 title are both one gold.
    // FIVB has renumbered its hierarchy repeatedly and no mapping between the
    // eras survives the archive, so there is nothing honest to weight by.
    const counts = aggregateTourPodiums(
      [
        { ...entry('1', 1, 2), Rank: '1' },
        { ...entry('2', 1, 2), Rank: '1' },
      ],
      byTier,
    );
    expect(counts.get(1)).toEqual({ gold: 2, silver: 0, bronze: 0 });
  });

  it('leaves out the Olympics and the World Championships, which are counted separately', () => {
    const counts = aggregateTourPodiums(
      [
        { ...entry('3', 1, 2), Rank: '1' },
        { ...entry('4', 1, 2), Rank: '1' },
      ],
      byTier,
    );
    expect(counts.size).toBe(0);
  });

  it('leaves out age-group world championships', () => {
    // A U21 title next to a Grand Slam title would flatter the wrong careers.
    expect(aggregateTourPodiums([{ ...entry('5', 1, 2), Rank: '1' }], byTier).size).toBe(0);
  });

  it('ignores a tournament the tier filter already rejected', () => {
    // Cancelled events, national tours, King of the Court: absent from the
    // normalised map, so they cannot contribute a podium.
    expect(aggregateTourPodiums([{ ...entry('404', 1, 2), Rank: '1' }], byTier).size).toBe(0);
  });

  it('skips a row with a missing or self-paired player', () => {
    const counts = aggregateTourPodiums(
      [
        { ...entry('1', 1, 0), Rank: '1' },
        { ...entry('1', 2, 2), Rank: '1' },
      ],
      byTier,
    );
    expect(counts.size).toBe(0);
  });
});

// A snapshot of every real Olympic Games (Type 5) and FIVB World
// Championships (Type 4) medal-round result FIVB's VIS API returns, captured
// so this test suite validates the medal logic against every actual medal
// event on record rather than a handful of synthetic cases — there are only
// 46 of them (16 Olympics, 30 World Championships), so the whole set fits.
// Cross-checked directly: Rio 2016 men's podium (Cerutti/Schmidt, Nicolai/Lupo,
// Brouwer/Meeuwsen) and Rome 2022 both golds (Mol/Sørum, Duda/Ana Patrícia)
// match the real, publicly documented results exactly, and the two 1997 World
// Championships below are real ties — the bronze-medal match didn't exist yet,
// so both semifinal losers share Rank 3.
const REAL_MEDAL_TOURNAMENTS: VisRow[] = [
  { No: '41', Code: 'MATH2004', OrganizerType: '1', Type: '5' },
  { No: '43', Code: 'MATL1996', OrganizerType: '1', Type: '5' },
  { No: '51', Code: 'MBEI2008', OrganizerType: '1', Type: '5' },
  { No: '62', Code: 'MBER2005', OrganizerType: '1', Type: '4' },
  { No: '178', Code: 'MGST2007', OrganizerType: '1', Type: '4' },
  { No: '193', Code: 'MITA2011', OrganizerType: '1', Type: '4' },
  { No: '211', Code: 'MKLA2001', OrganizerType: '1', Type: '4' },
  { No: '240', Code: 'MLAX1997', OrganizerType: '1', Type: '4' },
  { No: '287', Code: 'MMRS1999', OrganizerType: '1', Type: '4' },
  { No: '347', Code: 'MRIO2003', OrganizerType: '1', Type: '4' },
  { No: '384', Code: 'MSTA2009', OrganizerType: '1', Type: '4' },
  { No: '400', Code: 'MSYD2000', OrganizerType: '1', Type: '5' },
  { No: '478', Code: 'WATH2004', OrganizerType: '1', Type: '5' },
  { No: '480', Code: 'WATL1996', OrganizerType: '1', Type: '5' },
  { No: '489', Code: 'WBEI2008', OrganizerType: '1', Type: '5' },
  { No: '495', Code: 'WBER2005', OrganizerType: '1', Type: '4' },
  { No: '594', Code: 'WGST2007', OrganizerType: '1', Type: '4' },
  { No: '611', Code: 'WITA2011', OrganizerType: '1', Type: '4' },
  { No: '614', Code: 'WKLA2001', OrganizerType: '1', Type: '4' },
  { No: '635', Code: 'WLAX1997', OrganizerType: '1', Type: '4' },
  { No: '665', Code: 'WMRS1999', OrganizerType: '1', Type: '4' },
  { No: '735', Code: 'WRIO2003', OrganizerType: '1', Type: '4' },
  { No: '782', Code: 'WSTA2009', OrganizerType: '1', Type: '4' },
  { No: '793', Code: 'WSYD2000', OrganizerType: '1', Type: '5' },
  { No: '1097', Code: 'MLON2012', OrganizerType: '1', Type: '5' },
  { No: '1098', Code: 'WLON2012', OrganizerType: '1', Type: '5' },
  { No: '1364', Code: 'WSTJ2013', OrganizerType: '1', Type: '4' },
  { No: '1365', Code: 'MSTJ2013', OrganizerType: '1', Type: '4' },
  { No: '2564', Code: 'MNED2015', OrganizerType: '1', Type: '4' },
  { No: '2565', Code: 'WNED2015', OrganizerType: '1', Type: '4' },
  { No: '3690', Code: 'Rio2016M', OrganizerType: '1', Type: '5' },
  { No: '3691', Code: 'Rio2016W', OrganizerType: '1', Type: '5' },
  { No: '3895', Code: 'MWCH2017', OrganizerType: '1', Type: '4' },
  { No: '3896', Code: 'WWCH2017', OrganizerType: '1', Type: '4' },
  { No: '5022', Code: 'MWCH2019', OrganizerType: '1', Type: '4' },
  { No: '5023', Code: 'WWCH2019', OrganizerType: '1', Type: '4' },
  { No: '5872', Code: 'MTOK2020', OrganizerType: '1', Type: '5' },
  { No: '5873', Code: 'WTOK2020', OrganizerType: '1', Type: '5' },
  { No: '6295', Code: 'WROM2022', OrganizerType: '1', Type: '4' },
  { No: '6296', Code: 'MROM2022', OrganizerType: '1', Type: '4' },
  { No: '6796', Code: 'WWCH2023', OrganizerType: '1', Type: '4' },
  { No: '6797', Code: 'MWCH2023', OrganizerType: '1', Type: '4' },
  { No: '7642', Code: 'WPAR2024', OrganizerType: '1', Type: '5' },
  { No: '7643', Code: 'MPAR2024', OrganizerType: '1', Type: '5' },
  { No: '8136', Code: 'WWCH2025', OrganizerType: '1', Type: '4' },
  { No: '8137', Code: 'MWCH2025', OrganizerType: '1', Type: '4' },
];

const REAL_MEDAL_ROWS: VisRow[] = [
  { NoTournament: '41', NoPlayer1: '100096', NoPlayer2: '103311', Rank: '2' }, // MATH2004 Javier Bosma Minguez / Pablo Herrera Allepuz
  { NoTournament: '41', NoPlayer1: '100997', NoPlayer2: '100427', Rank: '1' }, // MATH2004 Ricardo Alex Costa Santos / Emanuel Rego
  { NoTournament: '41', NoPlayer1: '101846', NoPlayer2: '101847', Rank: '3' }, // MATH2004 Patrick Heuscher / Stefan "Kobi" Kobel
  { NoTournament: '43', NoPlayer1: '100002', NoPlayer2: '100088', Rank: '3' }, // MATL1996 John Child / Mark Heese
  { NoTournament: '43', NoPlayer1: '100132', NoPlayer2: '100458', Rank: '1' }, // MATL1996 Kent Steffes / Karch Kiraly
  { NoTournament: '43', NoPlayer1: '100365', NoPlayer2: '100133', Rank: '2' }, // MATL1996 Mike "Whit" Whitmarsh / Michael "Mike" Dodd
  { NoTournament: '51', NoPlayer1: '100425', NoPlayer2: '105143', Rank: '1' }, // MBEI2008 Todd Rogers / Philip Dalhausser
  { NoTournament: '51', NoPlayer1: '100997', NoPlayer2: '100427', Rank: '3' }, // MBEI2008 Ricardo Alex Costa Santos / Emanuel Rego
  { NoTournament: '51', NoPlayer1: '101591', NoPlayer2: '104207', Rank: '2' }, // MBEI2008 Marcio Henrique Barroso Araujo / Fabio Luiz de Jesus Magalhães
  { NoTournament: '62', NoPlayer1: '100670', NoPlayer2: '100530', Rank: '2' }, // MBER2005 Sascha Heyer / Paul Laciga
  { NoTournament: '62', NoPlayer1: '101591', NoPlayer2: '104207', Rank: '1' }, // MBER2005 Marcio Henrique Barroso Araujo / Fabio Luiz de Jesus Magalhães
  { NoTournament: '62', NoPlayer1: '103217', NoPlayer2: '101917', Rank: '3' }, // MBER2005 Julius Brink / Kjell "Kelli" Schneider
  { NoTournament: '178', NoPlayer1: '100425', NoPlayer2: '105143', Rank: '1' }, // MGST2007 Todd Rogers / Philip Dalhausser
  { NoTournament: '178', NoPlayer1: '100695', NoPlayer2: '102551', Rank: '3' }, // MGST2007 Andrew Schacht / Joshua "Josh" Slack
  { NoTournament: '178', NoPlayer1: '102631', NoPlayer2: '112228', Rank: '2' }, // MGST2007 Dmitri Barsuk / Igor Kolodinsky
  { NoTournament: '193', NoPlayer1: '103217', NoPlayer2: '103109', Rank: '3' }, // MITA2011 Julius Brink / Jonas Reckermann
  { NoTournament: '193', NoPlayer1: '101591', NoPlayer2: '100997', Rank: '2' }, // MITA2011 Marcio Henrique Barroso Araujo / Ricardo Alex Costa Santos
  { NoTournament: '193', NoPlayer1: '100427', NoPlayer2: '118267', Rank: '1' }, // MITA2011 Emanuel Rego / Alison Cerutti
  { NoTournament: '211', NoPlayer1: '100302', NoPlayer2: '100844', Rank: '3' }, // MKLA2001 Jorre André Kjemperud / Vegard Hoidalen
  { NoTournament: '211', NoPlayer1: '100997', NoPlayer2: '100218', Rank: '2' }, // MKLA2001 Ricardo Alex Costa Santos / José Geraldo Loiola
  { NoTournament: '211', NoPlayer1: '101345', NoPlayer2: '100148', Rank: '1' }, // MKLA2001 Mariano "Mono" Baracetti / Martin Alejo Conde
  { NoTournament: '240', NoPlayer1: '100132', NoPlayer2: '100334', Rank: '3' }, // MLAX1997 Kent Steffes / Dain Blanton
  { NoTournament: '240', NoPlayer1: '100365', NoPlayer2: '100869', Rank: '2' }, // MLAX1997 Mike "Whit" Whitmarsh / Canyon Ceman
  { NoTournament: '240', NoPlayer1: '100564', NoPlayer2: '100182', Rank: '1' }, // MLAX1997 Rogério "Pará" de Souza Ferreira / Guilherme Luiz Marques
  { NoTournament: '240', NoPlayer1: '101204', NoPlayer2: '100021', Rank: '3' }, // MLAX1997 Paulo Emilio Silva Azevedo / Paulo Roberto "Paulão" Moreira da Costa
  { NoTournament: '287', NoPlayer1: '100427', NoPlayer2: '100218', Rank: '1' }, // MMRS1999 Emanuel Rego / José Geraldo Loiola
  { NoTournament: '287', NoPlayer1: '100530', NoPlayer2: '100529', Rank: '2' }, // MMRS1999 Paul Laciga / Martin Laciga
  { NoTournament: '287', NoPlayer1: '100564', NoPlayer2: '100182', Rank: '3' }, // MMRS1999 Rogério "Pará" de Souza Ferreira / Guilherme Luiz Marques
  { NoTournament: '347', NoPlayer1: '100418', NoPlayer2: '102087', Rank: '2' }, // MRIO2003 Daxton "Dax" Holdren / Stein Metzger
  { NoTournament: '347', NoPlayer1: '100997', NoPlayer2: '100427', Rank: '1' }, // MRIO2003 Ricardo Alex Costa Santos / Emanuel Rego
  { NoTournament: '347', NoPlayer1: '102082', NoPlayer2: '101591', Rank: '3' }, // MRIO2003 Benjamin Insfran / Marcio Henrique Barroso Araujo
  { NoTournament: '384', NoPlayer1: '100425', NoPlayer2: '105143', Rank: '3' }, // MSTA2009 Todd Rogers / Philip Dalhausser
  { NoTournament: '384', NoPlayer1: '103217', NoPlayer2: '103109', Rank: '1' }, // MSTA2009 Julius Brink / Jonas Reckermann
  { NoTournament: '384', NoPlayer1: '101669', NoPlayer2: '118267', Rank: '2' }, // MSTA2009 Harley Marques Silva / Alison Cerutti
  { NoTournament: '400', NoPlayer1: '100334', NoPlayer2: '100393', Rank: '1' }, // MSYD2000 Dain Blanton / Eric Fonoimoana
  { NoTournament: '400', NoPlayer1: '100426', NoPlayer2: '100997', Rank: '2' }, // MSYD2000 José Marco "Zé Marco" Nóbrega Ferreira de Melo / Ricardo Alex Costa Santos
  { NoTournament: '400', NoPlayer1: '100494', NoPlayer2: '100495', Rank: '3' }, // MSYD2000 Jörg "Vince" Ahmann / Axel "Hägar" Hager
  { NoTournament: '478', NoPlayer1: '100256', NoPlayer2: '100926', Rank: '2' }, // WATH2004 Adriana Brandão Behar / Shelda Kelly Bruno Bede
  { NoTournament: '478', NoPlayer1: '100715', NoPlayer2: '101905', Rank: '3' }, // WATH2004 Holly McPeak / Elaine   "Ey" Youngs
  { NoTournament: '478', NoPlayer1: '103242', NoPlayer2: '102850', Rank: '1' }, // WATH2004 Kerri Walsh Jennings / Misty May-Treanor
  { NoTournament: '480', NoPlayer1: '100250', NoPlayer2: '100258', Rank: '1' }, // WATL1996 Jacqueline Louise "Jackie" Cruz Silva / Sandra Pires Tavares
  { NoTournament: '480', NoPlayer1: '100251', NoPlayer2: '100371', Rank: '3' }, // WATL1996 Natalie "Nat" Cook / Kerri-Ann "Kez" Pottharst
  { NoTournament: '480', NoPlayer1: '100253', NoPlayer2: '100252', Rank: '2' }, // WATL1996 Adriana Samuel Ramos / Mônica Rodrigues
  { NoTournament: '489', NoPlayer1: '102166', NoPlayer2: '104032', Rank: '2' }, // WBEI2008 Jia Tian / Jie Wang
  { NoTournament: '489', NoPlayer1: '103242', NoPlayer2: '102850', Rank: '1' }, // WBEI2008 Kerri Walsh Jennings / Misty May-Treanor
  { NoTournament: '489', NoPlayer1: '104438', NoPlayer2: '103653', Rank: '3' }, // WBEI2008 Chen Xue / Xi Zhang
  { NoTournament: '495', NoPlayer1: '102166', NoPlayer2: '102341', Rank: '3' }, // WBER2005 Jia Tian / Fei Wang
  { NoTournament: '495', NoPlayer1: '103242', NoPlayer2: '102850', Rank: '1' }, // WBER2005 Kerri Walsh Jennings / Misty May-Treanor
  { NoTournament: '495', NoPlayer1: '103903', NoPlayer2: '103904', Rank: '2' }, // WBER2005 Larissa França Maestrini / Juliana Felisberta  Da Silva
  { NoTournament: '594', NoPlayer1: '102166', NoPlayer2: '104032', Rank: '2' }, // WGST2007 Jia Tian / Jie Wang
  { NoTournament: '594', NoPlayer1: '103242', NoPlayer2: '102850', Rank: '1' }, // WGST2007 Kerri Walsh Jennings / Misty May-Treanor
  { NoTournament: '594', NoPlayer1: '103903', NoPlayer2: '103904', Rank: '3' }, // WGST2007 Larissa França Maestrini / Juliana Felisberta  Da Silva
  { NoTournament: '611', NoPlayer1: '104438', NoPlayer2: '103653', Rank: '3' }, // WITA2011 Chen Xue / Xi Zhang
  { NoTournament: '611', NoPlayer1: '102850', NoPlayer2: '103242', Rank: '2' }, // WITA2011 Misty May-Treanor / Kerri Walsh Jennings
  { NoTournament: '611', NoPlayer1: '103903', NoPlayer2: '103904', Rank: '1' }, // WITA2011 Larissa França Maestrini / Juliana Felisberta  Da Silva
  { NoTournament: '614', NoPlayer1: '100256', NoPlayer2: '100926', Rank: '1' }, // WKLA2001 Adriana Brandão Behar / Shelda Kelly Bruno Bede
  { NoTournament: '614', NoPlayer1: '100258', NoPlayer2: '101719', Rank: '2' }, // WKLA2001 Sandra Pires Tavares / Tatiana Minello
  { NoTournament: '614', NoPlayer1: '101546', NoPlayer2: '101547', Rank: '3' }, // WKLA2001 Eva Celbova / Sona Novakova Dosoudilova
  { NoTournament: '635', NoPlayer1: '100012', NoPlayer2: '100074', Rank: '3' }, // WLAX1997 Karolyn "KK" Kirby / Nancy Reno
  { NoTournament: '635', NoPlayer1: '100250', NoPlayer2: '100258', Rank: '1' }, // WLAX1997 Jacqueline Louise "Jackie" Cruz Silva / Sandra Pires Tavares
  { NoTournament: '635', NoPlayer1: '100256', NoPlayer2: '100926', Rank: '3' }, // WLAX1997 Adriana Brandão Behar / Shelda Kelly Bruno Bede
  { NoTournament: '635', NoPlayer1: '100615', NoPlayer2: '100715', Rank: '2' }, // WLAX1997 Lisa Arce / Holly McPeak
  { NoTournament: '665', NoPlayer1: '100019', NoPlayer2: '101905', Rank: '3' }, // WMRS1999 Elizabeth "Liz" Masakayan / Elaine   "Ey" Youngs
  { NoTournament: '665', NoPlayer1: '100256', NoPlayer2: '100926', Rank: '1' }, // WMRS1999 Adriana Brandão Behar / Shelda Kelly Bruno Bede
  { NoTournament: '665', NoPlayer1: '101712', NoPlayer2: '101718', Rank: '2' }, // WMRS1999 Annett "Nettie" Davis / Jennifer "Jenny" Jordan Jonnson
  { NoTournament: '735', NoPlayer1: '100251', NoPlayer2: '102145', Rank: '3' }, // WRIO2003 Natalie "Nat" Cook / Nicole Sanderson
  { NoTournament: '735', NoPlayer1: '100256', NoPlayer2: '100926', Rank: '2' }, // WRIO2003 Adriana Brandão Behar / Shelda Kelly Bruno Bede
  { NoTournament: '735', NoPlayer1: '103242', NoPlayer2: '102850', Rank: '1' }, // WRIO2003 Kerri Walsh Jennings / Misty May-Treanor
  { NoTournament: '782', NoPlayer1: '118426', NoPlayer2: '103011', Rank: '1' }, // WSTA2009 April Ross / Jennifer Kessy
  { NoTournament: '782', NoPlayer1: '103903', NoPlayer2: '103904', Rank: '2' }, // WSTA2009 Larissa França Maestrini / Juliana Felisberta  Da Silva
  { NoTournament: '782', NoPlayer1: '103892', NoPlayer2: '105063', Rank: '3' }, // WSTA2009 Talita Da Rocha Antunes / Maria Antonelli
  { NoTournament: '793', NoPlayer1: '100251', NoPlayer2: '100371', Rank: '1' }, // WSYD2000 Natalie "Nat" Cook / Kerri-Ann "Kez" Pottharst
  { NoTournament: '793', NoPlayer1: '100256', NoPlayer2: '100926', Rank: '2' }, // WSYD2000 Adriana Brandão Behar / Shelda Kelly Bruno Bede
  { NoTournament: '793', NoPlayer1: '100258', NoPlayer2: '100253', Rank: '3' }, // WSYD2000 Sandra Pires Tavares / Adriana Samuel Ramos
  { NoTournament: '1097', NoPlayer1: '100427', NoPlayer2: '118267', Rank: '2' }, // MLON2012 Emanuel Rego / Alison Cerutti
  { NoTournament: '1097', NoPlayer1: '103217', NoPlayer2: '103109', Rank: '1' }, // MLON2012 Julius Brink / Jonas Reckermann
  { NoTournament: '1097', NoPlayer1: '104142', NoPlayer2: '104449', Rank: '3' }, // MLON2012 Martins Plavins / Janis Smedins
  { NoTournament: '1098', NoPlayer1: '103903', NoPlayer2: '103904', Rank: '3' }, // WLON2012 Larissa França Maestrini / Juliana Felisberta  Da Silva
  { NoTournament: '1098', NoPlayer1: '102850', NoPlayer2: '103242', Rank: '1' }, // WLON2012 Misty May-Treanor / Kerri Walsh Jennings
  { NoTournament: '1098', NoPlayer1: '103011', NoPlayer2: '118426', Rank: '2' }, // WLON2012 Jennifer Kessy / April Ross
  { NoTournament: '1364', NoPlayer1: '119108', NoPlayer2: '118261', Rank: '2' }, // WSTJ2013 Karla Borger / Britta Büthe
  { NoTournament: '1364', NoPlayer1: '104438', NoPlayer2: '103653', Rank: '1' }, // WSTJ2013 Chen Xue / Xi Zhang
  { NoTournament: '1364', NoPlayer1: '116870', NoPlayer2: '104505', Rank: '3' }, // WSTJ2013 Liliane Maestrini / Barbara Seixas de Freitas
  { NoTournament: '1365', NoPlayer1: '116660', NoPlayer2: '103348', Rank: '3' }, // MSTJ2013 Jonathan Erdmann / Kay Matysik
  { NoTournament: '1365', NoPlayer1: '118317', NoPlayer2: '119991', Rank: '1' }, // MSTJ2013 Alexander Brouwer / Robert Meeuwsen
  { NoTournament: '1365', NoPlayer1: '100997', NoPlayer2: '120550', Rank: '2' }, // MSTJ2013 Ricardo Alex Costa Santos / Álvaro Morais Filho
  { NoTournament: '2564', NoPlayer1: '116556', NoPlayer2: '119235', Rank: '2' }, // MNED2015 Reinder Nummerdor / Christiaan Varenhorst
  { NoTournament: '2564', NoPlayer1: '118267', NoPlayer2: '117474', Rank: '1' }, // MNED2015 Alison Cerutti / Bruno Oscar Schmidt
  { NoTournament: '2564', NoPlayer1: '104073', NoPlayer2: '133285', Rank: '3' }, // MNED2015 Pedro Solberg / Evandro Gonçalves Oliveira Júnior
  { NoTournament: '2565', NoPlayer1: '105063', NoPlayer2: '103904', Rank: '3' }, // WNED2015 Maria Antonelli / Juliana Felisberta  Da Silva
  { NoTournament: '2565', NoPlayer1: '104505', NoPlayer2: '115287', Rank: '1' }, // WNED2015 Barbara Seixas de Freitas / Agatha Bednarczuk
  { NoTournament: '2565', NoPlayer1: '103997', NoPlayer2: '112638', Rank: '2' }, // WNED2015 Taiana Lima / Fernanda Alves
  { NoTournament: '3690', NoPlayer1: '118267', NoPlayer2: '117474', Rank: '1' }, // Rio2016M Alison Cerutti / Bruno Oscar Schmidt
  { NoTournament: '3690', NoPlayer1: '118317', NoPlayer2: '119991', Rank: '3' }, // Rio2016M Alexander Brouwer / Robert Meeuwsen
  { NoTournament: '3690', NoPlayer1: '118194', NoPlayer2: '120774', Rank: '2' }, // Rio2016M Paolo Nicolai / Daniele Lupo
  { NoTournament: '3691', NoPlayer1: '115287', NoPlayer2: '104505', Rank: '2' }, // Rio2016W Agatha Bednarczuk / Barbara Seixas de Freitas
  { NoTournament: '3691', NoPlayer1: '103242', NoPlayer2: '118426', Rank: '3' }, // Rio2016W Kerri Walsh Jennings / April Ross
  { NoTournament: '3691', NoPlayer1: '104461', NoPlayer2: '118951', Rank: '1' }, // Rio2016W Laura Ludwig / Kira Walkenhorst
  { NoTournament: '3895', NoPlayer1: '120749', NoPlayer2: '147531', Rank: '3' }, // MWCH2017 Viacheslav Krasilnikov / Nikita Liamin
  { NoTournament: '3895', NoPlayer1: '101534', NoPlayer2: '103677', Rank: '2' }, // MWCH2017 Clemens Doppler / Alexander Horst
  { NoTournament: '3895', NoPlayer1: '133285', NoPlayer2: '147009', Rank: '1' }, // MWCH2017 Evandro Gonçalves Oliveira Júnior / Andre Loyola Stein
  { NoTournament: '3896', NoPlayer1: '104461', NoPlayer2: '118951', Rank: '1' }, // WWCH2017 Laura Ludwig / Kira Walkenhorst
  { NoTournament: '3896', NoPlayer1: '118426', NoPlayer2: '104862', Rank: '2' }, // WWCH2017 April Ross / Lauren Fendrick
  { NoTournament: '3896', NoPlayer1: '103903', NoPlayer2: '103892', Rank: '3' }, // WWCH2017 Larissa França Maestrini / Talita Da Rocha Antunes
  { NoTournament: '5022', NoPlayer1: '143192', NoPlayer2: '137127', Rank: '3' }, // MWCH2019 Anders Berntsen Mol / Christian Sandlie Sørum
  { NoTournament: '5022', NoPlayer1: '147665', NoPlayer2: '139387', Rank: '2' }, // MWCH2019 Julius Thole / Clemens Wickler
  { NoTournament: '5022', NoPlayer1: '141535', NoPlayer2: '120749', Rank: '1' }, // MWCH2019 Oleg Stoyanovskiy / Viacheslav Krasilnikov
  { NoTournament: '5023', NoPlayer1: '113895', NoPlayer2: '124979', Rank: '1' }, // WWCH2019 Sarah Pavan / Melissa Humana-Paredes
  { NoTournament: '5023', NoPlayer1: '125172', NoPlayer2: '118988', Rank: '3' }, // WWCH2019 Taliqua Clancy / Mariafe Artacho Del Solar
  { NoTournament: '5023', NoPlayer1: '115846', NoPlayer2: '118426', Rank: '2' }, // WWCH2019 Alexandra Klineman / April Ross
  { NoTournament: '5872', NoPlayer1: '143192', NoPlayer2: '137127', Rank: '1' }, // MTOK2020 Anders Berntsen Mol / Christian Sandlie Sørum
  { NoTournament: '5872', NoPlayer1: '120749', NoPlayer2: '141535', Rank: '2' }, // MTOK2020 Viacheslav Krasilnikov / Oleg Stoyanovskiy
  { NoTournament: '5872', NoPlayer1: '146488', NoPlayer2: '146481', Rank: '3' }, // MTOK2020 Cherif Younousse / Ahmed Tijan
  { NoTournament: '5873', NoPlayer1: '118988', NoPlayer2: '125172', Rank: '2' }, // WTOK2020 Mariafe Artacho Del Solar / Taliqua Clancy
  { NoTournament: '5873', NoPlayer1: '124999', NoPlayer2: '124153', Rank: '3' }, // WTOK2020 Anouk Vergé-Dépré / Joana Mäder
  { NoTournament: '5873', NoPlayer1: '118426', NoPlayer2: '115846', Rank: '1' }, // WTOK2020 April Ross / Alexandra Klineman
  { NoTournament: '6295', NoPlayer1: '153267', NoPlayer2: '125549', Rank: '3' }, // WROM2022 Svenja Müller / Cinja Tillmann
  { NoTournament: '6295', NoPlayer1: '139087', NoPlayer2: '147073', Rank: '1' }, // WROM2022 Eduarda Santos Lisboa / Ana Patricia Silva Ramos
  { NoTournament: '6295', NoPlayer1: '139270', NoPlayer2: '141868', Rank: '2' }, // WROM2022 Sophie Bukovec / Brandie Wilkerson
  { NoTournament: '6296', NoPlayer1: '156493', NoPlayer2: '120551', Rank: '2' }, // MROM2022 Renato Andrew Lima de Carvalho / Vitor Gonçalves Felipe
  { NoTournament: '6296', NoPlayer1: '147009', NoPlayer2: '142889', Rank: '3' }, // MROM2022 Andre Loyola Stein / George Souto Maior Wanderley
  { NoTournament: '6296', NoPlayer1: '143192', NoPlayer2: '137127', Rank: '1' }, // MROM2022 Anders Berntsen Mol / Christian Sandlie Sørum
  { NoTournament: '6796', NoPlayer1: '147073', NoPlayer2: '139087', Rank: '2' }, // WWCH2023 Ana Patricia Silva Ramos / Eduarda Santos Lisboa
  { NoTournament: '6796', NoPlayer1: '162432', NoPlayer2: '184611', Rank: '3' }, // WWCH2023 Kristen Cruz / Taryn Brasher
  { NoTournament: '6796', NoPlayer1: '135571', NoPlayer2: '140066', Rank: '1' }, // WWCH2023 Sara Hughes / Kelly Cheng
  { NoTournament: '6797', NoPlayer1: '160555', NoPlayer2: '166274', Rank: '2' }, // MWCH2023 David Åhman / Jonatan Hellvig
  { NoTournament: '6797', NoPlayer1: '122846', NoPlayer2: '137237', Rank: '3' }, // MWCH2023 Bartosz Łosiak / Michal Bryl
  { NoTournament: '6797', NoPlayer1: '137346', NoPlayer2: '153790', Rank: '1' }, // MWCH2023 Ondrej Perusic / David Schweiner
  { NoTournament: '7642', NoPlayer1: '147073', NoPlayer2: '139087', Rank: '1' }, // WPAR2024 Ana Patricia Silva Ramos / Eduarda Santos Lisboa
  { NoTournament: '7642', NoPlayer1: '124979', NoPlayer2: '141868', Rank: '2' }, // WPAR2024 Melissa Humana-Paredes / Brandie Wilkerson
  { NoTournament: '7642', NoPlayer1: '132614', NoPlayer2: '135579', Rank: '3' }, // WPAR2024 Tanja Hüberli / Nina Brunner
  { NoTournament: '7643', NoPlayer1: '160555', NoPlayer2: '166274', Rank: '1' }, // MPAR2024 David Åhman / Jonatan Hellvig
  { NoTournament: '7643', NoPlayer1: '143192', NoPlayer2: '137127', Rank: '3' }, // MPAR2024 Anders Berntsen Mol / Christian Sandlie Sørum
  { NoTournament: '7643', NoPlayer1: '156567', NoPlayer2: '139387', Rank: '2' }, // MPAR2024 Nils Ehlers / Clemens Wickler
  { NoTournament: '8136', NoPlayer1: '141983', NoPlayer2: '141984', Rank: '1' }, // WWCH2025 Tina Graudina / Anastasija Samoilova
  { NoTournament: '8136', NoPlayer1: '104079', NoPlayer2: '132686', Rank: '3' }, // WWCH2025 Carolina Solberg Salgado / Rebecca Cavalcante Barbosa Silva
  { NoTournament: '8136', NoPlayer1: '162432', NoPlayer2: '184611', Rank: '2' }, // WWCH2025 Kristen Cruz / Taryn Brasher
  { NoTournament: '8137', NoPlayer1: '160555', NoPlayer2: '166274', Rank: '1' }, // MWCH2025 David Åhman / Jonatan Hellvig
  { NoTournament: '8137', NoPlayer1: '171940', NoPlayer2: '202200', Rank: '2' }, // MWCH2025 Jacob Hölting Nilsson / Elmer Andersson
  { NoTournament: '8137', NoPlayer1: '175205', NoPlayer2: '146455', Rank: '3' }, // MWCH2025 Téo Rotar / Arnaud Gauthier-Rat
];

describe('aggregateMedals (real FIVB medal history)', () => {
  const medals = medalTournaments(REAL_MEDAL_TOURNAMENTS);
  const byPlayer = aggregateMedals(REAL_MEDAL_ROWS, medals);

  it('recognises every real Olympic Games and World Championships event on record', () => {
    expect(medals.size).toBe(46);
    expect([...medals.values()].filter((c) => c === 'olympics')).toHaveLength(16);
    expect([...medals.values()].filter((c) => c === 'world-champs')).toHaveLength(30);
  });

  it("matches Kerri Walsh Jennings's known Olympic and World Championships record", () => {
    // 3 Olympic golds (2004, 2008, 2012) + 1 Olympic bronze (2016, with April
    // Ross, after Misty May-Treanor had retired), plus 3 World Championships
    // (2003, 2005, 2007) and a runner-up finish in 2011.
    const kerri = byPlayer.get(103242)!;
    expect(kerri.olympics).toEqual({ gold: 3, silver: 0, bronze: 1 });
    expect(kerri['world-champs']).toEqual({ gold: 3, silver: 1, bronze: 0 });
  });

  it('credits both teams for the shared 1997 World Championships bronze (no bronze-medal match yet)', () => {
    const steffesBlanton = byPlayer.get(100132)!; // Kent Steffes, men's MLAX1997
    expect(steffesBlanton['world-champs'].bronze).toBe(1);
    const paulao = byPlayer.get(100021)!; // Paulão, the other men's MLAX1997 bronze
    expect(paulao['world-champs'].bronze).toBe(1);
    const kirbyReno = byPlayer.get(100012)!; // KK Kirby, women's WLAX1997
    expect(kirbyReno['world-champs'].bronze).toBe(1);
  });

  it('gives Mol/Sørum the Tokyo 2020 gold and Rome 2022 World Championships gold', () => {
    const mol = byPlayer.get(143192)!;
    expect(mol.olympics.gold).toBeGreaterThanOrEqual(1); // Tokyo 2020
    expect(mol['world-champs'].gold).toBeGreaterThanOrEqual(1); // Rome 2022
  });

  it('awards exactly one gold pair (2 players) per medal event', () => {
    const golds = [...byPlayer.values()].reduce((s, m) => s + m.olympics.gold + m['world-champs'].gold, 0);
    // 46 events x 2 players per winning pair.
    expect(golds).toBe(46 * 2);
  });
});

describe('finishedWithoutResults', () => {
  const dated = (no: string, ends: string): VisRow => ({
    ...tournament(no, Number(ends.slice(0, 4))),
    EndDateMainDraw: ends,
  });

  it('reports an event that is over and has no ranked row', () => {
    // BPT Futures Busan, the case this exists for: every entry present, every
    // Rank blank, because FIVB had not written the placements yet.
    const tournaments = normaliseTournaments([dated('1', '2026-08-16')]);
    const rows: VisRow[] = [
      { ...entry('1', 1, 2), Rank: '' },
      { ...entry('1', 3, 4), Rank: '0' },
    ];
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17').map((t) => t.no)).toEqual(['1']);
  });

  it('says nothing once a single row has a rank', () => {
    const tournaments = normaliseTournaments([dated('1', '2026-08-16')]);
    const rows: VisRow[] = [
      { ...entry('1', 1, 2), Rank: '' },
      { ...entry('1', 3, 4), Rank: '9' },
    ];
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17')).toEqual([]);
  });

  it('counts a negative rank as a result -- a qualification exit is one', () => {
    const tournaments = normaliseTournaments([dated('1', '2026-08-16')]);
    const rows: VisRow[] = [{ ...entry('1', 1, 2), Rank: '-2' }];
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17')).toEqual([]);
  });

  it('ignores an event that has not finished', () => {
    // Future events carry full entry lists and no ranks by definition; saying
    // so every week for every scheduled tournament would be pure noise.
    const tournaments = normaliseTournaments([dated('1', '2026-12-01')]);
    const rows: VisRow[] = [{ ...entry('1', 1, 2), Rank: '' }];
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17')).toEqual([]);
  });

  it('treats the last day of the main draw as finished', () => {
    const tournaments = normaliseTournaments([dated('1', '2026-08-17')]);
    const rows: VisRow[] = [{ ...entry('1', 1, 2), Rank: '' }];
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17T09:00:00Z')).toHaveLength(1);
  });

  it('skips a tournament VIS gave no end date', () => {
    const tournaments = normaliseTournaments([tournament('1', 2026)]);
    const rows: VisRow[] = [{ ...entry('1', 1, 2), Rank: '' }];
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17')).toEqual([]);
  });

  it('lists the most recently finished first', () => {
    const tournaments = normaliseTournaments([
      dated('1', '2024-05-01'),
      dated('2', '2026-08-16'),
      dated('3', '2025-06-01'),
    ]);
    const rows: VisRow[] = ['1', '2', '3'].map((no) => ({ ...entry(no, 1, 2), Rank: '' }));
    expect(finishedWithoutResults(tournaments, rows, '2026-08-17').map((t) => t.no)).toEqual(['2', '3', '1']);
  });
});

/**
 * What actually got published, rather than what the rule does on a fixture.
 *
 * A best finish is the one number on the card a reader is most likely to check
 * against FIVB, so it is worth asserting against the artifact: a field that
 * silently stopped being written, or started carrying an elimination code,
 * would still render a full and plausible-looking list.
 */
describe('the published best finishes', () => {
  const dir = new URL('../web/public/v1/graphs', import.meta.url);
  const edges: { r?: number; t: number }[] = [];
  for (const f of readdirSync(dir)) {
    const file = JSON.parse(readFileSync(new URL(`../web/public/v1/graphs/${f}`, import.meta.url), 'utf8'));
    edges.push(...file.edges);
  }

  it('is on nearly every edge', () => {
    // Vacuity guard, and a floor: 98.0% of partnerships reached a main draw
    // together at least once. A drop past 90% is the field breaking, not the
    // archive changing.
    const withBest = edges.filter((e) => e.r !== undefined);
    expect(edges.length).toBeGreaterThan(10_000);
    expect(withBest.length / edges.length).toBeGreaterThan(0.9);
  });

  it('is never an elimination code or a zero', () => {
    // The failure that would look like a result: -25 is qualification and -2 a
    // confederation quota, and either would render as a placement.
    expect(edges.filter((e) => e.r !== undefined && e.r < 1)).toEqual([]);
  });

  it('is always a whole number', () => {
    expect(edges.filter((e) => e.r !== undefined && !Number.isInteger(e.r))).toEqual([]);
  });

  it('has someone who won together', () => {
    expect(edges.filter((e) => e.r === 1).length).toBeGreaterThan(100);
  });
});

/**
 * What actually got published, rather than what the rule does on a fixture.
 *
 * `tidyName` is unit-tested above, but nothing there proves it is *reached* —
 * the name path runs through `fullName`, `shortName` and the search index, and
 * a field that stopped being tidied on the way would still publish perfectly
 * plausible names. These assert the three defects are absent from the artifact
 * and that the deliberate non-fix is still deliberate.
 */
describe('the published player names', () => {
  const search = JSON.parse(readFileSync(new URL('../web/public/v1/search.json', import.meta.url), 'utf8'));
  const names: string[] = [];
  for (const list of Object.values(search.slices as Record<string, [number, string, number][]>)) {
    for (const entry of list) names.push(entry[1]);
  }

  const words = (name: string) => name.split(' ').filter((w) => /\p{L}/u.test(w));
  const shouts = (word: string) => word === word.toUpperCase() && word !== word.toLowerCase();

  it('covers the whole archive', () => {
    // Vacuity guard: the assertions below all pass trivially on an empty list.
    expect(names.length).toBeGreaterThan(10_000);
  });

  it('has no name typed entirely in capitals', () => {
    // 64 before this; the rule only fires when every word shouts.
    expect(names.filter((n) => words(n).length > 0 && words(n).every(shouts))).toEqual([]);
  });

  it('has no double space and no stray whitespace', () => {
    // 36 double-spaced. Tande's row is stored with a leading space.
    expect(names.filter((n) => /\s\s/.test(n) || n !== n.trim())).toEqual([]);
  });

  it('still keeps the capitals that mark a surname', () => {
    // The deliberate non-fix, asserted so a future "tidy every word" change
    // has to argue with a test rather than silently delete the signal. These
    // are names like "Katharina HETZENDORFER" and "MUKUNZI Christ Ornel".
    const marked = names.filter((n) => words(n).some(shouts) && words(n).some((w) => !shouts(w)));
    expect(marked.length).toBeGreaterThan(20);
  });
});

/**
 * A competition status is not a name — asserted on the artifact, not a fixture.
 *
 * `SUSPENDED` reaches us in two fields at once, and the one that did the damage
 * was `TeamName`: five of the six affected players were labelled "Suspended" on
 * the USA-M graph, which is the label the node draws and the card headlines.
 * A fixture proves the strip works; only the artifact proves it is reached on
 * both fields, and the short label is not in `search.json` unless it differs
 * from the full name — so this reads the graphs.
 */
describe('the published names carry no competition status', () => {
  const dir = new URL('../web/public/v1/graphs', import.meta.url);
  const labels: string[] = [];
  for (const f of readdirSync(dir)) {
    const file = JSON.parse(readFileSync(new URL(`../web/public/v1/graphs/${f}`, import.meta.url), 'utf8'));
    for (const node of file.nodes as { name: string; short: string }[]) {
      labels.push(node.name, node.short);
    }
  }

  it('covers every published node, name and short label alike', () => {
    // Vacuity guard: the assertion below passes trivially on an empty list.
    expect(labels.length).toBeGreaterThan(20_000);
  });

  it('never says a player is suspended', () => {
    // Six before this: Tanner, Hovland, Young, Frohoff, Martin and Unger.
    expect(labels.filter((n) => /(?<!\p{L})suspended(?!\p{L})/iu.test(n))).toEqual([]);
  });

  it('kept the players themselves', () => {
    // Guard the guard: deleting the six records would also pass the assertion
    // above. Hovland's six tournaments and Frohoff's two are still published.
    expect(labels).toContain('Tim "The Hov" Hovland');
    expect(labels).toContain('Hovland');
    expect(labels).toContain('Brent Frohoff');
  });

  it('never publishes one of FIVB’s test accounts', () => {
    // 19 player records in VIS are test or dummy accounts, and 10 of them have
    // real team rows with real placements — `Dummy2 Dummy2` has twelve. They
    // stay out because every one of those events is a national tour stop or a
    // tournament named "Test NC2", which §1's tier filter excludes.
    //
    // So this asserts a property that nothing else does: the name strip above
    // does not touch these, and the only thing keeping `Dummy2` off the graph
    // is a tier decision made three modules away. Widening the admitted types
    // would publish them, and that should fail here rather than ship.
    expect(labels.filter((n) => /(?<!\p{L})(dummy|test)\d*(?!\p{L})/iu.test(n))).toEqual([]);
  });
});

/**
 * A federation claim survives only where the partner's own record backs it.
 *
 * `spansFor` reads the code stamped on the team row, and on a mixed-nationality
 * pair that code belongs to player 1 alone (quirks §6c) — so without this the
 * card told readers that Gisi Gavio's Italian partners represented Brazil.
 */
describe('corroborating a partnership\u2019s federation', () => {
  const tournaments = normaliseTournaments([tournament('t1', 2002), tournament('t2', 2003)]);

  /** A team row with an explicit federation and an explicit player order. */
  const stamped = (tour: string, first: number, second: number, fed: string): VisRow => ({
    NoTournament: tour,
    NoPlayer1: String(first),
    NoPlayer2: String(second),
    FederationCode: fed,
    Rank: '5',
  });

  it('keeps a span the partner\u2019s own record agrees with', () => {
    // Both Brazilian, both listed first somewhere: nothing in dispute.
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'ARG')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [stamped('t1', 1, 2, 'BRA'), stamped('t2', 2, 1, 'BRA')],
      tournaments,
      people,
    );
    const away = awayPartnersByPlayer(partnerships, people, tournaments, ownFederation);
    // Player 2 was listed first on t2 under BRA, so BRA is corroborated for them.
    expect(away.get(1)![0]!.at).toBeTruthy();
  });

  it('drops a span the partner was never in', () => {
    // The Gisi shape: player 1 is Brazilian and listed first every time, so
    // every row is stamped BRA — while player 2 is Italian on their own rows.
    const roster = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'ITA'), player(3, '0', 'ITA')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [stamped('t1', 1, 2, 'BRA'), stamped('t2', 2, 3, 'ITA')],
      tournaments,
      roster,
    );
    const away = awayPartnersByPlayer(partnerships, roster, tournaments, ownFederation);
    const row = away.get(1)?.find((a) => a.id === 2);
    expect(row, 'the partnership should still be listed').toBeTruthy();
    // ...but it must not say the Italian represented Brazil.
    expect(row!.at).toBeUndefined();
  });

  /**
   * Written first as "answers differently in each direction, which is the
   * point", asserting that the Italian's card could still say the Brazilian
   * was Brazilian. That was wrong, and wrong in the way this whole area keeps
   * being wrong.
   *
   * Player 1's code is the *only* evidence of player 1's federation, so a
   * player who is always listed first and never partners a compatriot has no
   * independent record at all — every row saying BRA says it because they were
   * player 1 on it. Gisi Gavio is exactly that: fifteen rows, listed first on
   * all fifteen, never once partnered a Brazilian. An asymmetric rule reads
   * that as corroboration and is measuring its own input.
   */
  it('stays silent in both directions when only one side is established', () => {
    const roster = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'ITA'), player(3, '0', 'ITA')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [stamped('t1', 1, 2, 'BRA'), stamped('t2', 2, 3, 'ITA')],
      tournaments,
      roster,
    );
    const away = awayPartnersByPlayer(partnerships, roster, tournaments, ownFederation);
    expect(away.get(1)?.find((a) => a.id === 2)?.at).toBeUndefined();
    expect(away.get(2)?.find((a) => a.id === 1)?.at).toBeUndefined();
  });

  it('keeps a span both players are independently in', () => {
    // Two Brazilians who each have their own BRA row, one of whom later moves.
    // This is the Solberg/Tiago shape, and it must survive: it is the case the
    // field exists for.
    const roster = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'QAT'), player(3, '0', 'BRA')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [stamped('t1', 1, 2, 'BRA'), stamped('t1', 2, 3, 'BRA')],
      tournaments,
      roster,
    );
    const away = awayPartnersByPlayer(partnerships, roster, tournaments, ownFederation);
    expect(away.get(1)?.find((a) => a.id === 2)?.at).toEqual([[2002, 'BRA']]);
  });

  it('says nothing rather than guessing when the partner was never listed first', () => {
    // 31.5% of players never appear as player 1, so their federation cannot be
    // read from any row. Silence is the honest answer, not the team code.
    const people = normalisePlayers([player(1, '0', 'BRA'), player(2, '0', 'ARG')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [stamped('t1', 1, 2, 'BRA')],
      tournaments,
      people,
    );
    const away = awayPartnersByPlayer(partnerships, people, tournaments, ownFederation);
    expect(away.get(1)![0]!.at).toBeUndefined();
  });

  it('accepts a neighbouring season, since nobody transfers for one event', () => {
    // Both established as Italian — one in 2003 directly, the other in 2002 —
    // so the 2003 span stands on the nearby record rather than needing an
    // exact-season row from each.
    const roster = normalisePlayers([player(1, '0', 'ITA'), player(2, '0', 'BRA'), player(3, '0', 'ITA')]);
    const { partnerships, ownFederation } = aggregatePartnerships(
      [stamped('t2', 1, 2, 'ITA'), stamped('t1', 2, 3, 'ITA')],
      tournaments,
      roster,
    );
    const away = awayPartnersByPlayer(partnerships, roster, tournaments, ownFederation);
    expect(away.get(1)?.find((a) => a.id === 2)?.at).toEqual([[2003, 'ITA']]);
  });
});

/**
 * What actually got published, rather than what the rule does on a fixture.
 *
 * `tidyBirthPlace` is unit-tested above, but nothing there proves it is
 * *reached*: the value travels through `normalisePlayers` and the publish step
 * before it reaches a card, and a field that stopped being cleaned on the way
 * would still publish perfectly plausible-looking places.
 */
describe('the published birth places', () => {
  const dir = new URL('../web/public/v1/players', import.meta.url);
  const places: string[] = [];
  let players = 0;
  for (const f of readdirSync(dir)) {
    const file = JSON.parse(readFileSync(new URL(`../web/public/v1/players/${f}`, import.meta.url), 'utf8'));
    for (const p of file.players as { birthPlace?: string }[]) {
      players++;
      if (p.birthPlace !== undefined) places.push(p.birthPlace);
    }
  }

  it('covers about half the archive', () => {
    // Vacuity guard and a floor. 6,489 of 12,074 at the time of writing; a drop
    // past 40% is the field breaking, not the archive changing.
    expect(players).toBeGreaterThan(10_000);
    expect(places.length / players).toBeGreaterThan(0.4);
  });

  it('never publishes an empty string', () => {
    // The absent case must be an absent key, not a blank line under the date.
    expect(places.filter((p) => !p.trim())).toEqual([]);
  });

  it('publishes no bare date and no bare postcode', () => {
    expect(places.filter((p) => /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(p))).toEqual([]);
    expect(places.filter((p) => !/\p{L}/u.test(p))).toEqual([]);
  });

  it('publishes no internal note', () => {
    expect(places.filter((p) => /\bto be merged\b|#\d{3,}/i.test(p))).toEqual([]);
  });

  it('publishes nothing that shouts a whole word', () => {
    // 444 did before this. Short upper-case tokens are codes and stay — the
    // "PR" in "Curitiba, PR" is not shouting.
    const shouting = places.filter((p) =>
      p.split(' ').some((w) => {
        const letters = w.replace(/[^\p{L}]/gu, '');
        return letters.length >= 4 && w === w.toUpperCase() && w !== w.toLowerCase();
      }),
    );
    expect(shouting).toEqual([]);
  });

  it('publishes nothing entirely in lower case', () => {
    // 102 did before this: "rio de janeiro", "salvador". The mirror of the
    // assertion above, and the reason the rule runs in both directions.
    expect(places.filter((p) => p === p.toLowerCase() && /\p{Ll}/u.test(p))).toEqual([]);
  });

  it('still keeps the province and country codes', () => {
    // The guard on the guard: a rule that simply title-cased everything would
    // pass every assertion above and quietly turn "PR" into "Pr".
    expect(places.filter((p) => /\b[A-Z]{2,3}\b/.test(p)).length).toBeGreaterThan(20);
  });
});

/**
 * The published artifact, not the rule on a fixture.
 *
 * `seasonFor` is unit-tested above, but nothing there proves a ranged `Season`
 * ever reaches it — and while one did not, the damage was invisible in the
 * season itself and showed up two fields away, in an offset that is supposed to
 * be a few dozen days.
 */
describe('the published seasons', () => {
  const file = JSON.parse(readFileSync(new URL('../web/public/v1/tournaments.json', import.meta.url), 'utf8'));
  const rows = Object.values(file.tournaments) as [string, number, string, number | null, string][];

  it('keeps every start offset inside a single year', () => {
    // The whole symptom. 18 rows ran past 400 days and MSYD1991 reached 1,533,
    // because it was filed under the 1987 its "1987-91" season bucket starts
    // in. A season is a year, so an offset from its 1 January cannot be two.
    const wild = rows.filter(([, , , offset]) => offset !== null && Math.abs(offset) > 400);
    expect(wild).toEqual([]);
  });

  it('agrees with the year in FIVB\u2019s own code, bar the six that disagree', () => {
    // Not an equality: three codes are genuinely wrong (WCAR1991 was played in
    // 1994, the two Cape Town rows in 2020), the two Tokyo rows are named for
    // 2020 and were played in 2021, and MSAN1995 is a January event whose code
    // names the season it opened. Everything else lines up, which is what a
    // ranged season used to break on 25 rows.
    const off = rows.filter(([, season, , , code]) => {
      const year = /(\d{4})$/.exec(code ?? '');
      return year && Number(year[1]) !== season;
    });
    expect(off.length).toBeLessThanOrEqual(6);
  });

  it('has more than one season in the years a range used to swallow', () => {
    // Guards the guard. Taking the range start put five annual Rio editions in
    // 1987; if that came back, 1988 to 1991 would empty out again.
    for (const season of [1988, 1989, 1990, 1991]) {
      expect(rows.filter((r) => r[1] === season).length).toBeGreaterThan(0);
    }
  });
});

describe('timelineFiltersByPlayer', () => {
  // Numeric ids, because a published result entry carries the tournament
  // number as a number and the lookup stringifies it — 't1' would never match.
  const tours = normaliseTournaments([
    { ...tournament('1', 2004), Type: '5' }, // Olympics
    { ...tournament('2', 2003), Type: '4' }, // World Championships
    { ...tournament('3', 2005), Type: '52' }, // Beach Pro Tour Elite16
    { ...tournament('4', 2006), Type: '1' }, // World Tour
  ]);

  const filtersFor = (entries: [number, number, number][]) =>
    timelineFiltersByPlayer(new Map([[1, entries]]), tours).get(1);

  it('offers the Games to anyone who was there, medal or not', () => {
    // The point of the whole field: 412 of the 488 published Olympians never
    // reached a podium, and a control driven by medals would be missing for
    // all of them.
    expect(filtersFor([[1, 2, 19]])).toEqual(['olympics']);
  });

  it('offers Worlds on the same terms', () => {
    expect(filtersFor([[2, 2, 25]])).toEqual(['world-champs']);
  });

  it('offers tour podiums only for a podium', () => {
    expect(filtersFor([[4, 2, 3]])).toEqual(['tour-podium']);
    expect(filtersFor([[4, 2, 4]])).toBeUndefined();
  });

  it('counts a Beach Pro Tour podium, not just a World Tour one', () => {
    // The tour is two tiers and has been the Beach Pro Tour since 2022. Using
    // 'world-tour' alone would drop every podium from then on.
    expect(filtersFor([[3, 2, 1]])).toEqual(['tour-podium']);
  });

  it('does not turn an Olympic or World placing into a tour podium', () => {
    // An Olympic gold is rank 1, but it is not a week on tour — the Tour
    // podiums tile does not count it, and neither may the chip beside it.
    expect(filtersFor([[1, 2, 1]])).toEqual(['olympics']);
    expect(filtersFor([[2, 2, 1]])).toEqual(['world-champs']);
  });

  it('lists them in a fixed order, whatever order the events arrive in', () => {
    expect(filtersFor([[4, 2, 1], [2, 2, 9], [1, 2, 5]])).toEqual([
      'olympics',
      'world-champs',
      'tour-podium',
    ]);
  });

  it('says nothing at all for the great majority', () => {
    expect(filtersFor([[4, 2, 17]])).toBeUndefined();
    expect(timelineFiltersByPlayer(new Map(), tours).size).toBe(0);
  });
});

describe('olympicGamesByPlayer', () => {
  const tours = normaliseTournaments([
    { ...tournament('1', 2004), Type: '5' }, // Olympics
    { ...tournament('2', 2008), Type: '5' }, // Olympics
    { ...tournament('3', 2003), Type: '4' }, // World Championships
    { ...tournament('4', 2006), Type: '1' }, // World Tour
  ]);
  const gamesFor = (entries: [number, number, number][]) =>
    olympicGamesByPlayer(new Map([[1, entries]]), tours).get(1);

  it('counts a Games whatever the finish', () => {
    // The whole point: 412 of the 488 published Olympians never medalled, and
    // the tile was invisible for every one of them.
    expect(gamesFor([[1, 2, 19]])).toBe(1);
    expect(gamesFor([[1, 2, 1]])).toBe(1);
  });

  it('counts each Games once, not each row', () => {
    // A player has one entry per Games in practice, but a row records a pair
    // and nothing upstream forbids a second entry — counting rows would turn
    // that into a second Games.
    expect(gamesFor([[1, 2, 9], [1, 3, 9]])).toBe(1);
    expect(gamesFor([[1, 2, 9], [2, 3, 5]])).toBe(2);
  });

  it('counts nothing but the Olympics', () => {
    expect(gamesFor([[3, 2, 1], [4, 2, 1]])).toBeUndefined();
    expect(gamesFor([[1, 2, 9], [3, 2, 1], [4, 2, 2]])).toBe(1);
  });

  it('says nothing for the 96% who never went', () => {
    expect(gamesFor([[4, 2, 5]])).toBeUndefined();
    expect(olympicGamesByPlayer(new Map(), tours).size).toBe(0);
  });
});

/**
 * The published artifact, not the rule on a fixture.
 *
 * A medal without an appearance would be incoherent — you cannot medal at a
 * Games you did not attend — so it is worth asserting on the real data rather
 * than trusting that two derivations of the same archive agree.
 */
describe('the published Olympic appearances', () => {
  const players: { olympics?: unknown; olympicGames?: number }[] = [];
  for (const f of readdirSync(new URL('../web/public/v1/players', import.meta.url))) {
    const file = JSON.parse(readFileSync(new URL(`../web/public/v1/players/${f}`, import.meta.url), 'utf8'));
    players.push(...file.players);
  }

  it('reaches far more players than the medal tally does', () => {
    const games = players.filter((p) => p.olympicGames !== undefined);
    const medals = players.filter((p) => p.olympics !== undefined);
    expect(games.length).toBeGreaterThan(300);
    expect(games.length).toBeGreaterThan(medals.length * 3);
  });

  it('never records a medal without a Games to have won it at', () => {
    expect(players.filter((p) => p.olympics !== undefined && p.olympicGames === undefined)).toEqual([]);
  });

  it('is always a positive whole number', () => {
    const bad = players.filter(
      (p) => p.olympicGames !== undefined && (!Number.isInteger(p.olympicGames) || p.olympicGames < 1),
    );
    expect(bad).toEqual([]);
  });

  it('never claims more Games than have been held', () => {
    // Eight editions in the archive; nobody can have attended more.
    expect(players.filter((p) => (p.olympicGames ?? 0) > 8)).toEqual([]);
  });
});

/**
 * What actually got published, rather than what the maps hold.
 *
 * `olympics.ts` and `worlds.ts` are unit-tested, and `normaliseTournaments`
 * is tested for consulting them, but neither proves the names *survive* to
 * `tournaments.json` — the value travels through the publish step, and a name
 * that stopped being substituted on the way would publish "FIVB Beach
 * Volleyball World Championships" against every 2025 and 2027 row without
 * anything looking obviously wrong.
 */
describe('the published championship names', () => {
  const file = JSON.parse(readFileSync(new URL('../web/public/v1/tournaments.json', import.meta.url), 'utf8'));
  const rows = Object.values(file.tournaments) as [string, number, string][];
  const named = (tier: string) => rows.filter((r) => r[2] === tier).map((r) => r[0]);
  const worlds = named('world-champs');
  const olympics = named('olympics');

  it('publishes both draws of every edition', () => {
    // Vacuity guard, and the premise of keying by season: a men's draw and a
    // women's, and nothing else, in each season either map covers.
    expect(worlds.length).toBe(32);
    expect(olympics.length).toBe(16);
  });

  it('names each edition after its host and nothing else', () => {
    // The whole point. Every one of these substrings is in a name FIVB
    // actually published, and none should reach a card.
    const noise = /world championship|WCH|FIVB|Olympic|beach volleyball|\d/i;
    expect(worlds.filter((n) => noise.test(n))).toEqual([]);
  });

  it('gives the men and the women the same name', () => {
    // FIVB does not: the 2023 draws differ by a comma, "Tlaxcala Mexico"
    // against "Tlaxcala, Mexico". Two spellings of one edition would read as
    // two events on a timeline.
    //
    // Grouped by season rather than counted, because a host can and does
    // recur — Rome held 2011 and 2022, the Netherlands 2015 and 2027 — so it
    // is the season that must have one name, not the archive.
    const bySeason = new Map<string, Set<string>>();
    for (const [name, season, tier] of rows) {
      if (tier !== 'world-champs' && tier !== 'olympics') continue;
      const key = `${tier} ${season}`;
      (bySeason.get(key) ?? bySeason.set(key, new Set()).get(key)!).add(name);
    }
    expect([...bySeason].filter(([, names]) => names.size > 1)).toEqual([]);
  });
});

/**
 * A placeholder is not a name, and dots are the placeholder in the early
 * seasons.
 *
 * Quirks §22: 37 player records carry a `FirstName` of exactly `"..."`, 30 of
 * them published. The graph was never wrong — `shortName` draws the surname —
 * so the fault lived only where the full name is used: the card heading, every
 * search row, the avatar's initials, and the sort, where `.` orders before
 * every letter and put all thirty at the head of the archive.
 *
 * Asserted on the artifact rather than a fixture, because a fixture proves the
 * blanking works and only the artifact proves it is reached on the field that
 * actually carries it.
 */
describe('the published names carry no placeholder for an unknown name', () => {
  const index = JSON.parse(readFileSync(new URL('../web/public/v1/search.json', import.meta.url), 'utf8'));
  const names: string[] = [];
  for (const entries of Object.values(index.slices as Record<string, SearchEntry[]>)) {
    for (const [, name, , short] of entries) {
      names.push(name);
      if (short) names.push(short);
    }
  }

  it('covers the whole archive', () => {
    // Vacuity guard: every assertion below passes trivially on an empty list.
    expect(names.length).toBeGreaterThan(10_000);
  });

  it('has no name that is or begins with a run of dots', () => {
    // 30 before this: "... Guerber", "... Grimalt", "... Tatsukawa".
    expect(names.filter((n) => /(^|\s)[.…]+(\s|$)/u.test(n))).toEqual([]);
  });

  it('kept the players themselves, under their surnames', () => {
    // Guard the guard: dropping the 30 records would also satisfy the
    // assertion above. Grimalt played four tournaments, Tatsukawa one.
    for (const surname of ['Grimalt', 'Tatsukawa', 'Guerber', 'Grandvuillemin']) {
      expect(names).toContain(surname);
    }
  });

  it('leaves a dot that belongs to a real name alone', () => {
    // The boundary, and the whole risk: 536 records carry a single dot inside
    // a genuine name. A rule that stripped dots rather than testing the whole
    // field would take these with it.
    expect(names).toContain('N. Aihara');
    expect(names).toContain('Jean C. Gaston');
    expect(names.some((n) => n.includes('St. John'))).toBe(true);
    expect(names.some((n) => n.includes('A.J.'))).toBe(true);
  });
});
