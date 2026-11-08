/**
 * State that belongs to one `key`, and starts over when the key changes.
 *
 * The pattern this replaces was an effect, `useEffect(() => setX(initial),
 * [key])`, and it is one render late: the render that changes the key still
 * shows the previous key's value, and that render is painted. A search box
 * highlighted an option index from the previous query's list; a player card
 * drew the previous player's open seasons under the new player's name, for one
 * frame. `useClassification` fixed the same thing for fetched data by holding
 * the answer with the code it answers; this is that, for state a component owns.
 *
 * The reset happens during render, which React supports for exactly this —
 * adjusting state when an input changes: the render that sees a new key
 * discards itself and re-renders with the fresh value before anything is
 * committed. Guarded by the key, so it runs once per change, never in a loop.
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

export function useStateFor<K, V>(key: K, initial: (key: K) => V): [V, Dispatch<SetStateAction<V>>] {
  const [held, setHeld] = useState(() => ({ key, value: initial(key) }));

  let current = held;
  if (!Object.is(held.key, key)) {
    current = { key, value: initial(key) };
    setHeld(current);
  }

  // Stable for the component's life, like useState's own setter. It writes
  // against whichever key is held when it runs, so an answer arriving late for
  // a previous key must be dropped by its caller, as the fetch effects already
  // do with their `cancelled` flags.
  const set = useCallback<Dispatch<SetStateAction<V>>>(
    (action) =>
      setHeld((h) => ({
        key: h.key,
        value: typeof action === 'function' ? (action as (prev: V) => V)(h.value) : action,
      })),
    [],
  );

  return [current.value, set];
}
