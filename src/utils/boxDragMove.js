/**
 * boxDragMove.js — "drag inside a picked mark to move it" (Nightly beta flag
 * 'box-drag-move', Drawboard PDF Pro trial audit 2026-11-10, R3-F gap #1).
 *
 * UX:
 *   - Desktop (mouse / pen): once a mark is PICKED, a press-drag anywhere
 *     inside its selection box moves it — the empty inside of an unfilled
 *     rectangle, ellipse or polygon, or between a pen mark's strokes — not
 *     only on its 2 pt outline. The box is a transparent move zone drawn UNDER
 *     every mark, so a press on another (unpicked) mark inside the box still
 *     picks that mark, and the picked mark's grabbers stay on top. A drag on
 *     an unpicked mark keeps today's rule (it only picks; a drag from bare
 *     page box-selects). Locked marks never move. Shift and a finger press
 *     pass through to the page as before.
 *   - Phone (a finger): a small round move grip (four-way arrows) sits just
 *     below the selection box; dragging it with a finger moves the pick. The
 *     corner grabbers stay as they are. The quick bar keeps clear of it.
 *
 * Pure helpers only; the Node test runner imports this file directly.
 */

export const BOX_DRAG_MOVE_FLAG = 'box-drag-move';

/** On-screen size of the phone move grip (px) and its gap below the box. */
export const BOX_MOVE_GRIP_PX = 36;
// Clears a bottom-middle grabber's finger pad (44 pt, so 22 px past the edge).
export const BOX_MOVE_GRIP_GAP_PX = 24;

/**
 * Which affordance the pick gets for the pointer in use: a finger gets the
 * grip, a mouse or pen gets the move zone.
 */
export function boxDragMoveKind(inputKind) {
  return inputKind === 'touch' ? 'grip' : 'zone';
}

/**
 * Where the phone move grip goes, in page units: centred under the move
 * zone's lowest point (a turned box is measured by its turned corners).
 *
 * `zone` is resolveModifierMoveZone's result ({ left, top, width, height,
 * angle, cx, cy }); `inverseScale` is page units per screen pixel.
 * Returns { cx, cy, r } or null.
 */
export function boxMoveGripPlacement(zone, {
  inverseScale = 1,
  sizePx = BOX_MOVE_GRIP_PX,
  gapPx = BOX_MOVE_GRIP_GAP_PX,
} = {}) {
  if (!zone) return null;
  const left = Number(zone.left);
  const top = Number(zone.top);
  const width = Number(zone.width);
  const height = Number(zone.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  const inv = Number(inverseScale) > 0 && Number.isFinite(Number(inverseScale)) ? Number(inverseScale) : 1;
  const cx = Number.isFinite(Number(zone.cx)) ? Number(zone.cx) : left + width / 2;
  const cy = Number.isFinite(Number(zone.cy)) ? Number(zone.cy) : top + height / 2;
  const rad = ((Number(zone.angle) || 0) * Math.PI) / 180;
  // Lowest point of the (possibly turned) box: half its turned height below
  // the centre.
  const halfDrop = (Math.abs(Math.sin(rad)) * width + Math.abs(Math.cos(rad)) * height) / 2;
  const r = (sizePx / 2) * inv;
  return {
    cx,
    cy: cy + halfDrop + gapPx * inv + r,
    r,
  };
}

/**
 * The grip's four-way arrow glyph as one SVG path, centred on (cx, cy), for
 * a grip of radius `r` (page units).
 */
export function boxMoveGripGlyphPath(cx, cy, r) {
  const a = r * 0.62; // arrow tip distance from the centre
  const h = r * 0.24; // arrow head half-width / length
  const parts = [
    // the cross
    `M ${cx - a + h} ${cy} L ${cx + a - h} ${cy}`,
    `M ${cx} ${cy - a + h} L ${cx} ${cy + a - h}`,
    // heads: up, down, left, right
    `M ${cx - h} ${cy - a + h} L ${cx} ${cy - a} L ${cx + h} ${cy - a + h}`,
    `M ${cx - h} ${cy + a - h} L ${cx} ${cy + a} L ${cx + h} ${cy + a - h}`,
    `M ${cx - a + h} ${cy - h} L ${cx - a} ${cy} L ${cx - a + h} ${cy + h}`,
    `M ${cx + a - h} ${cy - h} L ${cx + a} ${cy} L ${cx + a - h} ${cy + h}`,
  ];
  return parts.join(' ');
}
