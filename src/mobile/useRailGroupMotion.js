import { useEffect, useLayoutEffect, useRef } from 'react';
import { LOADOUT_MOTION, prefersReducedMotion } from '../utils/loadoutTransition.js';
import { morphPairsToWarm, planMorph } from '../utils/iconMorph.js';
import useLoadoutTransition from '../hooks/useLoadoutTransition.js';

/**
 * Owner 2026-10-01 (iPhone): "On desktop, we have this morph effect that
 * happens when you switch between annotation tool groups: an icon takes the
 * place of another icon, and new icons appear where no icons were. I would
 * like that same animation on iPhone ... in the left rail."
 *
 * The phone rail shows a group's tools in a strip under the Draw / Shapes /
 * Text icons. Switching group now runs the desktop tool bar's own motion
 * (utils/loadoutTransition.js, attachLoadoutTransition - the same code, not a
 * copy): slot 1, 2, 3... pair up by position, a tool icon in both sets MORPHS
 * into the new one in place (pen -> rectangle -> text box), a slot only in
 * the new set grows in from its centre, one only in the old set shrinks out.
 *
 * What the phone adds, because its strip is a box in a column rather than a
 * row with nothing after it: the strip's box (and the whole block, rule
 * included, when a group opens or closes) changes height over the SAME 200ms
 * with the SAME ease-in-out, so its border never snaps and the survey
 * category / entity strips below glide with it instead of jumping. Nothing
 * above the strip ever moves: Pan, Select and the group icons stay where they
 * are, open or closed. While it glides the block clips its contents, so a
 * tool shrinking out never draws over the strip below it.
 *
 * Instant with prefers-reduced-motion (attachLoadoutTransition is too).
 *
 * `wrap` is the block (rule + strip), `box` the strip's bordered box, `slot`
 * the column of tool chips inside it and `layer` the ghost layer laid over the
 * slot (all elements from callback refs kept in state). `groupKey` is the open
 * group (null when none is open).
 */
// The rail draws its tools at 17px where the desktop bar draws 16, and a
// morph is planned per glyph size, so the desktop's idle warm-up does not
// cover the phone: plan the phone's pairs while the page is idle, once.
let warmed = false;
function warmRailMorphs(glyphPx) {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  const queue = morphPairsToWarm();
  const later = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2000 }) : window.setTimeout(fn, 50));
  const step = () => {
    const pair = queue.shift();
    if (!pair) return;
    try { planMorph(pair[0], pair[1], { glyphPx }); } catch { /* planned on demand instead */ }
    later(step);
  };
  later(step);
}

const clippers = new WeakMap(); // element -> the glide that owns its clip

export default function useRailGroupMotion({ wrap, box, slot, layer, groupKey, glyphPx = 17, enabled = true }) {
  useLoadoutTransition(slot, layer, enabled);
  useEffect(() => { if (enabled) warmRailMorphs(glyphPx); }, [enabled, glyphPx]);

  const settledRef = useRef(null); // { key, wrapH, wrapMargin, boxH }
  const runningRef = useRef([]);

  useLayoutEffect(() => {
    if (!wrap || !box) return;
    const measure = () => {
      // `height` is set on the box below: take its border off only when it
      // sizes its content box.
      const style = window.getComputedStyle(box);
      const borders = style.boxSizing === 'border-box'
        ? 0
        : (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      return {
        wrapH: wrap.getBoundingClientRect().height,
        wrapMargin: parseFloat(window.getComputedStyle(wrap).marginTop) || 0,
        boxH: box.getBoundingClientRect().height - borders,
      };
    };
    const previous = settledRef.current;
    const running = runningRef.current.filter((animation) => animation.playState === 'running');
    // A glide caught mid-way starts from where it is drawn right now (its
    // animation still holds the box); a settled strip from where it settled.
    const from = running.length ? measure() : previous;
    runningRef.current.forEach((animation) => animation.cancel());
    runningRef.current = [];
    const to = measure();
    settledRef.current = { key: groupKey, ...to };
    if (!previous || previous.key === groupKey || !from) return;
    if (!enabled || prefersReducedMotion()) return;
    if (Math.abs(from.wrapH - to.wrapH) < 0.5 && Math.abs(from.boxH - to.boxH) < 0.5) return;

    const timing = { duration: LOADOUT_MOTION.durationMs, easing: LOADOUT_MOTION.easing };
    // Clip while gliding. A cancelled glide's event lands after the glide
    // that replaced it has started, so only the element's current glide may
    // lift the clip.
    const clipWhile = (element, animation) => {
      clippers.set(element, animation);
      element.style.overflow = 'clip';
      const restore = () => {
        if (clippers.get(element) !== animation) return;
        clippers.delete(element);
        element.style.overflow = '';
      };
      animation.addEventListener('finish', restore);
      animation.addEventListener('cancel', restore);
    };
    const wrapGlide = wrap.animate?.([
      { height: `${from.wrapH}px`, marginTop: `${from.wrapMargin}px` },
      { height: `${to.wrapH}px`, marginTop: `${to.wrapMargin}px` },
    ], timing);
    const boxGlide = box.animate?.([
      { height: `${Math.max(0, from.boxH)}px` },
      { height: `${Math.max(0, to.boxH)}px` },
    ], timing);
    if (wrapGlide) clipWhile(wrap, wrapGlide);
    if (boxGlide) clipWhile(box, boxGlide);
    runningRef.current = [wrapGlide, boxGlide].filter(Boolean);
  }, [wrap, box, groupKey, enabled]);

  useEffect(() => () => { runningRef.current.forEach((animation) => animation.cancel()); }, []);
}
