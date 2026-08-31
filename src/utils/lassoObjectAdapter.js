import { createInkPathAffine } from './inkGeometryTransform.js';
import { normalizeOperationalInkPath } from './inkPathNormalization.js';
import { commandsToPolylines, sweptDiskPolygon } from './paperAnnotationGeometry.js';
import { buildArrowheadRenderSpec, ARROWHEAD_STYLES } from './lineRenderHelpers.js';
import { distanceToLineSegment, getCurveEndAngle, getPointOnCurve } from './lineGeometry.js';
import { computeLineBboxCenter, getAnnotationBBox, getLineEndpoints } from './svgBoundingBox.js';
import { getCounterRenderGeometry } from './counterGeometry.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-7;

const finitePoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);

const rotatePoint = (point, angle, center) => {
  if (!angle) return point;
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
};

const boundsForOutlines = (outlines) => {
  const points = outlines.flat().filter(finitePoint);
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs), right: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(...ys),
  };
};

const makeGeometry = (outlines, interiorSelectable = false) => {
  const clean = outlines
    .map((outline) => outline.filter(finitePoint))
    .filter((outline) => outline.length > 0);
  const bounds = boundsForOutlines(clean);
  return bounds ? { outlines: clean, bounds, interiorSelectable } : null;
};

const hasVisiblePaint = (paint) => paint != null
  && String(paint).trim() !== ''
  && String(paint).toLowerCase() !== 'none'
  && String(paint).toLowerCase() !== 'transparent'
  && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(String(paint));

const rectangleOutline = (left, top, width, height, angle = 0, pad = 0) => {
  const l = left - pad;
  const t = top - pad;
  const r = left + width + pad;
  const b = top + height + pad;
  const center = { x: left + width / 2, y: top + height / 2 };
  return [
    { x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b },
  ].map((point) => rotatePoint(point, angle, center));
};

const ellipseOutline = (cx, cy, rx, ry, angle = 0, pad = 0) => {
  const points = [];
  const steps = Math.max(24, Math.ceil(Math.PI * Math.sqrt(Math.max(rx + pad, ry + pad, 1))));
  for (let index = 0; index < steps; index += 1) {
    const theta = TAU * index / steps;
    points.push(rotatePoint({
      x: cx + (rx + pad) * Math.cos(theta),
      y: cy + (ry + pad) * Math.sin(theta),
    }, angle, { x: cx, y: cy }));
  }
  return points;
};

const strokeOutlines = (points, radius, closed = false) => {
  if (!points.length) return [];
  const centerline = closed && points.length > 1
    ? [...points, points[0]]
    : points;
  if (!(radius > EPSILON)) return [centerline];
  const polygonSet = sweptDiskPolygon(centerline, radius, { curveTolerance: 0.5 });
  const rings = [];
  for (const polygon of polygonSet || []) {
    for (const ring of polygon || []) {
      rings.push(ring.map(([x, y]) => ({ x, y })));
    }
  }
  return rings.length ? rings : [centerline];
};

const pointsFromString = (value) => String(value || '').trim().split(/\s+/).map((pair) => {
  const [x, y] = pair.split(',').map(Number);
  return { x, y };
}).filter(finitePoint);

const arrowheadOutlines = (spec) => {
  if (!spec || spec.kind === 'none') return [];
  if (spec.kind === 'solidTriangle' || spec.kind === 'openTriangle') {
    const local = pointsFromString(spec.polygon?.points);
    const angle = Number(spec.angleDeg) || 0;
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const points = local.map((point) => ({
      x: spec.tipX + point.x * cos - point.y * sin,
      y: spec.tipY + point.x * sin + point.y * cos,
    }));
    const radius = spec.kind === 'openTriangle' ? (Number(spec.polygon?.strokeWidth) || 0) / 2 : 0;
    return radius > EPSILON ? strokeOutlines(points, radius, true) : [points];
  }
  if (spec.kind === 'openCircle') {
    return [ellipseOutline(
      spec.circle.cx, spec.circle.cy, spec.circle.r, spec.circle.r, 0,
      (Number(spec.circle.strokeWidth) || 0) / 2,
    )];
  }
  if (spec.kind === 'vShape') {
    return strokeOutlines(
      pointsFromString(spec.polyline?.points),
      (Number(spec.polyline?.strokeWidth) || 0) / 2,
    );
  }
  if (spec.kind === 'horizontalLine') {
    return strokeOutlines([
      { x: spec.line.x1, y: spec.line.y1 },
      { x: spec.line.x2, y: spec.line.y2 },
    ], (Number(spec.line.strokeWidth) || 0) / 2);
  }
  return [];
};

const geometryFromLine = (annotation, offset = { x: 0, y: 0 }) => {
  let endpoints;
  if (offset.x || offset.y) {
    endpoints = {
      x1: offset.x + (annotation.x1 ?? 0),
      y1: offset.y + (annotation.y1 ?? 0),
      x2: offset.x + (annotation.x2 ?? 0),
      y2: offset.y + (annotation.y2 ?? 0),
    };
  } else {
    endpoints = getLineEndpoints(annotation);
  }
  const start = { x: endpoints.x1, y: endpoints.y1 };
  const end = { x: endpoints.x2, y: endpoints.y2 };
  const storedMidpoint = annotation.data?.midpoint;
  const midpoint = finitePoint(storedMidpoint) ? {
    x: storedMidpoint.x + (offset.x || 0),
    y: storedMidpoint.y + (offset.y || 0),
  } : null;
  const curved = midpoint && distanceToLineSegment(midpoint, start, end) > 1;
  const centerline = curved
    ? Array.from({ length: 33 }, (_, index) => getPointOnCurve(start, end, midpoint, index / 32))
    : [start, end];
  const strokeWidth = Math.max(0, Number(annotation.strokeWidth) || 1);
  const arrowStyle = annotation.data?.arrowheadStyle
    ?? (annotation.tool === 'arrow' ? ARROWHEAD_STYLES.SOLID_TRIANGLE : ARROWHEAD_STYLES.NONE);
  const arrowAngle = curved
    ? getCurveEndAngle(start, end, midpoint)
    : Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  const outlines = [
    ...strokeOutlines(centerline, strokeWidth / 2),
    ...arrowheadOutlines(buildArrowheadRenderSpec(
      arrowStyle, end.x, end.y, arrowAngle, annotation.stroke || '#000', strokeWidth,
    )),
  ];
  const angle = Number(annotation.angle) || 0;
  if (!angle) return makeGeometry(outlines);
  const center = computeLineBboxCenter(endpoints, midpoint);
  return makeGeometry(outlines.map((outline) => (
    outline.map((point) => rotatePoint(point, angle, center))
  )));
};

const geometryFromPoints = (annotation, closed) => {
  const raw = Array.isArray(annotation.points) ? annotation.points : [];
  if (!raw.length) return null;
  const offsetX = annotation.pathOffset?.x || 0;
  const offsetY = annotation.pathOffset?.y || 0;
  const sx = annotation.scaleX ?? 1;
  const sy = annotation.scaleY ?? 1;
  const left = annotation.left ?? 0;
  const top = annotation.top ?? 0;
  let points = raw.map((point) => ({
    x: left + sx * ((point?.x ?? 0) - offsetX),
    y: top + sy * ((point?.y ?? 0) - offsetY),
  }));
  const bounds = boundsForOutlines([points]);
  const center = bounds
    ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
    : { x: left, y: top };
  points = points.map((point) => rotatePoint(point, annotation.angle || 0, center));
  const radius = Math.max(0, Number(annotation.strokeWidth) || 0) / 2;
  const outlines = strokeOutlines(points, radius, closed);
  if (closed && radius <= EPSILON) outlines[0] = points;
  return makeGeometry(outlines);
};

const geometryFromPath = (annotation) => {
  const commands = normalizeOperationalInkPath(annotation.path || []);
  if (!commands.length) return null;
  const affine = createInkPathAffine(annotation, commands);
  const polylines = commandsToPolylines(commands, 0.5);
  const outlines = [];
  const radius = Math.max(0, Number(annotation.strokeWidth) || 0) / 2;
  for (const polyline of polylines) {
    const localPoints = (polyline.points || []).map((point) => ({ x: point.x, y: point.y }));
    if (annotation.strokeUniform === true) {
      const pagePoints = localPoints.map((point) => affine.point(point.x, point.y));
      outlines.push(...strokeOutlines(pagePoints, radius, polyline.closed));
    } else {
      const localOutlines = strokeOutlines(localPoints, radius, polyline.closed);
      outlines.push(...localOutlines.map((outline) => (
        outline.map((point) => affine.point(point.x, point.y))
      )));
    }
  }
  return makeGeometry(outlines);
};

const geometryFromCounter = (annotation) => {
  const radius = (Number(annotation.radius) || 14) * Math.abs(Number(annotation.scaleX) || 1);
  const centerX = (Number(annotation.left) || 0) + radius;
  const centerY = (Number(annotation.top) || 0) + radius;
  const rendered = getCounterRenderGeometry(
    centerX, centerY, radius, Number(annotation.data?.pointerAngle ?? 225),
    annotation.data?.displayNumber ?? 1,
  );
  const startAngle = Math.atan2(rendered.tangent1.y - centerY, rendered.tangent1.x - centerX);
  let endAngle = Math.atan2(rendered.tangent2.y - centerY, rendered.tangent2.x - centerX);
  while (endAngle <= startAngle) endAngle += TAU;
  if (endAngle - startAngle < Math.PI) endAngle += TAU;
  const outline = [rendered.tip, rendered.tangent1];
  for (let index = 1; index <= 48; index += 1) {
    const theta = startAngle + (endAngle - startAngle) * index / 48;
    outline.push({
      x: centerX + Math.cos(theta) * radius,
      y: centerY + Math.sin(theta) * radius,
    });
  }
  outline.push(rendered.tangent2);
  return makeGeometry([outline]);
};

const geometryFromTextMarkup = (annotation) => {
  const outlines = (Array.isArray(annotation?.data?.quads) ? annotation.data.quads : [])
    .map((quad) => [
      { x: Number(quad?.x1), y: Number(quad?.y1) },
      { x: Number(quad?.x2), y: Number(quad?.y2) },
      { x: Number(quad?.x4), y: Number(quad?.y4) },
      { x: Number(quad?.x3), y: Number(quad?.y3) },
    ])
    .filter((outline) => outline.every(finitePoint));
  if (outlines.length) return makeGeometry(outlines, true);
  const bbox = getAnnotationBBox(annotation);
  return makeGeometry([rectangleOutline(bbox.left, bbox.top, bbox.width, bbox.height)], true);
};

const geometryFromGroup = (annotation) => {
  if (annotation?.data?.type === 'counter') {
    return geometryFromCounter(annotation);
  }
  const children = Array.isArray(annotation.objects) ? annotation.objects : [];
  const outlines = [];
  for (const child of children) {
    if (!child) continue;
    let geometry = null;
    const childType = String(child.type || '').toLowerCase();
    if (childType === 'line') {
      geometry = geometryFromLine(child, { x: annotation.left ?? 0, y: annotation.top ?? 0 });
    } else {
      geometry = annotationToLassoGeometry({
        ...child,
        left: (annotation.left ?? 0) + (child.left ?? 0),
        top: (annotation.top ?? 0) + (child.top ?? 0),
      });
    }
    if (geometry) outlines.push(...geometry.outlines);
  }
  if (!outlines.length) {
    const bbox = getAnnotationBBox(annotation);
    outlines.push(rectangleOutline(bbox.left, bbox.top, bbox.width, bbox.height, bbox.angle || 0));
  }
  const origin = { x: annotation.left ?? 0, y: annotation.top ?? 0 };
  const sx = Number.isFinite(Number(annotation.scaleX)) ? Number(annotation.scaleX) : 1;
  const sy = Number.isFinite(Number(annotation.scaleY)) ? Number(annotation.scaleY) : 1;
  const skewX = Math.tan((Number(annotation.skewX) || 0) * Math.PI / 180);
  const skewY = Math.tan((Number(annotation.skewY) || 0) * Math.PI / 180);
  if (sx !== 1 || sy !== 1 || skewX || skewY) {
    for (const outline of outlines) {
      for (let index = 0; index < outline.length; index += 1) {
        const dx = (outline[index].x - origin.x) * sx;
        const dy = (outline[index].y - origin.y) * sy;
        outline[index] = {
          x: origin.x + dx + skewX * dy,
          y: origin.y + dy + skewY * dx,
        };
      }
    }
  }
  const groupBounds = boundsForOutlines(outlines);
  if (groupBounds && annotation.angle) {
    const center = {
      x: (groupBounds.left + groupBounds.right) / 2,
      y: (groupBounds.top + groupBounds.bottom) / 2,
    };
    return makeGeometry(outlines.map((outline) => (
      outline.map((point) => rotatePoint(point, annotation.angle, center))
    )));
  }
  return makeGeometry(outlines);
};

export function annotationToLassoGeometry(annotation) {
  if (!annotation?.type) return null;
  const type = String(annotation?.type || '').toLowerCase();
  const strokeScale = annotation.strokeUniform === true
    ? 1
    : Math.max(Math.abs(Number(annotation.scaleX) || 1), Math.abs(Number(annotation.scaleY) || 1));
  const strokePad = Math.max(0, Number(annotation?.strokeWidth) || 0) * strokeScale / 2;

  if (annotation.data?.type === 'counter') return geometryFromCounter(annotation);
  if (annotation.data?.type === 'text-markup') return geometryFromTextMarkup(annotation);

  if (type === 'path') return geometryFromPath(annotation);
  if (type === 'line') return geometryFromLine(annotation);
  if (type === 'polygon') return geometryFromPoints(annotation, true);
  if (type === 'polyline') return geometryFromPoints(annotation, false);
  if (type === 'group') return geometryFromGroup(annotation);

  if (['textbox', 'i-text', 'text'].includes(type)
    && Number.isFinite(Number(annotation.width))
    && Number.isFinite(Number(annotation.height))) {
    const width = Number(annotation.width) * Math.abs(Number(annotation.scaleX) || 1);
    const height = Number(annotation.height) * Math.abs(Number(annotation.scaleY) || 1);
    return makeGeometry([rectangleOutline(
      Number(annotation.left) || 0,
      Number(annotation.top) || 0,
      width,
      height,
      Number(annotation.angle) || 0,
      strokePad,
    )], hasVisiblePaint(annotation.backgroundColor || annotation.fill));
  }

  const bbox = getAnnotationBBox(annotation);
  if (!bbox) return null;
  if (type === 'circle' || type === 'ellipse') {
    return makeGeometry([ellipseOutline(
      bbox.left + bbox.width / 2,
      bbox.top + bbox.height / 2,
      bbox.width / 2,
      bbox.height / 2,
      bbox.angle || 0,
      strokePad,
    )], hasVisiblePaint(annotation.fill));
  }
  if (type === 'triangle') {
    const center = { x: bbox.left + bbox.width / 2, y: bbox.top + bbox.height / 2 };
    const points = [
      { x: center.x, y: bbox.top - strokePad },
      { x: bbox.left + bbox.width + strokePad, y: bbox.top + bbox.height + strokePad },
      { x: bbox.left - strokePad, y: bbox.top + bbox.height + strokePad },
    ].map((point) => rotatePoint(point, bbox.angle || 0, center));
    return makeGeometry([points], hasVisiblePaint(annotation.fill));
  }
  return makeGeometry([rectangleOutline(
    bbox.left, bbox.top, bbox.width, bbox.height, bbox.angle || 0, strokePad,
  )], hasVisiblePaint(annotation.fill));
}

export function calloutToLassoGeometry(callout, pageWidth, pageHeight) {
  if (!callout || !callout.id || callout.hidden || callout.deleted || callout.blocked || callout.locked) return null;
  const point = (value) => ({
    x: (value?.x ?? 0) * (pageWidth || 0),
    y: (value?.y ?? 0) * (pageHeight || 0),
  });
  const arrowTip = point(callout.arrowTip);
  const knee = point(callout.knee);
  const textLeft = (callout.textBoxPosition?.x ?? 0) * (pageWidth || 0);
  const textTop = (callout.textBoxPosition?.y ?? 0) * (pageHeight || 0);
  const textWidth = (callout.textBoxWidth ?? 0) * (pageWidth || 0);
  const textHeight = (callout.textBoxHeight ?? 0) * (pageHeight || 0);
  const textCenter = { x: textLeft + textWidth / 2, y: textTop + textHeight / 2 };
  const radius = Math.max(1, Number(callout.style?.lineThickness || callout.lineThickness || 2)) / 2;
  const arrowAngle = Math.atan2(arrowTip.y - knee.y, arrowTip.x - knee.x) * 180 / Math.PI;
  const arrowStyle = callout.style?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE;
  return makeGeometry([
    ...strokeOutlines([arrowTip, knee, textCenter], radius),
    ...arrowheadOutlines(buildArrowheadRenderSpec(
      arrowStyle, arrowTip.x, arrowTip.y, arrowAngle,
      callout.style?.lineColor || callout.lineColor || '#000', radius * 2,
    )),
    rectangleOutline(textLeft, textTop, textWidth, textHeight, 0, radius),
  ]);
}
