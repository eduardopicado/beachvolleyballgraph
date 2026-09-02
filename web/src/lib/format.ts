/** Small display helpers, kept pure so they can be unit-tested. */

/**
 * Builds a Unicode "emoji tag sequence" subdivision flag: the black flag base
 * followed by invisible tag characters spelling out the subdivision code,
 * terminated by the cancel tag. This is the mechanism behind England,
 * Scotland and Wales's flags — none of which have an ISO-3166-1 country code
 * of their own, since they aren't countries; FIVB still fields them as
 * separate federations.
 *
 * Support is real but narrower than regional-indicator flags: renders
 * correctly on Apple platforms and recent Android/Chrome, but on a font
 * without the sequence (older Windows, some Linux setups) the invisible tag
 * characters just vanish, leaving a plain black flag rather than a broken
 * glyph — a graceful, not broken, fallback.
 */
function subdivisionFlag(code: string): string {
  const TAG_BASE = 0xe0000;
  const CANCEL_TAG = 0xe007f;
  const BLACK_FLAG = 0x1f3f4;
  const tags = [...code.toLowerCase()].map((c) => String.fromCodePoint(TAG_BASE + c.charCodeAt(0)));
  return String.fromCodePoint(BLACK_FLAG) + tags.join('') + String.fromCodePoint(CANCEL_TAG);
}

/**
 * FIVB federation code -> subdivision code, for federations with no ISO
 * country code (see `subdivisionFlag`). Northern Ireland has no equivalent:
 * Unicode has never standardised a "gbnir" sequence, unlike gbeng/gbsct/gbwls
 * — its federation stays without a flag.
 */
const SUBDIVISION_CODES: Record<string, string> = {
  ENG: 'gbeng',
  SCO: 'gbsct',
  WAL: 'gbwls',
};

/**
 * Withdrawn ISO-3166-1 codes that FIVB federation records still carry,
 * mapped to the current code of whichever country now covers that
 * territory. `Intl.DisplayNames` resolves a *name* for these via CLDR's own
 * alias data (`AN` -> "Curaçao"), but building a flag is a raw, unvalidated
 * regional-indicator pair with no equivalent fallback — an unassigned pair
 * like AN commonly renders as two separate boxed letters instead of
 * collapsing into one flag glyph, which is what actually prompted this (it
 * reads as the country appearing twice). Confirmed AN/Curaçao is the only
 * federation in the published dataset carrying a withdrawn code.
 */
const WITHDRAWN_ISO2: Record<string, string> = {
  AN: 'CW', // Netherlands Antilles, dissolved 2010 -> Curaçao
};

/**
 * ISO-3166 alpha-2 -> flag emoji via regional indicator symbols, with a
 * federation-code fallback for the UK home nations (see `SUBDIVISION_CODES`),
 * none of which carry their own ISO code.
 */
export function flagEmoji(iso2: string | null | undefined, federationCode?: string): string {
  const subdivision = federationCode && SUBDIVISION_CODES[federationCode];
  if (subdivision) return subdivisionFlag(subdivision);
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return '';
  const code = WITHDRAWN_ISO2[iso2.toUpperCase()] ?? iso2;
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split('')
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Whole years from an ISO date to `now`. Null when the date is unusable. */
export function age(dob: string | null, now = new Date()): number | null {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) years--;
  return years >= 0 && years < 120 ? years : null;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2014" for a single season, "2014–2019" for a span. */
export function seasonSpan(first: number, last: number): string {
  return first === last ? String(first) : `${first}–${last}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1st", "2nd", "3rd", "4th" — including the 11th/12th/13th exceptions. */
export function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Day and month, for a result row where the season is already the heading. */
export function formatDayMonth(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * How a team finished, from FIVB's `Rank`.
 *
 * Positive is a placement, and a *shared* one: beach volleyball reports
 * brackets, so eight teams finish 9th and 89% of played rows sit on a rank
 * another team also holds. Shown as FIVB and every results site show it,
 * with the sharing spelled out in the long form rather than invented into a
 * "=9th" the source never says.
 *
 * Negative is elimination before the main draw. `<= -25` is qualification and
 * `-2` a confederation quota (docs/fivb-data-quirks.md §3); the eight rows
 * carrying anything else negative get the honest general case rather than a
 * guess at which of the two they are.
 */
export function formatFinish(rank: number): { text: string; label: string } {
  if (rank <= -25) return { text: 'Qual.', label: 'Eliminated in qualification' };
  if (rank === -2) return { text: 'Quota', label: 'Eliminated on a confederation quota' };
  if (rank < 0) return { text: '—', label: 'Did not reach the main draw' };
  if (rank === 1) return { text: ordinal(rank), label: 'Won the tournament' };
  return { text: ordinal(rank), label: `Finished ${ordinal(rank)}, a placement shared with other teams` };
}

interface MedalCounts {
  gold: number;
  silver: number;
  bronze: number;
}

/**
 * Compact tally like "🥇2 🥈1", omitting zero counts.
 *
 * A WORD JOINER (U+2060, zero-width and invisible) sits between each emoji
 * and its own count: without it, a narrow column can wrap the line right
 * between them -- the emoji ending one line and its count starting the
 * next, orphaned from what it's counting. The plain space between groups is
 * left breakable on purpose, so "🥇2 🥈1 🥉3" can still wrap between medal
 * kinds when the column is too narrow for all three.
 */
export function formatMedals({ gold, silver, bronze }: MedalCounts): string {
  const WORD_JOINER = '⁠';
  const parts: string[] = [];
  if (gold) parts.push(`${MEDALS[1]}${WORD_JOINER}${gold}`);
  if (silver) parts.push(`${MEDALS[2]}${WORD_JOINER}${silver}`);
  if (bronze) parts.push(`${MEDALS[3]}${WORD_JOINER}${bronze}`);
  return parts.join(' ');
}

/** Gold, silver, bronze, by the placement that earns each. */
const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/**
 * The medal for a placement, or `''` for a finish that earns none.
 *
 * Emoji rather than a colour, and that is the whole decision. Medal colours
 * measure 2.05 (gold), 1.77 (silver) and 3.06 (bronze) against the light card
 * surface, so as text they are unreadable there while being perfectly legible
 * on the dark one. Darkening them until they pass turns silver into #6f7275 —
 * plain grey, indistinguishable from the secondary text beside it — because
 * silver's whole identity is *being light*. These glyphs carry their own dark
 * outline and hold on either ground, which is why the vitals tiles have always
 * used them.
 *
 * Shares `MEDALS` with `formatMedals` deliberately: the tile counts the medals
 * and the timeline names them, so a reader meets both on one card and they must
 * not be able to drift apart.
 */
export function medalFor(rank: number): string {
  return MEDALS[rank] ?? '';
}

/** Screen-reader text for `formatMedals`'s emoji tally. */
export function medalAriaLabel({ gold, silver, bronze }: MedalCounts): string {
  const parts: string[] = [];
  if (gold) parts.push(plural(gold, 'gold medal'));
  if (silver) parts.push(plural(silver, 'silver medal'));
  if (bronze) parts.push(plural(bronze, 'bronze medal'));
  return parts.join(', ');
}
