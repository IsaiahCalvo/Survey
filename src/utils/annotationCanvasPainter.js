import { calculateCalloutConnection } from './calloutGeometry.js';
import { renderPathToSvgAttrs } from './svgPathAttrs.js';

const MAX_RASTER_SCALE = 2.5;
const MAX_BACKING_DIMENSION = 8192;
const MAX_BACKING_PIXELS = 4 * 1024 * 1024;
const DEFAULT_CALLOUT_COLOR = '#4A90E2';
const DEFAULT_CALLOUT_FILL = 'rgba(255,255,255,0.22)';

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampOpacity = (value) => Math.max(0, Math.min(1, toNumber(value, 1)));

const isVisiblePaint = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== ''
    && normalized !== 'none'
    && normalized !== 'transparent'
    && normalized !== 'rgba(0,0,0,0)'
    && normalized !== 'rgba(0, 0, 0, 0)';
};

export function calculateAnnotationCanvasBackingStore({
  pageWidth,
  pageHeight,
  displayScale,
  devicePixelRatio = 1,
}) {
  const safeWidth = Math.max(1, toNumber(pageWidth, 1));
  const safeHeight = Math.max(1, toNumber(pageHeight, 1));
  const safeDisplayScale = Math.max(0.01, toNumber(displayScale, 1));
  const safeDpr = Math.max(1, Math.min(2, toNumber(devicePixelRatio, 1)));
  const requestedScale = Math.min(safeDisplayScale, MAX_RASTER_SCALE) * safeDpr;
  const requestedWidth = safeWidth * requestedScale;
  const requestedHeight = safeHeight * requestedScale;
  const dimensionFactor = Math.min(
    1,
    MAX_BACKING_DIMENSION / requestedWidth,
    MAX_BACKING_DIMENSION / requestedHeight,
  );
  const areaFactor = Math.min(
    1,
    Math.sqrt(MAX_BACKING_PIXELS / (requestedWidth * requestedHeight)),
  );
  const budgetFactor = Math.min(dimensionFactor, areaFactor);
  const drawScale = requestedScale * budgetFactor;

  return {
    width: Math.max(1, Math.floor(safeWidth * drawScale)),
    height: Math.max(1, Math.floor(safeHeight * drawScale)),
    drawScale,
    clamped: safeDisplayScale > MAX_RASTER_SCALE || budgetFactor < 0.9999,
  };
}

export function traceFabricPath(context, commands) {
  context.beginPath();
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  for (const segment of commands || []) {
    if (!Array.isArray(segment) || segment.length === 0) continue;
    const op = String(segment[0]).toUpperCase();
    if (op === 'M') {
      currentX = toNumber(segment[1]);
      currentY = toNumber(segment[2]);
      startX = currentX;
      startY = currentY;
      context.moveTo(currentX, currentY);
    } else if (op === 'L') {
      currentX = toNumber(segment[1]);
      currentY = toNumber(segment[2]);
      context.lineTo(currentX, currentY);
    }
    else if (op === 'Q') {
      context.quadraticCurveTo(
        toNumber(segment[1]),
        toNumber(segment[2]),
        toNumber(segment[3]),
        toNumber(segment[4]),
      );
      currentX = toNumber(segment[3]);
      currentY = toNumber(segment[4]);
    } else if (op === 'C') {
      context.bezierCurveTo(
        toNumber(segment[1]),
        toNumber(segment[2]),
        toNumber(segment[3]),
        toNumber(segment[4]),
        toNumber(segment[5]),
        toNumber(segment[6]),
      );
      currentX = toNumber(segment[5]);
      currentY = toNumber(segment[6]);
    } else if (op === 'H') {
      currentX = toNumber(segment[1]);
      context.lineTo(currentX, currentY);
    } else if (op === 'V') {
      currentY = toNumber(segment[1]);
      context.lineTo(currentX, currentY);
    }
    else if (op === 'A' && segment.length >= 3) {
      currentX = toNumber(segment[segment.length - 2]);
      currentY = toNumber(segment[segment.length - 1]);
      context.lineTo(currentX, currentY);
    } else if (op === 'Z') {
      context.closePath();
      currentX = startX;
      currentY = startY;
    }
  }
}

function pathBounds(commands) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of commands || []) {
    for (let index = 1; index + 1 < segment.length; index += 2) {
      const x = Number(segment[index]);
      const y = Number(segment[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function applyBlendAndOpacity(context, object, opacityOverride = null) {
  context.globalAlpha = clampOpacity(opacityOverride ?? object?.opacity ?? 1);
  context.globalCompositeOperation = object?.globalCompositeOperation === 'multiply'
    ? 'multiply'
    : 'source-over';
}

function applyRotation(context, angle, centerX, centerY) {
  if (!angle) return;
  context.translate(centerX, centerY);
  context.rotate((angle * Math.PI) / 180);
  context.translate(-centerX, -centerY);
}

function paintCurrentPath(context, { fill, stroke, strokeWidth, fillRule = 'nonzero' }) {
  if (isVisiblePaint(fill)) {
    context.fillStyle = fill;
    context.fill(fillRule);
  }
  if (isVisiblePaint(stroke) && strokeWidth > 0) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.stroke();
  }
}

function drawPath(context, object, displayScale) {
  if (!Array.isArray(object?.path) || object.path.length === 0) return;
  const attrs = renderPathToSvgAttrs(object);
  const left = toNumber(object.left);
  const top = toNumber(object.top);
  const scaleX = toNumber(object.scaleX, 1) || 1;
  const scaleY = toNumber(object.scaleY, 1) || 1;
  const pathOffsetX = toNumber(object.pathOffset?.x);
  const pathOffsetY = toNumber(object.pathOffset?.y);
  const bounds = pathBounds(object.path);
  const rotationCenterX = bounds
    ? scaleX * ((bounds.minX + bounds.maxX) / 2 - pathOffsetX)
    : 0;
  const rotationCenterY = bounds
    ? scaleY * ((bounds.minY + bounds.maxY) / 2 - pathOffsetY)
    : 0;

  context.save();
  applyBlendAndOpacity(context, object, attrs.opacity);
  context.translate(left, top);
  applyRotation(context, toNumber(object.angle), rotationCenterX, rotationCenterY);
  context.scale(scaleX, scaleY);
  context.translate(-pathOffsetX, -pathOffsetY);
  context.lineCap = attrs.strokeLinecap || 'round';
  context.lineJoin = attrs.strokeLinejoin || 'round';
  traceFabricPath(context, object.path);

  const objectScale = Math.max(0.001, Math.sqrt(Math.abs(scaleX * scaleY)));
  const strokeWidth = attrs.vectorEffect === 'non-scaling-stroke'
    ? toNumber(attrs.strokeWidth, 1) / Math.max(0.01, displayScale * objectScale)
    : toNumber(attrs.strokeWidth, 1);
  paintCurrentPath(context, {
    fill: attrs.fill,
    stroke: attrs.stroke,
    strokeWidth,
    fillRule: attrs.fillRule || 'nonzero',
  });
  context.restore();
}

function beginObjectTransform(context, object) {
  const width = Math.abs(toNumber(object?.width));
  const height = Math.abs(toNumber(object?.height));
  const scaleX = toNumber(object?.scaleX, 1) || 1;
  const scaleY = toNumber(object?.scaleY, 1) || 1;
  context.save();
  applyBlendAndOpacity(context, object);
  context.translate(toNumber(object?.left), toNumber(object?.top));
  applyRotation(
    context,
    toNumber(object?.angle),
    (width * scaleX) / 2,
    (height * scaleY) / 2,
  );
  context.scale(scaleX, scaleY);
  return { width, height };
}

function paintShapeStyle(context, object) {
  if (typeof context.setLineDash === 'function') {
    context.setLineDash(Array.isArray(object?.strokeDashArray) ? object.strokeDashArray : []);
  }
  paintCurrentPath(context, {
    fill: object?.fill,
    stroke: isVisiblePaint(object?.stroke) ? object.stroke : null,
    strokeWidth: Math.max(0, toNumber(object?.strokeWidth, 1)),
  });
}

function drawArrowHead(context, x1, y1, x2, y2, stroke, strokeWidth) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(6, strokeWidth * 3);
  context.save();
  context.translate(x2, y2);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(0, -size / 2);
  context.lineTo(size, 0);
  context.lineTo(0, size / 2);
  context.closePath();
  context.fillStyle = stroke;
  context.fill();
  context.restore();
}

function drawLine(context, object) {
  context.save();
  applyBlendAndOpacity(context, object);
  const left = toNumber(object?.left);
  const top = toNumber(object?.top);
  const x1 = left + toNumber(object?.x1);
  const y1 = top + toNumber(object?.y1);
  const x2 = left + toNumber(object?.x2);
  const y2 = top + toNumber(object?.y2);
  const stroke = isVisiblePaint(object?.stroke) ? object.stroke : '#111111';
  const strokeWidth = Math.max(0.5, toNumber(object?.strokeWidth, 1));
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.strokeStyle = stroke;
  context.lineWidth = strokeWidth;
  context.lineCap = object?.strokeLineCap || 'round';
  context.stroke();
  if (String(object?.tool || '').toLowerCase() === 'arrow') {
    drawArrowHead(context, x1, y1, x2, y2, stroke, strokeWidth);
  }
  context.restore();
}

function drawPoints(context, object, close) {
  if (!Array.isArray(object?.points) || object.points.length === 0) return;
  beginObjectTransform(context, object);
  context.beginPath();
  object.points.forEach((point, index) => {
    const x = toNumber(point?.x);
    const y = toNumber(point?.y);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  if (close) context.closePath();
  paintCurrentPath(context, {
    fill: close ? object.fill : null,
    stroke: isVisiblePaint(object.stroke) ? object.stroke : '#111111',
    strokeWidth: Math.max(0.5, toNumber(object.strokeWidth, 1)),
  });
  context.restore();
}

function drawText(context, object) {
  const { width, height } = beginObjectTransform(context, object);
  const text = String(object?.text || '');
  const fontSize = Math.max(1, toNumber(object?.fontSize, 12));
  const fontFamily = String(object?.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '');
  context.font = `${object?.fontStyle || 'normal'} ${object?.fontWeight || 'normal'} ${fontSize}px ${fontFamily}`;
  context.textBaseline = 'top';
  context.fillStyle = isVisiblePaint(object?.fill)
    ? object.fill
    : (isVisiblePaint(object?.stroke) ? object.stroke : '#111111');
  const lineHeight = fontSize * Math.max(1, toNumber(object?.lineHeight, 1.16));
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const y = index * lineHeight;
    if (height > 0 && y > height) break;
    context.fillText(lines[index], 0, y, width || undefined);
  }
  context.restore();
}

// Counter pins are stored as Fabric Circle JSON with `radius` (NOT width/height
// — they are hand-built in the counter tool, so base-object width/height are
// absent). Geometry and styling must mirror renderCounter in
// svgAnnotationRenderers.jsx exactly (Shottr-style pin: one filled path that
// merges the bubble with a triangular nubbin via tangent lines, plus a centered
// number), or the pin visibly changes whenever this painter serves a frame.
function drawCounter(context, object) {
  const radius = Math.max(1, toNumber(object?.radius, 14) * Math.abs(toNumber(object?.scaleX, 1) || 1));
  const centerX = toNumber(object?.left) + radius;
  const centerY = toNumber(object?.top) + radius;
  const color = isVisiblePaint(object?.fill)
    ? object.fill
    : (isVisiblePaint(object?.data?.color) ? object.data.color : '#ef4444');
  const pointerAngleDeg = object?.data?.pointerAngle != null ? toNumber(object.data.pointerAngle, 225) : 225;

  const angleRad = (pointerAngleDeg * Math.PI) / 180;
  const tipExtension = Math.max(5, radius * 0.5);
  const tipDistance = radius + tipExtension;
  const tipX = centerX + Math.cos(angleRad) * tipDistance;
  const tipY = centerY + Math.sin(angleRad) * tipDistance;
  const tangentHalfAngle = Math.acos(radius / tipDistance);
  const t1Angle = angleRad + tangentHalfAngle;
  const t2Angle = angleRad - tangentHalfAngle;

  context.save();
  applyBlendAndOpacity(context, object);
  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(centerX + Math.cos(t1Angle) * radius, centerY + Math.sin(t1Angle) * radius);
  // Sweep the bubble the long way around (away from the nubbin) — the canvas
  // clockwise arc from t1 to t2 matches the SVG large-arc/sweep=1 path.
  context.arc(centerX, centerY, radius, t1Angle, t2Angle, false);
  context.closePath();
  context.fillStyle = color;
  context.fill();

  const label = String(object?.data?.displayNumber ?? 1);
  if (label) {
    const fontSize = Math.max(11, radius * 1.05);
    context.font = `700 ${fontSize}px -apple-system, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = isVisiblePaint(object?.data?.numberColor) ? object.data.numberColor : '#ffffff';
    context.fillText(label, centerX, centerY);
  }
  context.restore();
}

function drawGroup(context, object, displayScale) {
  const children = Array.isArray(object?.objects) ? object.objects : [];
  const line = children.find((child) => String(child?.type || '').toLowerCase() === 'line');
  if (line) {
    drawLine(context, {
      ...line,
      left: toNumber(object.left) + toNumber(line.left),
      top: toNumber(object.top) + toNumber(line.top),
      opacity: object.opacity ?? line.opacity,
      stroke: line.stroke ?? object.stroke,
      strokeWidth: line.strokeWidth ?? object.strokeWidth,
      tool: object.tool || (children.some((child) => child?.name === 'arrowHead' || child?.type === 'triangle') ? 'arrow' : line.tool),
    });
    return;
  }
  context.save();
  context.translate(toNumber(object.left), toNumber(object.top));
  context.scale(toNumber(object.scaleX, 1) || 1, toNumber(object.scaleY, 1) || 1);
  children.forEach((child) => drawAnnotationObject(context, child, displayScale));
  context.restore();
}

export function drawAnnotationObject(context, object, displayScale = 1) {
  if (!context || !object) return;
  const type = String(object.type || '').toLowerCase();
  if (type === 'path') {
    drawPath(context, object, displayScale);
    return;
  }
  if (type === 'line') {
    drawLine(context, object);
    return;
  }
  if (type === 'polygon') {
    drawPoints(context, object, true);
    return;
  }
  if (type === 'polyline') {
    drawPoints(context, object, false);
    return;
  }
  if (type === 'group') {
    drawGroup(context, object, displayScale);
    return;
  }
  if (object?.data?.type === 'counter') {
    drawCounter(context, object);
    return;
  }
  if (type === 'textbox' || type === 'i-text' || type === 'text') {
    drawText(context, object);
    return;
  }

  const { width, height } = beginObjectTransform(context, object);
  context.beginPath();
  if (type === 'circle' || type === 'ellipse') {
    context.ellipse(width / 2, height / 2, Math.max(0.5, width / 2), Math.max(0.5, height / 2), 0, 0, Math.PI * 2);
  } else if (type === 'triangle') {
    context.moveTo(width / 2, 0);
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
  } else {
    const radius = Math.max(0, Math.min(toNumber(object?.rx), width / 2, height / 2));
    if (radius > 0 && typeof context.roundRect === 'function') context.roundRect(0, 0, width, height, radius);
    else context.rect(0, 0, width, height);
  }
  paintShapeStyle(context, object);
  context.restore();
}

function drawCallout(context, callout, pageWidth, pageHeight) {
  const style = callout?.style || {};
  const arrowTip = {
    x: toNumber(callout?.arrowTip?.x) * pageWidth,
    y: toNumber(callout?.arrowTip?.y) * pageHeight,
  };
  const knee = {
    x: toNumber(callout?.knee?.x) * pageWidth,
    y: toNumber(callout?.knee?.y) * pageHeight,
  };
  const textBox = {
    x: toNumber(callout?.textBoxPosition?.x ?? callout?.textBox?.x) * pageWidth,
    y: toNumber(callout?.textBoxPosition?.y ?? callout?.textBox?.y) * pageHeight,
    width: Math.max(1, toNumber(callout?.textBoxWidth ?? callout?.textBox?.width) * pageWidth),
    height: Math.max(1, toNumber(callout?.textBoxHeight ?? callout?.textBox?.height) * pageHeight),
  };
  const lineThickness = Math.max(1, toNumber(style.lineThickness, 2));
  const lineColor = isVisiblePaint(style.borderColor) ? style.borderColor : DEFAULT_CALLOUT_COLOR;
  const fillColor = isVisiblePaint(style.fillColor) ? style.fillColor : DEFAULT_CALLOUT_FILL;
  const connection = calculateCalloutConnection(
    textBox.x,
    textBox.y,
    textBox.width,
    textBox.height,
    knee,
    arrowTip,
    lineThickness,
  );

  context.save();
  context.globalAlpha = clampOpacity(style.borderOpacity ?? 1);
  context.strokeStyle = lineColor;
  context.fillStyle = lineColor;
  context.lineWidth = lineThickness;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (!connection.shouldHideLine1) {
    context.moveTo(connection.line1Start.x, connection.line1Start.y);
    context.lineTo(connection.effectiveKnee.x, connection.effectiveKnee.y);
  }
  context.moveTo(connection.line2Start.x, connection.line2Start.y);
  context.lineTo(arrowTip.x, arrowTip.y);
  context.stroke();
  context.beginPath();
  context.arc(arrowTip.x, arrowTip.y, Math.max(2, lineThickness + 0.4), 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = clampOpacity(style.fillOpacity ?? 0.4);
  context.fillStyle = fillColor;
  context.fillRect(textBox.x, textBox.y, textBox.width, textBox.height);
  context.globalAlpha = clampOpacity(style.borderOpacity ?? 1);
  context.strokeRect(textBox.x, textBox.y, textBox.width, textBox.height);

  const text = String(callout?.text || '');
  if (text) {
    const fontSize = Math.max(1, toNumber(style.fontSize, 12));
    const fontFamily = String(style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '');
    const maxTextWidth = Math.max(1, textBox.width - 12);
    const lines = [];
    text.split(/\r?\n/).forEach((paragraph) => {
      if (!paragraph) {
        lines.push('');
        return;
      }
      let line = '';
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && context.measureText(candidate).width > maxTextWidth) {
          lines.push(line);
          line = character;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    });
    const lineHeight = fontSize * Math.max(1, toNumber(style.lineHeight, 1)) * 1.13;
    const availableHeight = textBox.height + fontSize * 0.35;
    const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const paintedLines = lines.slice(0, maxLines);
    const textHeight = paintedLines.length * lineHeight;
    const startY = textBox.y + Math.max(0, (availableHeight - textHeight) / 2);
    context.globalAlpha = 1;
    context.font = `${fontSize}px ${fontFamily}`;
    context.textBaseline = 'top';
    context.fillStyle = style.fontColor || style.textColor || '#000000';
    paintedLines.forEach((line, index) => {
      context.fillText(line, textBox.x + 6, startY + index * lineHeight, maxTextWidth);
    });
  }
  context.restore();
}

export function paintAnnotationCanvas(context, {
  canvasWidth,
  canvasHeight,
  drawScale,
  displayScale,
  pageWidth,
  pageHeight,
  offsetX = 0,
  offsetY = 0,
  objects = [],
  callouts = [],
}) {
  if (!context) return { objectCount: 0, calloutCount: 0 };
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.setTransform(
    drawScale,
    0,
    0,
    drawScale,
    -toNumber(offsetX) * drawScale,
    -toNumber(offsetY) * drawScale,
  );
  objects.forEach((object) => drawAnnotationObject(context, object, displayScale));
  callouts.forEach((callout) => drawCallout(context, callout, pageWidth, pageHeight));
  context.setTransform(1, 0, 0, 1, 0, 0);
  return { objectCount: objects.length, calloutCount: callouts.length };
}
