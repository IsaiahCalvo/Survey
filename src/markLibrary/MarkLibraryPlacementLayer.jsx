/**
 * MarkLibraryPlacementLayer — the viewer's side of placing a library item
 * (markLibraryPlacement.js). Mounted once per viewer; does nothing unless the
 * viewer is the active tab and an item is armed or being dragged.
 *
 * While an item is armed or dragged, a see-through copy of it follows the
 * pointer over the pages at the size it will land, so the person sees where
 * it goes. A mouse or pen press on a page places it there (the press does not
 * reach the page's own tools); a press anywhere else lets go of it, as does
 * Esc. A press on the selection (the stamp just placed) or a button lets go
 * of it and goes through, so that stamp can be moved or resized at once.
 * A finger still pans: only a tap (no drag, one finger) places.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  disarmLibraryItem,
  endLibraryDrag,
  getArmedLibraryItem,
  getLibraryDrag,
  pageElementAt,
  placeLibraryItem,
  registerLibraryPlacer,
  subscribeLibraryPlacement,
} from './markLibraryPlacement.js';
import { libraryThumbnail, thumbnailFrame } from './markLibraryThumbnail.js';
import { reviewStampPreviewItem } from './reviewStamps.js';

// Page units → screen pixels for a page element (its annotation layer's
// viewBox is the page size).
function pageScreenScale(page) {
  const svg = page?.querySelector?.('svg[data-svg-annotation-layer]');
  const vb = svg?.getAttribute?.('viewBox')?.split(/\s+/).map(Number);
  const rect = page?.getBoundingClientRect?.();
  if (!rect || !vb || vb.length !== 4 || !(vb[2] > 0)) return null;
  return rect.width / vb[2];
}

// What a press edits or clicks instead of placing (round 4: grabbing the new
// stamp's handle dropped a second stamp). Only the selection counts: a press
// on any other mark still stamps on top of it.
const SELECTION_HANDLE = '[data-resize-handle], [data-handle], [data-handle-hit-pad], [data-rotation-handle], [data-curve-handle]';
const CONTROL = 'button, input, textarea, select, [role="toolbar"], [contenteditable="true"]';
function pressGoesThrough(event, page) {
  const target = event.target;
  if (target?.closest?.(`${SELECTION_HANDLE}, ${CONTROL}`)) return true;
  if (!page) return false;
  const mark = target?.closest?.('[data-annotation-index]');
  if (mark && page.querySelector(`[data-selection-context-index="${mark.getAttribute('data-annotation-index')}"]`)) return true;
  for (const frame of page.querySelectorAll('[data-selection-context-hitbox]')) {
    const r = frame.getBoundingClientRect();
    if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) return true;
  }
  return false;
}
const TAP_SLOP_PX = 10;
const TAP_MS = 500;

export default function MarkLibraryPlacementLayer({ active = false, rootRef = null, place }) {
  const placeRef = useRef(place);
  placeRef.current = place;
  const [, force] = useState(0);
  const [ghost, setGhost] = useState(null); // { x, y, width, height }
  const [picture, setPicture] = useState(null);

  useEffect(() => subscribeLibraryPlacement(() => force((n) => n + 1)), []);

  useEffect(() => {
    if (!active) return undefined;
    return registerLibraryPlacer((item, where) => placeRef.current?.(item, where));
  }, [active]);

  // #1649: a fast press-drag can emit pointerup in the same frame that
  // beginLibraryDrag triggers a re-render, before the item-scoped effect below
  // has mounted its listeners. Keep the drag-release drop wired while active.
  useEffect(() => {
    if (!active) return undefined;
    const onDragUp = (event) => {
      const current = getLibraryDrag();
      if (!current) return;
      const dragged = current.item;
      endLibraryDrag();
      setGhost(null);
      if (pageElementAt(rootRef?.current || null, event.clientX, event.clientY)) {
        placeLibraryItem(dragged, { clientX: event.clientX, clientY: event.clientY });
      }
    };
    window.addEventListener('pointerup', onDragUp, true);
    return () => window.removeEventListener('pointerup', onDragUp, true);
  }, [active, rootRef]);

  const armed = getArmedLibraryItem();
  const drag = getLibraryDrag();
  const item = drag?.item || armed?.item || null;

  useEffect(() => {
    let cancelled = false;
    setPicture(null);
    if (!item || !active) return undefined;
    libraryThumbnail(item.builtIn ? reviewStampPreviewItem(item) : item, { px: 320 }).then((url) => { if (!cancelled) setPicture(url); });
    return () => { cancelled = true; };
  }, [item, active]);

  useEffect(() => {
    if (!active || !item) {
      setGhost(null);
      return undefined;
    }
    const root = () => rootRef?.current || null;
    const frame = thumbnailFrame(item.payload);
    const follow = (event) => {
      const page = pageElementAt(root(), event.clientX, event.clientY);
      const scale = page ? pageScreenScale(page) : null;
      if (!page || !scale) { setGhost(null); return; }
      setGhost({ x: event.clientX, y: event.clientY, width: frame.width * scale, height: frame.height * scale });
    };
    let swallowUntil = 0;
    const fingers = new Set();
    let tap = null; // { id, x, y, t }
    const placeAt = (event) => {
      const current = getArmedLibraryItem();
      if (!current?.keep) disarmLibraryItem();
      placeLibraryItem(current?.item || item, { clientX: event.clientX, clientY: event.clientY });
    };
    const swallow = (event) => {
      // A pick in a panel right after a drop (another stamp) is not the drop's own click.
      if (event.target?.closest?.('[data-mark-library-panel]')) return;
      if (Date.now() < swallowUntil) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }
    };
    const onDown = (event) => {
      if (getLibraryDrag()) return;
      if (event.target?.closest?.('[data-mark-library-panel]')) return;
      const page = pageElementAt(root(), event.clientX, event.clientY);
      if (event.pointerType === 'touch') {
        // The press itself goes through so a drag or a pinch still moves the page.
        fingers.add(event.pointerId);
        tap = page && fingers.size === 1 && !pressGoesThrough(event, page)
          ? { id: event.pointerId, x: event.clientX, y: event.clientY, t: Date.now() }
          : null;
        return;
      }
      if (!page || event.button !== 0 || pressGoesThrough(event, page)) {
        disarmLibraryItem();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      swallowUntil = Date.now() + 600;
      placeAt(event);
    };
    const onTouchEnd = (event) => {
      fingers.delete(event.pointerId);
      const start = tap;
      tap = null;
      if (event.type !== 'pointerup' || !start || start.id !== event.pointerId) return;
      if (Date.now() - start.t > TAP_MS || Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
      if (!pageElementAt(root(), event.clientX, event.clientY)) return;
      const at = { clientX: event.clientX, clientY: event.clientY };
      // After the tap's own click, so the page's tap handling (a deselect)
      // doesn't clear the selection the placement makes.
      setTimeout(() => placeAt(at), 0);
    };
    const onCancel = (event) => {
      if (event.pointerType === 'touch') onTouchEnd(event);
    };
    const onUp = (event) => {
      if (event.pointerType === 'touch' && !getLibraryDrag()) { onTouchEnd(event); return; }
      if (!getLibraryDrag()) { swallow(event); return; }
      const dragged = getLibraryDrag().item;
      endLibraryDrag();
      setGhost(null);
      if (pageElementAt(root(), event.clientX, event.clientY)) {
        placeLibraryItem(dragged, { clientX: event.clientX, clientY: event.clientY });
      }
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      endLibraryDrag();
      disarmLibraryItem();
    };
    window.addEventListener('pointermove', follow, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', follow, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active, item, rootRef]);

  if (!active || !item || !ghost || typeof document === 'undefined') return null;
  return createPortal(
    <div
      aria-hidden="true"
      data-mark-library-ghost=""
      style={{
        position: 'fixed',
        left: ghost.x - ghost.width / 2,
        top: ghost.y - ghost.height / 2,
        width: ghost.width,
        height: ghost.height,
        pointerEvents: 'none',
        zIndex: 2147483000,
        opacity: 0.6,
        outline: picture ? 'none' : '1px dashed var(--accent, #2563eb)',
        backgroundImage: picture ? `url("${picture}")` : 'none',
        backgroundSize: '100% 100%',
      }}
    />,
    document.body,
  );
}
