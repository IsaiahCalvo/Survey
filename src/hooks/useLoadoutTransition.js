import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LOADOUT_MOTION, attachLoadoutTransition, prefersReducedMotion } from '../utils/loadoutTransition.js';

/**
 * RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
 * Crossfades a tool-bar slot's contents whenever the set of controls in it
 * changes (see utils/loadoutTransition.js for the motion and why). Takes the
 * slot and its ghost layer as ELEMENTS (from callback refs kept in state), so
 * it re-attaches if either is rebuilt. Desktop only: pass enabled=false on
 * the phone.
 */
export default function useLoadoutTransition(slot, layer, enabled = true) {
  useEffect(() => {
    if (!enabled || !slot || !layer) return undefined;
    return attachLoadoutTransition(slot, layer);
  }, [slot, layer, enabled]);
}

/** Row 2 fading up and away: the reverse of its 140ms drop-in. */
export const ROW_LEAVE_KEYFRAMES = Object.freeze([
  { opacity: 1, translate: '0 0' },
  { opacity: 0, translate: '0 -5px' },
]);

/**
 * RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
 * Row 2 LEAVES the way it arrives. When `shown` goes false the row stays
 * drawn (`leaving`) for LOADOUT_MOTION.rowOutMs while it fades up and out
 * (`fading`: the live settings hide and their copy fades with the row).
 *
 * Intended UX: never a blink. So
 *   - the fade starts only once the row is still unwanted on the next frame:
 *     a tool switch the viewer publishes in two steps (the new tool first,
 *     its settings a render later) can report "no settings" for one render,
 *     and that must not flash the row out and back;
 *   - if the row is wanted again mid-fade, the fade runs backwards from where
 *     it got to instead of the row popping out and dropping in again.
 * With prefers-reduced-motion the row goes at once. `row` is the row element
 * (the fade is a Web Animation on it, so it never restarts the row's CSS
 * drop-in).
 *
 * @returns {{ leaving: boolean, fading: boolean }}
 */
export function useLeavingRow(row, shown, enabled = true) {
  const [leaving, setLeaving] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    // Worked out during render (not in an effect) so the row is never dropped
    // for a frame before its fade starts.
    setWasShown(shown);
    setLeaving(!shown && enabled && !prefersReducedMotion());
  }
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!leaving) { setFading(false); return undefined; }
    let timer = null;
    const frame = requestAnimationFrame(() => {
      setFading(true);
      timer = setTimeout(() => setLeaving(false), LOADOUT_MOTION.rowOutMs);
    });
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [leaving]);

  // Fading only while still leaving: a row wanted again stops fading in the
  // same render, not an effect later.
  const active = fading && leaving;
  const animationRef = useRef(null);
  useLayoutEffect(() => {
    if (!row) return;
    const running = animationRef.current;
    if (active && !running) {
      animationRef.current = row.animate?.(ROW_LEAVE_KEYFRAMES, {
        duration: LOADOUT_MOTION.rowOutMs, easing: LOADOUT_MOTION.leaveEasing, fill: 'forwards',
      }) || null;
      return;
    }
    if (!active && running) {
      animationRef.current = null;
      if (shown && running.playState !== 'idle') {
        // Wanted again mid-fade: run back from where it got to.
        running.onfinish = () => running.cancel();
        running.reverse();
      } else {
        running.cancel();
      }
    }
  }, [row, active, shown]);

  return { leaving, fading: active };
}
