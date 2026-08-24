/**
 * Weekly ingest: FIVB VIS -> static JSON under `web/public/v1/`, committed to
 * this repo rather than published as a build artifact.
 *
 * The whole archive is reachable in three bulk list requests, so there is no
 * per-tournament fan-out, no rate-limit dance and no incremental cache to go
 * stale. A full rebuild takes about a minute and is self-healing: any bug or
 * upstream correction is washed out by the next run.
 *
 * `web/public/v1/` is deliberately tracked in git, not gitignored: it is this
 * project's only durable copy of the dataset. FIVB is a free third-party
 * service with no uptime or continuity guarantee, and the previous design —
 * regenerate from scratch every run, publish only as a 1-day CI artifact —
 * meant a FIVB outage or shutdown could take the whole site down with it, and
 * a code-only change (a CSS fix, nothing data-related) couldn't deploy without
 * a successful fetch it didn't need. Committing the data means a fresh clone
 * can build immediately, a code push doesn't require FIVB to be reachable, and
 * the commit history is an actual changelog of the archive over time. It also
 * changes the bar for what "safe to write" means here: this now runs against
 * files real history is going to remember, not a throwaway temp directory —
 * hence pretty-printing (readable diffs), sorting by id rather than a mutable
 * field (stable diffs), and `regression.ts` (refusing to commit a fetch that
 * came back broken).
 *
 * Publishing is atomic. Everything is written to a temp directory and only
 * swapped into place once every file has been generated and passed the checks
 * below, so a failed run leaves last week's data being served rather than a
 * half-published state.
 */

import { mkdir, rm, writeFile, rename, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchList } from './vis.js';
import { fetchFederations, countryName, countryIso2 } from './countries.js';
import { TIER_LABEL, INCLUDE_AGE_GROUP } from './tiers.js';
import {
  aggregateMedals,
  aggregatePartnerships,
  aggregateTourPodiums,
  awayPartnersByPlayer,
  finishedWithoutResults,
  isCancelled,
  medalTournaments,
  normalisePlayers,
  normaliseTournaments,
  sliceByCountryAndGender,
} from './build.js';
import { checkForRegression, type DatasetTotals } from './regression.js';
import type {
  Manifest,
  ManifestCountry,
  Gender,
  MedalCounts,
  PlayersFile,
  GraphFile,
  ResultEntry,
  SearchEntry,
  TournamentMeta,
} from '../web/src/schema.js';
import { DATA_VERSION } from '../web/src/schema.js';
import { foldAccents } from '../web/src/lib/search.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../web/public');
const OUT_DIR = path.join(PUBLIC_DIR, DATA_VERSION);
const TMP_DIR = path.join(PUBLIC_DIR, `${DATA_VERSION}.tmp`);
/** Where the previous tree is parked during the swap. See the publish step. */
const OLD_DIR = path.join(PUBLIC_DIR, `${DATA_VERSION}.old`);

/** Slices smaller than this have no graph worth drawing. */
const MIN_NODES = 2;

/**
 * How recently an event must have finished for missing placements to read as
 * FIVB still catching up rather than a record that never had a result. Set
 * well past the observed lag — the one case measured resolved in days — so a
 * genuinely stuck event still surfaces by name.
 */
const RECENT_RESULT_DAYS = 30;

function log(step: string, detail: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${step.padEnd(12)} ${detail}`);
}

function hasMedal(counts: MedalCounts): boolean {
  return counts.gold > 0 || counts.silver > 0 || counts.bronze > 0;
}

/**
 * A JSON object with one line per key, its value serialised compactly.
 *
 * Everything published here is pretty-printed because it is committed to git
 * and a diff is only useful at line granularity — but `JSON.stringify(x, null,
 * 2)` gives every number a line of its own, and the results files hold about
 * 128,000 three-number tuples. Whole-file, that is roughly 640,000 lines to
 * express 128,000 facts. Keying by line puts the boundary where change
 * actually happens (one player, one tournament) and leaves each value short
 * enough to read across.
 */
function jsonByKey(record: Record<string, unknown>, indent: string): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, value]) => `${indent}  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/**
 * Recover from a run that was killed mid-swap.
 *
 * The publish step parks the previous tree at `OLD_DIR` for the instant it
 * takes to rename the new one into place. A SIGKILL in that window (a
 * cancelled CI job, an OOM) leaves no `OUT_DIR` and a complete `OLD_DIR`, and
 * the process is gone before any handler can put it back — so the next run has
 * to, before its own swap reaches for `OLD_DIR` and deletes the only copy.
 */
async function recoverInterruptedSwap() {
  if (existsSync(OUT_DIR) || !existsSync(OLD_DIR)) return;
  await rename(OLD_DIR, OUT_DIR);
  console.warn('  ! restored data left behind by an interrupted publish');
}

async function main() {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();

  await recoverInterruptedSwap();

  // Read before anything below touches OUT_DIR, so this is genuinely last
  // week's data — not a `null` because we deleted it ourselves in the
  // meantime. Missing or unreadable (the very first run, or a corrupt file)
  // both mean "nothing to compare against"; the absolute floor check further
  // down is what protects that cold-start case instead.
  let previousTotals: DatasetTotals | null = null;
  try {
    const previous = JSON.parse(await readFile(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
    previousTotals = previous.totals;
  } catch {
    /* no previous manifest to compare against */
  }

  // --- Stage 0: federations (for country display names) --------------------
  const federations = await fetchFederations();
  log('federations', `${federations.size} federations`);

  // --- Stage 1: tournaments ------------------------------------------------
  const tournamentRows = await fetchList({
    type: 'GetBeachTournamentList',
    // `Name` is fetched only to spot cancellations — VIS records those in the
    // display name rather than a status field, see isCancelled();
    // `StartDateMainDraw` orders partners inside a season on the player card's
    // timeline; `EndDateMainDraw` tells finishedWithoutResults() which events
    // are over. All three ride on a request already being made.
    fields: [
      'No',
      'Code',
      'Name',
      'Season',
      'Gender',
      'Type',
      'OrganizerType',
      'Version',
      'StartDateMainDraw',
      'EndDateMainDraw',
    ],
    itemTag: 'BeachTournament',
  });
  const tournaments = normaliseTournaments(tournamentRows);
  if (tournaments.size === 0) throw new Error('No qualifying tournaments — refusing to publish');

  const tierCounts: Record<string, number> = {};
  let seasonFrom = Infinity;
  let seasonTo = -Infinity;
  let sourceVersion = '0';
  for (const t of tournaments.values()) {
    const label = TIER_LABEL[t.tier];
    tierCounts[label] = (tierCounts[label] ?? 0) + 1;
    seasonFrom = Math.min(seasonFrom, t.season);
    seasonTo = Math.max(seasonTo, t.season);
    if (t.version.localeCompare(sourceVersion, undefined, { numeric: true }) > 0) {
      sourceVersion = t.version;
    }
  }
  const cancelled = tournamentRows.filter(isCancelled).length;
  log('tournaments', `${tournaments.size} of ${tournamentRows.length} qualify (${seasonFrom}-${seasonTo})`);
  log('cancelled', `${cancelled} called-off events excluded (VIS marks these in the tournament name)`);

  // --- Stage 2: players ----------------------------------------------------
  // Unfiltered: a few thousand players who entered FIVB beach events are not
  // flagged PlaysBeach in VIS, and filtering on it silently drops their edges.
  const playerRows = await fetchList({
    type: 'GetPlayerList',
    fields: [
      'No',
      'FirstName',
      'LastName',
      'TeamName',
      'Gender',
      'FederationCode',
      'Birthdate',
      'Height',
      'Weight',
    ],
    itemTag: 'Player',
  });
  const players = normalisePlayers(playerRows);
  log('players', `${players.size} usable of ${playerRows.length}`);

  // --- Stage 3: team entries -> partnership edges --------------------------
  const teamRows = await fetchList({
    type: 'GetBeachTeamList',
    fields: ['No', 'NoTournament', 'NoPlayer1', 'NoPlayer2', 'FederationCode', 'Rank'],
    itemTag: 'BeachTeam',
  });
  log('entries', `${teamRows.length} team entries`);

  const { partnerships, appearances, results, rejects } = aggregatePartnerships(teamRows, tournaments, players);
  log('aggregate', `${partnerships.size} partnerships across ${appearances.size} players`);
  log('rejected', JSON.stringify(rejects));

  // Medal tournaments are picked out of the raw rows directly (Type 5 / 4),
  // not the broader `olympics`/`world-champs` tiers above — see
  // medalTournaments() for why those tiers are too wide for this.
  // Finished, and still contributing nothing — see finishedWithoutResults().
  // Split by age, because the two cases are not the same thing. A recently
  // finished event is FIVB lag and the next run picks it up; the long tail is
  // events that never produced a result at all (postponed, relocated, or
  // abandoned records kept under their original date) and never will. Only the
  // first is worth a name. Logged rather than raised either way: neither is an
  // error, and the first anyone knew of the lag was a reader asking where a
  // result went (BPT Futures Busan, 16 August 2026).
  const awaiting = finishedWithoutResults(tournaments, teamRows, generatedAt);
  const recentCutoff = new Date(Date.parse(generatedAt) - RECENT_RESULT_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recent = awaiting.filter((t) => (t.endsOn ?? '') >= recentCutoff);
  if (awaiting.length > 0) {
    const named = recent.map((t) => `${t.name} (${t.endsOn})`).join('; ');
    log(
      'awaiting',
      recent.length > 0
        ? `${named} — finished with no placements published yet; ${awaiting.length - recent.length} older events have never had any`
        : `no recent event is missing placements; ${awaiting.length} older events have never had any`,
    );
  }

  const medals = medalTournaments(tournamentRows);
  const medalsByPlayer = aggregateMedals(teamRows, medals);
  log('medals', `${medalsByPlayer.size} players with an Olympic or World Championships medal`);

  // Tour podiums are the other end of the same question: the Olympics and the
  // World Championships say who peaked, this says who kept turning up on
  // Sundays. Levels mixed on purpose -- see aggregateTourPodiums.
  const podiumsByPlayer = aggregateTourPodiums(teamRows, tournaments);
  log('podiums', `${podiumsByPlayer.size} players with a World Tour or Beach Pro Tour podium`);

  // A collapse in matched entries means the upstream shape changed. Better to
  // fail loudly than to publish a graph that quietly lost most of its edges.
  if (partnerships.size < 1000) {
    throw new Error(`Only ${partnerships.size} partnerships aggregated — refusing to publish`);
  }

  // --- Stage 4: slice ------------------------------------------------------
  const slices = sliceByCountryAndGender(partnerships, appearances, players, tournaments, MIN_NODES);
  log('slices', `${slices.length} country x gender slices with >=${MIN_NODES} players`);

  // Partnerships split across federations, which the slicing drops from both
  // countries. Carried on the player instead, so a career built with foreign
  // partners still shows on the card.
  const awayPartners = awayPartnersByPlayer(partnerships, players, tournaments);

  // How many players are left with nothing visible in their own slice — they
  // competed, they have partners, and every one of those partners is filed
  // under another federation. This is not a bug to fix once: a transfer
  // creates a new one silently, and the count moving week to week is the only
  // signal that it happened. Karen Noppen became one on 16 August 2026 by
  // moving BDI -> NED, losing both her partnerships in a single refresh.
  const stranded = [...awayPartners.keys()].filter((id) => {
    const slice = slices.find((s) => s.nodes.some((n) => n.id === id));
    return slice ? !slice.edges.some((e) => e.a === id || e.b === id) : false;
  }).length;
  log('cross-fed', `${awayPartners.size} players have a partner in another federation; ${stranded} have no partner in their own`);

  // --- Stage 5: write to temp, then swap -----------------------------------
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(path.join(TMP_DIR, 'graphs'), { recursive: true });
  await mkdir(path.join(TMP_DIR, 'players'), { recursive: true });
  await mkdir(path.join(TMP_DIR, 'results'), { recursive: true });

  // One shared index for every qualifying tournament, named and dated, so a
  // results file can be nothing but numbers. Written whole rather than
  // restricted to tournaments somebody actually played: it is the published
  // form of the filter in tiers.ts, and an event with no entries yet is
  // exactly the thing worth being able to look up.
  const tournamentIndex: Record<string, TournamentMeta> = {};
  for (const t of [...tournaments.values()].sort((a, b) => Number(a.no) - Number(b.no))) {
    // Appended rather than slotted in, so every existing index keeps its
    // meaning and this stays an additive change to a published contract. Six
    // elements for a tour event, which is 92% of them; five for the Olympics,
    // the World Championships and the age-group championships, which have no
    // level below their tier.
    tournamentIndex[t.no] = t.code
      ? t.level
        ? [t.name, t.season, t.tier, t.startOffset, t.code, t.level]
        : [t.name, t.season, t.tier, t.startOffset, t.code]
      : t.startOffset === null
        ? [t.name, t.season, t.tier]
        : [t.name, t.season, t.tier, t.startOffset];
  }
  await writeFile(
    path.join(TMP_DIR, 'tournaments.json'),
    `{\n  "tournaments": ${jsonByKey(tournamentIndex, '  ')}\n}`,
  );

  const byCountry = new Map<string, ManifestCountry>();
  const searchIndex: Record<string, SearchEntry[]> = {};
  let resultRows = 0;

  for (const slice of slices) {
    const iso2 = countryIso2(federations, slice.country);
    const name = countryName(federations, slice.country);
    const graph: GraphFile = {
      country: slice.country,
      countryName: name,
      gender: slice.gender,
      // No per-file `generatedAt`: nothing reads it (`manifest.generatedAt`
      // is the one freshness marker the app and prerender actually use), and
      // a value that changes on every single run regardless of whether this
      // slice's real content did would touch all 575 files every week.
      nodes: slice.nodes,
      edges: slice.edges,
    };
    // Pretty-printed, like manifest.json already was: these files are meant
    // to be committed (see the publish step below), and a diff is only
    // useful — to a human, or to git's own delta compression — at line
    // granularity. A single minified line makes any change, however small,
    // look like the entire file was rewritten.
    await writeFile(
      path.join(TMP_DIR, 'graphs', `${slice.country}-${slice.gender}.json`),
      JSON.stringify(graph, null, 2),
    );

    const detail: PlayersFile = {
      country: slice.country,
      gender: slice.gender,
      players: slice.nodes.map((node) => {
        const p = players.get(node.id)!;
        const m = medalsByPlayer.get(node.id);
        const podium = podiumsByPlayer.get(node.id);
        return {
          id: node.id,
          name: p.name,
          dob: p.dob,
          height: p.height,
          weight: p.weight,
          olympics: m && hasMedal(m.olympics) ? m.olympics : undefined,
          worldChamps: m && hasMedal(m['world-champs']) ? m['world-champs'] : undefined,
          tour: podium && hasMedal(podium) ? podium : undefined,
          away: awayPartners.get(node.id),
        };
      }),
    };
    await writeFile(
      path.join(TMP_DIR, 'players', `${slice.country}-${slice.gender}.json`),
      JSON.stringify(detail, null, 2),
    );

    // Every tournament every player in this slice entered. Its own file, and
    // its own fetch: the timeline reads fine without it, and only a reader who
    // opens a season pays for it.
    const inSlice = new Set(slice.nodes.map((n) => n.id));
    const sliceResults: Record<string, ResultEntry[]> = {};
    const partnerNames: Record<string, string> = {};
    for (const node of slice.nodes) {
      const entries = results.get(node.id);
      if (!entries?.length) continue;
      sliceResults[node.id] = entries;
      resultRows += entries.length;
      for (const [, partner] of entries) {
        // Named here only when the graph cannot name them: a partner from
        // another federation, or one of the few players FIVB files under none.
        if (inSlice.has(partner) || partnerNames[partner]) continue;
        partnerNames[partner] = players.get(partner)?.name ?? `Player ${partner}`;
      }
    }
    await writeFile(
      path.join(TMP_DIR, 'results', `${slice.country}-${slice.gender}.json`),
      [
        '{',
        `  "country": ${JSON.stringify(slice.country)},`,
        `  "gender": ${JSON.stringify(slice.gender)},`,
        `  "names": ${jsonByKey(partnerNames, '  ')},`,
        `  "players": ${jsonByKey(sliceResults, '  ')}`,
        '}',
      ].join('\n'),
    );

    // Most tournaments first, so the file is already in the order the search
    // ranks by — and so an eye scanning it lands on the names it would expect.
    searchIndex[`${slice.country}-${slice.gender}`] = [...slice.nodes]
      .sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name))
      .map((n): SearchEntry =>
        // The graph's label, but only when it says something the name does
        // not. See SearchEntry: this is what makes "Duda" find Eduarda Santos
        // Lisboa, and it is skipped for the plain shortenings that a name
        // search already reaches.
        foldAccents(n.short).includes(foldAccents(n.name)) ||
        foldAccents(n.name).includes(foldAccents(n.short))
          ? [n.id, n.name, n.tournaments]
          : [n.id, n.name, n.tournaments, n.short],
      );

    let entry = byCountry.get(slice.country);
    if (!entry) {
      byCountry.set(
        slice.country,
        (entry = { code: slice.country, name, iso2, genders: {} }),
      );
    }
    entry.genders[slice.gender as Gender] = { nodes: slice.nodes.length, edges: slice.edges.length };
  }

  const manifest: Manifest = {
    generatedAt,
    sourceVersion,
    seasons: { from: seasonFrom, to: seasonTo },
    totals: {
      tournaments: tournaments.size,
      players: appearances.size,
      partnerships: partnerships.size,
    },
    tiers: tierCounts,
    countries: [...byCountry.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeFile(path.join(TMP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  await writeFile(
    path.join(TMP_DIR, 'search.json'),
    `{\n  "slices": ${jsonByKey(searchIndex, '  ')}\n}`,
  );

  log('results', `${resultRows.toLocaleString()} tournament entries across ${slices.length} slices`);
  log('search', `${Object.values(searchIndex).reduce((n, s) => n + s.length, 0).toLocaleString()} players indexed for cross-country search`);

  // Sanity-check the temp tree before letting it replace live data.
  const written = (await readdir(path.join(TMP_DIR, 'graphs'))).length;
  if (written !== slices.length) {
    throw new Error(`Expected ${slices.length} graph files, wrote ${written} — refusing to publish`);
  }
  for (const dir of ['players', 'results']) {
    const count = (await readdir(path.join(TMP_DIR, dir))).length;
    if (count !== slices.length) {
      throw new Error(`Expected ${slices.length} ${dir} files, wrote ${count} — refusing to publish`);
    }
  }

  // A rebuild that lost most of its data looks the same, from these numbers
  // alone, whether that's a real correction or FIVB silently handing back an
  // empty or truncated response. See regression.ts for why scale is the only
  // signal available to tell them apart.
  //
  // ALLOW_DATA_REGRESSION is the deliberate escape hatch for the one case
  // this can't tell apart from a broken fetch on its own: a real code change
  // that correctly excludes data that should never have been counted (e.g.
  // the Type-15 National Tour fix — a legitimate ~16% drop in one run). It is
  // wired to a workflow_dispatch checkbox, not a default, and this run is
  // never silent about using it: the drop is logged either way, published or
  // not, so it is visible in the run output and in the commit this produces.
  const regressions = checkForRegression(previousTotals, manifest.totals);
  if (regressions.length > 0) {
    const detail = `  ${regressions.join('\n  ')}`;
    if (process.env.ALLOW_DATA_REGRESSION === 'true') {
      console.warn(`  ! regression check bypassed (ALLOW_DATA_REGRESSION=true):\n${detail}`);
    } else {
      throw new Error(`Refusing to publish — this looks like a broken fetch, not a real change:\n${detail}`);
    }
  }

  // Swap the new tree in, then delete the old one — never the other way round.
  // `rm` the live directory first and the window between the two calls is a
  // window with no data at all: interrupt the process there (CI cancelled, disk
  // full, Ctrl-C) and what is left is not "last week's data", it is nothing,
  // with the freshly built replacement still sitting under a name nothing
  // serves. Renaming the old tree aside keeps a complete directory at OUT_DIR
  // at every instant except the moment of the rename itself, which is atomic
  // within a filesystem.
  await rm(OLD_DIR, { recursive: true, force: true });
  const hadPrevious = existsSync(OUT_DIR);
  if (hadPrevious) await rename(OUT_DIR, OLD_DIR);
  try {
    await rename(TMP_DIR, OUT_DIR);
  } catch (err) {
    // Put the previous data back rather than leaving the site with none.
    if (hadPrevious) await rename(OLD_DIR, OUT_DIR).catch(() => {});
    throw err;
  }
  await rm(OLD_DIR, { recursive: true, force: true });

  // graphs + players + results, plus the manifest, the tournament index
  // and the search index.
  log('published', `${OUT_DIR} (${written * 3 + 3} files) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  log('config', `age-group world championships ${INCLUDE_AGE_GROUP ? 'included' : 'excluded'}`);
}

main().catch(async (err) => {
  // Leave whatever is already published untouched. If the failure landed
  // mid-swap, the previous tree is parked at OLD_DIR — put it back rather than
  // discarding it, so a failed run still leaves the site with data to serve.
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await recoverInterruptedSwap().catch(() => {});
  await rm(OLD_DIR, { recursive: true, force: true }).catch(() => {});
  console.error('\nIngest failed — existing data left in place.');
  console.error(err);
  process.exit(1);
});
