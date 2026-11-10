// @vitest-environment jsdom
/**
 * The three lazy-data hooks, rendered for real.
 *
 * Each is asked for one item, then a second. What these tests watch is every
 * render in between, not only where it settles: the bug they guard showed the
 * first item's data in the render that asked for the second, one painted
 * frame of the previous tournament's field under the new tournament's name.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  fetchClassification: vi.fn(),
  fetchEntries: vi.fn(),
  fetchResults: vi.fn(),
}));

import { fetchClassification, fetchEntries, fetchResults } from './api';
import { useClassification } from './useClassification';
import { useEntries } from './useEntries';
import { useResults } from './useResults';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders `hook(props)` and records what it returned on every render. */
function renderHook<P, R>(hook: (props: P) => R, props: NoInfer<P>) {
  const seen: { props: P; result: R }[] = [];
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const Probe = ({ p }: { p: P }) => {
    seen.push({ props: p, result: hook(p) });
    return null;
  };
  const render = (p: P) => act(() => root.render(createElement(Probe, { p })));
  return { seen, render, initial: render(props), unmount: () => act(() => root.unmount()) };
}

/** A promise that never settles: the second item is still on its way. */
const pending = () => new Promise<never>(() => {});

let cleanup: (() => Promise<void> | void) | null = null;
beforeEach(() => {
  vi.mocked(fetchClassification).mockReset();
  vi.mocked(fetchEntries).mockReset();
  vi.mocked(fetchResults).mockReset();
});
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('useClassification', () => {
  it('never shows one event under another event’s code', async () => {
    const first = { teams: [], players: {} } as never;
    vi.mocked(fetchClassification).mockImplementation((code) =>
      code === 'MAAA2026' ? Promise.resolve(first) : pending(),
    );
    const { seen, render, initial, unmount } = renderHook((code: string) => useClassification(code), 'MAAA2026');
    cleanup = unmount;
    await initial;
    await act(async () => {});
    expect(seen.at(-1)!.result).toEqual({ status: 'ready', data: first });

    await render('MBBB2026');
    const forSecond = seen.filter((s) => s.props === 'MBBB2026');
    expect(forSecond.length).toBeGreaterThan(0);
    for (const s of forSecond) expect(s.result).toEqual({ status: 'loading' });
  });
});

describe('useEntries', () => {
  it('never shows one entry list under another event’s code', async () => {
    const first = { teams: [] } as never;
    vi.mocked(fetchEntries).mockImplementation((code) =>
      code === 'MAAA2026' ? Promise.resolve(first) : pending(),
    );
    const { seen, render, initial, unmount } = renderHook((code: string | null) => useEntries(code), 'MAAA2026');
    cleanup = unmount;
    await initial;
    await act(async () => {});
    expect(seen.at(-1)!.result).toEqual({ status: 'ready', data: first });

    await render('MBBB2026');
    const forSecond = seen.filter((s) => s.props === 'MBBB2026');
    expect(forSecond.length).toBeGreaterThan(0);
    for (const s of forSecond) expect(s.result).toEqual({ status: 'loading' });

    // And null still means "not an entry-list event", not a state.
    await render(null);
    expect(seen.at(-1)!.result).toBeNull();
  });
});

describe('useResults', () => {
  it('never reads one slice’s results for another slice', async () => {
    const first = { results: { country: 'BRA' }, tournaments: {} } as never;
    vi.mocked(fetchResults).mockImplementation((country) =>
      country === 'BRA' ? Promise.resolve(first) : pending(),
    );
    const { seen, render, initial, unmount } = renderHook(
      (country: string) => useResults(country, 'W', true),
      'BRA',
    );
    cleanup = unmount;
    await initial;
    await act(async () => {});
    expect(seen.at(-1)!.result).toEqual({ status: 'ready', data: first });

    await render('USA');
    const forSecond = seen.filter((s) => s.props === 'USA');
    expect(forSecond.length).toBeGreaterThan(0);
    for (const s of forSecond) expect(s.result).toEqual({ status: 'loading' });
  });

  it('stays idle until wanted, and fetches nothing', async () => {
    const { seen, initial, unmount } = renderHook((wanted: boolean) => useResults('BRA', 'W', wanted), false);
    cleanup = unmount;
    await initial;
    expect(seen.every((s) => s.result.status === 'idle')).toBe(true);
    expect(fetchResults).not.toHaveBeenCalled();
  });
});
