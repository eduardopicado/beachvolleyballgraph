import { describe, expect, it } from 'vitest';
import { readStored, writeStored } from './storage';

/** A store backed by a map, so a test can see what was written. */
function memory() {
  const map = new Map<string, string>();
  return {
    map,
    store: () => ({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }),
  };
}

/** What a browser that blocks site data does: the property itself throws. */
const blocked = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

describe('readStored / writeStored', () => {
  it('reads back what was written, and forgets it on null', () => {
    const { map, store } = memory();
    writeStored('theme', 'dark', store);
    expect(readStored('theme', store)).toBe('dark');
    writeStored('theme', null, store);
    expect(map.has('theme')).toBe(false);
    expect(readStored('theme', store)).toBeNull();
  });

  it('answers "nothing stored" when the browser will not hand over storage', () => {
    expect(readStored('theme', blocked)).toBeNull();
  });

  it('drops a write the browser refuses, rather than throwing it at the page', () => {
    expect(() => writeStored('theme', 'dark', blocked)).not.toThrow();
    expect(() => writeStored('theme', null, blocked)).not.toThrow();
  });
});
