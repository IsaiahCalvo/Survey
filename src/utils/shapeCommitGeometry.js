/**
 * shapeCommitGeometry.js — pure geometry helpers for drawn boundary shapes (rect/ellipse/circle).
 *
 * Exports tagDrawnCenteredStrokeGeometry (tags shape JSON with the
 * DRAWN_CENTERED_STROKE_CONTRACT marker), normalizeDrawnBoundaryShapeCommitGeometry
 * (re-derives Fabric props from outer bounds at commit time), and
 * computeDrawnBoundaryShapePreviewGeometry (live preview geometry with stroke inset).
 * Used by the drawing/edit canvas pipeline to keep stroke-centered shapes consistent.
 */
const finiteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const DRAWN_CENTERED_STROKE_CONTRACT = 'drawn-centered-stroke';

export function tagDrawnCenteredStrokeGeometry(shapeJSON) {
  if (!shapeJSON || typeof shapeJSON !== 'object') return shapeJSON;

  return {
    ...shapeJSON,
    data: {
      ...(shapeJSON.data || {}),
      strokeRenderContract: DRAWN_CENTERED_STROKE_CONTRACT,
    },
  };
}

export function normalizeDrawnBoundaryShapeCommitGeometry(shapeJSON, outerBounds = null) {
  if (!shapeJSON || typeof shapeJSON !== 'object') return shapeJSON;

  const type = String(shapeJSON.type || '').toLowerCase();
  const strokeWidth = Math.max(0, finiteNumber(shapeJSON.strokeWidth, 0));
  if (strokeWidth <= 0) return shapeJSON;
  if (shapeJSON.globalCompositeOperation === 'multiply') return shapeJSON;

  const normalized = { ...shapeJSON };
  const hasOuterBounds = outerBounds
    && Number.isFinite(Number(outerBounds.left))
    && Number.isFinite(Number(outerBounds.top))
    && Number.isFinite(Number(outerBounds.width))
    && Number.isFinite(Number(outerBounds.height));

  if (hasOuterBounds) {
    const left = finiteNumber(outerBounds.left, 0);
    const top = finiteNumber(outerBounds.top, 0);
    const width = Math.max(0, finiteNumber(outerBounds.width, 0));
    const height = Math.max(0, finiteNumber(outerBounds.height, 0));

    if (type === 'rect') {
      normalized.left = left;
      normalized.top = top;
      normalized.width = width;
      normalized.height = height;
      return normalized;
    }

    if (type === 'ellipse') {
      normalized.left = left;
      normalized.top = top;
      normalized.rx = width / 2;
      normalized.ry = height / 2;
      return normalized;
    }

    if (type === 'circle' || shapeJSON.radius != null) {
      const diameter = Math.max(width, height);
      normalized.left = left;
      normalized.top = top;
      normalized.radius = diameter / 2;
      return normalized;
    }
  }

  return shapeJSON;
}

export function computeDrawnBoundaryShapePreviewGeometry({
  tool,
  startX,
  startY,
  pointerX,
  pointerY,
  strokeWidth,
}) {
  const left = Math.min(finiteNumber(startX, 0), finiteNumber(pointerX, 0));
  const top = Math.min(finiteNumber(startY, 0), finiteNumber(pointerY, 0));
  const width = Math.abs(finiteNumber(pointerX, 0) - finiteNumber(startX, 0));
  const height = Math.abs(finiteNumber(pointerY, 0) - finiteNumber(startY, 0));
  const inset = Math.max(0, finiteNumber(strokeWidth, 0) / 2);
  const outerBounds = { left, top, width, height };

  if (tool === 'rect') {
    return {
      outerBounds,
      fabricProps: {
        left: left + inset,
        top: top + inset,
        width: Math.max(0, width - inset * 2),
        height: Math.max(0, height - inset * 2),
      },
    };
  }

  if (tool === 'ellipse') {
    return {
      outerBounds,
      fabricProps: {
        left: left + inset,
        top: top + inset,
        rx: Math.max(0, width / 2 - inset),
        ry: Math.max(0, height / 2 - inset),
      },
    };
  }

  return {
    outerBounds,
    fabricProps: { left, top, width, height },
  };
}
