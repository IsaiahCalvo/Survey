import { drawTextboxAnnotation, isTextboxAnnotation, textboxBounds } from './textAnnotation.js';

const pathCache = new Map();

function pathFor(annotation) {
  const cached = pathCache.get(annotation.id);
  if (cached?.cmds === annotation.cmds) return cached.path;
  const path = new Path2D();
  for (const command of annotation.cmds || []) {
    if (command[0] === 'M') path.moveTo(command[1], command[2]);
    else if (command[0] === 'L') path.lineTo(command[1], command[2]);
    else if (command[0] === 'Q') path.quadraticCurveTo(command[1], command[2], command[3], command[4]);
    else if (command[0] === 'C') path.bezierCurveTo(command[1], command[2], command[3], command[4], command[5], command[6]);
    else if (command[0] === 'Z') path.closePath();
  }
  pathCache.set(annotation.id, { cmds: annotation.cmds, path });
  return path;
}

function paintFor(annotation) {
  const fill = annotation.fill ?? (annotation.filled ? annotation.paint : null);
  const stroke = annotation.stroke ?? (annotation.filled ? null : annotation.paint);
  return {
    fill: fill && fill !== 'none' ? fill : null,
    stroke: stroke && stroke !== 'none' ? stroke : null,
  };
}

function drawAnnotation(context, annotation) {
  if (isTextboxAnnotation(annotation)) {
    drawTextboxAnnotation(context, annotation);
    return;
  }
  const path = pathFor(annotation);
  const { fill, stroke } = paintFor(annotation);
  if (fill) {
    context.fillStyle = fill;
    context.fill(path, 'evenodd');
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = annotation.strokeWidth ?? 1;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke(path);
  }
}

function boundsOfCommands(commands) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of commands || []) {
    for (let i = 1; i + 1 < command.length; i += 2) {
      minX = Math.min(minX, command[i]);
      minY = Math.min(minY, command[i + 1]);
      maxX = Math.max(maxX, command[i]);
      maxY = Math.max(maxY, command[i + 1]);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

self.onmessage = (event) => {
  const request = event.data;
  if (request?.type !== 'render') return;
  const started = performance.now();
  try {
    const canvas = new OffscreenCanvas(request.width, request.height);
    const context = canvas.getContext('2d');
    context.setTransform(...request.transform);
    for (const annotation of request.annotations || []) {
      if (annotation.id !== request.hiddenId) drawAnnotation(context, annotation);
    }
    const selected = request.annotations?.find((annotation) => annotation.id === request.selectedId);
    if (selected && selected.id !== request.hiddenId) {
      const box = isTextboxAnnotation(selected) ? textboxBounds(selected) : boundsOfCommands(selected.cmds);
      const inset = 3 / request.renderScale;
      context.save();
      context.strokeStyle = '#0a84ff';
      context.lineWidth = 1.5 / request.renderScale;
      context.setLineDash([6 / request.renderScale, 4 / request.renderScale]);
      context.strokeRect(box.x - inset, box.y - inset, box.w + inset * 2, box.h + inset * 2);
      context.restore();
    }
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({
      type: 'rendered',
      requestId: request.requestId,
      bitmap,
      ms: performance.now() - started,
    }, [bitmap]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: request.requestId, message: error?.message || String(error) });
  }
};
