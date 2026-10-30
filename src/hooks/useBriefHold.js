/**
 * useBriefHold - a true that stays true for `ms` after it turns false.
 *
 * Owner note 2026-10-26 (item 38, "everything gets pushed and comes back"):
 * a pick that is swapped for another (Locate on page, a click from one Survey
 * Marker to the next) goes through a render with nothing picked. The survey
 * bar left for that render and came back, and the page under it moved down
 * and up. Held here for a moment, a gap that short never shows; a real
 * "nothing picked" still drops the bar once the hold runs out.
 *
 * Worked out during render (not in an effect), so the gap render itself
 * already sees the hold.
 */
import { useEffect, useRef, useState } from 'react';

export const BRIEF_HOLD_MS = 200;

/** Pure: whether `value` still counts as true at `now`, given when it was last true. */
export function resolveBriefHold(value, lastTrueAt, now, ms = BRIEF_HOLD_MS) {
  if (value) return true;
  return Number.isFinite(lastTrueAt) && now - lastTrueAt >= 0 && now - lastTrueAt < ms;
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useBriefHold(value, ms = BRIEF_HOLD_MS) {
  const lastTrueRef = useRef(-Infinity);
  const [, setTick] = useState(0);
  const now = clock();
  if (value) lastTrueRef.current = now;
  const held = !value && resolveBriefHold(false, lastTrueRef.current, now, ms);
  useEffect(() => {
    if (!held) return undefined;
    // Render again when the hold runs out, so a real drop still lands.
    const left = Math.max(0, ms - (clock() - lastTrueRef.current)) + 1;
    const timer = setTimeout(() => setTick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [held, ms]);
  return Boolean(value) || held;
}
