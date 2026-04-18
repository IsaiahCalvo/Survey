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
      return { ...base, radius: a.radius ?? 0, width: a.width ?? 0, height: a.height ?? 0 };

    case 'ellipse':
      return {
        ...base,
        rx: a.rx ?? 0,
        ry: a.ry ?? 0,
        width: a.width ?? 0,
        height: a.height ?? 0,
      };

    case 'line':
      return {
        ...base,
        x1: a.x1 ?? 0,
        y1: a.y1 ?? 0,
        x2: a.x2 ?? 0,
        y2: a.y2 ?? 0,
      };

    case 'polyline':
    case 'polygon':
      return { ...base, points: a.points ?? [] };

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
