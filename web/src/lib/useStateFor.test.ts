// @vitest-environment jsdom
/**
 * `useStateFor`, rendered for real, every render recorded — the bug it exists
 * for lived in one intermediate render, so the assertions are about all of
 * them, not about where things settle.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useStateFor } from './useStateFor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function harness<K, V>(initial: (key: K) => V, first: K) {
  const seen: { key: K; value: V }[] = [];
  let setter: ((action: V | ((prev: V) => V)) => void) | null = null;
  const setters = new Set<unknown>();
  const Probe = ({ k }: { k: K }) => {
    const [value, set] = useStateFor(k, initial);
    seen.push({ key: k, value });
    setter = set;
    setters.add(set);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  const render = (k: K) => act(() => root.render(createElement(Probe, { k })));
  render(first);
  return {
    seen,
    render,
    set: (action: V | ((prev: V) => V)) => act(() => setter!(action)),
    setters,
  };
}

describe('useStateFor', () => {
  it('keeps a value across renders with the same key', () => {
    const h = harness<string, string>((k) => `start:${k}`, 'a');
    h.set('changed');
    h.render('a');
    expect(h.seen.at(-1)).toEqual({ key: 'a', value: 'changed' });
  });

  it('starts over from the render that changes the key, never showing the old value under it', () => {
    const h = harness<string, string>((k) => `start:${k}`, 'a');
    h.set('changed');
    h.render('b');
    // Every render that saw key b saw b's value. The effect it replaces
    // rendered { key: 'b', value: 'changed' } once before resetting.
    const forB = h.seen.filter((r) => r.key === 'b');
    expect(forB.length).toBeGreaterThan(0);
    expect(forB.every((r) => r.value === 'start:b')).toBe(true);
  });

  it('computes the fresh value from the new key', () => {
    const h = harness<number[], number>((k) => (k.length > 0 ? 0 : -1), [1, 2]);
    h.set(1);
    h.render([]);
    expect(h.seen.at(-1)!.value).toBe(-1);
  });

  it('applies an updater to the current value', () => {
    const h = harness<string, number>(() => 1, 'a');
    h.set((n) => n + 1);
    h.set((n) => n + 1);
    expect(h.seen.at(-1)!.value).toBe(3);
  });

  it('keeps one setter for the life of the component', () => {
    const h = harness<string, number>(() => 0, 'a');
    h.render('b');
    h.render('c');
    expect(h.setters.size).toBe(1);
  });
});
