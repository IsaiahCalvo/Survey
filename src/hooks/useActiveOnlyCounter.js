/**
 * useActiveOnlyCounter - a request counter (bump to ask for something once)
 * that only the active tab's chrome hears.
 *
 * Every open tab keeps its own rails mounted (docs/TAB-SWITCHING.md), but the
 * shell has one counter per request ("open the Survey sheet"). A hidden rail
 * holds the value it last saw, and when its tab comes to the front it takes
 * the current count as its new starting point instead of acting on the bumps
 * that happened while another tab was in front.
 */
import { useRef } from 'react';

export function nextActiveOnlyCount(state, value, active) {
  const next = { ...state };
  if (active && !state.wasActive) next.base = value - state.seen;
  if (active) next.seen = value - next.base;
  next.wasActive = active;
  return next;
}

export default function useActiveOnlyCounter(value, active) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = { base: 0, seen: value, wasActive: active };
  ref.current = nextActiveOnlyCount(ref.current, value, active);
  return ref.current.seen;
}
