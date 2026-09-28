import { paintAnnotationCanvas } from '../utils/annotationCanvasPainter.js';
import { preloadAnnotationImages } from '../utils/annotationImageCache.js';

let cachedDataRevision = null;
let cachedObjects = [];
let cachedCallouts = [];
let latestRequest = null;

const render = (request) => {
  const canvas = new OffscreenCanvas(request.width, request.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas2D is unavailable in the annotation worker');

  const result = paintAnnotationCanvas(context, {
    canvasWidth: request.width,
    canvasHeight: request.height,
    drawScale: request.drawScale,
    drawScaleY: request.drawScaleY,
    displayScale: request.displayScale,
    pageWidth: request.pageWidth,
    pageHeight: request.pageHeight,
    offsetX: request.offsetX,
    offsetY: request.offsetY,
    objects: cachedObjects,
    callouts: cachedCallouts,
  });

  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({
    type: 'rendered',
    requestId: request.requestId,
    width: request.width,
    height: request.height,
    clamped: request.clamped,
    bitmap,
  }, [bitmap]);
  return result;
};

self.onmessage = (event) => {
  const request = event.data;
  if (request?.type !== 'render') return;

  try {
    const carriesAnnotationData = Array.isArray(request.objects) && Array.isArray(request.callouts);
    if (carriesAnnotationData) {
      cachedDataRevision = request.dataRevision;
      cachedObjects = request.objects;
      cachedCallouts = request.callouts;
    } else if (request.dataRevision !== cachedDataRevision) {
      throw new Error('Annotation worker received an uncached data revision');
    }

    latestRequest = request;
    const result = render(request);
    // w52 (2026-09-28): an image mark (imported stamp) whose image was still
    // decoding was left out of that paint. Decode it here in the worker and
    // repaint the same request once, if nothing newer has arrived - the main
    // thread accepts a second 'rendered' for its current requestId.
    if (result?.pendingImageCount > 0) {
      preloadAnnotationImages(cachedObjects).then((loaded) => {
        if (!loaded || latestRequest !== request) return;
        try { render(request); } catch { /* the first paint already landed */ }
      });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error?.message || String(error),
    });
  }
};
