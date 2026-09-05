/**
 * Shared setup for the smoke suite.
 *
 * Two things every test gets for free:
 *
 * 1. A JS-error guard. Any uncaught exception or `console.error` fails the
 *    test at teardown. This is the single highest-value assertion here — most
 *    ways the page can "break" show up as a thrown error long before they show
 *    up as a missing element anyone thought to assert on.
 *
 * 2. Portrait requests stubbed. `playerPhotoUrl` points at FIVB's image
 *    service, which 404s for the many players with no photo on file (the UI
 *    falls back to initials by design). Those failures log as console errors
 *    and would drown the guard above in noise that means nothing — worse, a CI
 *    runner without egress would fail every test for the wrong reason.
 *
 *    Fulfilled with a stub image rather than aborted: an aborted request still
 *    logs `net::ERR_FAILED`, so blocking them would mean widening the error
 *    filter until it could hide a genuine failed fetch. A 200 makes the noise
 *    not exist instead of teaching the guard to ignore it, and keeps the suite
 *    free of outbound network calls either way.
 */

import { test as base, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type {
  GraphFile,
  Manifest,
  PlayersFile,
  ResultsFile,
  SearchIndex,
  ClassificationFile,
  TournamentsFile,
} from '../web/src/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');

const read = <T>(...segments: string[]): T =>
  JSON.parse(readFileSync(path.join(DATA, ...segments), 'utf8')) as T;

export const manifest = () => read<Manifest>('manifest.json');
export const graph = (code: string, gender: string) =>
  read<GraphFile>('graphs', `${code}-${gender}.json`);
export const players = (code: string, gender: string) =>
  read<PlayersFile>('players', `${code}-${gender}.json`);
export const results = (code: string, gender: string) =>
  read<ResultsFile>('results', `${code}-${gender}.json`);
export const tournamentIndex = () => read<TournamentsFile>('tournaments.json').tournaments;
export const searchIndex = () => read<SearchIndex>('search.json').slices;

/** One tournament's published final classification, by FIVB's own code. */
export const classification = (code: string) =>
  read<ClassificationFile>('classifications', `${code}.json`);

/**
 * A player outside the given slice whose name carries diacritics — the case
 * cross-country search and accent folding both have to handle, found by
 * scanning so it survives the archive changing under it.
 *
 * Picks the most prominent such player, which also makes the assertion below
 * meaningful: if accent folding regressed, a name this well-known going
 * missing is unambiguous.
 */
export function accentedPlayerElsewhere(exclude: string): {
  name: string;
  plain: string;
  slice: string;
} | null {
  let best: { name: string; plain: string; slice: string; tournaments: number } | null = null;
  for (const [slice, entries] of Object.entries(searchIndex())) {
    if (slice === exclude) continue;
    for (const [, name, tournaments] of entries) {
      const plain = name.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      if (plain === name) continue;
      if (!best || tournaments > best.tournaments) best = { name, plain, slice, tournaments };
    }
  }
  return best;
}

/**
 * A published player whose partnerships are *all* with other federations, so
 * their own slice shows none of them.
 *
 * Found by scanning rather than named, because who this is changes: a player
 * transfers, their partners stay behind, and the next weekly refresh strands
 * somebody new. Hard-coding one would turn a real regression test into a
 * test that fails the week FIVB updates a federation.
 */
export function strandedPlayer(): { code: string; gender: string; id: number; away: number } | null {
  for (const file of readdirSync(path.join(DATA, 'players'))) {
    const match = /^([A-Z]+)-([MW])\.json$/.exec(file);
    if (!match) continue;
    const [, code, gender] = match as unknown as [string, string, string];
    const detail = players(code, gender);
    const g = graph(code, gender);
    const connected = new Set<number>();
    for (const e of g.edges) {
      connected.add(e.a);
      connected.add(e.b);
    }
    for (const p of detail.players) {
      if (p.away?.length && !connected.has(p.id)) {
        return { code, gender, id: p.id, away: p.away.length };
      }
    }
  }
  return null;
}

/**
 * A country published for one gender only, and the gender it is missing.
 *
 * Scanned rather than named for the usual reason — Iceland's men could enter a
 * Beach Pro Tour event next season and quietly turn this into a test of
 * nothing. Prefers a women-only country when one exists, because that is the
 * case the fallback actually has to handle: the app opens on Men, so a
 * men-only country lands correctly without the fallback running at all.
 */
export function singleGenderCountry(): { code: string; name: string; has: 'M' | 'W'; missing: 'M' | 'W' } | null {
  const single = manifest()
    .countries.map((c) => {
      const has = (['M', 'W'] as const).filter((g) => c.genders[g]);
      return has.length === 1 ? { code: c.code, name: c.name, has: has[0]!, missing: has[0] === 'M' ? ('W' as const) : ('M' as const) } : null;
    })
    .filter((c): c is { code: string; name: string; has: 'M' | 'W'; missing: 'M' | 'W' } => c !== null);
  return single.find((c) => c.has === 'W') ?? single[0] ?? null;
}

/** FIVB's portrait host — stubbed, see the header comment. */
const PHOTO_HOST = 'sharp.fivb.com';

/** 1x1 transparent PNG. */
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const test = base.extend<{ jsErrors: string[] }>({
  jsErrors: [
    async ({ page }, use) => {
      await page.route(`**://${PHOTO_HOST}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG }),
      );

      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        // A portrait that 404s is the designed path, not a fault: FIVB has no
        // photo for a large share of the archive and both the card and the
        // search rows fall back to initials. The blanket stub above means this
        // only fires for a test that asked for a failure on purpose, so the
        // exemption is scoped to that host and to a failed *request* — a real
        // console.error from the app still fails the run, and so does a
        // resource failure from anywhere else.
        if (msg.location().url.includes(PHOTO_HOST) && /Failed to load resource/.test(msg.text())) {
          return;
        }
        errors.push(`console.error: ${msg.text()}`);
      });

      await use(errors);

      expect(errors, 'the page logged JavaScript errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
