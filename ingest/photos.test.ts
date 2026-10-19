import { describe, expect, it } from 'vitest';
import { needsFetch, photosFromRows, splitImageResponses } from './photos.js';

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
