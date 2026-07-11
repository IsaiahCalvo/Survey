import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  boundsOfCommands,
  commandsToPolygonSet,
  commandsToPolylines,
  createInkAnnotation,
  eraseAnnotations,
  normalizeMultiPolygon,
  translateCommands,
  translatePolygonSet,
} from './annotationGeometry';

const BASE_MAX_SCALE = 2.5;
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
const PAN_START_EVENT = 'spike-pdf-pan-start';
const pathCache = new WeakMap();
const hitCache = new WeakMap();
let inkSequence = 0;

function pathFor(annotation) {
  const cached = pathCache.get(annotation);
  if (cached) return cached;
  const path = new Path2D();
  for (const command of annotation.cmds || []) {
    if (command[0] === 'M') path.moveTo(command[1], command[2]);
    else if (command[0] === 'L') path.lineTo(command[1], command[2]);
    else if (command[0] === 'Q') path.quadraticCurveTo(command[1], command[2], command[3], command[4]);
    else if (command[0] === 'C') path.bezierCurveTo(command[1], command[2], command[3], command[4], command[5], command[6]);
    else if (command[0] === 'Z') path.closePath();
  }
  pathCache.set(annotation, path);
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

function drawAnnotation(ctx, annotation, dx = 0, dy = 0) {
  const path = pathFor(annotation);
  const { fill, stroke } = paintFor(annotation);
  ctx.save();
  if (dx || dy) ctx.translate(dx, dy);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path, 'evenodd');
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = annotation.strokeWidth ?? 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  ctx.restore();
}

function pointInRing(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygons(polygons, point) {
  return normalizeMultiPolygon(polygons).some((polygon) => (
    pointInRing(polygon[0], point)
    && !polygon.slice(1).some((hole) => pointInRing(hole, point))
  ));
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function hitData(annotation) {
  const cached = hitCache.get(annotation);
  if (cached) return cached;
  const { fill, stroke } = paintFor(annotation);
  const bounds = annotation.bounds || boundsOfCommands(annotation.cmds);
  const data = {
    bounds,
    fill,
    stroke,
    polygons: null,
    polylines: null,
    strokeWidth: annotation.strokeWidth || 0,
  };
  hitCache.set(annotation, data);
  return data;
}

function annotationContains(annotation, point, tolerance) {
  const data = hitData(annotation);
  const pad = Math.max(tolerance, data.strokeWidth / 2);
  if (point.x < data.bounds.x - pad || point.x > data.bounds.x + data.bounds.w + pad
    || point.y < data.bounds.y - pad || point.y > data.bounds.y + data.bounds.h + pad) {
    return false;
  }
  if (data.fill && data.polygons === null) {
    data.polygons = annotation.polygons || commandsToPolygonSet(annotation.cmds, { fill: true });
  }
  if (data.stroke && data.polylines === null) data.polylines = commandsToPolylines(annotation.cmds, 1);
  if (data.polygons?.length && pointInPolygons(data.polygons, point)) return true;
  const threshold = data.strokeWidth / 2 + tolerance;
  for (const polyline of data.polylines || []) {
    for (let i = 1; i < polyline.points.length; i += 1) {
      if (distanceToSegment(point, polyline.points[i - 1], polyline.points[i]) <= threshold) return true;
    }
  }
  return false;
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

function drawRoundStroke(ctx, points, width, color) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function CanvasAnnotationLayer({
  pageWidth,
  pageHeight,
  renderScale,
  liveZoom = 1,
  annotations,
  interactive,
  tool = 'select',
  penColor = '#e11d48',
  penWidth = 10,
  eraserWidth = 24,
  eraseMode = 'partial',
  sloppiness = 0,
  panActiveRef,
  scrollerRef,
  onChange,
  onRenderMetrics,
}) {
  const hostRef = useRef(null);
  const baseCanvasRef = useRef(null);
  const tileCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const moveBackdropRef = useRef(null);
  const cursorRef = useRef(null);
  const annotationsRef = useRef(annotations || []);
  const selectedRef = useRef(null);
  const pointerRef = useRef(null);
  const hiddenAnnotationRef = useRef(null);
  const tileRef = useRef(null);
  const renderRafRef = useRef(0);
  const previewRafRef = useRef(0);
  const scrollRafRef = useRef(0);
  const lastMetricRef = useRef(0);
  const workerRef = useRef(null);
  const workerFailedRef = useRef(false);
  const workerRequestRef = useRef(0);
  const workerMetaRef = useRef(null);
  const workerMessageRef = useRef(null);
  const renderStaticRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onRenderMetricsRef = useRef(onRenderMetrics);

  annotationsRef.current = annotations || [];
  onChangeRef.current = onChange;
  onRenderMetricsRef.current = onRenderMetrics;

  const pagePoint = useCallback((eventLike) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return null;
    return {
      x: ((eventLike.clientX - rect.left) / rect.width) * pageWidth,
      y: ((eventLike.clientY - rect.top) / rect.height) * pageHeight,
    };
  }, [pageWidth, pageHeight]);

  const updateEraserCursor = useCallback((point, visible = true) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const shouldShow = visible && tool === 'erase' && interactive && !panActiveRef?.current && point;
    cursor.style.display = shouldShow ? 'block' : 'none';
    if (!shouldShow) return;
    const diameter = eraserWidth * renderScale;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate(${point.x * renderScale - diameter / 2}px, ${point.y * renderScale - diameter / 2}px)`;
  }, [tool, interactive, panActiveRef, eraserWidth, renderScale]);

  const tileForViewport = useCallback((force) => {
    const host = hostRef.current;
    const scroller = scrollerRef?.current;
    const canvas = tileCanvasRef.current;
    if (!host || !scroller || !canvas) return null;
    const hostRect = host.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    const visibleLeft = Math.max(0, scrollRect.left - hostRect.left);
    const visibleTop = Math.max(0, scrollRect.top - hostRect.top);
    const visibleRight = Math.min(hostRect.width, scrollRect.right - hostRect.left);
    const visibleBottom = Math.min(hostRect.height, scrollRect.bottom - hostRect.top);
    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

    const previous = tileRef.current;
    const marginX = Math.min(scrollRect.width * 0.65, hostRect.width);
    const marginY = Math.min(scrollRect.height * 0.65, hostRect.height);
    const edgeGuard = 2;
    if (!force && previous
      && visibleLeft >= previous.left + edgeGuard
      && visibleRight <= previous.left + previous.w - edgeGuard
      && visibleTop >= previous.top + edgeGuard
      && visibleBottom <= previous.top + previous.h - edgeGuard) {
      return previous;
    }

    const left = Math.max(0, visibleLeft - marginX);
    const top = Math.max(0, visibleTop - marginY);
    const right = Math.min(hostRect.width, visibleRight + marginX);
    const bottom = Math.min(hostRect.height, visibleBottom + marginY);
    const tile = { left, top, w: right - left, h: bottom - top };
    tileRef.current = tile;
    return tile;
  }, [scrollerRef]);

  const configurePreviewCanvas = useCallback((copyStatic = false) => {
    const preview = previewCanvasRef.current;
    const deep = renderScale > BASE_MAX_SCALE;
    const source = deep ? tileCanvasRef.current : baseCanvasRef.current;
    if (!preview || !source || !source.width || !source.height) return null;

    preview.style.display = 'block';
    preview.style.left = deep ? source.style.left : '0px';
    preview.style.top = deep ? source.style.top : '0px';
    preview.style.width = deep ? source.style.width : '100%';
    preview.style.height = deep ? source.style.height : '100%';
    if (preview.width !== source.width || preview.height !== source.height) {
      preview.width = source.width;
      preview.height = source.height;
    }
    const context = preview.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, preview.width, preview.height);
    if (copyStatic) context.drawImage(source, 0, 0);
    const tile = tileRef.current;
    context.setTransform(
      renderScale * DPR,
      0,
      0,
      renderScale * DPR,
      deep && tile ? -tile.left * DPR : 0,
      deep && tile ? -tile.top * DPR : 0,
    );
    return {
      context,
      source,
      pageTransform: [
        renderScale * DPR,
        0,
        0,
        renderScale * DPR,
        deep && tile ? -tile.left * DPR : 0,
        deep && tile ? -tile.top * DPR : 0,
      ],
    };
  }, [renderScale]);

  const resetPreview = useCallback(() => {
    const preview = previewCanvasRef.current;
    if (preview) {
      const context = preview.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, preview.width, preview.height);
      preview.style.display = 'none';
    }
    if (baseCanvasRef.current) baseCanvasRef.current.style.visibility = 'visible';
    if (tileCanvasRef.current) tileCanvasRef.current.style.visibility = 'visible';
    moveBackdropRef.current = null;
  }, []);

  const prepareMovePreview = useCallback((annotation, previousSelectedId) => {
    const configured = configurePreviewCanvas(true);
    const preview = previewCanvasRef.current;
    if (!configured || !preview) return false;
    const { context, source } = configured;
    const previous = previousSelectedId && previousSelectedId !== annotation.id
      ? annotationsRef.current.find((item) => item.id === previousSelectedId)
      : null;
    const patchAnnotations = previous ? [annotation, previous] : [annotation];

    for (const patchAnnotation of patchAnnotations) {
      const box = boundsOfCommands(patchAnnotation.cmds);
      const pad = Math.max((patchAnnotation.strokeWidth || 0) / 2 + 2, 6 / renderScale);
      const patch = {
        x: box.x - pad,
        y: box.y - pad,
        w: box.w + pad * 2,
        h: box.h + pad * 2,
      };
      context.save();
      context.beginPath();
      context.rect(patch.x, patch.y, patch.w, patch.h);
      context.clip();
      context.clearRect(patch.x, patch.y, patch.w, patch.h);
      for (const item of annotationsRef.current) {
        if (item.id === annotation.id) continue;
        const itemBounds = hitData(item).bounds;
        const itemPad = (item.strokeWidth || 0) / 2;
        if (itemBounds.x - itemPad > patch.x + patch.w
          || itemBounds.x + itemBounds.w + itemPad < patch.x
          || itemBounds.y - itemPad > patch.y + patch.h
          || itemBounds.y + itemBounds.h + itemPad < patch.y) continue;
        drawAnnotation(context, item);
      }
      context.restore();
    }

    const backdrop = document.createElement('canvas');
    backdrop.width = preview.width;
    backdrop.height = preview.height;
    backdrop.getContext('2d').drawImage(preview, 0, 0);
    moveBackdropRef.current = backdrop;
    source.style.visibility = 'hidden';
    return true;
  }, [configurePreviewCanvas, renderScale]);

  const renderNow = useCallback((forceTile = false) => {
    if (!pageWidth || !pageHeight || !renderScale || liveZoom !== 1) return;
    const baseCanvas = baseCanvasRef.current;
    const tileCanvas = tileCanvasRef.current;
    if (!baseCanvas || !tileCanvas) return;

    const started = performance.now();
    const deep = renderScale > BASE_MAX_SCALE;
    let canvas;
    let context;
    let backingPixels = 0;
    if (deep) {
      baseCanvas.style.display = 'none';
      const tile = tileForViewport(forceTile);
      if (!tile) {
        tileCanvas.style.display = 'none';
        return;
      }
      tileCanvas.style.display = 'block';
      tileCanvas.style.left = `${tile.left}px`;
      tileCanvas.style.top = `${tile.top}px`;
      tileCanvas.style.width = `${tile.w}px`;
      tileCanvas.style.height = `${tile.h}px`;
      const width = Math.max(1, Math.ceil(tile.w * DPR));
      const height = Math.max(1, Math.ceil(tile.h * DPR));
      if (tileCanvas.width !== width || tileCanvas.height !== height) {
        tileCanvas.width = width;
        tileCanvas.height = height;
      }
      canvas = tileCanvas;
      context = canvas.getContext('2d');
      context.setTransform(renderScale * DPR, 0, 0, renderScale * DPR, -tile.left * DPR, -tile.top * DPR);
      backingPixels = width * height;
    } else {
      tileCanvas.style.display = 'none';
      tileRef.current = null;
      baseCanvas.style.display = 'block';
      const width = Math.max(1, Math.ceil(pageWidth * renderScale * DPR));
      const height = Math.max(1, Math.ceil(pageHeight * renderScale * DPR));
      if (baseCanvas.width !== width || baseCanvas.height !== height) {
        baseCanvas.width = width;
        baseCanvas.height = height;
      }
      canvas = baseCanvas;
      context = canvas.getContext('2d');
      context.setTransform(renderScale * DPR, 0, 0, renderScale * DPR, 0, 0);
      backingPixels = width * height;
    }

    context.clearRect(
      deep ? tileRef.current.left / renderScale : 0,
      deep ? tileRef.current.top / renderScale : 0,
      deep ? tileRef.current.w / renderScale : pageWidth,
      deep ? tileRef.current.h / renderScale : pageHeight,
    );

    const hiddenId = hiddenAnnotationRef.current;
    for (const annotation of annotationsRef.current) {
      if (annotation.id !== hiddenId) drawAnnotation(context, annotation);
    }

    const selected = annotationsRef.current.find((annotation) => annotation.id === selectedRef.current);
    if (selected && selected.id !== hiddenId) {
      const box = boundsOfCommands(selected.cmds);
      const inset = 3 / renderScale;
      context.save();
      context.strokeStyle = '#0a84ff';
      context.lineWidth = 1.5 / renderScale;
      context.setLineDash([6 / renderScale, 4 / renderScale]);
      context.strokeRect(box.x - inset, box.y - inset, box.w + inset * 2, box.h + inset * 2);
      context.restore();
    }

    if (!pointerRef.current) resetPreview();

    const now = performance.now();
    if (now - lastMetricRef.current > 180) {
      lastMetricRef.current = now;
      onRenderMetricsRef.current?.({
        ms: Number((now - started).toFixed(2)),
        count: annotationsRef.current.length,
        tiled: deep,
        backingPixels,
      });
    }
  }, [pageWidth, pageHeight, renderScale, liveZoom, tileForViewport, resetPreview]);

  const applyWorkerMessage = useCallback((message) => {
    const meta = workerMetaRef.current;
    if (!meta || message.requestId !== meta.requestId) {
      message.bitmap?.close?.();
      return;
    }
    if (message.type === 'error') {
      workerFailedRef.current = true;
      workerMetaRef.current = null;
      renderNow(meta.forceTile);
      return;
    }
    const baseCanvas = baseCanvasRef.current;
    const tileCanvas = tileCanvasRef.current;
    const target = meta.deep ? tileCanvas : baseCanvas;
    if (!target || !message.bitmap) return;

    if (meta.deep) {
      baseCanvas.style.display = 'none';
      tileCanvas.style.display = 'block';
      tileCanvas.style.left = `${meta.tile.left}px`;
      tileCanvas.style.top = `${meta.tile.top}px`;
      tileCanvas.style.width = `${meta.tile.w}px`;
      tileCanvas.style.height = `${meta.tile.h}px`;
    } else {
      tileCanvas.style.display = 'none';
      baseCanvas.style.display = 'block';
    }
    target.width = meta.width;
    target.height = meta.height;
    const context = target.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, meta.width, meta.height);
    context.drawImage(message.bitmap, 0, 0);
    message.bitmap.close?.();
    const pointerMode = pointerRef.current?.mode;
    target.style.visibility = pointerMode === 'erase' || pointerMode === 'move' ? 'hidden' : 'visible';
    workerMetaRef.current = null;
    if (!pointerRef.current) resetPreview();
    onRenderMetricsRef.current?.({
      ms: Number(message.ms.toFixed(2)),
      count: meta.count,
      tiled: meta.deep,
      backingPixels: meta.width * meta.height,
      worker: true,
    });
  }, [renderNow, resetPreview]);
  workerMessageRef.current = applyWorkerMessage;

  const requestWorkerRender = useCallback((forceTile = false) => {
    const worker = workerRef.current;
    if (!worker || workerFailedRef.current || liveZoom !== 1) return false;
    const deep = renderScale > BASE_MAX_SCALE;
    const tile = deep ? tileForViewport(forceTile) : null;
    if (deep && !tile) return false;
    const width = Math.max(1, Math.ceil((deep ? tile.w : pageWidth * renderScale) * DPR));
    const height = Math.max(1, Math.ceil((deep ? tile.h : pageHeight * renderScale) * DPR));
    const requestId = ++workerRequestRef.current;
    const renderAnnotations = annotationsRef.current.map((annotation) => ({
      id: annotation.id,
      cmds: annotation.cmds,
      fill: annotation.fill,
      filled: annotation.filled,
      paint: annotation.paint,
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
    }));
    workerMetaRef.current = {
      requestId,
      forceTile,
      deep,
      tile,
      width,
      height,
      count: renderAnnotations.length,
    };
    try {
      worker.postMessage({
        type: 'render',
        requestId,
        width,
        height,
        renderScale,
        transform: [
          renderScale * DPR,
          0,
          0,
          renderScale * DPR,
          deep ? -tile.left * DPR : 0,
          deep ? -tile.top * DPR : 0,
        ],
        annotations: renderAnnotations,
        selectedId: selectedRef.current,
        hiddenId: hiddenAnnotationRef.current,
      });
      return true;
    } catch {
      workerFailedRef.current = true;
      workerMetaRef.current = null;
      return false;
    }
  }, [liveZoom, renderScale, tileForViewport, pageWidth, pageHeight]);

  const renderStatic = useCallback((forceTile = false) => {
    if (!pointerRef.current && annotationsRef.current.length >= 500 && requestWorkerRender(forceTile)) return;
    renderNow(forceTile);
  }, [requestWorkerRender, renderNow]);
  renderStaticRef.current = renderStatic;

  const renderPreviewNow = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.mode === 'erase') return;
    const configured = configurePreviewCanvas(false);
    if (!configured) return;
    const { context, pageTransform } = configured;
    if (pointer.mode === 'draw') {
      drawRoundStroke(context, pointer.points, penWidth, penColor);
      return;
    }
    if (pointer.mode === 'move') {
      const annotation = annotationsRef.current.find((item) => item.id === pointer.id);
      if (!annotation) return;
      const backdrop = moveBackdropRef.current;
      if (backdrop) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(backdrop, 0, 0);
        context.setTransform(...pageTransform);
      }
      const dx = pointer.current.x - pointer.start.x;
      const dy = pointer.current.y - pointer.start.y;
      drawAnnotation(context, annotation, dx, dy);
      const box = boundsOfCommands(annotation.cmds);
      const inset = 3 / renderScale;
      context.save();
      context.strokeStyle = '#0a84ff';
      context.lineWidth = 1.5 / renderScale;
      context.setLineDash([6 / renderScale, 4 / renderScale]);
      context.strokeRect(box.x + dx - inset, box.y + dy - inset, box.w + inset * 2, box.h + inset * 2);
      context.restore();
    }
  }, [configurePreviewCanvas, penWidth, penColor, renderScale]);

  const schedulePreview = useCallback(() => {
    if (previewRafRef.current) return;
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = 0;
      renderPreviewNow();
    });
  }, [renderPreviewNow]);

  const drawErasePreviewSegment = useCallback((points, copyStatic = false) => {
    let configured;
    if (copyStatic) {
      configured = configurePreviewCanvas(true);
      if (configured?.source) configured.source.style.visibility = 'hidden';
    } else {
      const preview = previewCanvasRef.current;
      const tile = tileRef.current;
      if (!preview || preview.style.display === 'none') return;
      const context = preview.getContext('2d');
      context.setTransform(
        renderScale * DPR,
        0,
        0,
        renderScale * DPR,
        renderScale > BASE_MAX_SCALE && tile ? -tile.left * DPR : 0,
        renderScale > BASE_MAX_SCALE && tile ? -tile.top * DPR : 0,
      );
      configured = { context };
    }
    if (!configured) return;
    configured.context.save();
    configured.context.globalCompositeOperation = 'destination-out';
    drawRoundStroke(configured.context, points, eraserWidth, '#000');
    configured.context.restore();
  }, [configurePreviewCanvas, renderScale, eraserWidth]);

  const renderScrolledViewport = useCallback(() => {
    if (renderScale <= BASE_MAX_SCALE || liveZoom !== 1) return;
    const previous = tileRef.current;
    const next = tileForViewport(false);
    if (previous === next) return;
    renderStatic(false);
  }, [renderScale, liveZoom, tileForViewport, renderStatic]);

  const scheduleRender = useCallback((forceTile = false) => {
    if (renderRafRef.current) return;
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = 0;
      renderStatic(forceTile);
    });
  }, [renderStatic]);

  const commit = useCallback((next) => {
    annotationsRef.current = next;
    onChangeRef.current?.(next);
    scheduleRender();
  }, [scheduleRender]);

  const findAnnotation = useCallback((point) => {
    const tolerance = Math.max(2, 6 / renderScale);
    const list = annotationsRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (annotationContains(list[i], point, tolerance)) return list[i];
    }
    return null;
  }, [renderScale]);

  const onPointerDown = useCallback((event) => {
    if (!interactive || panActiveRef?.current || event.button !== 0) return;
    const point = pagePoint(event.nativeEvent);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    workerRequestRef.current += 1;
    workerMetaRef.current = null;

    if (tool === 'pen') {
      moveBackdropRef.current = null;
      selectedRef.current = null;
      pointerRef.current = { mode: 'draw', pointerId: event.pointerId, points: [point] };
      hiddenAnnotationRef.current = null;
      schedulePreview();
    } else if (tool === 'erase') {
      moveBackdropRef.current = null;
      selectedRef.current = null;
      pointerRef.current = { mode: 'erase', pointerId: event.pointerId, points: [point] };
      hiddenAnnotationRef.current = null;
      drawErasePreviewSegment([point], true);
    } else {
      const previousSelectedId = selectedRef.current;
      const annotation = findAnnotation(point);
      selectedRef.current = annotation?.id || null;
      pointerRef.current = annotation && !annotation.noDrag
        ? { mode: 'move', pointerId: event.pointerId, id: annotation.id, start: point, current: point }
        : null;
      hiddenAnnotationRef.current = pointerRef.current ? annotation.id : null;
      if (pointerRef.current) {
        if (!prepareMovePreview(annotation, previousSelectedId)) renderNow(false);
        schedulePreview();
      } else {
        scheduleRender();
      }
    }
  }, [interactive, panActiveRef, pagePoint, tool, findAnnotation, schedulePreview, drawErasePreviewSegment, prepareMovePreview, renderNow, scheduleRender]);

  const onPointerMove = useCallback((event) => {
    const point = pagePoint(event.nativeEvent);
    updateEraserCursor(point, true);
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (event.buttons === 0) {
      pointerRef.current = null;
      hiddenAnnotationRef.current = null;
      resetPreview();
      scheduleRender();
      return;
    }
    event.preventDefault();
    if (pointer.mode === 'move') {
      pointer.current = point;
      schedulePreview();
    } else {
      const coalesced = event.nativeEvent.getCoalescedEvents?.() || [];
      const nativeEvents = coalesced.length ? coalesced : [event.nativeEvent];
      for (const nativeEvent of nativeEvents) {
        const sampled = pagePoint(nativeEvent);
        const last = pointer.points[pointer.points.length - 1];
        if (sampled && (!last || Math.hypot(sampled.x - last.x, sampled.y - last.y) >= 0.2)) {
          pointer.points.push(sampled);
          if (pointer.mode === 'erase') drawErasePreviewSegment(last ? [last, sampled] : [sampled], false);
        }
      }
      if (pointer.mode === 'draw') schedulePreview();
    }
  }, [
    pagePoint,
    updateEraserCursor,
    resetPreview,
    scheduleRender,
    schedulePreview,
    drawErasePreviewSegment,
  ]);

  const finishPointer = useCallback((event, cancelled = false) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const releasePoint = pagePoint(event.nativeEvent);
    if (releasePoint) {
      updateEraserCursor(releasePoint, true);
      if (pointer.mode === 'move') {
        pointer.current = releasePoint;
      } else {
        const last = pointer.points[pointer.points.length - 1];
        if (!last || Math.hypot(releasePoint.x - last.x, releasePoint.y - last.y) >= 0.2) {
          pointer.points.push(releasePoint);
          if (pointer.mode === 'erase') {
            drawErasePreviewSegment(last ? [last, releasePoint] : [releasePoint], false);
          }
        }
      }
    }
    pointerRef.current = null;
    hiddenAnnotationRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (cancelled) {
      scheduleRender();
      return;
    }

    if (pointer.mode === 'draw') {
      const annotation = createInkAnnotation(pointer.points, {
        id: `ink-${Date.now().toString(36)}-${inkSequence += 1}`,
        color: penColor,
        width: penWidth,
        sloppiness,
      });
      if (annotation.cmds.length) commit([...annotationsRef.current, annotation]);
      else scheduleRender();
      return;
    }
    if (pointer.mode === 'erase') {
      const result = eraseAnnotations(annotationsRef.current, pointer.points, eraserWidth / 2, eraseMode);
      if (result.changedIds.length) commit(result.annotations);
      else scheduleRender();
      return;
    }
    if (pointer.mode === 'move') {
      const dx = pointer.current.x - pointer.start.x;
      const dy = pointer.current.y - pointer.start.y;
      if (Math.abs(dx) <= 1e-5 && Math.abs(dy) <= 1e-5) {
        scheduleRender();
        return;
      }
      commit(annotationsRef.current.map((annotation) => {
        if (annotation.id !== pointer.id) return annotation;
        const cmds = translateCommands(annotation.cmds, dx, dy);
        return {
          ...annotation,
          cmds,
          polygons: annotation.polygons?.length
            ? translatePolygonSet(annotation.polygons, dx, dy)
            : annotation.polygons,
          bounds: boundsOfCommands(cmds),
        };
      }));
    }
  }, [
    pagePoint,
    updateEraserCursor,
    drawErasePreviewSegment,
    scheduleRender,
    penColor,
    penWidth,
    sloppiness,
    commit,
    eraserWidth,
    eraseMode,
  ]);

  const onLostPointerCapture = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    hiddenAnnotationRef.current = null;
    resetPreview();
    updateEraserCursor(null, false);
    scheduleRender();
  }, [resetPreview, scheduleRender, updateEraserCursor]);

  useLayoutEffect(() => {
    if (selectedRef.current && !annotationsRef.current.some((annotation) => annotation.id === selectedRef.current)) {
      selectedRef.current = null;
    }
    if (liveZoom === 1) renderStatic(true);
  }, [annotations, renderStatic, liveZoom]);

  useEffect(() => {
    const scroller = scrollerRef?.current;
    if (!scroller || renderScale <= BASE_MAX_SCALE) return undefined;
    const onScroll = () => {
      if (panActiveRef?.current || scrollRafRef.current || liveZoom !== 1) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        renderScrolledViewport();
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    };
  }, [scrollerRef, renderScale, liveZoom, panActiveRef, renderScrolledViewport]);

  useEffect(() => {
    const onPanStart = () => {
      updateEraserCursor(null, false);
      if (pointerRef.current) {
        pointerRef.current = null;
        hiddenAnnotationRef.current = null;
        scheduleRender();
      }
    };
    window.addEventListener(PAN_START_EVENT, onPanStart);
    return () => {
      window.removeEventListener(PAN_START_EVENT, onPanStart);
    };
  }, [scheduleRender, updateEraserCursor]);

  useEffect(() => {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return undefined;
    const worker = new Worker(new URL('./annotationCanvasWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event) => workerMessageRef.current?.(event.data);
    worker.onerror = () => {
      workerFailedRef.current = true;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      renderStaticRef.current?.(true);
    };
    const readyRaf = requestAnimationFrame(() => renderStaticRef.current?.(true));
    return () => {
      cancelAnimationFrame(readyRaf);
      workerRequestRef.current += 1;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!interactive || isEditableTarget(event.target)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current) {
        event.preventDefault();
        const id = selectedRef.current;
        selectedRef.current = null;
        commit(annotationsRef.current.filter((annotation) => annotation.id !== id));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interactive, commit]);

  useEffect(() => () => {
    if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  useEffect(() => {
    if (tool !== 'erase') updateEraserCursor(null, false);
    if (tool !== 'select' && selectedRef.current) {
      selectedRef.current = null;
      scheduleRender();
    }
  }, [tool, updateEraserCursor, scheduleRender]);

  const cursor = tool === 'pen' ? 'crosshair' : tool === 'erase' ? 'none' : 'default';

  return (
    <div
      ref={hostRef}
      data-annotation-renderer="canvas2d"
      data-annotation-count={annotations?.length || 0}
      data-page-width={pageWidth}
      data-page-height={pageHeight}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: interactive ? 'auto' : 'none',
        cursor,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishPointer(event, false)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={onLostPointerCapture}
      onPointerLeave={() => updateEraserCursor(null, false)}
      onPointerEnter={(event) => updateEraserCursor(pagePoint(event.nativeEvent), true)}
      aria-label="PDF annotations"
    >
      <canvas
        ref={baseCanvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
      <canvas
        ref={tileCanvasRef}
        style={{ position: 'absolute', display: 'none', pointerEvents: 'none' }}
      />
      <canvas
        ref={previewCanvasRef}
        style={{ position: 'absolute', display: 'none', pointerEvents: 'none' }}
      />
      <div
        ref={cursorRef}
        data-eraser-cursor
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'none',
          boxSizing: 'border-box',
          border: '1px solid rgba(17, 24, 39, 0.9)',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.18)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.72)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export default memo(CanvasAnnotationLayer);
