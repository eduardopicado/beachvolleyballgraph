/**
 * The tournaments a refresh found that the one before it did not, written as
 * a GitHub comment.
 *
 * The owner asked to hear when FIVB adds an event. The daily refresh already
 * holds both answers — the `tournaments.json` it is about to replace, and the
 * one it just built — so the news is a set difference, and the deploy
 * workflow posts it to one pinned issue (`announce` in deploy.yml). An issue
 * rather than a feed because the notification is GitHub's own: no service to
 * run, and it reaches the phone app and the inbox the owner already reads.
 *
 * Keyed by FIVB's tournament number, the file's own key, not by code: the
 * oldest rows have no code, and a code is what a correction upstream is most
 * likely to change. A row whose number is new is a new tournament.
 *
 * Quiet by default. Of the 47 refreshes committed from 15 September to 29
 * October 2026, two added events (2 on 30 September, 8 on 1 October) and 45
 * added none, so an empty result is the usual one and prints nothing.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Gender, Manifest, TournamentMeta, TournamentsFile } from '../shared/schema.js';
import { GENDER_LABEL } from '../shared/schema.js';
import { SITE_URL } from '../shared/site.js';
import { nameCarriesSeason } from '../shared/slug.js';
import { buildIndex } from '../web/src/lib/tournamentIndex.js';
import { readTournament } from '../web/src/lib/tournamentMeta.js';

/**
 * More than this and the rest are counted, not listed. A whole season's
 * calendar published at once is about a hundred rows; a list that long is
 * not read, and a comment has a size limit.
 */
export const ANNOUNCE_MAX = 40;

/**
 * Text from FIVB, made inert in Markdown.
 *
 * Two things matter in a comment that the HTML escaping elsewhere does not
 * cover: a bracket would break the link text it sits in, and `@name` notifies
 * a GitHub user — nobody this project should be pinging because of a
 * tournament's name. A zero-width space after the `@` breaks the mention and
 * reads the same.
 */
export const mdText = (s: string) => s.replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`).replace(/@/g, '@\u200b');

const DRAW_ORDER: Gender[] = ['M', 'W'];

const formatRange = (start: Date, end: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatRange(
    start,
    end,
  );

const countryName = (iso2: string) => {
  try {
    return new Intl.DisplayNames('en', { type: 'region' }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
};

/**
 * The comment for tournaments in `after` and not in `before`, or `''` when
 * there are none.
 *
 * One line per event, its men's and women's draws together, each linking to
 * its page where it has one. A page exists for every row the tournament index
 * shows, which is what `buildIndex` decides; a new row it leaves out (no code,
 * or an old fieldless event FIVB has just backfilled) is listed unlinked
 * rather than linked to a page that will never be written.
 */
export function announcement(
  before: Record<string, TournamentMeta>,
  after: Record<string, TournamentMeta>,
  hasField: (code: string) => boolean,
  pageUrl: (slug: string) => string,
  now: Date = new Date(),
): string {
  const added = Object.keys(after)
    .filter((no) => !(no in before))
    .map((no) => readTournament(after[no]!));
  if (added.length === 0) return '';

  const slugs = new Map(buildIndex(after, hasField, now).map((row) => [row.code, row.slug]));

  // One event, two draws: same name and season. Ordered by opening day, then
  // name, with undated rows last.
  const events = new Map<string, typeof added>();
  for (const t of added) {
    const key = `${t.season}\u0000${t.name}`;
    events.set(key, [...(events.get(key) ?? []), t]);
  }
  const opening = (t: (typeof added)[number]) => t.startOffset ?? Number.POSITIVE_INFINITY;
  const ordered = [...events.values()].sort(
    (a, b) => a[0]!.season - b[0]!.season || opening(a[0]!) - opening(b[0]!) || a[0]!.name.localeCompare(b[0]!.name),
  );

  const lines = ordered.slice(0, ANNOUNCE_MAX).map((draws) => {
    const t = draws[0]!;
    const named = nameCarriesSeason(t.name, t.season) ? t.name : `${t.name} ${t.season}`;
    const drawLinks = [...draws]
      .sort((a, b) => DRAW_ORDER.indexOf(a.gender ?? 'M') - DRAW_ORDER.indexOf(b.gender ?? 'M'))
      .map((d) => {
        const label = d.gender ? GENDER_LABEL[d.gender].toLowerCase() : 'draw';
        const slug = d.code ? slugs.get(d.code) : undefined;
        return slug ? `[${label}](${pageUrl(slug)})` : label;
      });
    const when =
      t.startOffset === null
        ? 'dates not published yet'
        : formatRange(
            new Date(Date.UTC(t.season, 0, 1 + t.startOffset)),
            new Date(Date.UTC(t.season, 0, 1 + t.startOffset + Math.max(t.span ?? 0, 0))),
          );
    const facts = [when, t.level, t.country && countryName(t.country)].filter(Boolean).map((f) => mdText(f!));
    return `- **${mdText(named)}** (${drawLinks.join(', ')}) · ${facts.join(' · ')}`;
  });

  const more = ordered.length - lines.length;
  const count = added.length === 1 ? '1 new tournament' : `${added.length} new tournaments`;
  return [
    `**${count}** on the FIVB calendar since the last refresh:`,
    '',
    ...lines,
    ...(more > 0 ? [`- …and ${more} more event${more === 1 ? '' : 's'}, in the tournament index.`] : []),
    '',
  ].join('\n');
}

/**
 * `tsx ingest/announce.ts <tournaments.json before this refresh>` prints the
 * comment, or nothing. Reads the new file and the manifest from the tree.
 *
 * A `before` that will not parse prints nothing rather than announcing the
 * whole archive as new: the first refresh after this lands, or a history
 * rewritten past the file, should be silent, not 1,698 lines.
 */
async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const DATA = path.resolve(HERE, '../web/public/v1');
  const beforePath = process.argv[2];
  if (!beforePath) throw new Error('usage: tsx ingest/announce.ts <tournaments.json before this refresh>');

  let before: TournamentsFile;
  try {
    before = JSON.parse(await readFile(beforePath, 'utf8'));
    if (!before?.tournaments || Object.keys(before.tournaments).length === 0) throw new Error('no tournaments');
  } catch (err) {
    console.error(`  ! no earlier tournament list to compare against (${(err as Error).message}); nothing announced`);
    return;
  }
  const after: TournamentsFile = JSON.parse(await readFile(path.join(DATA, 'tournaments.json'), 'utf8'));
  const manifest: Manifest = JSON.parse(await readFile(path.join(DATA, 'manifest.json'), 'utf8'));
  const withoutField = new Set(manifest.withoutField ?? []);

  const origin = (process.env.SITE_URL || SITE_URL).replace(/\/+$/, '');
  const base = process.env.BASE_PATH || '/';
  process.stdout.write(
    announcement(
      before.tournaments,
      after.tournaments,
      (code) => !withoutField.has(code),
      (slug) => `${origin}${base}tournament/${slug}/`,
    ),
  );
}

// Only run when invoked as a script, so tests can import the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Announce failed:', err);
    process.exit(1);
  });
}
