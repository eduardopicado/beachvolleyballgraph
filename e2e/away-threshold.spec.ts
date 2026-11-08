/**
 * Following a partner into another country lands on their card, whatever the
 * "min. events together" filter was set to.
 *
 * The filter is a statement about the graph the reader was looking at. Carried
 * into another country, it can hide the very partner they just clicked — and
 * the effect that drops a selection the visible graph does not contain then
 * closed the card, leaving a bare country page. The search box and a name in a
 * tournament field already reset it for exactly this reason; following an away
 * partner did not.
 *
 * Found from the data rather than named: a player visible at 2+ in their own
 * graph whose away partner has no partnership of two events or more in theirs.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';
import type { GraphFile, Gender, PlayersFile } from '../shared/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');
const read = <T>(rel: string): T => JSON.parse(readFileSync(path.join(DATA, rel), 'utf8')) as T;
const maxTogether = (g: GraphFile, id: number) =>
  Math.max(0, ...g.edges.filter((e) => e.a === id || e.b === id).map((e) => e.t));

function hiddenAwayPartner(): { slice: string; country: string; gender: Gender; from: number; partner: { id: number; name: string } } | null {
  const graphs = new Map<string, GraphFile>();
  const graph = (k: string) => {
    if (!graphs.has(k)) graphs.set(k, read<GraphFile>(`graphs/${k}.json`));
    return graphs.get(k)!;
  };
  const published = new Set(readdirSync(path.join(DATA, 'graphs')).map((f) => f.replace(/\.json$/, '')));
  for (const file of readdirSync(path.join(DATA, 'players'))) {
    const slice = file.replace(/\.json$/, '');
    const { country, gender, players } = read<PlayersFile>(`players/${file}`);
    for (const p of players) {
      if (!p.away || maxTogether(graph(slice), p.id) < 2) continue;
      for (const y of p.away) {
        const theirs = `${y.fed}-${y.gender}`;
        if (!published.has(theirs) || !graph(theirs).nodes.some((n) => n.id === y.id)) continue;
        if (maxTogether(graph(theirs), y.id) < 2) return { slice, country, gender, from: p.id, partner: { id: y.id, name: y.name } };
      }
    }
  }
  return null;
}

test('an away partner hidden by the filter in their own graph still opens', async ({ page }) => {
  const found = hiddenAwayPartner();
  test.skip(!found, 'no away partner is hidden at 2+ in their own graph today');
  const { country, gender, from, partner } = found!;
  const name = manifest().countries.find((c) => c.code === country)!.name;

  await page.goto(`/${sliceSlug(name, gender)}/?player=${from}&min=2`);
  const card = page.locator('.player-card');
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: new RegExp(partner.name.split(' ')[0]!) }).first().click();

  await expect(page).toHaveURL(new RegExp(`[?&]player=${partner.id}(&|$)`));
  await expect(page.locator('.player-card h2, .player-card h3').first()).toContainText(partner.name.split(' ')[0]!);
});
