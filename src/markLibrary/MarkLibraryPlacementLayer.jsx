/**
 * MarkLibraryPlacementLayer — the viewer's side of placing a library item
 * (markLibraryPlacement.js). Mounted once per viewer; does nothing unless the
 * viewer is the active tab and an item is armed or being dragged.
 *
 * While an item is armed or dragged, a see-through copy of it follows the
 * pointer over the pages at the size it will land, so the person sees where
 * it goes. A mouse or pen press on a page places it there (the press does not
 * reach the page's own tools); a press anywhere else lets go of it, as does
 * Esc. Touch presses are left alone: a finger pans.
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

// Page units → screen pixels for a page element (its annotation layer's
// viewBox is the page size).
function pageScreenScale(page) {
  const svg = page?.querySelector?.('svg[data-svg-annotation-layer]');
  const vb = svg?.getAttribute?.('viewBox')?.split(/\s+/).map(Number);
  const rect = page?.getBoundingClientRect?.();
  if (!rect || !vb || vb.length !== 4 || !(vb[2] > 0)) return null;
  return rect.width / vb[2];
}

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

  const armed = getArmedLibraryItem();
  const drag = getLibraryDrag();
  const item = drag?.item || armed?.item || null;

  useEffect(() => {
    let cancelled = false;
    setPicture(null);
    if (!item || !active) return undefined;
    libraryThumbnail(item, { px: 320 }).then((url) => { if (!cancelled) setPicture(url); });
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
    const swallow = (event) => {
      if (Date.now() < swallowUntil) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }
    };
    const onDown = (event) => {
      if (getLibraryDrag()) return;
      if (event.pointerType === 'touch') return;
      if (event.target?.closest?.('[data-mark-library-panel]')) return;
      const page = pageElementAt(root(), event.clientX, event.clientY);
      if (!page || event.button !== 0) {
        disarmLibraryItem();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      swallowUntil = Date.now() + 600;
      const current = getArmedLibraryItem();
      if (!current?.keep) disarmLibraryItem();
      placeLibraryItem(current?.item || item, { clientX: event.clientX, clientY: event.clientY });
    };
    const onUp = (event) => {
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
    window.addEventListener('click', swallow, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', follow, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
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
