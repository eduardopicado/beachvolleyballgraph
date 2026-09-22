/**
 * The home page's "start here" strip.
 *
 * Three things fixtures cannot reach, so they are asserted against the running
 * page and the published manifest together:
 *
 * 1. The strip renders at the site root, with the names and figures the
 *    manifest holds — not names the component invented, and not a strip that
 *    silently rendered empty because `highlights` went missing from the tree.
 * 2. Clicking a card lands on that player, on their own page. Most cards name
 *    somebody outside Brazil men, which is the whole failure mode: setting the
 *    id without moving the slice leaves the card pointing at a player this
 *    graph has never heard of, and the reader gets nothing.
 * 3. It is a *home page* feature. A slice page is already about something and
 *    must not grow a strip of records above it.
 */

import { test, expect, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';
import { RECORD_LABEL } from '../shared/schema.js';

const m = manifest();
const cards = m.highlights ?? [];
const nameOf = (code: string) => m.countries.find((c) => c.code === code)?.name ?? code;

test.describe('the start here strip', () => {
  test.skip(cards.length === 0, 'the published manifest carries no highlights — run `npm run ingest`');

  test('renders every card the manifest publishes', async ({ page }) => {
    await page.goto('/');
    const strip = page.locator('.start-here');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.cards > li')).toHaveCount(cards.length);
  });

  test('names and figures come from the manifest, in its order', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.start-here .cards > li');
    for (const [i, card] of cards.entries()) {
      const row = items.nth(i);
      await expect(row.locator('.who')).toHaveText(card.who.map((w) => w.name).join(' & '));
      // The figure and its label together: "255" alone would pass against a
      // card that had picked up the wrong board's phrasing.
      await expect(row.locator('.stat')).toHaveText(
        `${card.value.toLocaleString('en-US')} ${RECORD_LABEL[card.key]}`,
      );
    }
  });

  test('a card opens its player on their own page', async ({ page }) => {
    // The last card, because the first few are Brazilian and the app already
    // opens on Brazil — a test that picked one of those would pass without the
    // slice ever having to move.
    const card = cards[cards.length - 1]!;
    const lead = card.who[0]!;
    const slug = sliceSlug(nameOf(lead.federation), card.gender);

    await page.goto('/');
    await page.locator('.start-here .cards > li').last().locator('a').click();

    await expect(page).toHaveURL(new RegExp(`/${slug}/\\?player=${lead.id}(&|$)`));
    await expect(page.locator('.player-card')).toContainText(lead.name);
  });

  test('every card is a real link before any script runs', async ({ page }) => {
    // The prerendered home page is what a crawler and a cold cache see. The
    // hrefs have to be right there, not assembled on click.
    await page.goto('/');
    for (const [i, card] of cards.entries()) {
      const lead = card.who[0]!;
      const slug = sliceSlug(nameOf(lead.federation), card.gender);
      await expect(page.locator('.start-here .cards > li').nth(i).locator('a')).toHaveAttribute(
        'href',
        new RegExp(`/${slug}/\\?player=${lead.id}$`),
      );
    }
  });

  test('does not appear on a slice page', async ({ page }) => {
    const brazil = m.countries.find((c) => c.code === 'BRA')!;
    await page.goto(`/${sliceSlug(brazil.name, 'M')}/`);
    await expect(page.locator('.graph-section')).toBeVisible();
    await expect(page.locator('.start-here')).toHaveCount(0);
  });
});
