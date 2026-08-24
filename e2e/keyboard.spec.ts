/**
 * Can the site be driven without a mouse?
 *
 * Two pieces of custom keyboard behaviour carry real logic and produce no
 * visual diff when they regress, which makes them the least likely things to
 * be noticed by hand and the most worth pinning:
 *
 *   - the player card's focus contract: focus moves *in* when a card opens,
 *     and back to whatever the reader came from when it closes. Get the second
 *     half wrong and focus silently drops to <body>, which for a keyboard user
 *     means starting the tab order again from the top of the page.
 *   - the search box is a combobox in the ARIA sense: real focus never leaves
 *     the input, and `aria-activedescendant` is what moves. A rewrite that
 *     "simplifies" it into focusable rows would still look and click
 *     identically while breaking the pattern entirely.
 *
 * These assert behaviour, not markup — which key does what, and where focus
 * ends up.
 */

import { test, expect, graph, manifest } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';

const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

/** What currently has focus, described well enough to assert on. */
const focused = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'BODY', label: '', inCard: false };
    return {
      tag: el.tagName,
      label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '',
      inCard: !!el.closest('.player-card'),
    };
  });

test.describe('player card focus', () => {
  test('opening a card moves focus into it, and closing gives it back', async ({ page }) => {
    await page.goto(`./${slicePath()}`);
    await expect(page.locator('.table-view tbody tr').first()).toBeVisible();

    // Come from the table rather than the graph: a real, identifiable element
    // to hand focus back to.
    const row = page.locator('.table-view tbody tr').first();
    await row.focus();
    const before = await focused(page);
    expect(before.inCard).toBe(false);

    await row.press('Enter');
    await expect(page.locator('.player-card')).toBeVisible();

    // Focus must land inside the card. Without this a keyboard reader presses
    // Enter, a panel appears elsewhere on the page, and their focus has not
    // moved — so nothing appears to have happened at all.
    await expect.poll(async () => (await focused(page)).inCard).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.player-card')).toHaveCount(0);

    // ...and back where it came from, not dropped to <body>, which is where
    // the browser sends it when the element holding focus is removed.
    const after = await focused(page);
    expect(after.tag, 'focus was dropped to the document body').not.toBe('BODY');
    expect(after.label).toBe(before.label);
  });

  test('a graph node opens a card with Enter', async ({ page }) => {
    // The nodes are SVG groups given button semantics by hand, so the keyboard
    // path through them is entirely ours and not the browser's.
    await page.goto(`./${slicePath()}`);
    const node = page.locator('[data-node]').first();
    await expect(node).toBeVisible();
    await node.focus();
    await node.press('Enter');
    await expect(page.locator('.player-card')).toBeVisible();
    await expect.poll(async () => (await focused(page)).inCard).toBe(true);
  });
});

test.describe('search combobox', () => {
  const box = (page: import('@playwright/test').Page) => page.getByPlaceholder('Start typing a name…');

  test('arrow keys move the active option while focus stays in the input', async ({ page }) => {
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await page.goto(`./${slicePath()}`);

    const input = box(page);
    await input.click();
    await input.fill(target.name.split(' ')[0]!);
    await expect(page.locator('.player-search-results .result').first()).toBeVisible();

    // The first hit is active without any key being pressed, so Enter alone
    // does the obvious thing.
    await expect(input).toHaveAttribute('aria-activedescendant', 'player-search-option-0');

    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'player-search-option-1');
    await expect(page.locator('#player-search-option-1')).toHaveAttribute('aria-selected', 'true');

    // Real focus never leaves the input — that is the whole combobox contract,
    // and what keeps the option rows out of the tab order.
    const where = await focused(page);
    expect(where.tag).toBe('INPUT');

    await input.press('ArrowUp');
    await expect(input).toHaveAttribute('aria-activedescendant', 'player-search-option-0');
  });

  test('Enter opens the active player and clears the box', async ({ page }) => {
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await page.goto(`./${slicePath()}`);

    const input = box(page);
    await input.click();
    await input.fill(target.name);
    await expect(page.locator('.player-search-results .result').first()).toBeVisible();
    await input.press('Enter');

    await expect(page.locator('.player-card h2')).toHaveText(target.name);
    // "Jump to" is a completed action, not a filter left standing.
    await expect(input).toHaveValue('');
    await expect(page.locator('.player-search-results')).toHaveCount(0);
  });

  test('Escape closes the list without selecting anything', async ({ page }) => {
    await page.goto(`./${slicePath()}`);
    const input = box(page);
    await input.click();
    await input.fill('a');
    await expect(page.locator('.player-search-results .result').first()).toBeVisible();

    await input.press('Escape');
    await expect(page.locator('.player-search-results')).toHaveCount(0);
    await expect(page.locator('.player-card')).toHaveCount(0);
    // The text survives — Escape dismisses the list, it does not undo typing.
    await expect(input).toHaveValue('a');
  });
});

/**
 * The portrait beside each search result.
 *
 * Two things worth pinning, both invisible to a passing build: that the
 * portrait does not push the row taller (the whole reason 32px was affordable
 * is that the two text lines already stand the row at ~40px), and that a
 * player with no photo on file still gets a circle rather than a gap. FIVB
 * 404s a large share of the archive, so the fallback is the common path, not
 * the edge case — and `fixtures.ts` stubs every portrait with a 200, which
 * means nothing exercises it unless a test asks for a failure on purpose.
 */
test.describe('search result portraits', () => {
  const box = (page: import('@playwright/test').Page) => page.getByPlaceholder('Start typing a name…');

  async function openResults(page: import('@playwright/test').Page, term: string) {
    await page.goto(`./${slicePath()}`);
    const input = box(page);
    await input.click();
    await input.fill(term);
    await expect(page.locator('.player-search-results .result').first()).toBeVisible();
  }

  test('every result carries a 32px portrait, and the row is no taller for it', async ({ page }) => {
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    await openResults(page, target.name.split(' ')[0]!);

    const rows = page.locator('.player-search-results .result');
    const count = await rows.count();
    expect(count, 'need results to assert on').toBeGreaterThan(0);
    // One avatar per row, no row left without one.
    await expect(page.locator('.player-search-results .avatar')).toHaveCount(count);

    const avatar = (await page.locator('.player-search-results .avatar').first().boundingBox())!;
    expect(Math.round(avatar.width)).toBe(32);
    expect(Math.round(avatar.height)).toBe(32);

    // The circle costs no height, and this is the assertion that says so
    // without hard-coding a row height: the two text lines are taller than the
    // avatar, so the row is sized by them and the avatar rides in space it
    // already had. Measured rather than assumed — the row is ~54px, not the
    // ~40px I first guessed, but the text column is ~40px and still wins.
    const who = (await page.locator('.player-search-results .who').first().boundingBox())!;
    expect(who.height).toBeGreaterThanOrEqual(avatar.height);
  });

  test('a player with no photo on file gets initials, not a hole', async ({ page }) => {
    const target = [...graph(COUNTRY, GENDER).nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;
    // Registered after the fixture's blanket stub, so it wins for this one
    // player: Playwright matches the most recently added route first.
    await page.route(`**://sharp.fivb.com/**No=${target.id}**`, (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'no photo' }),
    );

    await openResults(page, target.name.split(' ')[0]!);
    const row = page.locator('.player-search-results .result').filter({ hasText: target.name }).first();
    const fallback = row.locator('.avatar.is-fallback');
    await expect(fallback).toBeVisible();
    // Initials of the same name the row shows, so the circle still identifies
    // somebody rather than sitting there empty.
    await expect(fallback).not.toBeEmpty();
    const box2 = (await fallback.boundingBox())!;
    expect(Math.round(box2.width)).toBe(32);
  });
});
