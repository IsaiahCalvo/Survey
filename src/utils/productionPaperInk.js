import {
  boundsOfCommands,
  compactPoints,
  createInkAnnotation,
  polygonSetToCommands,
} from './paperAnnotationGeometry.js';
import { variableWidthPolygon } from './penWidthInk.js';

/**
 * Nightly 'pen-types': ink whose width varies along the stroke. `factors`
 * holds one width factor per centerline point (1 = the picked width).
 * Same result shape as createInkAnnotation.
 */
export function createVariableInk(centerline, factors, { id, color, width }) {
  const w = Math.max(0.5, Number(width) || 2);
  const radii = centerline.map((_, i) => Math.max(0.25, (w * (Number(factors[i]) || 1)) / 2));
  const polygons = variableWidthPolygon(centerline, radii);
  return {
    id, type: 'ink', source: 'drawn', cmds: polygonSetToCommands(polygons), polygons,
    fill: color, stroke: null, strokeWidth: 0, sourceWidth: w,
  };
}

// Compact like compactPoints(…, 0.01) but keep each point's width factor.
function compactWithFactors(points) {
  const kept = [];
  const factors = [];
  for (const point of points || []) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.01) {
      kept.push({ x: point.x, y: point.y });
      factors.push(Number.isFinite(point.f) ? point.f : 1);
    }
  }
  return { centerline: kept, factors };
}

export const PAPER_INK_GEOMETRY_VERSION = 'v1';

export function createProductionPaperInk({
  id,
  tool = 'pen',
  points,
  color,
  width,
  sloppiness = 0,
  data,
  ...metadata
} = {}) {
  // Pen types (Nightly): points carrying a width factor f draw variable ink.
  const variable = tool !== 'highlighter' && Array.isArray(points) && points.some((p) => Number.isFinite(p?.f));
  const compacted = variable ? compactWithFactors(points) : null;
  const centerline = variable ? compacted.centerline : compactPoints(points, 0.01);
  if (!id || centerline.length === 0) return null;
  const penWidths = variable ? compacted.factors.map((f) => Math.round(f * 1000) / 1000) : null;

  const ink = variable
    ? createVariableInk(centerline, penWidths, { id, color, width })
    : createInkAnnotation(centerline, {
      id,
      color,
      width,
      sloppiness,
    });
  const bounds = boundsOfCommands(ink.cmds);
  const normalizedTool = tool === 'highlighter' ? 'highlighter' : 'pen';
  const persistentMetadata = { ...metadata };
  for (const key of [
    'type', 'path', 'polygons', 'paperCenterline', 'paperCenterlineRuns',
    'paperInkGeometry',
    'paperEraserGeometry', 'paperSourceStroke', 'paperEraserCuts',
    'pathOffset', 'left', 'top', 'width', 'height',
    'originX', 'originY',
    'scaleX', 'scaleY', 'angle', 'fill', 'fillRule', 'stroke', 'strokeWidth',
    'sourceWidth', 'globalCompositeOperation',
  ]) {
    delete persistentMetadata[key];
  }

  return {
    ...persistentMetadata,
    type: 'path',
    id,
    tool: normalizedTool,
    data: { ...(data || {}), id, tool: normalizedTool, ...(penWidths ? { penWidths } : {}) },
    path: ink.cmds,
    polygons: ink.polygons,
    paperCenterline: centerline,
    paperInkGeometry: PAPER_INK_GEOMETRY_VERSION,
    fillRule: 'evenodd',
    fill: ink.fill,
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: ink.sourceWidth,
    left: 0,
    top: 0,
    width: bounds.w,
    height: bounds.h,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    perPixelTargetFind: true,
    uniformScaling: false,
    centeredRotation: true,
    ...(normalizedTool === 'highlighter'
      ? { globalCompositeOperation: 'multiply' }
      : {}),
  };
}
