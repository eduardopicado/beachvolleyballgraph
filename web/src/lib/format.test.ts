import { describe, expect, it } from 'vitest';
import {
  age,
  flagEmoji,
  formatDate,
  formatDayMonth,
  formatFinish,
  formatMedals,
  initials,
  medalAriaLabel,
  medalFor,
  ordinal,
  plural,
  seasonSpan,
} from './format';

describe('flagEmoji', () => {
  it('maps an ISO-2 code to regional indicators', () => {
    expect(flagEmoji('BR')).toBe('🇧🇷');
    expect(flagEmoji('no')).toBe('🇳🇴');
  });
  it('returns empty for anything that is not a two-letter code', () => {
    for (const bad of [null, undefined, '', 'BRA', 'B1']) expect(flagEmoji(bad)).toBe('');
  });

  it('builds a subdivision flag for the UK home nations, which have no ISO code', () => {
    // FIVB carries these with CountryCode "GB" (England/Scotland/N.Ireland,
    // ambiguous — three federations, one code) or the non-ISO "04" (Wales),
    // so iso2 alone can never distinguish them; the federation code can.
    const wales = flagEmoji(null, 'WAL');
    expect(wales).not.toBe('');
    expect(wales.codePointAt(0)).toBe(0x1f3f4); // waving black flag
    expect([...wales]).toHaveLength(7); // flag + 5 tag chars + cancel tag

    // Each home nation's sequence must be distinct, or they'd render identically.
    const england = flagEmoji('GB', 'ENG');
    const scotland = flagEmoji('GB', 'SCO');
    expect(new Set([wales, england, scotland]).size).toBe(3);
  });

  it('falls back to the plain UK flag for Northern Ireland — no distinct Unicode sequence exists', () => {
    // No override for NIR, so this falls through to the iso2 path. GB is a
    // valid (if ambiguous) code, so this is the UK flag, not nothing.
    expect(flagEmoji('GB', 'NIR')).toBe('🇬🇧');
  });

  it('a plain federation code with a real ISO code is unaffected', () => {
    expect(flagEmoji('BR', 'BRA')).toBe('🇧🇷');
  });

  it('aliases the withdrawn Netherlands Antilles code to Curaçao, lowercase included', () => {
    // FIVB still carries some federation records with the withdrawn "AN" code.
    // A raw regional-indicator pair for it is unassigned and commonly renders
    // as two separate boxed letters rather than one flag glyph — which reads
    // as the country appearing twice in a flag-prefixed list.
    expect(flagEmoji('AN')).toBe(flagEmoji('CW'));
    expect(flagEmoji('an')).toBe(flagEmoji('CW'));
  });
});

describe('age', () => {
  const now = new Date('2026-08-03T00:00:00Z');
  it('counts whole years', () => {
    expect(age('1996-08-02', now)).toBe(30);
    expect(age('1996-08-03', now)).toBe(30);
  });
  it('does not count a birthday that has not happened yet', () => {
    expect(age('1996-08-04', now)).toBe(29);
    expect(age('1996-12-31', now)).toBe(29);
  });
  it('returns null for missing or nonsense dates', () => {
    expect(age(null, now)).toBeNull();
    expect(age('not-a-date', now)).toBeNull();
    expect(age('1800-01-01', now)).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats an ISO date without shifting across time zones', () => {
    expect(formatDate('1973-04-15')).toBe('15 Apr 1973');
  });
  it('falls back to an em dash', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nope')).toBe('—');
  });
});

describe('seasonSpan', () => {
  it('collapses a single season', () => {
    expect(seasonSpan(2019, 2019)).toBe('2019');
  });
  it('renders a range with an en dash', () => {
    expect(seasonSpan(2002, 2016)).toBe('2002–2016');
  });
});

describe('initials', () => {
  it('takes the first and last initial', () => {
    expect(initials('Emanuel Rego')).toBe('ER');
    expect(initials('Anders Berntsen Mol')).toBe('AM');
  });
  it('handles a single name and blank input', () => {
    expect(initials('Karch')).toBe('K');
    expect(initials('   ')).toBe('?');
  });
});

describe('plural', () => {
  it('switches on count', () => {
    expect(plural(1, 'player')).toBe('1 player');
    expect(plural(2, 'player')).toBe('2 players');
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(0, 'entry', 'entries')).toBe('0 entries');
  });
});

describe('formatMedals', () => {
  it('omits zero counts', () => {
    expect(formatMedals({ gold: 2, silver: 0, bronze: 1 })).toBe('🥇⁠2 🥉⁠1');
    expect(formatMedals({ gold: 0, silver: 0, bronze: 0 })).toBe('');
  });

  it('joins an emoji to its own count with a WORD JOINER, not a space', () => {
    // U+2060: zero-width, but stops a line break from landing between an
    // emoji and its count and stranding them on separate lines. A plain
    // space here would be a real, visible gap -- wrong -- and the absence
    // of any joiner at all is the bug this guards against.
    const result = formatMedals({ gold: 3, silver: 0, bronze: 0 });
    expect(result).toBe('🥇⁠3');
    expect([...result]).toEqual(['🥇', '⁠', '3']);
  });

  it('still allows a break between different medal kinds', () => {
    // The space joining groups is a plain, breakable space -- three medal
    // kinds in a narrow column should be able to wrap between kinds, just
    // never inside one.
    const result = formatMedals({ gold: 1, silver: 1, bronze: 1 });
    expect(result).toContain(' ');
    expect(result.split(' ')).toHaveLength(3);
  });
});

describe('medalFor', () => {
  it('gives a medal to the podium and nothing to anyone else', () => {
    expect(medalFor(1)).toBe('🥇');
    expect(medalFor(2)).toBe('🥈');
    expect(medalFor(3)).toBe('🥉');
    for (const rank of [4, 5, 9, 17, 33]) expect(medalFor(rank)).toBe('');
  });

  it('gives nothing to the ranks that are not placements at all', () => {
    // Negative ranks are elimination codes, not finishes (quirks §3): -25 and
    // below is qualification, -2 is a confederation quota. A lookup that read
    // them as placements would decorate a first-round exit with a medal.
    for (const rank of [0, -2, -25, -33]) expect(medalFor(rank)).toBe('');
  });

  it('uses the same glyphs the vitals tile counts with', () => {
    // The tile says "🥇20" and the timeline names which twenty. A reader meets
    // both on one card, so they must not be able to drift apart — this fails
    // if either side is edited alone.
    const tally = formatMedals({ gold: 1, silver: 1, bronze: 1 });
    for (const rank of [1, 2, 3]) expect(tally).toContain(medalFor(rank));
  });
});

describe('medalAriaLabel', () => {
  it('spells out each nonzero medal count', () => {
    expect(medalAriaLabel({ gold: 3, silver: 0, bronze: 1 })).toBe('3 gold medals, 1 bronze medal');
    expect(medalAriaLabel({ gold: 0, silver: 0, bronze: 0 })).toBe('');
  });
});

describe('ordinal', () => {
  it('uses the right suffix for each final digit', () => {
    expect([1, 2, 3, 4, 5, 9].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th', '9th']);
  });

  it('handles the teens, which take "th" against their final digit', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });

  it('goes back to the digit rule past the teens', () => {
    // The real placement brackets: 17th, 21st, 25th, 33rd, 41st, 57th.
    expect([17, 21, 25, 33, 41, 57].map(ordinal)).toEqual([
      '17th',
      '21st',
      '25th',
      '33rd',
      '41st',
      '57th',
    ]);
  });

  it('handles 111 to 113, where only the last two digits decide', () => {
    expect([111, 112, 113].map(ordinal)).toEqual(['111th', '112th', '113th']);
  });
});

describe('formatFinish', () => {
  it('reads a win as a win', () => {
    expect(formatFinish(1)).toEqual({ text: '1st', label: 'Won the tournament' });
  });

  it('says a placement is shared, because 89% of them are', () => {
    // Beach volleyball reports brackets: eight teams finish 9th. The number
    // is FIVB's own and is shown as-is; the sharing goes in the long form
    // rather than into an "=9th" the source never says.
    expect(formatFinish(9).text).toBe('9th');
    expect(formatFinish(9).label).toContain('shared');
  });

  it('names the two kinds of elimination before the main draw', () => {
    expect(formatFinish(-25).text).toBe('Qual.');
    expect(formatFinish(-33).text).toBe('Qual.');
    expect(formatFinish(-2)).toEqual({
      text: 'Quota',
      label: 'Eliminated on a confederation quota',
    });
  });

  it('does not guess at the handful of other negatives', () => {
    // -4 turns up on eight rows from 2015 and is documented nowhere. The
    // honest general case beats picking one of the two labels above.
    expect(formatFinish(-4)).toEqual({ text: '—', label: 'Did not reach the main draw' });
  });
});

describe('formatDayMonth', () => {
  it('drops the year, which the season heading already carries', () => {
    expect(formatDayMonth(new Date('2024-07-28T00:00:00Z'))).toBe('28 Jul');
  });

  it('reads the date in UTC, not the viewer’s zone', () => {
    // Dates are reconstructed from a UTC day offset. Formatting them locally
    // would move an event to the previous day for anyone west of Greenwich.
    expect(formatDayMonth(new Date('2024-01-01T00:00:00Z'))).toBe('1 Jan');
  });

  it('is null for no date and for an unparseable one', () => {
    expect(formatDayMonth(null)).toBeNull();
    expect(formatDayMonth(new Date('nonsense'))).toBeNull();
  });
});
