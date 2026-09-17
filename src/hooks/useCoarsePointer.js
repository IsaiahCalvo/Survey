import { useEffect, useState } from 'react';

/**
 * Is the primary pointer a finger / stylus rather than a mouse?
 *
 * Intended UX: touch targets grow on a coarse pointer (44 pt, Apple HIG) and
 * stay tight on a mouse (Drawboard PDF measures 34 x 34 for its handles on the
 * web, 2026-09-16). This hook is the one place that answers the question, so
 * every surface flips at the same moment — including when a laptop's window is
 * emulated to a phone or a 2-in-1 is folded into tablet mode.
 */
export const hasCoarsePointer = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches
);

export default function useCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(hasCoarsePointer);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarsePointer(coarseQuery.matches);
    update();
    coarseQuery.addEventListener?.('change', update);
    return () => coarseQuery.removeEventListener?.('change', update);
  }, []);
  return isCoarsePointer;
}
