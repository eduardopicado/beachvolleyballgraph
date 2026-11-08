/**
 * `localStorage` that may not be there.
 *
 * Merely reading `window.localStorage` throws a `SecurityError` when the
 * browser blocks site data — Chrome with cookies blocked, some embedded
 * webviews — and so does every call on it in a few private modes. The theme
 * toggle read it while `App` rendered, with nothing above it to catch the
 * error, so on those browsers React unmounted the whole tree and the graph
 * page went blank, prerendered table included.
 *
 * What is stored here is a preference. Not being able to remember it is not
 * worth a page: a read that fails answers "nothing stored", and a write that
 * fails is dropped.
 *
 * `store` is a getter rather than the object because the getter is what
 * throws.
 */

type Store = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browser: Store = () => window.localStorage;

export function readStored(key: string, store: Store = browser): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value` under `key`, or removes the key for `null`. */
export function writeStored(key: string, value: string | null, store: Store = browser): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // Remembered for this page only.
  }
}
