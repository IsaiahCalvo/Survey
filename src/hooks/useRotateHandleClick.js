/**
 * useRotateHandleClick — a CLICK on the rotate grabber opens the angle box.
 *
 * Intended UX (Drawboard canvas audit 2026-10-13, chunk 5): pressing the
 * rotate grabber and letting go without dragging (Drawboard: "click, no drag,
 * on the rotate button") puts the caret in the angle box with its number
 * selected, so you can type an exact angle straight away. Dragging the
 * grabber still rotates, exactly as before; a press that travels past the
 * shape-drag threshold (6 px mouse / pen, 10 px finger — utils/dragThreshold)
 * at any point is a drag, even if it comes back to where it started.
 *
 * The box is shown inside the release handler (flushSync renders it) and
 * focused there for a mouse, or in the click that ends a finger's tap: iOS
 * only raises the on-screen keyboard for a focus made in a user gesture, so a
 * focus deferred to a later frame would leave a phone with a focused box and
 * no keyboard.
 *
 * Listens on the page's own <svg> (capture, so the grabber's stopPropagation
 * cannot hide the press) and on window for the release (the rotate drag
 * captures the pointer). Reads nothing from React state, so it never
 * re-attaches during a gesture.
 */
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { hasPassedShapeDragThreshold } from '../utils/dragThreshold.js';

export const ROTATE_HANDLE_SELECTOR = '[data-rotation-handle="mtr"]';
export const ROTATION_INPUT_SELECTOR = '[data-rotation-input-field] input';

/**
 * Pure part, for the Node tests: given the press and the furthest point the
 * pointer reached, is the release a click on the grabber?
 */
export function isRotateHandleClick(press, release) {
  if (!press || !release) return false;
  if (press.pointerId != null && release.pointerId != null && press.pointerId !== release.pointerId) return false;
  if (press.dragged) return false;
  return !hasPassedShapeDragThreshold(press, release, press.pointerType);
}

/**
 * @param {object} options
 * @param {{ current: SVGSVGElement | null }} options.svgRef — the page layer's root <svg>
 * @param {() => void} options.onClick — make the angle box visible (a state
 *   update; it is flushed before the box is focused)
 */
export function useRotateHandleClick({ svgRef, onClick }) {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof window === 'undefined') return undefined;
    let press = null;
    const onDown = (event) => {
      const onHandle = event.target?.closest?.(ROTATE_HANDLE_SELECTOR);
      if (!onHandle || (event.pointerType === 'mouse' && event.button !== 0)) {
        press = null;
        return;
      }
      press = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, dragged: false };
    };
    const onMove = (event) => {
      if (!press || press.dragged || event.pointerId !== press.pointerId) return;
      if (hasPassedShapeDragThreshold(press, { x: event.clientX, y: event.clientY }, press.pointerType)) press.dragged = true;
    };
    const onUp = (event) => {
      const started = press;
      press = null;
      if (!isRotateHandleClick(started, { pointerId: event.pointerId, x: event.clientX, y: event.clientY })) return;
      try {
        flushSync(() => onClickRef.current?.());
      } catch { /* a render already in flight: the box still shows next frame */ }
      const focusBox = () => {
        const input = svg.parentElement?.querySelector?.(ROTATION_INPUT_SELECTOR);
        if (!input) return;
        try {
          input.focus({ preventScroll: true });
          input.select?.();
        } catch { /* not focusable */ }
      };
      if (event.pointerType === 'mouse') {
        focusBox();
        return;
      }
      // A finger's tap is followed by the browser's compatibility mouse
      // events, whose mousedown moves focus back to the page (measured: the
      // box got focus at pointerup and lost it 12 ms later). Take focus in the
      // click that ends the tap instead — still a user gesture, so iOS raises
      // the keyboard. The timer only covers a click that never comes.
      let done = false;
      let timer = null;
      const onClickOnce = () => {
        if (done) return;
        done = true;
        window.removeEventListener('click', onClickOnce, true);
        clearTimeout(timer);
        focusBox();
      };
      window.addEventListener('click', onClickOnce, true);
      timer = setTimeout(onClickOnce, 400);
    };
    const onCancel = () => { press = null; };
    svg.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      svg.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [svgRef]);
}
