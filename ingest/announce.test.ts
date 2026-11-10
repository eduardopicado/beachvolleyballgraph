import { describe, expect, it } from 'vitest';
import { ANNOUNCE_MAX, announcement, dateRange, mdText } from './announce.js';
import type { TournamentMeta } from '../shared/schema.js';

const NOW = new Date('2026-10-30T12:00:00Z');
const page = (slug: string) => `https://example.org/tournament/${slug}/`;
const always = () => true;

// [name, season, tier, opening day offset, code, level, country, span, gender]
const row = (name: string, code: string, gender: 'M' | 'W', offset: number | null = 19): TournamentMeta => [
  name,
  2027,
  'beach-pro-tour',
  offset,
  code,
  'Elite16',
  'AE',
  4,
  gender,
];

const before: Record<string, TournamentMeta> = {
  '9100': row('BPT Elite16 Doha', 'MDOH2027', 'M', 40),
};

describe('announcement', () => {
  it('says nothing when the refresh added nothing', () => {
    expect(announcement(before, before, always, page, NOW)).toBe('');
  });

  it('never lists a tournament the last refresh already had, even one that changed', () => {
    const changed = { '9100': row('BPT Elite16 Doha (moved)', 'MDOH2027', 'M', 50) };
    expect(announcement(before, changed, always, page, NOW)).toBe('');
  });

  it('puts both draws of a new event on one line, men first, each linked to its page', () => {
    // The women's draw has the lower number, so the file lists it first.
    const after = {
      ...before,
      '9201': row('Beach World Series Dubai', 'WDUB2027', 'W'),
      '9202': row('Beach World Series Dubai', 'MDUB2027', 'M'),
    };
    expect(announcement(before, after, always, page, NOW)).toBe(
      [
        '**2 new tournaments** on the FIVB calendar since the last refresh:',
        '',
        '- **Beach World Series Dubai 2027** ([men](https://example.org/tournament/beach-world-series-dubai-2027-men/), [women](https://example.org/tournament/beach-world-series-dubai-2027-women/)) · 20–24 Jan 2027 · Elite16 · United Arab Emirates',
        '',
      ].join('\n'),
    );
  });

  it('orders events by their opening day, undated ones last', () => {
    const after = {
      ...before,
      '1': row('Late', 'MLAT2027', 'M', 200),
      '2': row('Undated', 'MUND2027', 'M', null),
      '3': row('Early', 'MEAR2027', 'M', 5),
    };
    const names = [...announcement(before, after, always, page, NOW).matchAll(/^- \*\*(\w+)/gm)].map((m) => m[1]);
    expect(names).toEqual(['Early', 'Late', 'Undated']);
    expect(announcement(before, after, always, page, NOW)).toContain(
      '**Undated 2027** ([men](https://example.org/tournament/undated-2027-men/)) · dates not published yet · Elite16',
    );
  });

  it('lists a new row the index has no page for, without a link', () => {
    // An event long finished with no result: the index leaves it out, so
    // nothing is written at the address a link would point to.
    const backfilled: TournamentMeta = ['Old Open', 2005, 'world-tour', 100, 'MOLD2005', 'Open', 'IT', 4, 'M'];
    const out = announcement(before, { ...before, '500': backfilled }, () => false, page, NOW);
    expect(out).toContain('- **Old Open 2005** (men) · ');
    expect(out).not.toContain('](');
  });

  it('counts rather than lists past the limit', () => {
    const after: Record<string, TournamentMeta> = { ...before };
    for (let i = 0; i < ANNOUNCE_MAX + 2; i++) after[String(i)] = row(`Event ${String(i).padStart(2, '0')}`, `M${i}X2027`, 'M', i);
    const out = announcement(before, after, always, page, NOW);
    expect(out.match(/^- \*\*/gm)).toHaveLength(ANNOUNCE_MAX);
    expect(out).toContain(`**${ANNOUNCE_MAX + 2} new tournaments**`);
    expect(out).toContain('- …and 2 more events, in the tournament index.');
  });

  it('keeps a name from FIVB from breaking the list or pinging anyone', () => {
    const after = { ...before, '7': row('Cup [final] @fivb', 'MCUP2027', 'M') };
    const out = announcement(before, after, always, page, NOW);
    expect(out).toContain('**Cup \\[final\\] @\u200bfivb 2027**');
    expect(out).not.toMatch(/@fivb/);
  });
});

describe('mdText', () => {
  it('escapes what would change the Markdown, and leaves letters alone', () => {
    expect(mdText('a*b_c`d|e<f>')).toBe('a\\*b\\_c\\`d\\|e\\<f\\>');
    expect(mdText('João Pessoa')).toBe('João Pessoa');
  });
});

describe('dateRange', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  it('says the month and year once when the event stays inside them', () => {
    expect(dateRange(d('2027-01-20'), d('2027-01-24'))).toBe('20–24 Jan 2027');
  });

  it('names both months across a month end, and both years across a year end', () => {
    expect(dateRange(d('2027-02-28'), d('2027-03-03'))).toBe('28 Feb – 3 Mar 2027');
    expect(dateRange(d('2026-12-30'), d('2027-01-02'))).toBe('30 Dec 2026 – 2 Jan 2027');
  });

  it('is one date for a one-day event', () => {
    expect(dateRange(d('2027-09-01'), d('2027-09-01'))).toBe('1 Sep 2027');
  });
});
