import { describe, expect, it } from 'vitest';
import { assertPopulated } from './main';

describe('assertPopulated', () => {
  const rows = (populated: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ country: i < populated ? 'CH' : null }));
  const has = (r: { country: string | null }) => r.country !== null;

  it('refuses to publish a field that came back empty on every row', () => {
    // The bug this exists for: `CountryCode` read by the code and missing from
    // the VIS request, so every row is null and nothing looks broken.
    expect(() => assertPopulated('country', rows(0, 1688), has)).toThrow(/0 of 1688/);
    expect(() => assertPopulated('country', rows(0, 1688), has)).toThrow(/asks for the field/);
  });

  it('passes a field populated on all but a handful', () => {
    // Eight tournaments legitimately have no usable country (quirks §25).
    expect(() => assertPopulated('country', rows(1680, 1688), has)).not.toThrow();
  });

  it('is a did-we-ask-for-it check, not a coverage target', () => {
    // Half populated is odd but not the failure this guards against, and a
    // genuinely sparse field should not be guarded here at all.
    expect(() => assertPopulated('country', rows(900, 1688), has)).not.toThrow();
    expect(() => assertPopulated('country', rows(100, 1688), has)).toThrow();
  });

  it('says nothing about an empty dataset, which the totals already guard', () => {
    expect(() => assertPopulated('country', [], has)).not.toThrow();
  });
});
