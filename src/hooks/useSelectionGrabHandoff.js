/**
 * useSelectionGrabHandoff — "the selected mark and its handles answer to every
 * tool" (Drawboard PDF rules 3 + 4, owner 2026-10-02; rule table in
 * utils/selectModes.js).
 *
 * Owner 2026-10-04 (own tool group only): "every tool" now means every tool
 * that may pick the whole selection (selectModes.canToolGrabSelection) — a
 * Shapes tool over picked shapes, a Text tool over picked text. The caller
 * leaves this off for the Draw group, whose press always draws or erases.
 *
 * Under Select the SVG layer owns the pointer, so a press on the selection
 * moves / resizes it. Under every other tool something else owns the press:
 * the drawing surface (shapes, ink, polygon), the pdf.js pan scroller (Pan) or
 * a full-page overlay above the layer (Text, Counter). Drawboard still lets
 * you drag the selected mark or its handles under ANY tool, without switching
 * tools, while a press anywhere else is the tool's own.
 *
 * How: one window-capture pointerdown listener per page layer, live only while
 * that page has a selection and a non-Select tool is armed. On a press inside
 * the page it ARMS the layer synchronously (flushSync: the layer then renders
 * exactly as under Select — hit targets live, root handlers attached, and
 * `data-pan-interactive` so the pan scroller leaves the press alone), and asks
 * the browser what is under the pointer:
 *   - the selection (a selected mark, its handles) -> the press is handed to
 *     it. If the original target was something else (the drawing surface, an
 *     overlay) the original press is stopped and an identical pointerdown is
 *     dispatched on the selection element, so the layer's own move / resize
 *     machinery runs, captures the pointer and gets the rest of the gesture.
 *   - anything else -> the layer is disarmed again in the same task and the
 *     press continues untouched to the tool.
 * The layer stays armed until the gesture ends.
 *
 * A second press on the same selected text within the double-click window is
 * reported through onDoublePress (rule 7: a double-click on selected text
 * edits it under any tool).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// The pointer currently held by a selection grab, if any. Viewer-level press
// listeners (Pan quick-click, tool overlays) skip a press that belongs to it.
let activeGrabPointerId = null;
export function isSelectionGrabPress(event) {
  return activeGrabPointerId != null && (event?.pointerId == null || event.pointerId === activeGrabPointerId);
}

// Rule 13: a TAP that picked text through a tool overlay above the layers
// (the Text tool, owner 2026-10-04) counts as the first tap of a double-tap,
// like notePick below — the overlay does not know which page layer owns it.
let overlayTapPick = null;
export function noteOverlayTapPick(key, { x, y, pointerType } = {}) {
  overlayTapPick = pointerType === 'touch' ? { at: performance.now(), x, y, key } : null;
}

const NEVER_GRAB = 'button, input, textarea, select, a[href], [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"], [data-counter-caret-popup], [data-text-edit-overlay], [data-rich-text-toolbar], [data-mini-toolbar]';
const DOUBLE_PRESS_MS = 450;
const DOUBLE_PRESS_PX = 8;

export function useSelectionGrabHandoff({ svgRef, enabled, isSelectionTarget, onDoublePress }) {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const grabRef = useRef(null);
  const lastPressRef = useRef(null);
  const latestRef = useRef({ isSelectionTarget, onDoublePress });
  latestRef.current = { isSelectionTarget, onDoublePress };

  const setArmedSync = useCallback((next) => {
    if (armedRef.current === next) return;
    armedRef.current = next;
    flushSync(() => setArmed(next));
  }, []);

  useEffect(() => {
    if (!enabled) {
      // The pick went away (or an editor opened) — never stay armed behind it.
      if (grabRef.current && activeGrabPointerId === grabRef.current.pointerId) activeGrabPointerId = null;
      grabRef.current = null;
      if (armedRef.current) {
        armedRef.current = false;
        setArmed(false);
      }
      return undefined;
    }
    const onDown = (event) => {
      if (!event.isTrusted || event.defaultPrevented) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (grabRef.current) return;
      const svg = svgRef.current;
      const target = event.target;
      if (!svg || !(target instanceof Element)) return;
      const page = svg.closest('[data-page-number]') || svg.parentElement;
      if (!page || !page.contains(target) || target.closest(NEVER_GRAB)) return;
      const rect = svg.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom) return;
      setArmedSync(true);
      let stack = [];
      try {
        stack = (document.elementsFromPoint(event.clientX, event.clientY) || []).filter((el) => svg.contains(el));
      } catch (_) { stack = []; }
      const hit = stack[0] || null;
      const info = hit ? latestRef.current.isSelectionTarget(hit) : null;
      if (!info) {
        setArmedSync(false);
        return;
      }
      grabRef.current = { pointerId: event.pointerId };
      activeGrabPointerId = event.pointerId;
      // Rule 7: a second press on the same selected text opens its editor —
      // also when a grabber's (touch-sized) pad lies over the text.
      let textInfo = info.text ? info : null;
      for (let i = 1; !textInfo && i < stack.length; i += 1) {
        const below = latestRef.current.isSelectionTarget(stack[i]);
        if (below?.text) textInfo = below;
      }
      const now = performance.now();
      const ownLast = lastPressRef.current;
      const last = overlayTapPick && (!ownLast || overlayTapPick.at > ownLast.at) ? overlayTapPick : ownLast;
      overlayTapPick = null;
      lastPressRef.current = { at: now, x: event.clientX, y: event.clientY, key: textInfo ? textInfo.key : info.key };
      if (textInfo && last && last.key === textInfo.key && now - last.at < DOUBLE_PRESS_MS
        && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_PRESS_PX
        && typeof latestRef.current.onDoublePress === 'function') {
        lastPressRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        latestRef.current.onDoublePress(textInfo, event);
        return;
      }
      if (target === hit) return; // already aimed at the selection: let it run armed
      event.preventDefault();
      event.stopPropagation();
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        width: event.width,
        height: event.height,
        pressure: event.pressure,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        detail: event.detail,
        view: window,
      };
      hit.dispatchEvent(new PointerEvent('pointerdown', init));
    };
    const onEnd = (event) => {
      const grab = grabRef.current;
      if (!grab || event.pointerId !== grab.pointerId) return;
      // Let the layer's own pointerup run (and commit the move) while still
      // armed, then hand the page back to the tool.
      window.requestAnimationFrame(() => {
        if (grabRef.current !== grab) return;
        grabRef.current = null;
        if (activeGrabPointerId === grab.pointerId) activeGrabPointerId = null;
        armedRef.current = false;
        setArmed(false);
      });
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
    };
  }, [enabled, svgRef, setArmedSync]);

  useEffect(() => () => {
    if (grabRef.current && activeGrabPointerId === grabRef.current.pointerId) activeGrabPointerId = null;
  }, []);

  // Rule 13: a TAP that picked a mark through the tool's own click route
  // counts as the first tap of a double-tap, so a second tap on that text
  // edits it. A mouse click never does (a double-click on text that was not
  // selected only picks it, rule 7).
  const notePick = useCallback((key, { x, y, pointerType } = {}) => {
    if (pointerType !== 'touch') return;
    lastPressRef.current = { at: performance.now(), x, y, key };
  }, []);

  return { armed, armedRef, notePick };
}
