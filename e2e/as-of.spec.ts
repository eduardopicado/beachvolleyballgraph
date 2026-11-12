/**
 * "Data as of" names the day the archive was rebuilt, in UTC, wherever the
 * reader is.
 *
 * It was formatted in the reader's own time zone. The refresh lands in the
 * afternoon UTC, so for much of Asia and the Pacific the graph page said the
 * next day, while the About page, which formats in UTC, said the right one.
 */

import { test, expect, manifest } from './fixtures.js';
import { sliceSlug } from '../shared/slug.js';
import { DEFAULT_COUNTRY, DEFAULT_GENDER } from '../shared/site.js';

const generated = new Date(manifest().generatedAt);
// A zone whose calendar day differs from UTC's at this timestamp: fourteen
// hours ahead from 10:00 UTC on, eleven behind before 11:00. Between them they
// cover every hour, so the test checks something whatever time the data was
// built.
const zone = generated.getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';

test.use({ timezoneId: zone });

test(`shows the UTC day, not the reader's (${zone})`, async ({ page }) => {
  const country = manifest().countries.find((c) => c.code === DEFAULT_COUNTRY)!;
  await page.goto(`./${sliceSlug(country.name, DEFAULT_GENDER)}/`);
  // Guard the guard: in this zone the local day really is another day.
  const localDay = await page.evaluate((iso) => new Date(iso).getDate(), manifest().generatedAt);
  expect(localDay).not.toBe(generated.getUTCDate());

  await expect(page.locator('.as-of time')).toHaveText(
    new RegExp(`^${generated.getUTCDate()} \\S+ ${generated.getUTCFullYear()}$`),
  );
});
