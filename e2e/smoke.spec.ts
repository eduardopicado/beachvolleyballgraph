/**
 * Does the built site actually work?
 *
 * Every assertion here is cross-checked against the JSON the page was built
 * from, rather than against a number written into the test — so these stay
 * true as the weekly ingest changes the data, and fail when the page and its
 * data stop agreeing.
 *
 * Deliberately *not* covered: anything that depends on synthetic input
 * subtleties (wheel gestures, pinch-zoom). Those are verifiable by hand but
 * measurably flaky under CDP — parking a synthetic cursor over a node makes
 * the following wheel event report `cancelable: false`, which reads as a
 * regression when nothing is wrong. A check that blocks deploys and cries
 * wolf is worse than no check.
 */

import type { Page } from '@playwright/test';
import {
  test,
  expect,
  accentedPlayerElsewhere,
  manifest,
  graph,
  players,
  results,
  searchIndex,
  strandedPlayer,
  tournamentIndex,
} from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';
import {
  indexPlayers,
  searchPlayers,
  type SearchablePlayer,
  type Slice,
} from '../web/src/lib/search.js';
import { parseSliceKey } from '../web/src/schema.js';
import { CONTACT_EMAIL } from '../web/src/site.js';

/** A big, always-present slice — the densest realistic render. */
const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

test('home page renders and lists countries', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Beach Volleyball Partnership Graph', level: 1 })).toBeVisible();

  // The country picker is populated from the manifest, so an empty one means
  // the data never loaded — the most likely shape of a "blank page" report.
  const options = page.locator('select option');
  await expect.poll(() => options.count()).toBeGreaterThan(50);
  expect(manifest().countries.length).toBeGreaterThan(50);
});

test('a country page draws every node and edge in its graph file', async ({ page }) => {
  await page.goto(`./${slicePath()}`);

  const data = graph(COUNTRY, GENDER);
  // Rendered on mount; the force simulation only moves them afterwards, so
  // this needs no wait for the layout to settle.
  await expect.poll(() => page.locator('[data-node]').count()).toBe(data.nodes.length);
  await expect(page.locator('svg.graph line')).toHaveCount(data.edges.length);
});

test('the headline player count matches the graph file', async ({ page }) => {
  await page.goto(`./${slicePath()}`);
  const expected = graph(COUNTRY, GENDER).nodes.length;
  await expect(page.locator('.tile.is-hero .value')).toHaveText(expected.toLocaleString('en-US'));
});

test('selecting a player opens their card with the right numbers', async ({ page }) => {
  const data = graph(COUNTRY, GENDER);
  // The most-active player: guaranteed to have partners, so the card is fully
  // populated rather than hitting the "no partnerships" empty state.
  const target = [...data.nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;

  await page.goto(`./${slicePath()}?player=${target.id}`);

  const card = page.locator('.player-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 2 })).toHaveText(target.name);

  // Tournaments on the card must equal the node's own count — the invariant
  // that surfaced the Rank-0 double-counting bug in the first place.
  const tournaments = card.locator('.vitals div', { has: page.getByText('Tournaments', { exact: true }) });
  await expect(tournaments.locator('dd')).toHaveText(String(target.tournaments));
});

test.describe('partners from other federations', () => {
  const sliceFor = (code: string, gender: string) => {
    const entry = manifest().countries.find((c) => c.code === code);
    if (!entry) throw new Error(`${code} missing from the manifest`);
    return `${sliceSlug(entry.name, gender as 'M' | 'W')}/`;
  };

  test('a player with only foreign partners still shows a career', async ({ page }) => {
    const target = strandedPlayer();
    // If the archive ever contains none, the feature has nothing to prove and
    // the test should say so rather than pass silently.
    expect(target, 'no player in the published data has only away partners').not.toBeNull();

    await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);
    const card = page.locator('.player-card');
    await expect(card).toBeVisible();

    // The graph genuinely has no edge for them...
    await expect(card.locator('.partners > ul > li')).toHaveCount(0);
    // ...and without this feature that was the whole story. Now it is not.
    await expect(card.locator('.away li')).toHaveCount(target!.away);
    await expect(card.locator('.partners .empty')).toContainText('same federation');

    // The vitals describe the player, not the graph. Counting only the edges
    // put "0 partners" directly above a list of them.
    const partners = card.locator('.vitals div', { has: page.getByText('Partners', { exact: true }) });
    await expect(partners.locator('dd')).toHaveText(String(target!.away));
  });

  test('the away list does not spill over the card below it', async ({ page }) => {
    // The card is capped at the graph's height, and this section used to be
    // allowed to shrink below its own contents — which painted the away rows
    // straight through the FIVB profile link underneath.
    const target = strandedPlayer();
    expect(target).not.toBeNull();
    await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);
    await expect(page.locator('.player-card')).toBeVisible();

    // The *last rendered row*, not the section's own box. A box does not grow
    // to contain a child that overflows it, so measuring `.partners` reported
    // a clean 18px gap at every width — including the one where the rows were
    // visibly painted across the link. The away list is the right thing to
    // measure because, unlike the partner list above it, it is not a scroll
    // container: its rows sit where they are drawn.
    const overhang = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.away li')];
      const link = document.querySelector('.profile-link')?.getBoundingClientRect();
      if (!link || rows.length === 0) return null;
      const last = rows[rows.length - 1]!.getBoundingClientRect();
      return Math.round(last.bottom - link.top);
    });
    expect(overhang, 'no away rows found to measure').not.toBeNull();
    expect(overhang, 'the away list is painted over the FIVB profile link').toBeLessThanOrEqual(0);
  });

  test('following an away partner lands on their own country page', async ({ page }) => {
    const target = strandedPlayer();
    expect(target).not.toBeNull();
    await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);

    const first = page.locator('.away li button').first();
    const name = (await first.locator('.name').innerText()).trim();
    const startedAt = new URL(page.url()).pathname;
    await first.click();

    // The card now belongs to the partner, in a different slice.
    await expect(page.locator('.player-card h2')).toHaveText(name);
    await expect.poll(() => new URL(page.url()).pathname).not.toBe(startedAt);
  });
});

test.describe('timeline view', () => {
  // Scoped to the switch: the sortable table below the graph has its own
  // "Partners" column-header button, so an unscoped role query is ambiguous.
  const tab = (page: Page, name: 'Partners' | 'Timeline') =>
    page.getByRole('group', { name: 'Partner view' }).getByRole('button', { name, exact: true });

  /** The player in this slice with the most seasons that had two partners. */
  const busiest = () => {
    const data = graph(COUNTRY, GENDER);
    const byPlayer = new Map<number, Map<number, number>>();
    for (const e of data.edges) {
      for (const id of [e.a, e.b]) {
        let seasons = byPlayer.get(id);
        if (!seasons) byPlayer.set(id, (seasons = new Map()));
        for (const [season] of e.s ?? []) seasons.set(season, (seasons.get(season) ?? 0) + 1);
      }
    }
    let best = { id: 0, shared: -1, seasons: 0 };
    for (const [id, seasons] of byPlayer) {
      const shared = [...seasons.values()].filter((n) => n > 1).length;
      if (shared > best.shared) best = { id, shared, seasons: seasons.size };
    }
    return best;
  };

  // Scoped to `.partners > .timeline` throughout, not a bare `.timeline`: the
  // card renders a second one inside `.away` for partnerships the graph cannot
  // hold, so an unscoped selector matches both and silently doubles every
  // count. `.is-away` marks the other one.
  test('groups a career by season and matches the graph file', async ({ page }) => {
    const target = busiest();
    // Guards the guard: if the published data ever loses its per-season field
    // this test would otherwise pass vacuously against an empty timeline.
    expect(target.shared, 'no player in this slice shares a season').toBeGreaterThan(0);

    await page.goto(`./${slicePath()}?player=${target.id}`);
    await tab(page, 'Timeline').click();

    // One group per season the player actually competed in — derived from the
    // same edges the page was built from, so this stays true as data changes.
    await expect(page.locator('.partners > .timeline > li')).toHaveCount(target.seasons);

    // Seasons run newest first.
    const years = await page.locator('.partners > .timeline .year').allInnerTexts();
    const numbers = years.map(Number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

    // And the thing the partner list structurally cannot show: one year with
    // more than one name against it.
    const shared = page
      .locator('.partners > .timeline > li')
      .filter({ has: page.locator('ul > li:nth-child(2)') });
    await expect(shared).toHaveCount(target.shared);
  });

  test('switches back to the partner list', async ({ page }) => {
    const target = busiest();
    await page.goto(`./${slicePath()}?player=${target.id}`);

    await expect(tab(page, 'Partners')).toHaveAttribute('aria-pressed', 'true');
    await tab(page, 'Timeline').click();
    await expect(tab(page, 'Timeline')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.partners > .timeline')).toBeVisible();

    await tab(page, 'Partners').click();
    await expect(page.locator('.partners > .timeline')).toHaveCount(0);
    await expect(page.locator('.partners > ul > li').first()).toBeVisible();
  });

  test('a partner in the timeline opens that partner', async ({ page }) => {
    const target = busiest();
    await page.goto(`./${slicePath()}?player=${target.id}`);
    await tab(page, 'Timeline').click();

    const firstPartner = page.locator('.timeline ul li button').first();
    const name = (await firstPartner.locator('.name').innerText()).trim();
    // The timeline is its own scroll container inside a card that is itself
    // sized to the graph, so the first row is not necessarily in view.
    await firstPartner.scrollIntoViewIfNeeded();
    await firstPartner.click();

    await expect(page.locator('.player-card').getByRole('heading', { level: 2 })).toHaveText(name);
    // The view is a reading mode, not a per-player setting: someone working
    // through a career year by year should stay in it as they click through.
    await expect(tab(page, 'Timeline')).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * The busiest player's busiest season, and what the published files say
   * happened in it — the answer the page has to reproduce, derived from the
   * same data it was built from.
   */
  const busiestSeason = () => {
    const target = busiest();
    const index = tournamentIndex();
    const entries = results(COUNTRY, GENDER).players[target.id] ?? [];
    const bySeason = new Map<number, string[]>();
    for (const [no] of entries) {
      const meta = index[no];
      if (!meta) continue;
      const list = bySeason.get(meta[1]) ?? [];
      list.push(meta[0]);
      bySeason.set(meta[1], list);
    }
    let best = { season: 0, names: [] as string[] };
    for (const [season, names] of bySeason) {
      if (names.length > best.names.length) best = { season, names };
    }
    return { id: target.id, ...best };
  };

  test('expanding a season lists the tournaments behind it', async ({ page }) => {
    const target = busiestSeason();
    expect(target.names.length, 'no season in this slice has a tournament to show').toBeGreaterThan(1);

    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));

    await page.goto(`./${slicePath()}?player=${target.id}`);
    await tab(page, 'Timeline').click();

    // Nothing has been fetched yet — the whole point of a separate file.
    expect(requests.filter((p) => p.includes('/results/'))).toEqual([]);

    const season = page.locator('.timeline .season', { hasText: String(target.season) }).first();
    await season.scrollIntoViewIfNeeded();
    await season.click();

    const rows = page.locator('.events > li');
    await expect(rows).toHaveCount(target.names.length);
    // In the order the ingest published, which is the season run backwards.
    expect(await rows.locator('.name').allInnerTexts()).toEqual(target.names);
    await expect(season).toHaveAttribute('aria-expanded', 'true');

    // The disclosure caret is the only thing telling a reader the year opens,
    // and it has to be there without hovering — touch has no hover state. It
    // is drawn with borders rather than a glyph, so "visible" means the
    // triangle has a width to it.
    const caret = season.locator('.caret');
    await expect(caret).toBeAttached();
    const border = await caret.evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(border, 'the caret is not drawn').not.toBe('0px');
    expect(requests.filter((p) => p.includes('/results/'))).toHaveLength(1);
  });

  test('collapsing a season puts its partner rows back', async ({ page }) => {
    const target = busiestSeason();
    await page.goto(`./${slicePath()}?player=${target.id}`);
    await tab(page, 'Timeline').click();

    const item = page.locator('.timeline > li', { hasText: String(target.season) }).first();
    const season = item.locator('.season');
    await season.scrollIntoViewIfNeeded();

    const partnersBefore = await item.locator('ul > li').count();
    expect(partnersBefore).toBeGreaterThan(0);

    await season.click();
    await expect(item.locator('.events > li').first()).toBeVisible();
    await expect(item.locator('ul > li')).toHaveCount(0);

    await season.click();
    await expect(item.locator('.events')).toHaveCount(0);
    await expect(item.locator('ul > li')).toHaveCount(partnersBefore);
  });
});

test('the card renders vitals from the separate player detail file', async ({ page }) => {
  // The graph file and the player file are fetched separately and joined by
  // id in the browser. If that join breaks, the card still opens and still
  // shows the name — it just renders every vital as an em dash, which is
  // indistinguishable from "FIVB has no height on file" unless something
  // checks a player known to have one.
  const detail = players(COUNTRY, GENDER);
  const withHeight = detail.players.find((p) => p.height !== null);
  expect(withHeight, 'no player in this slice has a height to check').toBeTruthy();

  await page.goto(`./${slicePath()}?player=${withHeight!.id}`);
  const card = page.locator('.player-card');
  const height = card.locator('.vitals div', { has: page.getByText('Height', { exact: true }) });
  await expect(height.locator('dd')).toHaveText(`${withHeight!.height} cm`);
});

test('the card counts tour podiums apart from Olympic and World Championships medals', async ({
  page,
}) => {
  // The three tallies are never merged, so the card has to show them as three
  // cells with three different numbers. Picking the player with the most tour
  // podiums makes it the busiest case rather than a lucky one.
  const detail = players(COUNTRY, GENDER);
  const best = detail.players
    .filter((p) => p.tour)
    .sort((a, b) => {
      const total = (c: typeof a.tour) => (c ? c.gold + c.silver + c.bronze : 0);
      return total(b.tour) - total(a.tour);
    })[0];
  expect(best, 'no player in this slice has a tour podium').toBeTruthy();

  await page.goto(`./${slicePath()}?player=${best!.id}`);
  const cell = page
    .locator('.player-card .vitals div')
    .filter({ has: page.getByText('Tour podiums', { exact: true }) });
  const { gold, silver, bronze } = best!.tour!;
  // Emoji and count are joined by a WORD JOINER, so match the numbers rather
  // than the exact string.
  const text = await cell.locator('dd').innerText();
  expect(text.match(/\d+/g)?.map(Number)).toEqual([gold, silver, bronze].filter((n) => n > 0));

  // And it is genuinely a different number from the medal cells beside it.
  if (best!.olympics) {
    const olympics = page
      .locator('.player-card .vitals div')
      .filter({ has: page.getByText('Olympics', { exact: true }) });
    await expect(olympics.locator('dd')).not.toHaveText(text);
  }
});

test('the table lists the whole slice', async ({ page }) => {
  await page.goto(`./${slicePath()}`);
  const expected = graph(COUNTRY, GENDER).nodes.length;
  await expect.poll(() => page.locator('.table-view tbody tr').count()).toBe(expected);
});

test.describe('cross-country search', () => {
  const box = (page: Page) => page.getByPlaceholder('Start typing a name…');

  /** Result rows only — the list also holds group wrappers and headings. */
  const rows = (page: Page) => page.locator('.player-search-results .result');

  /**
   * The same list the app searches, built from the same published index.
   *
   * Used only to *choose* a query whose matches land in more than one group —
   * which names do that depends entirely on the archive, and the archive moves
   * every week. Every assertion below is still made against the rendered DOM.
   */
  const searchable = () => {
    const all: SearchablePlayer[] = [];
    for (const [key, entries] of Object.entries(searchIndex())) {
      const slice = parseSliceKey(key);
      if (!slice) continue;
      for (const [id, name, tournaments] of entries) all.push({ id, name, tournaments, slice });
    }
    return indexPlayers(all);
  };

  /**
   * Where a match sits relative to the page, worked out from the *published
   * slices* rather than from the grouping code this file is testing. Deriving
   * the subject from `MatchGroup` would mean a revert of the grouping made
   * these tests silently skip instead of fail.
   */
  const placeOf = (slice: Slice, home: Slice) =>
    slice.country !== home.country ? 'elsewhere' : slice.gender === home.gender ? 'home' : 'country';

  /** Scan for a query whose eight rows reach every place named. */
  const queryCovering = (home: Slice, wanted: string[]) => {
    const index = searchable();
    const seen = new Set<string>();
    for (const player of index) {
      // A single name token: what a reader actually types.
      for (const token of player.folded.split(' ')) {
        if (token.length < 3 || seen.has(token)) continue;
        seen.add(token);
        const { matches } = searchPlayers(index, token, home);
        const places = new Set(matches.map((m) => placeOf(m.slice, home)));
        if (wanted.every((w) => places.has(w))) return { token, matches };
      }
    }
    return null;
  };

  test('finds an accented name from another country, typed without the accents', async ({
    page,
  }) => {
    const target = accentedPlayerElsewhere(`${COUNTRY}-${GENDER}`);
    expect(target, 'no accented name outside this slice to search for').toBeTruthy();

    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await page.goto(`./${slicePath()}`);
    await expect(page.locator('.table-view tbody tr').first()).toBeVisible();

    // 370 KB that a visit which never uses the box should not pay for.
    expect(requests.filter((p) => p.endsWith('/search.json'))).toEqual([]);

    await box(page).click();
    await expect.poll(() => requests.filter((p) => p.endsWith('/search.json')).length).toBe(1);

    await box(page).fill(target!.plain);
    const row = rows(page).filter({ hasText: target!.name });
    await expect(row).toBeVisible();
    // Flagged with where they actually are, since picking it leaves this page.
    await expect(row.locator('.where')).toBeVisible();

    await row.click();

    // Landed on their country, with their card open.
    await expect(page.locator('.player-card h2')).toHaveText(target!.name);
    const { country } = parseSliceKey(target!.slice)!;
    const entry = manifest().countries.find((c) => c.code === country);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toContain(sliceSlug(entry!.name, parseSliceKey(target!.slice)!.gender));
  });

  test('every row names a country, and only the ones elsewhere are flagged as such', async ({ page }) => {
    // Every row says where the player is from — eight results named "Sam" are
    // otherwise impossible to tell apart, and the rows left blank were the
    // local ones, which is exactly the group a reader is most likely to want.
    //
    // The emphasis is the part that stays conditional: `is-elsewhere` marks
    // the rows whose selection leaves this country, which is the only thing on
    // this line with a consequence.
    const local = graph(COUNTRY, GENDER).nodes.sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await page.goto(`./${slicePath()}`);
    await box(page).click();
    await box(page).fill(local.name);

    const row = rows(page).filter({ hasText: local.name }).first();
    await expect(row).toBeVisible();
    const where = row.locator('.where');
    await expect(where).toHaveCount(1);
    // Named as the country actually on screen, not left blank.
    const entry = manifest().countries.find((c) => c.code === COUNTRY)!;
    await expect(where).toContainText(entry.name);
    // …but not dressed as somewhere you would have to navigate to.
    await expect(row.locator('.where.is-elsewhere')).toHaveCount(0);
  });

  /**
   * The country selector has always ranked this list rather than filtering it,
   * and nothing on screen said so — which is why the same box reads as strict
   * on one query and absent on the next. The headings are that precedence,
   * written down.
   */
  test('headings separate this page from the rest of the country and from everywhere else', async ({
    page,
  }) => {
    const home: Slice = { country: COUNTRY, gender: GENDER };
    const found = queryCovering(home, ['home', 'country', 'elsewhere']);
    test.skip(!found, 'no query in this archive spans all three groups');

    await page.goto(`./${slicePath()}`);
    await box(page).click();
    await box(page).fill(found!.token);

    const list = page.locator('.player-search-results');
    await expect(rows(page)).toHaveCount(found!.matches.length);

    // Three groups, in order, each named for what it holds.
    const entry = manifest().countries.find((c) => c.code === COUNTRY)!;
    const labels = await list.locator('[role="group"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')),
    );
    expect(labels).toEqual([`${entry.name} Men`, `${entry.name} Women`, 'Elsewhere']);

    // Each group holds exactly the rows the ranking put in it, and the rows
    // sit under the right heading rather than merely in the right order.
    for (const [i, place] of ['home', 'country', 'elsewhere'].entries()) {
      const expected = found!.matches
        .filter((m) => placeOf(m.slice, home) === place)
        .map((m) => m.name);
      const names = await list
        .locator('[role="group"]')
        .nth(i)
        .locator('.result .name')
        .allInnerTexts();
      expect(names).toEqual(expected);
    }
  });

  test('a heading is not an option, so the arrow keys pass straight over it', async ({ page }) => {
    // A heading faked with a plain <li> inside the listbox would be counted as
    // an option by assistive tech and stopped on by the keyboard. This is the
    // guard on that: options are only ever result rows.
    const home: Slice = { country: COUNTRY, gender: GENDER };
    const found = queryCovering(home, ['home', 'elsewhere']);
    test.skip(!found, 'no query in this archive spans two groups');

    await page.goto(`./${slicePath()}`);
    await box(page).click();
    await box(page).fill(found!.token);

    const options = page.locator('.player-search-results [role="option"]');
    await expect(options).toHaveCount(found!.matches.length);
    // Every option is a result row — no headings crept into the count.
    await expect(page.locator('.player-search-results [role="option"].result')).toHaveCount(
      found!.matches.length,
    );
    // And nothing in the list is an unlabelled list item: every <li> is either
    // an option, a named group, or explicitly presentational. A heading left as
    // a bare <li> would be counted as an option by assistive tech without
    // changing either count above.
    const unroled = await page
      .locator('.player-search-results li')
      .evaluateAll((els) => els.filter((el) => !el.getAttribute('role')).map((el) => el.textContent));
    expect(unroled).toEqual([]);

    // Arrowing from the top hit lands on the second *row*, across the heading
    // that sits between them in the DOM.
    const second = found!.matches[1]!.name;
    await box(page).press('ArrowDown');
    await expect(page.locator('.player-search-results .result.is-active')).toContainText(second);
  });

  test('the list says how many matches it threw away', async ({ page }) => {
    // The eight-row cut is what actually filters this search, and it used to be
    // completely silent: against the published index the median three-letter
    // query matches far more players than the list can hold.
    const index = searchable();
    const home: Slice = { country: COUNTRY, gender: GENDER };
    const token = [...new Set(index.map((p) => p.folded.slice(0, 3)))].find(
      (t) => t.length === 3 && searchPlayers(index, t, home).hidden > 0,
    );
    test.skip(!token, 'no query in this archive overflows the list');
    const { hidden } = searchPlayers(index, token!, home);

    await page.goto(`./${slicePath()}`);
    await box(page).click();
    await box(page).fill(token!);

    await expect(page.locator('.player-search-results .is-more')).toHaveText(
      `${hidden} more not shown`,
    );
  });

  test('a compatriot of the other gender is a compatriot, not a foreigner', async ({ page }) => {
    // Kimberly Dicello is American. On the United States men's page she used to
    // be flagged in orange as being from somewhere else, below players from
    // Switzerland, because "here" meant the country *and* the gender.
    const home: Slice = { country: COUNTRY, gender: GENDER };
    const found = queryCovering(home, ['country']);
    test.skip(!found, 'no query in this archive reaches the other gender');
    const compatriot = found!.matches.find(
      (m) => m.slice.country === COUNTRY && m.slice.gender !== GENDER,
    )!;

    await page.goto(`./${slicePath()}`);
    await box(page).click();
    await box(page).fill(found!.token);

    const row = rows(page).filter({ hasText: compatriot.name }).first();
    await expect(row).toBeVisible();
    // Named — every row is — but not dressed as a country change.
    const entry = manifest().countries.find((c) => c.code === COUNTRY)!;
    await expect(row.locator('.where')).toContainText(entry.name);
    await expect(row.locator('.where.is-elsewhere')).toHaveCount(0);
  });
});

test('published JSON endpoints are reachable', async ({ page, baseURL }) => {
  const suffixes = [
    'v1/manifest.json',
    'v1/tournaments.json',
    'v1/search.json',
    `v1/graphs/${COUNTRY}-${GENDER}.json`,
    `v1/players/${COUNTRY}-${GENDER}.json`,
    `v1/results/${COUNTRY}-${GENDER}.json`,
  ];
  for (const suffix of suffixes) {
    const res = await page.request.get(new URL(suffix, baseURL).toString());
    expect(res.status(), `${suffix} should be served`).toBe(200);
    expect(() => res.json(), `${suffix} should be JSON`).not.toThrow();
  }
});

test.describe('/about/', () => {
  // The one page here that is not the app. Every other document is
  // prerendered markup that React replaces on mount; this one deliberately
  // ships without the module script, because booting the app on a path that
  // matches no country slice would fall back to the default country and swap
  // the text for the Brazil graph. That failure is invisible to a build —
  // the page compiles, deploys and 200s, it just isn't the page any more.
  test('is a standalone document the app never takes over', async ({ page }) => {
    await page.goto('./about/');

    await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
    // The mechanism, asserted directly: no script, nothing to mount.
    await expect(page.locator('script[type="module"]')).toHaveCount(0);
    await expect(page.locator('#root')).toHaveCount(0);
    // And still the About page a beat later, not a graph.
    await expect(page.locator('svg.graph')).toHaveCount(0);
  });

  test('carries the contact address and a way back', async ({ page, baseURL }) => {
    await page.goto('./about/');

    // The address is the reason the page exists — for FIVB, and for anyone
    // with a correction. A broken mailto here is the whole feature failing.
    await expect(page.locator(`a[href="mailto:${CONTACT_EMAIL}"]`).first()).toBeVisible();

    const back = page.getByRole('link', { name: /Back to the graph/ });
    await expect(back).toHaveAttribute('href', new URL('./', baseURL).pathname);
  });

  test('is reachable from the footer of a country page', async ({ page }) => {
    await page.goto(`./${slicePath()}`);
    await page.getByRole('link', { name: 'About this project' }).click();
    await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the prerendered footer carries the contact address', async ({ page }) => {
    // The crawler and no-JS path has its own footer, written by prerender.ts
    // rather than React. It is also the version most likely to be read by the
    // two audiences the address exists for, so it is worth its own check.
    await page.goto(`./${slicePath()}`);
    await expect(page.locator(`footer a[href="mailto:${CONTACT_EMAIL}"]`)).toBeVisible();
  });

  // Canonical tags are the one part of the build that names a URL nobody
  // visits during the test — they describe where the page is *published*, not
  // where it is being served from right now. Which is exactly why they rot
  // silently: SITE_URL and BASE_PATH are set separately by the workflow, and
  // a canonical assembled from a custom origin and a project-Pages base
  // points at a path that exists on neither host. Nothing else in the suite
  // would notice, and the first symptom is Google indexing 265 dead URLs.
  test('the canonical URL describes where the page is published', async ({ page, baseURL }) => {
    const here = `./${slicePath()}`;
    await page.goto(here);

    const href = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(href, 'the prerendered page declares no canonical URL').toBeTruthy();
    const canonical = new URL(href!);

    // Checkable anywhere: the path has to be the path this page is served
    // from, base included. A base that only half made it into the prerender
    // shows up here.
    expect(canonical.pathname).toBe(new URL(here, baseURL).pathname);

    // The origin is only knowable when the build was told one. Locally it
    // isn't, and the placeholder origin is not worth asserting on.
    if (process.env.SITE_URL) {
      expect(canonical.origin).toBe(new URL(process.env.SITE_URL).origin);
    }
  });

  test('the prerendered page still carries the full player table', async ({ page }) => {
    // The crawler path. React never mounts here, so anything visible is what
    // ingest/prerender.ts wrote at build time.
    await page.goto(`./${slicePath()}`);
    const expected = graph(COUNTRY, GENDER).nodes.length;
    await expect(page.locator('table tbody tr')).toHaveCount(expected);
    await expect(page.locator('nav[aria-label="Other countries"] a').first()).toBeVisible();
  });
});

/**
 * The other-federations block, which now runs through the same timeline as the
 * player's own partnerships.
 *
 * Worth its own coverage because for the 49 players with no partner in their
 * own federation this block *is* the career — the main list is empty and
 * everything the card has to say lives here. It is also the change that put a
 * second `.timeline` in the card, which is why every selector above had to say
 * which one it meant.
 */
test.describe('other federations', () => {
  const tab = (page: import('@playwright/test').Page, name: 'Partners' | 'Timeline') =>
    page.getByRole('group', { name: 'Partner view' }).getByRole('button', { name, exact: true });

  test('the away block gets seasons that expand, like the list above it', async ({ page }) => {
    const stranded = strandedPlayer();
    test.skip(!stranded, 'no player in the archive has only cross-federation partners');
    const { code, gender, id, away } = stranded!;
    const entry = manifest().countries.find((c) => c.code === code)!;
    await page.goto(`./${sliceSlug(entry.name, gender as 'M' | 'W')}/?player=${id}`);

    await expect(page.locator('.player-card')).toBeVisible();
    await expect(page.locator('.away')).toBeVisible();

    // In the partners view it is still the flat list of names it always was.
    await expect(page.locator('.away ul > li')).toHaveCount(away);

    await tab(page, 'Timeline').click();
    const timeline = page.locator('.away .timeline.is-away');
    await expect(timeline).toBeVisible();
    const seasons = timeline.locator('> li');
    const count = await seasons.count();
    expect(count, 'an away timeline with no seasons would pass everything vacuously').toBeGreaterThan(0);

    // Newest first, the same direction as the card's own timeline.
    const years = (await timeline.locator('.year').allInnerTexts()).map(Number);
    expect(years).toEqual([...years].sort((a, b) => b - a));

    // And a season opens into the tournaments behind it — the whole point of
    // giving this block the same behaviour rather than a flat list.
    await seasons.first().locator('.season').click();
    await expect(timeline.locator('.events > li').first()).toBeVisible();
  });

  test('an expanded away season lists only cross-federation events', async ({ page }) => {
    // The results file holds a player's whole career, so an unfiltered season
    // would show their home partnerships under a heading reading "other
    // federations" — real events, wrong question.
    const stranded = strandedPlayer();
    test.skip(!stranded, 'no player in the archive has only cross-federation partners');
    const { code, gender, id } = stranded!;
    const entry = manifest().countries.find((c) => c.code === code)!;
    const awayNames = new Set(
      (players(code, gender).players.find((p) => p.id === id)!.away ?? []).map((a) => a.name),
    );

    await page.goto(`./${sliceSlug(entry.name, gender as 'M' | 'W')}/?player=${id}`);
    await tab(page, 'Timeline').click();
    const timeline = page.locator('.away .timeline.is-away');
    await timeline.locator('> li').first().locator('.season').click();

    const withs = await timeline.locator('.events .with').allInnerTexts();
    expect(withs.length, 'need at least one event to check').toBeGreaterThan(0);
    for (const name of withs) {
      expect(awayNames, `${name} is not one of this player's away partners`).toContain(name.trim());
    }
  });
});

/**
 * The tournament level on an expanded season.
 *
 * Until this, a tour row carried no badge at all: `tier` collapses thirteen
 * distinct levels into one `world-tour` value, so a 2005 Grand Slam and a 2019
 * 1-star read identically. The badge now falls back to the level when the tier
 * has none of its own.
 */
test('an expanded season badges tour events with the level FIVB gave them', async ({ page }) => {
  const index = tournamentIndex();
  // Find a player whose expanded season contains an event with a level, by
  // scanning rather than naming one — which level a career touches depends on
  // when it happened, and careers move as the archive is rebuilt.
  const rows = results(COUNTRY, GENDER).players;
  let found: { id: number; season: number; level: string; name: string } | null = null;
  for (const [id, entries] of Object.entries(rows)) {
    for (const [no] of entries) {
      const meta = index[no];
      if (meta && meta.length > 5 && meta[5]) {
        found = { id: Number(id), season: meta[1], level: meta[5] as string, name: meta[0] };
        break;
      }
    }
    if (found) break;
  }
  expect(found, 'no tournament in this slice carries a level').not.toBeNull();

  await page.goto(`./${slicePath()}?player=${found!.id}`);
  await page
    .getByRole('group', { name: 'Partner view' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  const season = page
    .locator('.partners > .timeline > li')
    .filter({ hasText: String(found!.season) })
    .first();
  await season.locator('.season').click();

  const row = season.locator('.events > li').filter({ hasText: found!.name }).first();
  await expect(row).toBeVisible();
  // The badge says exactly what the published index says, not a guess.
  await expect(row.locator('.badge')).toHaveText(found!.level);
});

test('the Olympics keep their tier badge rather than gaining a level', async ({ page }) => {
  // Tier wins where it exists: the Games have no level below them, and a row
  // reading "Olympics" is the right answer where "1-star" would be nonsense.
  const index = tournamentIndex();
  const rows = results(COUNTRY, GENDER).players;
  let found: { id: number; season: number; name: string } | null = null;
  for (const [id, entries] of Object.entries(rows)) {
    for (const [no] of entries) {
      const meta = index[no];
      if (meta && meta[2] === 'olympics') {
        found = { id: Number(id), season: meta[1], name: meta[0] };
        break;
      }
    }
    if (found) break;
  }
  test.skip(!found, 'no Olympic entry in this slice');

  await page.goto(`./${slicePath()}?player=${found!.id}`);
  await page
    .getByRole('group', { name: 'Partner view' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  const season = page
    .locator('.partners > .timeline > li')
    .filter({ hasText: String(found!.season) })
    .first();
  await season.locator('.season').click();
  const row = season.locator('.events > li').filter({ hasText: found!.name }).first();
  await expect(row.locator('.badge')).toHaveText('Olympics');
});
