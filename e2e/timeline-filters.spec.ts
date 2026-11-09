/**
 * The timeline's "Show only" chips, for players with partners in other
 * federations.
 *
 * A chip lists the player's whole career narrowed to one kind of event, and
 * that career includes partnerships the graph does not hold. Two cards got
 * this wrong: for a player whose partners are all elsewhere, the chip changed
 * nothing on screen, because the card said "none of these partnerships appear"
 * before it looked at the chip; and for everyone else the block of partners
 * not in this graph stayed below, unfiltered, so the same Games showed twice.
 *
 * Subjects are found by scanning the published files, like the rest of the
 * suite, because who has a foreign partner changes with every transfer.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, graph, manifest, players, results, tournamentIndex } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';
import type { Gender, TimelineFilter } from '../shared/schema.js';

const LABEL: Record<TimelineFilter, string> = { olympics: 'Olympics', 'world-champs': 'Worlds', 'tour-podium': 'Tour podiums' };
const TOUR = new Set(['world-tour', 'beach-pro-tour']);

const slices = () =>
  readdirSync(path.resolve(import.meta.dirname, '../web/public/v1/players')).flatMap((f) => {
    const m = /^([A-Z]+)-([MW])\.json$/.exec(f);
    return m ? [{ code: m[1]!, gender: m[2] as Gender }] : [];
  });

const pageOf = (code: string, gender: Gender, id: number) => {
  const name = manifest().countries.find((c) => c.code === code)!.name;
  return `./${sliceSlug(name, gender)}/?player=${id}`;
};

/** Does one of this player's results with `partner` match the chip? */
function matches(filter: TimelineFilter, tier: string, rank: number) {
  if (filter === 'olympics') return tier === 'olympics';
  if (filter === 'world-champs') return tier === 'world-champs';
  return TOUR.has(tier) && rank >= 1 && rank <= 3;
}

test('a player whose partners are all elsewhere gets the filtered list', async ({ page }) => {
  let subject: { code: string; gender: Gender; id: number; filter: TimelineFilter } | null = null;
  for (const { code, gender } of slices()) {
    const connected = new Set(graph(code, gender).edges.flatMap((e) => [e.a, e.b]));
    const p = players(code, gender).players.find((p) => p.filters?.length && p.away?.length && !connected.has(p.id));
    if (p) {
      subject = { code, gender, id: p.id, filter: p.filters![0]! };
      break;
    }
  }
  expect(subject, 'no player with only foreign partners has a timeline chip').not.toBeNull();

  await page.goto(pageOf(subject!.code, subject!.gender, subject!.id));
  await page.getByRole('button', { name: 'Timeline' }).click();
  await page.locator('.tl-filters button', { hasText: LABEL[subject!.filter] }).click();
  await expect(page.locator('.timeline.is-filtered .events > li').first()).toBeVisible();
  await expect(page.locator('.player-card .empty')).toHaveCount(0);
});

test('a chip shows a foreign partner\'s event once, in the filtered list', async ({ page }) => {
  const index = tournamentIndex();
  let subject: { code: string; gender: Gender; id: number; filter: TimelineFilter; partner: string } | null = null;
  outer: for (const { code, gender } of slices()) {
    const connected = new Set(graph(code, gender).edges.flatMap((e) => [e.a, e.b]));
    const detail = players(code, gender).players.filter((p) => p.filters?.length && p.away?.length && connected.has(p.id));
    if (detail.length === 0) continue;
    const res = results(code, gender);
    for (const p of detail) {
      const awayIds = new Map(p.away!.map((a) => [a.id, a.name]));
      for (const filter of p.filters!) {
        const hit = (res.players[p.id] ?? []).find(
          ([no, partner, rank]) => awayIds.has(partner) && index[no] && matches(filter, index[no]![2], rank),
        );
        if (hit) {
          subject = { code, gender, id: p.id, filter, partner: awayIds.get(hit[1])! };
          break outer;
        }
      }
    }
  }
  expect(subject, 'no player has a chip-matching event with a foreign partner').not.toBeNull();

  await page.goto(pageOf(subject!.code, subject!.gender, subject!.id));
  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.locator('.player-card .away')).toBeVisible();

  await page.locator('.tl-filters button', { hasText: LABEL[subject!.filter] }).click();
  const filtered = page.locator('.timeline.is-filtered');
  await expect(filtered.locator('.events .with', { hasText: subject!.partner }).first()).toBeVisible();
  // Not a second time below, unfiltered.
  await expect(page.locator('.player-card .away')).toHaveCount(0);

  await page.locator('.tl-filters button', { hasText: 'All' }).click();
  await expect(page.locator('.player-card .away')).toBeVisible();
});
