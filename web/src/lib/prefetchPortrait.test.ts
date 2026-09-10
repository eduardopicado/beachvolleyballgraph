import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchPortrait, resetPrefetchedPortraits } from './prefetchPortrait';
import { playerPhotoUrl } from '../schema';

/** Every `new Image()` this module makes, in order. */
let made: { src: string; fetchPriority?: string; decoding?: string }[] = [];

beforeEach(() => {
  made = [];
  resetPrefetchedPortraits();
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      fetchPriority?: string;
      decoding?: string;
      constructor() {
        made.push(this as never);
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('prefetchPortrait', () => {
  it('starts the card-sized portrait', () => {
    prefetchPortrait(169575);
    expect(made).toHaveLength(1);
    // 200, not the lightbox's 600: same time on a warm connection, ten times
    // the bytes, and most players opened are never magnified.
    expect(made[0]!.src).toBe(playerPhotoUrl(169575, 200));
  });

  it('asks for it at low priority, behind anything already on screen', () => {
    prefetchPortrait(169575);
    expect(made[0]!.fetchPriority).toBe('low');
  });

  it('starts a player only once, however often they are crossed', () => {
    // A pointer travelling over a dense graph re-enters the same node
    // repeatedly; without this each crossing would be a request.
    prefetchPortrait(169575);
    prefetchPortrait(169575);
    prefetchPortrait(169575);
    expect(made).toHaveLength(1);
  });

  it('starts each different player', () => {
    prefetchPortrait(169575);
    prefetchPortrait(144114);
    expect(made.map((m) => m.src)).toEqual([
      playerPhotoUrl(169575, 200),
      playerPhotoUrl(144114, 200),
    ]);
  });

  it('ignores an id that cannot name a player', () => {
    // The hit test can miss and a row can be mid-render; a request for
    // `No=0` is a round trip that can only 404.
    for (const id of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) prefetchPortrait(id);
    expect(made).toHaveLength(0);
  });
});
