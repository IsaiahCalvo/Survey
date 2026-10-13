/**
 * Phase 19 — AutoCAD Window + Crossing Selection
 *
 * Thin adapter that maps an SVG-layer annotation (or SVG callout) into the
 * shape signature the existing `doesRectIntersectObject` dispatcher in
 * `geometryHitTest.js` already knows how to consume. Read-only pass-through:
 * no math, no mutation, no new geometry.
 *
 * For standard annotations, fields are shallow-copied directly because the
 * SVG-layer annotation objects are already Fabric-style JSON (they share the
 * same schema Fabric.js uses).
 *
 * For SVG callouts (React state keyed by id, with normalized 0-1 coordinates),
 * we build an axis-aligned rectangle covering the three anchor points plus
 * the textbox rect, and return a `rect` signature. Per 19-CONTEXT.md: callouts
 * participate like any other shape; no parent/child redirect needed.
 */

import { getAnnotationBBox } from './svgBoundingBox.js';
import { maxOf, minOf } from './arrayExtrema.js';

/**
 * @param {object} annotation - Fabric.js JSON annotation OR an SVG callout record
 * @param {object} [options]
 * @param {number} [options.pageWidth] - Required when kind === 'callout'
 * @param {number} [options.pageHeight] - Required when kind === 'callout'
 * @param {'callout'} [options.kind] - Force callout interpretation
 * @returns {object} Shape signature for `doesRectIntersectObject`
 */
export function toFabricShape(annotation, options = {}) {
  if (options.kind === 'callout') {
    return calloutToRect(annotation, options.pageWidth, options.pageHeight);
  }

  const a = annotation || {};
  const type = String(a.type || '').toLowerCase();
  const base = {
    type,
    left: a.left ?? 0,
    top: a.top ?? 0,
    scaleX: a.scaleX ?? 1,
    scaleY: a.scaleY ?? 1,
    angle: a.angle ?? 0,
    strokeWidth: a.strokeWidth ?? 0,
    stroke: a.stroke,
    originX: a.originX,
    originY: a.originY,
    fill: a.fill,
  };
  if (typeof a.calcTransformMatrix === 'function') {
    base.calcTransformMatrix = a.calcTransformMatrix.bind(a);
  }
  if (typeof a.getBoundingRect === 'function') {
    base.getBoundingRect = a.getBoundingRect.bind(a);
  }

  switch (type) {
    case 'rect':
    case 'textbox':
    case 'text':
    case 'i-text':
    case 'triangle':
      return { ...base, width: a.width ?? 0, height: a.height ?? 0 };

    case 'circle':
      return {
        ...base,
        left: (a.left ?? 0) + (a.radius ?? 0) * Math.abs(a.scaleX ?? 1),
        top: (a.top ?? 0) + (a.radius ?? 0) * Math.abs(a.scaleY ?? 1),
        radius: a.radius ?? 0,
        width: a.width ?? 0,
        height: a.height ?? 0,
        originX: 'center',
        originY: 'center',
      };

    case 'ellipse':
      return {
        ...base,
        left: (a.left ?? 0) + (a.rx ?? 0) * Math.abs(a.scaleX ?? 1),
        top: (a.top ?? 0) + (a.ry ?? 0) * Math.abs(a.scaleY ?? 1),
        rx: a.rx ?? 0,
        ry: a.ry ?? 0,
        width: a.width ?? 0,
        height: a.height ?? 0,
        originX: 'center',
        originY: 'center',
      };

    case 'line':
      return {
        ...base,
        x1: a.x1 ?? 0,
        y1: a.y1 ?? 0,
        x2: a.x2 ?? 0,
        y2: a.y2 ?? 0,
        // w41: the endpoints are offsets from the bbox CENTER, so the
        // geometry tests need the size (and a curved line's midpoint).
        width: a.width ?? 0,
        height: a.height ?? 0,
        ...(a.data?.midpoint ? { data: { midpoint: a.data.midpoint } } : {}),
      };

    case 'polyline':
      return {
        ...base,
        points: a.points ?? [],
        calcTransformMatrix: () => getPointsShapeTransformMatrix(a),
      };

    case 'polygon': {
      const pts = Array.isArray(a.points) ? a.points : [];
      return {
        ...base,
        type: 'polygon',
        points: pts.slice(),
        calcTransformMatrix: () => getPointsShapeTransformMatrix(a),
      };
    }

    case 'path':
      return {
        ...base,
        path: a.path ?? [],
        width: a.width ?? 0,
        height: a.height ?? 0,
        pathOffset: a.pathOffset,
      };

    case 'group':
      return {
        ...base,
        width: a.width ?? 0,
        height: a.height ?? 0,
        objects: Array.isArray(a.objects) ? a.objects : [],
      };

    default: {
      const bbox = getAnnotationBBox(a) || { left: 0, top: 0, width: 0, height: 0 };
      return {
        type: 'rect',
        left: bbox.left,
        top: bbox.top,
        width: bbox.width,
        height: bbox.height,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        strokeWidth: 0,
      };
    }
  }
}

function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function translate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

function scale(sx, sy) {
  return [sx, 0, 0, sy, 0, 0];
}

function rotate(deg) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, sin, -sin, cos, 0, 0];
}

function getPointsShapeTransformMatrix(annotation) {
  const points = Array.isArray(annotation?.points) ? annotation.points : [];
  const scaleX = annotation?.scaleX ?? 1;
  const scaleY = annotation?.scaleY ?? 1;
  const pathOffsetX = annotation?.pathOffset?.x || 0;
  const pathOffsetY = annotation?.pathOffset?.y || 0;
  const xs = points.map((p) => Number(p?.x) || 0);
  const ys = points.map((p) => Number(p?.y) || 0);
  // Linear, not a spread: an imported polygon's point list is unbounded.
  const rawCenterX = xs.length ? (minOf(xs) + maxOf(xs)) / 2 : 0;
  const rawCenterY = ys.length ? (minOf(ys) + maxOf(ys)) / 2 : 0;
  const rotCenterX = scaleX * (rawCenterX - pathOffsetX);
  const rotCenterY = scaleY * (rawCenterY - pathOffsetY);

  return [
    translate(annotation?.left ?? 0, annotation?.top ?? 0),
    translate(rotCenterX, rotCenterY),
    rotate(annotation?.angle ?? 0),
    translate(-rotCenterX, -rotCenterY),
    scale(scaleX, scaleY),
  ].reduce((acc, matrix) => multiply(acc, matrix));
}

function calloutToRect(callout, pageWidth, pageHeight) {
  const c = callout || {};
  const xs = [
    c.arrowTip?.x ?? 0,
    c.knee?.x ?? 0,
    c.textBoxPosition?.x ?? 0,
    (c.textBoxPosition?.x ?? 0) + (c.textBoxWidth ?? 0),
  ].map((n) => n * (pageWidth || 0));
  const ys = [
    c.arrowTip?.y ?? 0,
    c.knee?.y ?? 0,
    c.textBoxPosition?.y ?? 0,
    (c.textBoxPosition?.y ?? 0) + (c.textBoxHeight ?? 0),
  ].map((n) => n * (pageHeight || 0));

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    type: 'rect',
    left,
    top,
    width: right - left,
    height: bottom - top,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    strokeWidth: 0,
  };
}
