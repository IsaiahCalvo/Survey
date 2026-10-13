import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but which always runs the latest
 * `handler` passed in. Hand it to a memoised child so the child does not
 * re-render just because the parent re-created an inline function.
 *
 * Only for event-style callbacks (clicks, changes, notifications). The latest
 * handler is installed before any layout effect runs, so it is current
 * whenever an event or effect calls it; do not call it during render.
 */
export default function useStableHandler(handler) {
  const latest = useRef(handler);
  useInsertionEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args) => latest.current?.(...args), []);
}
