/**
 * selectionHandleVisibility.js — computes which selection handles to show and at what
 * size based on a selected object's screen-space bounding box.
 *
 * Exports the handle-name constants (CORNER/SIDE/ALL_RESIZE_HANDLES),
 * getSelectionHandleVisualMetrics (sizes scaled by sqrt(inverseScale) so handles stay
 * constant on screen across zoom), and getAdaptiveSelectionHandleSpec, which picks the
 * 'all' / 'corners' / 'single' tier and rotation offset that fit the box. Used by the
 * SVG/Fabric selection overlays.
 *
 * UX 2026-09-10 (round 4, defect 2 — "tiny polyline grabbers"). The adaptive
 * tier CULLS handles that do not fit, which is right for an ordinary mark but
 * wrong for a revision cloud in bbox mode: a 2-point polyline cloud's frame is
 * 157 x 20 page units, the edge PILLS need cornerR*2 + pillH + two gaps = 47
 * units on the short axis, so the four edge grabbers vanished and the vertical
 * axis could not be resized at all. Contract: a cloud in bbox mode ALWAYS
 * exposes all eight grabbers. Callers that need that pass `alwaysAllHandles`,
 * and when the pills do not fit the spec reports `edgeHandleShape: 'dot'` —
 * the four edge grabbers render as small dots the size of the corner dots, on
 * the frame's edge midpoints, driving exactly the same resize math. On a frame
 * too thin to hold a dot between its two corner dots, `edgeDotOutset` pushes
 * that dot straight OUT along the frame normal until every pair of grabbers is
 * at least one dot-diameter-plus-gap apart, so they can never overlap.
 */
import { HANDLE_RADIUS } from './handleStyle.js';

export const CORNER_RESIZE_HANDLES = ['tl', 'tr', 'bl', 'br'];
export const SIDE_RESIZE_HANDLES = ['mt', 'mb', 'ml', 'mr'];
export const ALL_RESIZE_HANDLES = [...CORNER_RESIZE_HANDLES, ...SIDE_RESIZE_HANDLES];

const BOTTOM_RIGHT_ONLY = ['br'];

function safePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function getSelectionHandleVisualMetrics(inverseScale) {
  const inv = safePositiveNumber(inverseScale, 1);
  const is = Math.sqrt(inv);
  return {
    scale: is,
    cornerR: HANDLE_RADIUS * is,
    cornerStrokeWidth: 1 * is,
    hPillW: 28 * is,
    hPillH: 8 * is,
    vPillW: 8 * is,
    vPillH: 28 * is,
    pillRx: 4 * is,
    rotationR: 10 * is,
    rotationIconSize: 14 * is,
    minGap: 4 * is,
  };
}

/**
 * How far an edge dot has to move OUT along its own normal so it clears both
 * neighbours by `need` (centre-to-centre). `spanToNeighbour` is the in-frame
 * distance from the edge midpoint to each adjacent corner; `spanAcross` is the
 * distance to the dot on the opposite edge, which must clear too.
 */
const edgeDotOutset = (spanToNeighbour, spanAcross, need) => {
  const clearNeighbours = spanToNeighbour >= need
    ? 0
    : Math.sqrt(Math.max(0, need * need - spanToNeighbour * spanToNeighbour));
  const clearOpposite = Math.max(0, (need - spanAcross) / 2);
  return Math.max(clearNeighbours, clearOpposite);
};

export function getAdaptiveSelectionHandleSpec({
  bboxWidth,
  bboxHeight,
  inverseScale,
  padding = 2,
  // Revision clouds in bbox mode: never cull a grabber, fall back to dots.
  alwaysAllHandles = false,
}) {
  const width = Math.max(0, Number(bboxWidth) || 0);
  const height = Math.max(0, Number(bboxHeight) || 0);
  const pad = Math.max(0, Number(padding) || 0);
  const metrics = getSelectionHandleVisualMetrics(inverseScale);

  const boxW = width + pad * 2;
  const boxH = height + pad * 2;

  const cornersFit =
    boxW >= (metrics.cornerR * 2 + metrics.minGap) &&
    boxH >= (metrics.cornerR * 2 + metrics.minGap);

  const allFit =
    cornersFit &&
    boxW >= (metrics.cornerR * 2 + metrics.hPillW + metrics.minGap * 2) &&
    boxH >= (metrics.cornerR * 2 + metrics.vPillH + metrics.minGap * 2);

  const resizeHandles = (allFit || alwaysAllHandles)
    ? ALL_RESIZE_HANDLES
    : (cornersFit ? CORNER_RESIZE_HANDLES : BOTTOM_RIGHT_ONLY);

  // Edge grabbers fall back to corner-sized dots rather than disappearing.
  const edgeHandleShape = (allFit || !alwaysAllHandles) ? 'pill' : 'dot';
  // Centre-to-centre clearance two dots need: both radii plus the same gap the
  // fit test uses everywhere else.
  const dotNeed = metrics.cornerR * 2 + metrics.minGap;
  const outset = edgeHandleShape === 'dot'
    ? {
      // ml / mr push sideways; their neighbours are the corners half a frame
      // HEIGHT away, and the opposite dot is a frame WIDTH across.
      x: edgeDotOutset(boxH / 2, boxW, dotNeed),
      // mt / mb push up / down.
      y: edgeDotOutset(boxW / 2, boxH, dotNeed),
    }
    : { x: 0, y: 0 };

  // The rotation arm has to clear whatever the top-centre grabber actually is:
  // a pill's half-height, a bare corner dot, or a dot pushed out by `outset.y`.
  const topHandleHalfHeight = edgeHandleShape === 'dot'
    ? metrics.cornerR + outset.y
    : (allFit ? metrics.hPillH / 2 : metrics.cornerR);
  const rotationOffset = Math.max(36, metrics.rotationR + topHandleHalfHeight + metrics.minGap);

  return {
    resizeHandles,
    // The tier still answers "what FITS" — `edgeHandleShape` answers "what is
    // drawn". A cloud can be tier 'corners' and still show eight grabbers.
    tier: allFit ? 'all' : (cornersFit ? 'corners' : 'single'),
    rotationOffset,
    edgeHandleShape,
    edgeDotOutset: outset,
  };
}
