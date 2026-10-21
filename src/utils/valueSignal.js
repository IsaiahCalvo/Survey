// A one-value store for useSyncExternalStore: set() notifies subscribers only
// when the value actually changes.
export function createValueSignal(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
