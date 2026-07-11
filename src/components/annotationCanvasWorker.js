import { paintAnnotationCanvas } from '../utils/annotationCanvasPainter.js';

let cachedDataRevision = null;
let cachedObjects = [];
let cachedCallouts = [];

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

    const canvas = new OffscreenCanvas(request.width, request.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas2D is unavailable in the annotation worker');

    paintAnnotationCanvas(context, {
      canvasWidth: request.width,
      canvasHeight: request.height,
      drawScale: request.drawScale,
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
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error?.message || String(error),
    });
  }
};
