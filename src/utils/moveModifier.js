/**
 * moveModifier.js — the "hold Command / Control to move" key (w58, owner
 * request 2026-09-28).
 *
 * UX: with one or more marks selected, holding Command (Mac) or Control
 * (Windows / Linux) hides the resize grabbers (the rotate grabber stays) and
 * turns the whole selection box into a move handle: press anywhere inside the
 * box and drag to move the selection. On a tiny mark seen zoomed out (a dot,
 * a counter, a short line) the grabbers cover the whole mark, so without this
 * every press resized it. Drawboard PDF puts a separate drag grip on the
 * selection; we use the modifier instead so no chrome is added.
 *
 * The rule, in one place:
 *   - Modifier held + press INSIDE the selection box  -> move the selection
 *     (the same move the plain body drag does: one Undo step, live preview,
 *     locked marks stay put, kept on the page).
 *   - Modifier held + press on the rotate grabber     -> rotate, as always —
 *     except where that grabber lies on top of the mark itself (a tiny
 *     counter's nub at 25 % zoom): a press on the mark moves it.
 *   - Modifier held + press OUTSIDE the selection box -> whatever that press
 *     did before (plain click on a mark selects it; on a callout it grabs the
 *     whole callout; on bare page it starts the marquee).
 *   - Keyboard shortcuts (Cmd+C / V / Z, z-order) are never touched: this
 *     module only watches the key, it never consumes it.
 *
 * Which key: Command on a Mac (Control+click there is the right-click menu),
 * Control everywhere else (the Windows key is the OS's). The desktop app
 * (Electron) runs this same page, so it follows the same rule per OS.
 *
 * Stuck-key safety: the key state clears on window blur, on the tab going
 * hidden and on page hide (Cmd+Tab away never delivers the key-up), and every
 * pointer move / press re-reads the modifier from the event itself, so a
 * missed key-up heals the moment the mouse moves.
 *
 * Pure JS apart from the tiny React hook at the bottom — the Node test runner
 * imports the pure parts directly.
 */
import { useSyncExternalStore } from 'react';

/** True on macOS / iOS (Command is the move key there). */
export function isMacLikePlatform(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (!nav) return false;
  const platform = String(
    nav.userAgentData?.platform
    || nav.platform
    || nav.userAgent
    || '',
  );
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Does this keyboard / pointer event have the move modifier down? */
export function isMoveModifierEvent(event, mac = isMacLikePlatform()) {
  if (!event) return false;
  return mac ? event.metaKey === true : event.ctrlKey === true;
}

/**
 * The page-space rectangle that acts as the move handle.
 *
 * `boxes` are the selected members' boxes in page units ({ left, top, width,
 * height, angle? } — an angle turns the box about its own centre). One box
 * keeps its own tilt so a rotated mark's handle matches its tilted frame;
 * several collapse to the axis-aligned union, like the group frame.
 *
 * The rectangle is padded by `padScreenPx` and grown to at least
 * `minScreenPx` on each side (both in screen pixels, converted with
 * `inverseScale` = page units per screen pixel), centred on the selection, so
 * a dot drawn at 25 % zoom still gives a comfortable grab area.
 *
 * Returns { left, top, width, height, angle, cx, cy } or null.
 */
export function resolveModifierMoveZone(boxes, {
  inverseScale = 1,
  minScreenPx = 24,
  padScreenPx = 4,
} = {}) {
  const list = (Array.isArray(boxes) ? boxes : []).filter((box) => (
    box
    && Number.isFinite(Number(box.left))
    && Number.isFinite(Number(box.top))
    && Number.isFinite(Number(box.width))
    && Number.isFinite(Number(box.height))
  ));
  if (list.length === 0) return null;
  const inv = Number(inverseScale) > 0 && Number.isFinite(Number(inverseScale)) ? Number(inverseScale) : 1;

  let left;
  let top;
  let width;
  let height;
  let angle = 0;
  if (list.length === 1) {
    const box = list[0];
    left = Number(box.left);
    top = Number(box.top);
    width = Math.abs(Number(box.width));
    height = Math.abs(Number(box.height));
    angle = Number(box.angle) || 0;
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of list) {
      for (const corner of boxCornerPoints(box)) {
        if (corner.x < minX) minX = corner.x;
        if (corner.y < minY) minY = corner.y;
        if (corner.x > maxX) maxX = corner.x;
        if (corner.y > maxY) maxY = corner.y;
      }
    }
    left = minX;
    top = minY;
    width = maxX - minX;
    height = maxY - minY;
  }

  const cx = left + width / 2;
  const cy = top + height / 2;
  const pad = Math.max(0, Number(padScreenPx) || 0) * inv;
  const minSide = Math.max(0, Number(minScreenPx) || 0) * inv;
  const zoneW = Math.max(width + pad * 2, minSide);
  const zoneH = Math.max(height + pad * 2, minSide);
  return {
    left: cx - zoneW / 2,
    top: cy - zoneH / 2,
    width: zoneW,
    height: zoneH,
    angle,
    cx,
    cy,
  };
}

/**
 * Is a page-space point inside any of the marks' own boxes (not the grown
 * zone)? A box with an angle is tested in its own turned frame.
 *
 * Why it matters: on a tiny counter at 25 % zoom its rotate nub grabber sits
 * on top of the counter itself. With the key held, a press ON THE MARK moves
 * it; a press on the rotate grabber where it sticks out past the mark rotates.
 */
export function isPointInBoxes(point, boxes) {
  const px = Number(point?.x);
  const py = Number(point?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  for (const box of Array.isArray(boxes) ? boxes : []) {
    if (!box) continue;
    const left = Number(box.left);
    const top = Number(box.top);
    const width = Math.abs(Number(box.width));
    const height = Math.abs(Number(box.height));
    if (![left, top, width, height].every(Number.isFinite)) continue;
    const angle = Number(box.angle) || 0;
    let x = px;
    let y = py;
    if (angle) {
      const cx = left + width / 2;
      const cy = top + height / 2;
      const rad = (-angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      x = cx + (px - cx) * cos - (py - cy) * sin;
      y = cy + (px - cx) * sin + (py - cy) * cos;
    }
    if (x >= left && x <= left + width && y >= top && y <= top + height) return true;
  }
  return false;
}

function boxCornerPoints(box) {
  const left = Number(box.left);
  const top = Number(box.top);
  const width = Number(box.width);
  const height = Number(box.height);
  const angle = Number(box.angle) || 0;
  const corners = [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ];
  if (!angle) return corners;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return corners.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

// ---------------------------------------------------------------------------
// Shared key state (one set of window listeners for every page layer)
// ---------------------------------------------------------------------------

let held = false;
const subscribers = new Set();
let detach = null;

function setHeld(next) {
  const value = next === true;
  if (value === held) return;
  held = value;
  for (const fn of Array.from(subscribers)) {
    try { fn(); } catch (_) { /* a subscriber must never break the others */ }
  }
}

/**
 * Wire the window listeners. Exported (with the target injectable) so the
 * Node tests can drive a fake window; the app calls it through subscribe.
 */
export function attachMoveModifierListeners(target = (typeof window !== 'undefined' ? window : null), {
  mac = isMacLikePlatform(),
  doc = (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!target?.addEventListener) return () => {};
  const fromEvent = (event) => setHeld(isMoveModifierEvent(event, mac));
  const clear = () => setHeld(false);
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') setHeld(false);
  };
  const passiveCapture = { capture: true, passive: true };
  target.addEventListener('keydown', fromEvent, true);
  target.addEventListener('keyup', fromEvent, true);
  target.addEventListener('pointerdown', fromEvent, passiveCapture);
  target.addEventListener('pointermove', fromEvent, passiveCapture);
  target.addEventListener('blur', clear);
  target.addEventListener('pagehide', clear);
  doc?.addEventListener?.('visibilitychange', onVisibility);
  return () => {
    target.removeEventListener('keydown', fromEvent, true);
    target.removeEventListener('keyup', fromEvent, true);
    target.removeEventListener('pointerdown', fromEvent, passiveCapture);
    target.removeEventListener('pointermove', fromEvent, passiveCapture);
    target.removeEventListener('blur', clear);
    target.removeEventListener('pagehide', clear);
    doc?.removeEventListener?.('visibilitychange', onVisibility);
    setHeld(false);
  };
}

export function subscribeMoveModifier(callback) {
  subscribers.add(callback);
  if (!detach) detach = attachMoveModifierListeners();
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && detach) {
      const off = detach;
      detach = null;
      off();
    }
  };
}

export function getMoveModifierHeld() {
  return held;
}

const getServerSnapshot = () => false;

/** React hook: is the move modifier (Cmd on Mac, Ctrl elsewhere) held now? */
export function useMoveModifierHeld() {
  return useSyncExternalStore(subscribeMoveModifier, getMoveModifierHeld, getServerSnapshot);
}
