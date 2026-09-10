import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelPortraitDwell,
  prefetchPortrait,
  prefetchPortraitOnDwell,
  resetPrefetchedPortraits,
} from './prefetchPortrait';
import { playerPhotoUrl } from '../schema';

/** Every `new Image()` this module makes, in order. */
let made: { src: string; fetchPriority?: string; decoding?: string }[] = [];

beforeEach(() => {
  made = [];
  vi.useFakeTimers();
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Comfortably past the dwell, without the test naming its exact length. */
const settle = () => vi.advanceTimersByTime(1000);

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

describe('prefetchPortraitOnDwell', () => {
  it('does not start anybody the moment the pointer arrives', () => {
    // The whole point: on a graph, arriving somewhere is not choosing it.
    prefetchPortraitOnDwell(169575);
    expect(made).toHaveLength(0);
  });

  it('starts them once they have been rested on', () => {
    prefetchPortraitOnDwell(169575);
    settle();
    expect(made).toHaveLength(1);
    expect(made[0]!.src).toBe(playerPhotoUrl(169575, 200));
  });

  it('starts nothing for players merely crossed on the way', () => {
    // A pointer travelling to one player over five others, none of them rested
    // on. Before the dwell this was six requests; sweeping USA-W's 423 nodes
    // was 2.4 MB against a 611 KB page.
    //
    // The 16ms is what makes this a test rather than a formality. Called with
    // no time in between, every crossing cancels the previous one before it
    // could have fired, so *any* non-negative dwell passes — including zero,
    // which is the bug this guards. A real pointer emits a move about every
    // frame, and the dwell has to outlast that gap.
    for (const id of [111111, 222222, 333333, 444444, 555555]) {
      prefetchPortraitOnDwell(id);
      vi.advanceTimersByTime(16);
    }
    prefetchPortraitOnDwell(169575);
    settle();
    expect(made.map((m) => m.src)).toEqual([playerPhotoUrl(169575, 200)]);
  });

  it('leaving before the dwell is up starts nobody at all', () => {
    prefetchPortraitOnDwell(169575);
    cancelPortraitDwell();
    settle();
    expect(made).toHaveLength(0);
  });

  it('holds the same player rather than restarting their wait', () => {
    // `onPointerMove` fires continuously while the pointer sits still, so
    // re-arming on each event would mean a resting pointer never dwells.
    for (let i = 0; i < 20; i++) {
      prefetchPortraitOnDwell(169575);
      vi.advanceTimersByTime(30);
    }
    expect(made).toHaveLength(1);
  });

  it('still costs one request when the pointer returns to someone', () => {
    prefetchPortraitOnDwell(169575);
    settle();
    prefetchPortraitOnDwell(144114);
    settle();
    prefetchPortraitOnDwell(169575);
    settle();
    expect(made).toHaveLength(2);
  });
});
