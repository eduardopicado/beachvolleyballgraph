/**
 * Links in, links out.
 *
 * The app has two ways of naming a view — the prerendered path
 * (`/brazil-men/`) and the older query form (`?country=BRA&gender=M`) — plus
 * two query parameters that survive alongside them (`?player=`, `?min=`). The
 * address bar is then rewritten to the canonical path on every state change,
 * and the `<link rel=canonical>`/`og:url` tags are rewritten with it.
 *
 * None of that is visible. A broken canonical tag renders a perfect page and
 * quietly tells search engines the wrong thing; a dropped `?player=` renders a
 * perfect page and quietly loses what someone shared. The smoke suite checks
 * the canonical tag in the *prerendered* HTML — these check what the app does
 * to it afterwards, which is the half that no static check can see.
 */

import { test, expect, graph, manifest, singleGenderCountry } from './fixtures.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sliceSlug, tournamentSlugs, TOURNAMENT_PREFIX } from '../web/src/lib/slug.js';
import type { Gender, TournamentsFile } from '../web/src/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const nameOf = (code: string) => {
  const entry = manifest().countries.find((c) => c.code === code);
  if (!entry) throw new Error(`${code} missing from the manifest`);
  return entry.name;
};

const slicePath = (code = COUNTRY, gender: 'M' | 'W' = GENDER) =>
  `${sliceSlug(nameOf(code), gender)}/`;

const head = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    title: document.title,
  }));

test.describe('deep links', () => {
  test('?player= opens that player’s card', async ({ page }) => {
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await page.goto(`./${slicePath()}?player=${target.id}`);
    await expect(page.locator('.player-card h2')).toHaveText(target.name);
  });

  test('?min= arrives with the control already set', async ({ page }) => {
    await page.goto(`./${slicePath()}?min=3`);
    const group = page.getByRole('group', { name: 'Min. events together' });
    await expect(group.getByRole('button', { name: '3+', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.key.filtered')).toContainText('3+ events together');
  });

  test('a min= with no matching button is ignored rather than applied silently', async ({ page }) => {
    // The control is a segmented group. Honouring ?min=7 would filter the
    // graph with no button showing it, so the page would be lying about its
    // own state — see lib/params.ts.
    await page.goto(`./${slicePath()}?min=7`);
    await expect(page.getByRole('group', { name: 'Min. events together' }).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.key.filtered')).toHaveCount(0);
  });

  test('both parameters survive together', async ({ page }) => {
    const g = graph(COUNTRY, GENDER);
    // Someone who still has a partnership at 3+, so the card and the filter
    // are not in conflict.
    const strong = g.edges.find((e) => e.t >= 3)!;
    await page.goto(`./${slicePath()}?min=3&player=${strong.a}`);
    await expect(page.locator('.player-card')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Min. events together' }).getByRole('button', { name: '3+', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the older ?country=&gender= form still resolves', async ({ page }) => {
    // Links shared before the prerendered paths existed. Cheap to keep
    // working, and there is no way to find out who still holds one.
    await page.goto(`./?country=${COUNTRY}&gender=W`);
    await expect(page.locator('.graph-section h2')).toContainText(nameOf(COUNTRY));
    await expect(page.locator('.graph-section h2')).toContainText('Women');
    // ...and is rewritten to the path that is actually indexed.
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/${sliceSlug(nameOf(COUNTRY), 'W')}/`);
  });

  test('a path the build never produced falls back instead of failing', async ({ page }) => {
    // Someone edits a URL, or a page is unpublished when a federation drops
    // below two players. The app should open on something, not on an error.
    await page.goto('./atlantis-men/');
    await expect(page.locator('.graph-section h2')).toBeVisible();
    await expect(page.locator('[data-node]').first()).toBeVisible();
  });
});

test.describe('the address bar', () => {
  test('picks up a selection and drops it again', async ({ page }) => {
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await page.goto(`./${slicePath()}`);
    expect(new URL(page.url()).search).toBe('');

    await page.locator(`[data-node="${target.id}"]`).click();
    await expect(page.locator('.player-card')).toBeVisible();
    // This is what a reader copies out of the address bar to share a player.
    await expect.poll(() => new URL(page.url()).searchParams.get('player')).toBe(String(target.id));

    await page.keyboard.press('Escape');
    await expect(page.locator('.player-card')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });

  test('records the threshold only when one is applied', async ({ page }) => {
    await page.goto(`./${slicePath()}`);
    const group = page.getByRole('group', { name: 'Min. events together' });

    await group.getByRole('button', { name: '2+', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('min')).toBe('2');

    // "All" is the default, so it is absent rather than spelled out — a
    // shared link should be the shortest thing that reproduces the view.
    await group.getByRole('button', { name: 'All', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has('min')).toBe(false);
  });

  test('does not add a history entry per click', async ({ page }) => {
    // replaceState, not pushState: selecting six players in a row and then
    // pressing Back should leave the site, not walk back through six cards.
    const nodes = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments);
    // Arrive from /about/, which never boots the app — so the entry behind us
    // is a fixed URL rather than one the app rewrites out from under the test.
    await page.goto('./about/');
    await page.goto(`./${slicePath()}`);

    for (const node of nodes.slice(0, 3)) {
      await page.locator(`[data-node="${node.id}"]`).click();
      await expect(page.locator('.player-card')).toBeVisible();
    }

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/about/');
  });
});

test.describe('the document head follows the view', () => {
  test('canonical and og:url track the slice, not the URL that was typed', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.goto(`./?country=${COUNTRY}&gender=${GENDER}`);

    await expect
      .poll(async () => (await head(page)).canonical)
      .toBe(`${origin}/${slicePath()}`);
    const { ogUrl, title } = await head(page);
    // og:url and canonical disagreeing is the classic way a share card ends
    // up pointing somewhere other than the page it previews.
    expect(ogUrl).toBe(`${origin}/${slicePath()}`);
    expect(title).toContain(nameOf(COUNTRY));
  });

  test('a selected player does not fork the canonical URL', async ({ page, baseURL }) => {
    // ?player= is a view of the same page, and the app deliberately keeps the
    // parameter in the canonical tag so a shared card resolves to the card.
    // Whatever the choice, canonical and og:url have to make the same one.
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await page.goto(`./${slicePath()}?player=${target.id}`);
    await expect(page.locator('.player-card')).toBeVisible();

    const { canonical, ogUrl } = await head(page);
    expect(canonical).toBe(ogUrl);
    expect(canonical).toContain(new URL(baseURL!).origin);
    expect(canonical).toContain(slicePath());
  });

  test('switching country rewrites the title and the canonical together', async ({ page }) => {
    await page.goto(`./${slicePath()}`);
    const before = await head(page);

    const other = manifest().countries.find((c) => c.code !== COUNTRY && c.genders[GENDER])!;
    await page.locator('.controls select').selectOption(other.code);
    await expect(page.locator('.graph-section h2')).toContainText(other.name);

    await expect.poll(async () => (await head(page)).title).not.toBe(before.title);
    const after = await head(page);
    expect(after.title).toContain(other.name);
    expect(after.canonical).toContain(sliceSlug(other.name, GENDER));
    expect(after.canonical).toBe(after.ogUrl);
  });
});

test.describe('a country published for one gender only', () => {
  test('switches to the gender it has instead of showing an empty graph', async ({ page }) => {
    const only = singleGenderCountry();
    expect(only, 'every published country has both genders').not.toBeNull();

    // Arrive asking for the gender that does not exist — which is what the
    // app's own default does for a women-only country.
    await page.goto(`./?country=${only!.code}&gender=${only!.missing}`);

    await expect(page.locator('.graph-section h2')).toContainText(only!.name);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/${sliceSlug(only!.name, only!.has)}/`);
    // Not merely a redirect: the slice it fell back to is drawn.
    await expect(page.locator('[data-node]').first()).toBeVisible();
    await expect(page.locator('[data-node]')).toHaveCount(graph(only!.code, only!.has).nodes.length);
  });

  test('the missing gender is offered as a disabled, empty option', async ({ page }) => {
    const only = singleGenderCountry();
    await page.goto(`./${sliceSlug(only!.name, only!.has)}/`);

    const genders = page.getByRole('group', { name: 'Gender' });
    const missing = genders.getByRole('button', { name: only!.missing === 'M' ? /^Men/ : /^Women/ });
    // Disabled rather than hidden: a control that vanishes between countries
    // moves everything beside it, and hides the fact that the answer is zero.
    await expect(missing).toBeDisabled();
    await expect(missing.locator('.tally')).toHaveText('0');
  });
});

/**
 * A tournament page with a played classification, found by scanning rather
 * than named. Any one will do: a full field is almost never entirely
 * unlinkable — measured archive-wide at 5 slots in 128,222 — so the first
 * played tournament with a slug is enough to find a linked pair on.
 */
function tournamentWithClassification(): { slug: string } | null {
  const tournaments = Object.values(
    (JSON.parse(readFileSync(path.join(DATA, 'tournaments.json'), 'utf8')) as TournamentsFile)
      .tournaments,
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  // Built over every tournament, exactly as the prerenderer does it — see
  // withdrawn.spec.ts and entry-links.spec.ts for why a slug computed over a
  // subset can name an address that was never written.
  const slugs = tournamentSlugs(tournaments, (t) => ({
    name: t[0] as string,
    season: t[1] as number,
    gender: t[8] as Gender,
    code: t[4] as string,
  }));
  const byCode = new Map<string, string>();
  for (const [t, slug] of slugs) byCode.set(t[4] as string, slug);

  for (const file of readdirSync(path.join(DATA, 'classifications'))) {
    const code = /^(.+)\.json$/.exec(file)?.[1];
    const slug = code && byCode.get(code);
    if (slug) return { slug };
  }
  return null;
}

/**
 * Following a link from a page the graph app does not itself render.
 *
 * `TournamentPage` and `App` are separate mounts (see `TournamentRoute`'s
 * header comment) — a classification name or an entry-list name does a full
 * `location.href` navigation, not client-side routing, because the graph the
 * reader lands in has to boot from scratch. That is invisible to a reader
 * right up until they close the profile they followed the link to: the app
 * only ever calls `history.replaceState` on its own address, so a plain
 * `setSelectedId(null)` left the browser's "back" pointing at the tournament
 * page while the card's own close button stranded the reader in the graph.
 */
test.describe('closing a profile opened from elsewhere', () => {
  const found = tournamentWithClassification();
  test.skip(!found, 'no published tournament has a classification');

  test('returns to the tournament page that linked here', async ({ page }) => {
    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    const tournamentUrl = page.url();

    // The classification is client-rendered — see withdrawn.spec.ts — so wait
    // for a real name link rather than the prerendered podium summary.
    const link = page.locator('.bands .pair button').first();
    await expect(link).toBeVisible();
    const name = (await link.textContent())!.trim();
    await link.click();

    // A full navigation, not a client-side transition: the address changes
    // to the player's own slice and the card opens on load.
    await expect(page.locator('.player-card h2')).toHaveText(name);
    expect(page.url()).not.toBe(tournamentUrl);

    await page.getByRole('button', { name: 'Close profile' }).click();
    await expect(page).toHaveURL(tournamentUrl);
  });

  test('the same, via Escape', async ({ page }) => {
    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    const tournamentUrl = page.url();

    await page.locator('.bands .pair button').first().click();
    await expect(page.locator('.player-card')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(tournamentUrl);
  });

  test('switching to someone else first means close just closes', async ({ page }) => {
    // The one-shot guard, and the reason this is not simply "go back if we
    // arrived with a player already selected": a reader who explores after
    // landing is browsing the graph on their own account, not continuing the
    // link that brought them here, and closing should leave them where they
    // are rather than walk them out of the app.
    await page.goto(`./${TOURNAMENT_PREFIX}/${found!.slug}/`);
    const tournamentUrl = page.url();

    await page.locator('.bands .pair button').first().click();
    await expect(page.locator('.player-card')).toBeVisible();
    const graphUrl = page.url();
    const arrivedId = new URL(graphUrl).searchParams.get('player');

    // A table row rather than a graph node: switching selection is the point
    // of this test, not surviving the force layout, and the table is a plain,
    // untransformed list — no settle-and-scroll dance to get a reliable click.
    const other = page.locator('.table-view tbody tr:not(.is-selected)').first();
    await expect(other).toBeVisible();
    await other.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('player'))
      .not.toBe(arrivedId);

    await page.getByRole('button', { name: 'Close profile' }).click();
    // Still in the graph — closing switched-to selection is an ordinary
    // deselect, not a walk back out through the link that brought us here.
    expect(new URL(page.url()).pathname).toBe(new URL(graphUrl).pathname);
    await expect(page.locator('.player-card')).toHaveCount(0);
  });
});
