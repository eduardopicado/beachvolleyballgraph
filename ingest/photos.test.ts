import { describe, expect, it } from 'vitest';
import { needsFetch, photosFromRows, refreshLists, splitImageResponses } from './photos.js';

describe('photosFromRows', () => {
  it("puts FIVB's slideshow picks first, each group in the order it was taken", () => {
    const photos = photosFromRows([
      { No: '30', Title: 'Warm-up', TakenDT: '2019-07-14T09:00:00', InSlideShow: '0' },
      { No: '20', Title: 'Final', TakenDT: '2019-07-14T17:28:00', InSlideShow: '1' },
      { No: '10', Title: 'Opening', TakenDT: '2019-07-10T10:00:00', InSlideShow: '0' },
      { No: '40', Title: 'Semi', TakenDT: '2019-07-13T15:00:00', InSlideShow: '1' },
    ]);
    expect(photos.map((p) => p[0])).toEqual([40, 20, 10, 30]);
    expect(photos[1]).toEqual([20, 'Final', '2019-07-14T17:28', 1]);
  });

  it('sorts an undated photograph last within its group, ties by number', () => {
    const photos = photosFromRows([
      { No: '7', TakenDT: '', InSlideShow: '0' },
      { No: '5', TakenDT: '2019-07-14T09:00:00', InSlideShow: '0' },
      { No: '6', InSlideShow: '0' },
    ]);
    expect(photos.map((p) => [p[0], p[2]])).toEqual([
      [5, '2019-07-14T09:00'],
      [6, null],
      [7, null],
    ]);
  });

  it('drops a row without a usable image number, and trims the caption', () => {
    const photos = photosFromRows([{ No: '' }, { No: '0' }, { No: 'x' }, { No: '1.5' }, { No: '9', Title: '  Gstaad  ' }]);
    expect(photos).toEqual([[9, 'Gstaad', null, 0]]);
  });
});

describe('splitImageResponses', () => {
  it('gives one body per request, empty lists included, in order', () => {
    const body =
      '<Responses><Images Version="1"><Image No="1"/><Image No="2"/></Images><Images Version="1"/><Images Version="1"><Image No="3"/></Images></Responses>';
    const parts = splitImageResponses(body, 3);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('No="2"');
    expect(parts[1]).not.toContain('<Image ');
    expect(parts[2]).toContain('No="3"');
  });

  it('refuses a response that does not answer every request', () => {
    // Positions are the only key: one list short would give every later
    // tournament its neighbour's photographs.
    expect(() => splitImageResponses('<Responses><Images/><Images/></Responses>', 3)).toThrow(/Expected 3/);
    expect(() => splitImageResponses('<faultstring>busy</faultstring>', 1)).toThrow(/got 0/);
  });
});

describe('needsFetch', () => {
  const now = new Date('2026-10-18T00:00:00Z');
  const at = (days: number) => ({ at: new Date(now.getTime() - days * 86_400_000).toISOString(), photos: [] });

  it('asks again for what is missing or older than 90 days, and only that', () => {
    const cache = { FRESH: at(89), EDGE: at(90), STALE: at(91) };
    expect(needsFetch(['FRESH', 'EDGE', 'STALE', 'NEW'], cache, now)).toEqual(['STALE', 'NEW']);
  });
});

describe('refreshLists', () => {
  // Two batches: VIS asks for 25 lists at a time.
  const codes = Array.from({ length: 30 }, (_, i) => `M${String(i).padStart(3, '0')}2019`);
  const noByCode = new Map(codes.map((c, i) => [c, String(1000 + i)]));
  /** One `<Images>` per request in the document, each holding one photograph. */
  const answer = (xml: string) =>
    [...xml.matchAll(/NoTournament="(\d+)"/g)]
      .map(([, no]) => `<Images><Image No="${no}" Title="" TakenDT="" InSlideShow="0"/></Images>`)
      .join('');
  const options = { pauseMs: 0, now: () => new Date('2026-11-08T00:00:00Z') };

  it('fills the cache from every batch VIS answers', async () => {
    const cache = {};
    const saves: number[] = [];
    const result = await refreshLists(codes, noByCode, cache, {
      ...options,
      fetch: async (xml) => answer(xml),
      save: async (c) => void saves.push(Object.keys(c).length),
    });
    expect(result).toEqual({ fetched: 30, error: null });
    expect(Object.keys(cache)).toHaveLength(30);
    expect(saves).toEqual([25, 30]);
  });

  it('hands back a VIS failure instead of throwing, keeping what it already had', async () => {
    const old = { at: '2026-01-01T00:00:00.000Z', photos: [[7, 'Kept', null, 0] as [number, string, null, 0]] };
    const cache: Record<string, typeof old> = { [codes[29]!]: old };
    let calls = 0;
    const down = new Error('VIS responded 503 Service Unavailable');
    const result = await refreshLists(codes, noByCode, cache, {
      ...options,
      fetch: async (xml) => {
        if (++calls === 2) throw down;
        return answer(xml);
      },
    });
    expect(result).toEqual({ fetched: 25, error: down });
    // The first batch landed; the second never arrived.
    expect(cache[codes[0]!]!.at).toBe('2026-11-08T00:00:00.000Z');
    expect(cache[codes[25]!]).toBeUndefined();
    // A stale list in the failed batch keeps its old copy rather than going blank.
    expect(cache[codes[29]!]).toBe(old);
  });

  it('treats an answer that skips a request as a failure too', async () => {
    const cache = {};
    const result = await refreshLists(codes.slice(0, 3), noByCode, cache, {
      ...options,
      fetch: async () => '<Images></Images>',
    });
    expect(result.fetched).toBe(0);
    expect(String(result.error)).toMatch(/Expected 3 image lists/);
    expect(cache).toEqual({});
  });
});
