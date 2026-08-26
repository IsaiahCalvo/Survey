import {
  boundsOfCommands,
  compactPoints,
  createInkAnnotation,
} from './paperAnnotationGeometry.js';

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
  const centerline = compactPoints(points, 0.01);
  if (!id || centerline.length === 0) return null;

  const ink = createInkAnnotation(centerline, {
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
    data: { ...(data || {}), id, tool: normalizedTool },
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

/**
 * Select Width used to patch leftover sourceWidth only. The page / export
 * paint the baked filled outline (path + polygons), so the screen stayed
 * the old width until a new stroke was drawn. Restroke from the live
 * centerline. Skip when there is no centerline (imported outlines) or
 * when eraser cuts exist (restroking the full centerline would restore
 * erased bits).
 */
export function rebuildProductionPaperInkWidth(annotation, width) {
  const nextWidth = Number(width);
  if (!annotation || !Number.isFinite(nextWidth) || nextWidth <= 0) {
    return { sourceWidth: width };
  }
  const centerline = Array.isArray(annotation.paperCenterline)
    ? annotation.paperCenterline
    : null;
  const hasEraser = Boolean(annotation.paperEraserGeometry)
    || (Array.isArray(annotation.paperEraserCuts) && annotation.paperEraserCuts.length > 0);
  if (!centerline?.length || hasEraser) {
    return { sourceWidth: nextWidth };
  }

  const rebuilt = createProductionPaperInk({
    id: annotation.id || annotation.data?.id,
    tool: annotation.tool === 'highlighter' ? 'highlighter' : 'pen',
    points: centerline,
    color: annotation.fill,
    width: nextWidth,
    data: annotation.data,
  });
  if (!rebuilt) return { sourceWidth: nextWidth };

  return {
    sourceWidth: rebuilt.sourceWidth,
    path: rebuilt.path,
    polygons: rebuilt.polygons,
    width: rebuilt.width,
    height: rebuilt.height,
    paperCenterline: rebuilt.paperCenterline,
    paperInkGeometry: rebuilt.paperInkGeometry,
    fillRule: rebuilt.fillRule,
    stroke: 'transparent',
    strokeWidth: 0,
  };
}
