/**
 * selectionHandleVisibility.js — computes which selection handles to show and at what
 * size based on a selected object's screen-space bounding box.
 *
 * Exports the handle-name constants (CORNER/SIDE/ALL_RESIZE_HANDLES),
 * getSelectionHandleVisualMetrics (sizes scaled by sqrt(inverseScale) so handles stay
 * constant on screen across zoom), and getAdaptiveSelectionHandleSpec, which picks the
 * 'all' / 'corners' / 'single' tier and rotation offset that fit the box. Used by the
 * SVG/Fabric selection overlays.
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

export function getAdaptiveSelectionHandleSpec({
  bboxWidth,
  bboxHeight,
  inverseScale,
  padding = 2,
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

  const resizeHandles = allFit
    ? ALL_RESIZE_HANDLES
    : (cornersFit ? CORNER_RESIZE_HANDLES : BOTTOM_RIGHT_ONLY);

  const topHandleHalfHeight = allFit ? metrics.hPillH / 2 : metrics.cornerR;
  const rotationOffset = Math.max(36, metrics.rotationR + topHandleHalfHeight + metrics.minGap);

  return {
    resizeHandles,
    tier: allFit ? 'all' : (cornersFit ? 'corners' : 'single'),
    rotationOffset,
  };
}
