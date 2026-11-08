/**
 * FIVB's own event photographs, for the tournament pages: a build step that
 * does nothing at all unless the site is built with `TOURNAMENT_PHOTOS=1`.
 *
 * **Why a switch.** VIS publishes 289,525 photographs of 726 tournaments,
 * nearly all 2006–2021 (fivb-vis-survey.md §6), every one `Copyright FIVB`. They cannot
 * ship until FIVB agrees, and that request is in fivb-email.md. Until then
 * the feature has to be ready and invisible at once: a build without the
 * switch fetches nothing, writes nothing, and — because the page's photo
 * strip is a dynamic import behind a build-time constant (see
 * `vite.config.ts`) — carries no line of the code either. A reader cannot
 * find what was never shipped.
 *
 * **Why `dist/` and not the committed tree.** The daily ingest commits
 * `web/public/v1/` to the repository, and a switch on a build that commits
 * would leave the photo index in git history for good, switch or no switch.
 * Writing here, at build time, keeps it out of history and out of every build
 * that has not asked for it.
 *
 * **Why a cache.** The lists are nearly an archive — FIVB stopped adding to
 * them when the Beach Pro Tour moved to volleyballworld.com, bar seven events
 * it still runs itself — and asking VIS for 289,525 rows on every build would
 * be a poor way to repay a free service. Each
 * tournament's list is kept in `ingest/.cache/photos.json` (git-ignored) and
 * asked for again only once it is `REFRESH_DAYS` old.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractRows, fetchRaw, type VisRow } from './vis.js';
import type { TournamentMeta, TournamentPhoto, TournamentsFile } from '../shared/schema.js';
import { DATA_VERSION } from '../shared/schema.js';

/** The switch. One variable for both halves: this step and the page's code. */
export const PHOTOS_ENABLED = process.env.TOURNAMENT_PHOTOS === '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'web/public', DATA_VERSION);
const OUT = path.join(ROOT, 'dist', DATA_VERSION, 'photos');
const CACHE = path.join(HERE, '.cache', 'photos.json');

/** Tournaments per VIS request document. */
const BATCH = 25;
/** Between batches: a burst of unpaced requests is what got this project a 503 (survey §2). */
const PAUSE_MS = 1500;
/** How long a cached list is trusted. Long: the archive barely grows, and this is for the odd late addition. */
const REFRESH_DAYS = 90;

type Cache = Record<string, { at: string; photos: TournamentPhoto[] }>;

/**
 * One tournament's rows, in the order the strip shows them: FIVB's slideshow
 * picks first, then the rest, each group by the time it was taken. Rows with
 * no image number are dropped; a missing time sorts last within its group.
 */
export function photosFromRows(rows: VisRow[]): TournamentPhoto[] {
  const photos: TournamentPhoto[] = [];
  for (const row of rows) {
    const no = Number(row.No);
    if (!Number.isInteger(no) || no <= 0) continue;
    const taken = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(row.TakenDT ?? '')?.[0] ?? null;
    photos.push([no, (row.Title ?? '').trim(), taken, row.InSlideShow === '1' ? 1 : 0]);
  }
  return photos.sort(
    (a, b) =>
      b[3] - a[3] ||
      (a[2] ?? '￿').localeCompare(b[2] ?? '￿') ||
      a[0] - b[0],
  );
}

/**
 * Split a batched response into one body per request, in request order.
 *
 * VIS answers a `<Requests>` document with one `<Images>` element per
 * request, empty ones included, so the position is the tournament.
 */
export function splitImageResponses(body: string, expected: number): string[] {
  const parts = body.split(/(?=<Images\b)/).filter((p) => p.startsWith('<Images'));
  if (parts.length !== expected) {
    throw new Error(`Expected ${expected} image lists in the response, got ${parts.length}`);
  }
  return parts;
}

/** Which cached lists are missing or stale, as of `now`. */
export function needsFetch(codes: string[], cache: Cache, now: Date): string[] {
  const cutoff = now.getTime() - REFRESH_DAYS * 86_400_000;
  return codes.filter((code) => {
    const hit = cache[code];
    return !hit || Date.parse(hit.at) < cutoff;
  });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  if (!PHOTOS_ENABLED) return;

  // Every tournament with a published field: an event that has not been
  // played has no photographs to show.
  const { tournaments } = await readJson<TournamentsFile>(path.join(DATA, 'tournaments.json'), { tournaments: {} });
  const byCode = new Map<string, string>();
  for (const [no, meta] of Object.entries(tournaments) as [string, TournamentMeta][]) {
    const code = meta.length > 4 ? meta[4] : null;
    if (code && existsSync(path.join(DATA, 'classifications', `${code}.json`))) byCode.set(code, no);
  }

  const cache = await readJson<Cache>(CACHE, {});
  const stale = needsFetch([...byCode.keys()].sort(), cache, new Date());
  console.log(`photos: ${byCode.size} played tournaments, ${stale.length} lists to fetch`);

  for (let i = 0; i < stale.length; i += BATCH) {
    const codes = stale.slice(i, i + BATCH);
    const xml = `<Requests>${codes
      .map(
        (code) =>
          `<Request Type="GetImageList" Fields="No Title TakenDT InSlideShow"><Filter NoTournament="${byCode.get(code)}"/></Request>`,
      )
      .join('')}</Requests>`;
    const parts = splitImageResponses(await fetchRaw(xml, 'GetImageList'), codes.length);
    const at = new Date().toISOString();
    codes.forEach((code, k) => {
      cache[code] = { at, photos: photosFromRows(extractRows(parts[k]!, 'Image')) };
    });
    // Saved after every batch, so an interrupted run keeps what it fetched.
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(cache));
    if (i + BATCH < stale.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  await mkdir(OUT, { recursive: true });
  let files = 0;
  let total = 0;
  for (const code of byCode.keys()) {
    const photos = cache[code]?.photos ?? [];
    if (photos.length === 0) continue;
    files++;
    total += photos.length;
    await writeFile(
      path.join(OUT, `${code}.json`),
      [
        '{',
        `  "code": ${JSON.stringify(code)},`,
        `  "photos": [\n${photos.map((p) => `    ${JSON.stringify(p)}`).join(',\n')}\n  ]`,
        '}',
        '',
      ].join('\n'),
    );
  }
  console.log(`photos: ${total.toLocaleString('en-US')} photographs across ${files} tournaments`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
