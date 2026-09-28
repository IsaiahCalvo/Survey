import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ROW_MOTION, attachLoadoutTransition, attachRowCrossfade, playRowDrop, prefersReducedMotion,
} from '../utils/loadoutTransition.js';

/**
 * RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
 * drops down. Owner: row 2 was inconsistent — "sometimes you get a pan-in
 * animation, sometimes some type of morph". The w48 re-centre glide and the
 * w49 per-control grow / shrink are gone from row 2: when its set of controls
 * changes the whole row crossfades in place (attachRowCrossfade in
 * utils/loadoutTransition.js), already at its new centred spot, and an
 * unchanged set never animates. `holder` is row 2's settings holder, `layer`
 * its ghost layer (elements, from callback refs kept in state). Desktop only:
 * pass enabled=false on the phone.
 */
export function useRowCrossfade(holder, layer, enabled = true) {
  useEffect(() => {
    if (!enabled || !holder || !layer) return undefined;
    return attachRowCrossfade(holder, layer);
  }, [holder, layer, enabled]);
}

/**
 * RULED 2026-09-28 owner: row 3 "doesn't really need an animation, it just
 * needs to appear, e.g. come down from underneath the second bar". When the
 * Aa bar (`bar`, from a callback ref kept in state) appears it drops ~8px
 * down into place as it fades in (~150ms, ease-out); when it goes, a lifeless
 * copy of it goes back up the same way (~110ms) laid over the page where it
 * was — the live bar is already gone, so nothing below or around it waits or
 * moves (the w43 no-shift guarantee: row 3 lies over the page). A clip at its
 * top edge keeps it from ever drawing over row 2. It never moves sideways; a
 * re-centre just lands. Instant with prefers-reduced-motion; desktop only.
 * `slot` is row 3's slot (the copy is placed in it).
 */
export function useDropInRow(bar, slot, enabled = true) {
  const lastRef = useRef(null);
  const leavingRef = useRef(null); // { copy, animation }
  useLayoutEffect(() => {
    const last = lastRef.current;
    lastRef.current = bar;
    if (bar === last) return;
    leavingRef.current = playRowDrop(bar, last, slot, { enabled, previous: leavingRef.current });
  }, [bar, slot, enabled]);
  useEffect(() => () => { leavingRef.current?.copy?.remove?.(); }, []);
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

/**
 * Row 2 fading out in place: the reverse of its fade-in.
 * RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade) — it no
 * longer drifts up as it goes (w47's 5px), it just fades where it is.
 */
export const ROW_LEAVE_KEYFRAMES = Object.freeze([
  { opacity: 1 },
  { opacity: 0 },
]);

/**
 * RULED 2026-09-26 owner: fixed centred groups + animated loadouts (w47).
 * Row 2 LEAVES the way it arrives. When `shown` goes false the row stays
 * drawn (`leaving`) for ROW_MOTION.outMs while it fades out in place
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
      timer = setTimeout(() => setLeaving(false), ROW_MOTION.outMs);
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
        duration: ROW_MOTION.outMs, easing: ROW_MOTION.outEasing, fill: 'forwards',
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
