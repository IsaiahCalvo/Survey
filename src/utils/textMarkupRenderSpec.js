/**
 * Text markup (highlight / underline / strikeout / squiggly / redact quads)
 * render spec for the Canvas2D painter.
 *
 * w52 (2026-09-28) "annotations are annotations": the Canvas2D painter
 * (annotationCanvasPainter.js - thumbnails, the zoom/scroll proxy and the
 * eraser raster base) draws text markup from this spec. It is the
 * formula-for-formula twin of renderTextMarkup in svgAnnotationRenderers.jsx
 * (and of SVGAnnotationLayer's uniformTextMarkupElements); the SVG side still
 * carries its own copy because source-assertion tests pin that text
 * (tests/unappliedRedactionWarning, tests/importedPdfAnnotationManipulation).
 * Change one, change the other. Before this the painter had no quads branch
 * and text markup was missing from thumbnails.
 *
 * Worker-safe: no React, fabric or DOM.
 */
import { getTextMarkupUnderlineInset } from './pdfTextMarkup.js';

export const UNAPPLIED_REDACTION_WARNING_COLOR = '#d0021b';
export const DEFAULT_TEXT_MARKUP_COLOR = '#f4d35e';

export const isUniformTextMarkupHighlight = (obj) => (
  obj?.data?.type === 'text-markup'
  && obj.data.markupType === 'highlight'
  && obj.data.overlapMode === 'uniform'
);

const quadPolygon = (q) => [[q.x1, q.y1], [q.x2, q.y2], [q.x4, q.y4], [q.x3, q.y3]];

/** SVG path data for a list of point runs (closed runs end with Z). */
export const textMarkupRunsToSvgD = (runs, closed) => runs.map((points) => (
  points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
  + (closed ? ' Z' : '')
)).join(' ');

/**
 * @returns {null | {
 *   type: string, shapeId: string, key: string,
 *   mode: 'fill' | 'stroke',
 *   runs: number[][][], closed: boolean,
 *   fill: string | null, stroke: string | null, strokeWidth: number | null,
 *   opacity: number, multiply: boolean, overlapMode: string | undefined,
 * }}
 */
export function buildTextMarkupRenderSpec(obj, index = 0) {
  const data = obj?.data || {};
  const type = String(data.markupType || obj?.exportType || '').toLowerCase();
  const quads = Array.isArray(data.quads) ? data.quads : [];
  if (data.type !== 'text-markup' || quads.length === 0) return null;
  const color = (obj.fill && obj.fill !== 'transparent' ? obj.fill : null)
    || (obj.stroke && obj.stroke !== 'transparent' ? obj.stroke : null)
    || DEFAULT_TEXT_MARKUP_COLOR;
  const opacity = Math.max(0, Math.min(1, Number(obj.opacity ?? 0.3)));
  const key = `text-markup-${obj.id || data.id || index}`;
  const shapeId = obj.id || data.id || key;
  // UX: authored weights must survive import, including strokes below our default.
  const lineWidth = Number.isFinite(data.lineWidth) ? Math.max(0, data.lineWidth) : 1.2;

  if (type === 'highlight' || type === 'redact') {
    const isUnappliedImportedRedaction = type === 'redact'
      && obj?.isPdfImported
      && data.applied !== true;
    return {
      type,
      shapeId,
      key,
      mode: 'fill',
      runs: quads.map(quadPolygon),
      closed: true,
      fill: isUnappliedImportedRedaction ? null : type === 'redact' ? '#000000' : color,
      stroke: isUnappliedImportedRedaction ? UNAPPLIED_REDACTION_WARNING_COLOR : null,
      strokeWidth: isUnappliedImportedRedaction ? lineWidth : null,
      opacity: type === 'redact' ? 1 : opacity,
      multiply: data.overlapMode === 'layered',
      overlapMode: data.overlapMode,
    };
  }

  if (type === 'link' && obj?.isPdfImported) return null;

  const runs = quads.map((q) => {
    const height = Math.max(1, Math.hypot(q.x3 - q.x1, q.y3 - q.y1));
    // PDF underline imports paint a thin rect whose center sits just inside
    // the text quad. Match that baseline instead of putting our stroke center
    // on the quad edge, which left the whole stroke too far below the text.
    const underlineInset = type === 'underline'
      ? getTextMarkupUnderlineInset(obj, height, lineWidth)
      : 0;
    const startX = type === 'strikeout' ? (q.x1 + q.x3) / 2 : q.x3;
    const startY = type === 'strikeout' ? (q.y1 + q.y3) / 2 : q.y3 - underlineInset;
    const endX = type === 'strikeout' ? (q.x2 + q.x4) / 2 : q.x4;
    const endY = type === 'strikeout' ? (q.y2 + q.y4) / 2 : q.y4 - underlineInset;
    if (type !== 'squiggly') return [[startX, startY], [endX, endY]];
    const length = Math.max(1, Math.hypot(endX - startX, endY - startY));
    const ux = (endX - startX) / length;
    const uy = (endY - startY) / length;
    const nx = -uy;
    const ny = ux;
    const amplitude = Math.max(0.7, Math.min(1.8, height * 0.12));
    const segments = Math.max(6, Math.ceil(length / 2.5));
    const points = [[startX, startY]];
    for (let i = 1; i <= segments; i += 1) {
      const along = length * i / segments;
      const wave = i % 2 === 0 ? -amplitude : amplitude;
      points.push([startX + ux * along + nx * wave, startY + uy * along + ny * wave]);
    }
    return points;
  });
  return {
    type,
    shapeId,
    key,
    mode: 'stroke',
    runs,
    closed: false,
    fill: null,
    stroke: color,
    strokeWidth: lineWidth,
    opacity,
    multiply: false,
    overlapMode: data.overlapMode,
  };
}

/**
 * Uniform-overlap highlights are painted as ONE merged mask per colour +
 * opacity, beneath every other mark, so overlapping quads never darken where
 * they cross (the SVG layer's uniformTextMarkupElements; export flattens the
 * same groups via drawUniformHighlightMask). The individual highlight itself
 * paints nothing visible.
 */
export function groupUniformTextMarkupHighlights(objects) {
  const groups = new Map();
  for (const obj of objects || []) {
    if (!isUniformTextMarkupHighlight(obj)) continue;
    const color = obj.fill || obj.stroke || DEFAULT_TEXT_MARKUP_COLOR;
    const opacity = Number(obj.opacity ?? 0.3);
    const key = `${color}:${opacity}`;
    if (!groups.has(key)) groups.set(key, { color, opacity, quads: [] });
    groups.get(key).quads.push(...(obj.data.quads || []));
  }
  return Array.from(groups.values()).map((group) => ({
    color: group.color,
    opacity: Math.max(0, Math.min(1, group.opacity)),
    runs: group.quads.map(quadPolygon),
  }));
}
