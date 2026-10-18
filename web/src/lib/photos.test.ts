import { describe, expect, it } from 'vitest';
import { formatTaken } from './photos';

describe('formatTaken', () => {
  it('reads the time FIVB recorded, without converting it', () => {
    expect(formatTaken('2019-07-14T17:28')).toBe('14 Jul 2019, 17:28');
    expect(formatTaken('2008-01-03T09:05:00')).toBe('3 Jan 2008, 09:05');
    expect(formatTaken('2012-12-31T23:59')).toBe('31 Dec 2012, 23:59');
  });

  it('says nothing for a missing or partial time', () => {
    expect(formatTaken(null)).toBeNull();
    expect(formatTaken('')).toBeNull();
    expect(formatTaken('2019-07-14')).toBeNull();
  });
});
