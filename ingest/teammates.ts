/**
 * Does FIVB agree with the partnerships we publish?
 *
 * Every edge on the site is derived: 206,325 team rows, filtered by tier (§1),
 * filtered again by `Rank` (§3), deduplicated per pair per tournament, then
 * sliced by federation. That is a lot of inference standing between the source
 * and a line drawn between two names, and nothing checked it. A wrong pair key,
 * an off-by-one in the dedupe, or a slicing change could invent a partnership
 * that never existed and the site would render it without complaint.
 *
 * `GetBeachTeamMateList` closes that hole. It is FIVB answering the question
 * directly — give it a player number, it returns the player numbers they have
 * partnered with — so it is an *independent* answer to the same question, not
 * another pass over the same rows.
 *
 * The invariant is one-directional. VIS lists partnerships we deliberately
 * exclude, so its list is a superset and always will be; measured over all
 * 12,074 published players it had 15,808 pairs we do not, of which 13,019 are
 * events outside our tiers and 2,765 are entries where nobody played. What must
 * never happen is the other direction: a partnership *we* publish that FIVB has
 * no record of. Across the whole archive that number was exactly zero, which is
 * what makes it worth asserting — the baseline is not "small", it is none.
 */

import { fetchRaw } from './vis.js';

/** A partnership the site publishes that VIS does not list for that player. */
export interface TeammateMismatch {
  player: number;
  /** Partners we publish that VIS's own teammate list omits. */
  missing: number[];
}

export interface TeammateCheck {
  /** Players actually compared — fewer than requested if VIS returned errors. */
  checked: number;
  /** Players whose published partners VIS confirms exactly. */
  agreed: number;
  mismatches: TeammateMismatch[];
  /** Players VIS declined or answered unparseably; not a failure on our side. */
  unanswered: number;
}

/**
 * Which players to ask about.
 *
 * Deterministic, because a check that samples randomly reports a different
 * failure every week and cannot be reproduced from a log line. Two groups, for
 * two different jobs:
 *
 *  - the busiest careers, which carry the most edges and therefore give a
 *    systemic aggregation bug the most surface to show up on;
 *  - an even stride across the id-sorted rest, so the check is not permanently
 *    blind to the long tail of players with one or two partnerships.
 *
 * Ordered by id at the end so the request batches, and any diff of them, are
 * stable run to run.
 */
export function sampleForCheck(byPlayer: ReadonlyMap<number, ReadonlySet<number>>, size: number): number[] {
  const ids = [...byPlayer.keys()].sort((a, b) => a - b);
  if (ids.length <= size) return ids;

  const half = Math.max(1, Math.floor(size / 2));
  const busiest = [...byPlayer.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0] - b[0])
    .slice(0, half)
    .map(([id]) => id);

  const picked = new Set(busiest);
  // Stride the whole id-sorted list rather than slicing a contiguous block:
  // ids cluster by era, so a block would sample one decade and call it cover.
  const stride = Math.max(1, Math.floor(ids.length / (size - picked.size)));
  for (let i = 0; i < ids.length && picked.size < size; i += stride) picked.add(ids[i]!);

  return [...picked].sort((a, b) => a - b);
}

/**
 * Split one batched response into per-request teammate sets.
 *
 * VIS answers a `<Requests>` document with one child element per request, in
 * order, so position is the only link back to the player asked about — there is
 * no id echoed in the reply. A missing or unparseable child therefore has to
 * stay in place as `null` rather than being dropped, or every answer after it
 * is attributed to the wrong player.
 *
 * A teammate list arrives as `<OK>101452 103034</OK>`, and a player with no
 * partnerships as `<OK></OK>` or `<OK/>` — both are answers, not failures.
 */
export function parseTeammateBatch(body: string, expected: number): (Set<number> | null)[] {
  const inner = body
    .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
    .replace(/^\s*<Responses[^>]*>/, '')
    .replace(/<\/Responses>\s*$/, '');

  const out: (Set<number> | null)[] = [];
  // Matches one element per response, self-closing or not, without assuming
  // they are all <OK>: an error child (<BadParameter/>, <NotFound/>) has to
  // occupy its slot too.
  const element = /<([A-Za-z][\w]*)\b[^>]*?(\/>|>([\s\S]*?)<\/\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = element.exec(inner)) !== null) {
    if (m[1] !== 'OK') {
      out.push(null);
      continue;
    }
    const set = new Set<number>();
    for (const token of (m[3] ?? '').trim().split(/\s+/)) {
      if (!token) continue;
      const n = Number(token);
      // A non-numeric token means the response is not the shape documented;
      // treat the whole answer as unusable rather than silently keeping half.
      if (!Number.isFinite(n)) return [...out, ...Array(expected - out.length).fill(null)].slice(0, expected);
      set.add(n);
    }
    out.push(set);
  }

  while (out.length < expected) out.push(null);
  return out.slice(0, expected);
}

/**
 * Compare what we publish against what VIS says, in the one direction that can
 * indicate a bug on our side.
 *
 * `theirs` holding partners `ours` does not is normal and ignored — see the
 * file header. Only the reverse is reported.
 */
export function compareTeammates(
  ours: ReadonlyMap<number, ReadonlySet<number>>,
  theirs: ReadonlyMap<number, Set<number> | null>,
): TeammateCheck {
  let checked = 0;
  let agreed = 0;
  let unanswered = 0;
  const mismatches: TeammateMismatch[] = [];

  for (const [player, theirSet] of theirs) {
    if (theirSet === null) {
      unanswered++;
      continue;
    }
    checked++;
    const mine = ours.get(player) ?? new Set<number>();
    const missing = [...mine].filter((id) => !theirSet.has(id)).sort((a, b) => a - b);
    if (missing.length === 0) agreed++;
    else mismatches.push({ player, missing });
  }

  mismatches.sort((a, b) => b.missing.length - a.missing.length || a.player - b.player);
  return { checked, agreed, mismatches, unanswered };
}

/**
 * Ask VIS about a sample of players and compare.
 *
 * Batched, because one request per player would be 12,074 requests at a service
 * that asks to be treated gently and gives us the whole archive in three. A
 * hundred `<Request>` elements in one document answer in a single round trip,
 * so the default sample costs three.
 */
export async function verifyTeammates(
  ours: ReadonlyMap<number, ReadonlySet<number>>,
  size = 300,
  batchSize = 100,
): Promise<TeammateCheck> {
  const sample = sampleForCheck(ours, size);
  const theirs = new Map<number, Set<number> | null>();

  for (let i = 0; i < sample.length; i += batchSize) {
    const chunk = sample.slice(i, i + batchSize);
    const xml = `<Requests>${chunk
      .map((no) => `<Request Type="GetBeachTeamMateList" No="${no}"/>`)
      .join('')}</Requests>`;
    const body = await fetchRaw(xml, 'GetBeachTeamMateList');
    const parsed = parseTeammateBatch(body, chunk.length);
    chunk.forEach((id, k) => theirs.set(id, parsed[k] ?? null));
  }

  return compareTeammates(ours, theirs);
}
