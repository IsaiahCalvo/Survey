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
    'paperEraserGeometry', 'pathOffset', 'left', 'top', 'width', 'height',
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
