import { describe, expect, it } from 'vitest';
import { SERIES, seriesFor } from './series';

const of = (code: string, tier: Parameters<typeof seriesFor>[0]['tier']) =>
  seriesFor({ code, tier });

describe('seriesFor', () => {
  it('puts a tournament in no series by default', () => {
    // The ordinary case: 87% of the archive is a tour week belonging to
    // nothing recurring that this project has defined.
    expect(of('MADE2008', 'world-tour')).toEqual([]);
    expect(of('WBUS2026', 'beach-pro-tour')).toEqual([]);
  });

  it('derives the Olympics and the World Championships from the tier', () => {
    expect(of('MPAR2024', 'olympics')).toEqual(['olympics']);
    expect(of('WHAM2019', 'world-champs')).toEqual(['world-championships']);
  });

  it('matches Gstaad on its code, which survived the rebrand', () => {
    // The name went from "Gstaad" to "BPT Elite16 Gstaad" when the tour was
    // renamed; a name match would have split the series in two.
    expect(of('MGST2002', 'world-tour')).toEqual(['gstaad']);
    expect(of('WGST2026', 'beach-pro-tour')).toEqual(['gstaad']);
  });

  it('puts Gstaad 2007 in two series, because it was the World Championships', () => {
    expect(of('MGST2007', 'world-champs')).toEqual(['world-championships', 'gstaad']);
    expect(of('WGST2007', 'world-champs')).toEqual(['world-championships', 'gstaad']);
  });

  it('enumerates the Rio Open rather than matching its code', () => {
    // The whole reason it is a list: `?RIO` is not a Rio de Janeiro marker
    // once the original run ends.
    expect(of('MRIO1987', 'world-tour')).toEqual(['rio-open']);
    expect(of('WRIO1998', 'world-tour')).toEqual(['rio-open']);
  });

  it('keeps Salvador, Itapema and Uberlandia out of the Rio Open', () => {
    // These carry `?RIO` codes and are other Brazilian cities. A code match
    // would have folded three venues into the series.
    expect(of('MRIO2005', 'world-tour')).toEqual([]);
    expect(of('MRIO2018', 'beach-pro-tour')).toEqual([]);
    expect(of('MRIO2022', 'beach-pro-tour')).toEqual([]);
  });

  it('does not match a code that merely contains GST or RIO', () => {
    expect(of('MAGST2019', 'world-tour')).toEqual([]);
    expect(of('MGST20191', 'world-tour')).toEqual([]);
  });

  it('every series in SERIES has a distinct slug', () => {
    expect(new Set(SERIES.map((s) => s.slug)).size).toBe(SERIES.length);
  });
});
