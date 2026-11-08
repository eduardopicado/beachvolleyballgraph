import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Importing the ingest must not run it.
 *
 * `populated.test.ts` imports `assertPopulated` from `main.ts`, and for as long
 * as `main()` ran at module load, every `npm test` — every pull request's CI
 * run included, whose workflow promises it never contacts FIVB — opened a real
 * request to VIS, and would have gone on to rebuild and swap the published tree
 * had the worker lived long enough. Nothing failed; the test file simply
 * finished first.
 *
 * Stubs `fetch` rather than trusting the network to be absent, so the check is
 * the same on a laptop, in CI and in a sandbox.
 */
describe('ingest/main.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not start an ingest when imported', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    vi.resetModules();

    await import('./main');
    // main() awaits two filesystem reads before its first request, so give it
    // well past that before deciding nothing was sent.
    await new Promise((r) => setTimeout(r, 300));

    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * The stages after the fetch, run end to end on a handful of synthetic rows.
 *
 * Until `main()` was split, none of this could run without VIS: the aggregation,
 * the writing and the refusals were one function that began with three list
 * requests. Now `aggregate` and `writeTree` take rows and a directory, so the
 * whole published shape can be built here and read back.
 */
describe('aggregate and writeTree', () => {
  const tournament = (no: string, code: string, start: string, end: string) => ({
    No: no,
    Code: code,
    Name: `Event ${no}`,
    Season: start.slice(0, 4),
    Gender: '0',
    Type: '52', // Beach Pro Tour Elite16
    OrganizerType: '1',
    Version: '1',
    StartDateMainDraw: start,
    EndDateMainDraw: end,
    CountryCode: 'IT',
  });
  const player = (no: number, fed: string) => ({
    No: String(no),
    FirstName: `First${no}`,
    LastName: `Last${no}`,
    Gender: '0',
    FederationCode: fed,
  });
  const team = (tour: string, a: number, b: number, fed: string, rank: number) => ({
    No: `${tour}${a}${b}`,
    NoTournament: tour,
    NoPlayer1: String(a),
    NoPlayer2: String(b),
    FederationCode: fed,
    Rank: String(rank),
  });

  it('writes every file of the published tree from rows alone', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
    const { mkdtemp, readdir, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { aggregate, writeTree } = await import('./main');
    const { normalisePlayers, normaliseTournaments } = await import('./build');

    const tournamentRows = [
      tournament('1', 'MAAA2025', '2025-06-01', '2025-06-04'),
      tournament('2', 'MBBB2025', '2025-07-01', '2025-07-04'),
      // Still to come, so it has entries rather than a classification.
      tournament('3', 'MCCC2099', '2099-07-01', '2099-07-04'),
    ];
    const playerRows = [1, 2, 3, 4].map((n) => player(n, 'BRA')).concat([5, 6].map((n) => player(n, 'USA')));
    const teamRows = [
      team('1', 1, 2, 'BRA', 1),
      team('1', 3, 4, 'BRA', 2),
      team('1', 5, 6, 'USA', 3),
      team('2', 1, 3, 'BRA', 1),
      team('2', 2, 4, 'BRA', 2),
    ];
    const archive = {
      federations: new Map([
        ['BRA', { code: 'BRA', name: 'Brazil', iso2: 'BR' }],
        ['USA', { code: 'USA', name: 'United States', iso2: 'US' }],
      ]),
      tournamentRows,
      tournaments: normaliseTournaments(tournamentRows),
      players: normalisePlayers(playerRows),
      teamRows,
      tierCounts: { 'Beach Pro Tour': 3 },
      seasonFrom: 2025,
      seasonTo: 2099,
      sourceVersion: '1',
    };

    const generatedAt = '2025-08-01T00:00:00.000Z';
    const agg = aggregate(archive, generatedAt);
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'ingest-')), 'v1');
    const { manifest } = await writeTree(dir, archive, agg, new Map(), generatedAt);
    const read = async (...p: string[]) => JSON.parse(await readFile(path.join(dir, ...p), 'utf8'));

    expect(manifest.totals).toEqual({ tournaments: 3, players: 6, partnerships: 5 });
    expect(manifest.countries.map((c) => c.code)).toEqual(['BRA', 'USA']);
    expect(await read('manifest.json')).toEqual(manifest);

    const brazil = await read('graphs', 'BRA-M.json');
    expect(brazil.nodes).toHaveLength(4);
    expect(brazil.edges).toHaveLength(4);
    expect((await readdir(path.join(dir, 'players'))).sort()).toEqual(['BRA-M.json', 'USA-M.json']);
    expect((await readdir(path.join(dir, 'results'))).sort()).toEqual(['BRA-M.json', 'USA-M.json']);

    expect((await readdir(path.join(dir, 'classifications'))).sort()).toEqual(['MAAA2025.json', 'MBBB2025.json']);
    expect((await read('classifications', 'MAAA2025.json')).teams).toHaveLength(3);
    expect(await readdir(path.join(dir, 'entries'))).toEqual(['MCCC2099.json']);
    expect(manifest.withoutField).toEqual(['MCCC2099']);

    expect(Object.keys((await read('tournaments.json')).tournaments)).toEqual(['1', '2', '3']);
    expect(Object.keys((await read('search.json')).slices).sort()).toEqual(['BRA-M', 'USA-M']);
    expect((await read('records.json')).categories.tournaments.M.rows[0].value).toBe(2);
    // Nothing above reached for the network.
    expect(fetch).not.toHaveBeenCalled();
  });
});
