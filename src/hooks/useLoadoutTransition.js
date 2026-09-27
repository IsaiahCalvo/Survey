import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LOADOUT_MOTION, attachLoadoutTransition, cancelRowSlide, prefersReducedMotion, rowMoveIsInstant, slideRow, swapSharedNothing,
} from '../utils/loadoutTransition.js';

/**
 * RULED 2026-09-27 owner: rows 2/3 centred, animated (w48). When `left` (the
 * row's planned start) changes while the row is on screen, the row GLIDES to
 * it (slideRow; see utils/loadoutTransition.js for the motion and why)
 * instead of snapping. `element` is what the plan positions (row 2's settings
 * holder, row 3's text bar); `row` is the bar itself, checked for arriving /
 * leaving and open popovers (rowMoveIsInstant); `targets(element)` lists what
 * to move (default: the element). The first spot a (new) element gets is
 * never animated. Desktop only: pass enabled=false on the phone.
 */
export function useRowSlide(element, left, { row = null, enabled = true, targets = null } = {}) {
  const lastRef = useRef({ element: null, left: null });
  useLayoutEffect(() => {
    const last = lastRef.current;
    lastRef.current = { element, left };
    if (!element || !Number.isFinite(left)) return;
    if (last.element !== element || !Number.isFinite(last.left)) return;
    const delta = last.left - left;
    if (Math.abs(delta) < 0.5) return;
    const list = targets ? targets(element) : [element];
    // RULED 2026-09-27 owner: morphing icons + one motion language (w49): a
    // row whose controls were ALL just replaced (Draw's colours → Shapes'
    // border and fill) has nothing to carry across, so it lands at its new
    // centre at once — the new controls grow in where they belong and the
    // old ones shrink out where they were; nothing slides in from the side.
    // A row that keeps some controls (Line → Arrow) still glides.
    if (!enabled || rowMoveIsInstant(row || element) || swapSharedNothing(element)) { cancelRowSlide(list); return; }
    slideRow(list, delta);
  }, [element, left, enabled, row, targets]);
}

/**
 * RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
 * RULED 2026-09-27 owner: morphing icons + one motion language (w49): shared
 * slots morph their icons / stay, extra ones grow in or shrink out.
 * Animates a tool-bar slot's contents whenever the set of controls in it
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
