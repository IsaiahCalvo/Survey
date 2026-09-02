/**
 * eraserHitTest.js — determines which annotations an eraser stroke touches.
 *
 * Exports getEraserStrokeBounds, sampleEraserStroke (densifies the stroke path),
 * eraserStrokeTouchesObject (samples the stroke and hit-tests each point via
 * geometryHitTest's isPointOnObject), getEraserCandidateId, and
 * getEraserDeleteDiagnostics. Used by the eraser tool to find delete candidates.
 */
import { isPointOnObject } from './geometryHitTest.js';
import { getAnnotationHistoryId } from './annotationLocalHistory.js';

const MIN_SAMPLE_STEP = 2;
const MAX_SAMPLE_STEP = 8;
const TEXT_PADDING = 6;
let textMeasureContext = null;

const getTextMeasureContext = () => {
  if (textMeasureContext || typeof document === 'undefined') return textMeasureContext;
  const canvas = document.createElement('canvas');
  textMeasureContext = canvas.getContext('2d');
  return textMeasureContext;
};

const estimateTextWidth = (text, fontSize) => Array.from(text).reduce((width, char) => {
  if (/\s/.test(char)) return width + fontSize * 0.28;
  if (/[ilI1.,'`]/.test(char)) return width + fontSize * 0.3;
  if (/[MW@#%]/.test(char)) return width + fontSize * 0.85;
  return width + fontSize * 0.56;
}, 0);

const textWidth = (text, object, fontSize) => {
  const context = getTextMeasureContext();
  if (!context) return estimateTextWidth(text, fontSize);
  context.font = `${object.fontStyle || 'normal'} ${object.fontWeight || 'normal'} ${fontSize}px ${object.fontFamily || 'sans-serif'}`;
  return context.measureText(text).width;
};

const wrapTextLines = (object, maxWidth, fontSize) => {
  const lines = [];
  String(object?.text || '').split('\n').forEach((sourceLine) => {
    if (!sourceLine) {
      lines.push('');
      return;
    }
    let line = '';
    Array.from(sourceLine).forEach((char) => {
      const next = `${line}${char}`;
      if (line && textWidth(next, object, fontSize) > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    });
    lines.push(line);
  });
  return lines;
};

const unrotateTextPoint = (point, angle, cx, cy) => {
  if (!angle) return point;
  const radians = (-angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
};

const pointTouchesRect = (point, rect, radius) => {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy) <= radius;
};

export function buildTextInkHitLayout(object) {
  const text = String(object?.text || '');
  if (!text.trim()) return null;

  const scaleX = Math.abs(Number(object.scaleX) || 1);
  const scaleY = Math.abs(Number(object.scaleY) || 1);
  const width = Math.abs(Number(object.width) || 0) * scaleX;
  const height = Math.abs(Number(object.height) || 0) * scaleY;
  if (width <= 0 || height <= 0) return null;

  const left = Number(object.left) || 0;
  const top = Number(object.top) || 0;
  const padX = TEXT_PADDING * scaleX;
  const padY = object.calloutText ? 0 : TEXT_PADDING * scaleY;
  const innerWidth = Math.max(0, width - padX * 2);
  const innerHeight = Math.max(0, height - padY * 2);
  const baseFontSize = Number(object.fontSize) || 16;
  const fontSize = baseFontSize * scaleY;
  const lineStep = fontSize * (Number(object.lineHeight) || (object.calloutText ? 1 : 1.16)) * 1.13;
  const wrappedLines = wrapTextLines(object, innerWidth / scaleX, baseFontSize);
  const maxLines = Math.max(1, Number(object.maxLines) || wrappedLines.length);
  const lines = wrappedLines.slice(0, maxLines);
  const blockHeight = lines.length * lineStep;
  const verticalAlign = object.calloutText ? 'middle' : (object.verticalAlign || 'top');
  const blockTop = top + padY + (
    verticalAlign === 'bottom'
      ? Math.max(0, innerHeight - blockHeight)
      : verticalAlign === 'middle'
        ? Math.max(0, (innerHeight - blockHeight) / 2)
        : 0
  );

  const lineBoxes = lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    const lineWidth = Math.min(innerWidth, textWidth(line, object, baseFontSize) * scaleX);
    const textAlign = object.textAlign || 'left';
    const lineLeft = left + padX + (
      textAlign === 'right'
        ? innerWidth - lineWidth
        : textAlign === 'center'
          ? (innerWidth - lineWidth) / 2
          : 0
    );
    return [{
      left: lineLeft,
      top: blockTop + index * lineStep,
      right: lineLeft + lineWidth,
      bottom: blockTop + (index + 1) * lineStep,
    }];
  });

  return {
    angle: Number(object.angle) || 0,
    centerX: left + width / 2,
    centerY: top + height / 2,
    lineBoxes,
  };
}

export function eraserPointTouchesText(point, object, eraserRadius = 0, layout = null) {
  const hitLayout = layout || buildTextInkHitLayout(object);
  if (!hitLayout) return false;
  const probe = unrotateTextPoint(
    point,
    hitLayout.angle,
    hitLayout.centerX,
    hitLayout.centerY,
  );
  const radius = Math.max(0, Number(eraserRadius) || 0);
  return hitLayout.lineBoxes.some((rect) => pointTouchesRect(probe, rect, radius));
}

export function getEraserStrokeBounds(points = [], radius = 0) {
  const finite = points.filter((point) => (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ));
  if (finite.length === 0) {
    return null;
  }

  let minX = finite[0].x;
  let minY = finite[0].y;
  let maxX = finite[0].x;
  let maxY = finite[0].y;
  finite.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    left: minX - radius,
    top: minY - radius,
    right: maxX + radius,
    bottom: maxY + radius,
    width: (maxX - minX) + radius * 2,
    height: (maxY - minY) + radius * 2,
  };
}

export function getEraserCandidateId(obj, fallbackIndex = null) {
  return getAnnotationHistoryId(obj)
    || obj?.callout?.id
    || (obj?.type === 'callout' ? obj.id : null)
    || `index:${fallbackIndex}`;
}

function sampleSegment(start, end, step) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const count = Math.max(1, Math.ceil(distance / Math.max(1, step)));
  const samples = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    samples.push({
      x: start.x + dx * t,
      y: start.y + dy * t,
    });
  }
  return samples;
}

export function sampleEraserStroke(points = [], radius = 0) {
  const finite = points.filter((point) => (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ));
  if (finite.length <= 1) {
    return finite;
  }

  const step = Math.max(MIN_SAMPLE_STEP, Math.min(Math.max(radius / 2, MIN_SAMPLE_STEP), MAX_SAMPLE_STEP));
  const samples = [finite[0]];
  for (let i = 1; i < finite.length; i += 1) {
    const segmentSamples = sampleSegment(finite[i - 1], finite[i], step);
    samples.push(...segmentSamples.slice(1));
  }
  return samples;
}

export function eraserStrokeTouchesObject({ eraserPoints, eraserRadius, object }) {
  if (!object || !Array.isArray(eraserPoints) || eraserPoints.length === 0) {
    return false;
  }

  const samples = sampleEraserStroke(eraserPoints, eraserRadius);
  const type = String(object.type || '').toLowerCase().replace('itext', 'i-text');
  if (type === 'textbox' || type === 'text' || type === 'i-text') {
    const layout = buildTextInkHitLayout(object);
    return samples.some((point) => eraserPointTouchesText(point, object, eraserRadius, layout));
  }
  return samples.some((point) => isPointOnObject(point, object, eraserRadius));
}

export function getEraserDeleteDiagnostics({ beforeObjects = [], afterObjects = [] } = {}) {
  const beforeIds = beforeObjects.map((obj, index) => getEraserCandidateId(obj, index));
  const afterIds = new Set(afterObjects.map((obj, index) => getEraserCandidateId(obj, index)));
  const finalDeletedAnnotationIds = beforeIds.filter((id) => id && !afterIds.has(id));
  let changedObjectsCount = 0;
  const max = Math.max(beforeObjects.length, afterObjects.length);

  for (let index = 0; index < max; index += 1) {
    const before = beforeObjects[index] ?? null;
    const after = afterObjects[index] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedObjectsCount += 1;
    }
  }

  return {
    finalDeletedAnnotationIds,
    objectDelta: afterObjects.length - beforeObjects.length,
    changedObjectsCount,
  };
}
