const DEFAULT_APPEARANCE_SCALE = 2;
const MAX_APPEARANCE_EDGE = 2048;
// Stable public pdf.js enum values. Keeping these local avoids loading the
// browser-only pdf.js build in Node callers of the print flattener.
const PDFJS_ANNOTATION_MODE_ENABLE = 1;
const PDFJS_OP_DEPENDENCY = 1;
const PDFJS_OP_BEGIN_ANNOTATION = 80;
const PDFJS_OP_END_ANNOTATION = 81;

const normalizedAngle = (value) => {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  const wrapped = ((angle % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};

export const getPdfStampRotation = (annotation, rawMetadata = null) => {
  const explicit = Number(rawMetadata?.rotation ?? annotation?.rotation);
  if (Number.isFinite(explicit) && explicit !== 0) return normalizedAngle(explicit);
  const matrix = rawMetadata?.appearance?.matrix || annotation?._appearance?.matrix;
  if (!Array.isArray(matrix) || matrix.length !== 6) return 0;
  return normalizedAngle(Math.atan2(Number(matrix[1]) || 0, Number(matrix[0]) || 1) * 180 / Math.PI);
};

const annotationOperatorRange = (operatorList, annotationId) => {
  let start = -1;
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    if (fn === PDFJS_OP_BEGIN_ANNOTATION && String(operatorList.argsArray[index]?.[0]) === String(annotationId)) {
      start = index;
      continue;
    }
    if (start >= 0 && fn === PDFJS_OP_END_ANNOTATION) return { start, end: index };
  }
  return null;
};

const canvasToPngDataUrl = async (canvas) => {
  if (typeof canvas?.toDataURL === 'function') return canvas.toDataURL('image/png');
  if (typeof canvas?.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not encode stamp PNG'));
      reader.readAsDataURL(blob);
    });
  }
  throw new Error('This browser cannot encode the stamp appearance canvas');
};

/** Render each native /Stamp /AP /N through pdf.js into a transparent PNG. */
export async function renderPdfStampAppearances(page, annotations) {
  if (typeof document === 'undefined') {
    throw new Error('Stamp appearance rendering needs a browser canvas');
  }
  const stamps = (annotations || []).filter((annotation) => (
    annotation?.subtype === 'Stamp' && annotation?.hasAppearance === true
  ));
  if (stamps.length === 0) return new Map();

  const operatorList = await page.getOperatorList({
    intent: 'display',
    annotationMode: PDFJS_ANNOTATION_MODE_ENABLE,
  });
  const output = new Map();

  for (const annotation of stamps) {
    const range = annotationOperatorRange(operatorList, annotation.id);
    if (!range || !Array.isArray(annotation.rect)) continue;
    const unitViewport = page.getViewport({ scale: 1 });
    const unitRect = unitViewport.convertToViewportRectangle(annotation.rect);
    const unitWidth = Math.abs(unitRect[2] - unitRect[0]);
    const unitHeight = Math.abs(unitRect[3] - unitRect[1]);
    if (!(unitWidth > 0 && unitHeight > 0)) continue;
    const scale = Math.min(
      DEFAULT_APPEARANCE_SCALE,
      MAX_APPEARANCE_EDGE / Math.max(unitWidth, unitHeight),
    );
    const viewport = page.getViewport({ scale });
    const rect = viewport.convertToViewportRectangle(annotation.rect);
    const left = Math.min(rect[0], rect[2]);
    const top = Math.min(rect[1], rect[3]);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(Math.abs(rect[2] - rect[0])));
    canvas.height = Math.max(1, Math.ceil(Math.abs(rect[3] - rect[1])));
    const canvasContext = canvas.getContext('2d', { alpha: true });
    if (!canvasContext) continue;

    const task = page.render({
      canvas,
      canvasContext,
      viewport,
      annotationMode: PDFJS_ANNOTATION_MODE_ENABLE,
      background: 'rgba(0,0,0,0)',
      transform: [1, 0, 0, 1, -left, -top],
      operationsFilter: (index) => (
        operatorList.fnArray[index] === PDFJS_OP_DEPENDENCY
        || (index >= range.start && index <= range.end)
      ),
    });
    await task.promise;
    output.set(annotation.id, await canvasToPngDataUrl(canvas));
  }
  return output;
}

export const isPdfStampProxy = (obj) => (
  String(obj?.type || '').toLowerCase() === 'image'
  && (obj?.pdfAnnotationType || obj?.data?.pdfAnnotationType) === 'Stamp'
  && typeof (obj?.src || obj?.dataUrl) === 'string'
);

export const getPdfStampProxySvgProps = (obj) => {
  const left = Number(obj?.left) || 0;
  const top = Number(obj?.top) || 0;
  const width = Math.max(0, (Number(obj?.width) || 0) * Math.abs(Number(obj?.scaleX) || 1));
  const height = Math.max(0, (Number(obj?.height) || 0) * Math.abs(Number(obj?.scaleY) || 1));
  const angle = obj?.data?.pdfStampAppearanceRotationBaked === true ? 0 : Number(obj?.angle) || 0;
  return {
    href: obj?.src || obj?.dataUrl,
    x: left,
    y: top,
    width,
    height,
    opacity: Number.isFinite(Number(obj?.opacity)) ? Number(obj.opacity) : 1,
    preserveAspectRatio: 'none',
    ...(angle ? { transform: `rotate(${angle}, ${left + width / 2}, ${top + height / 2})` } : {}),
  };
};

export const pngDataUrlToBytes = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const binary = typeof atob === 'function'
    ? atob(match[1].replace(/\s/g, ''))
    : Buffer.from(match[1], 'base64').toString('binary');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
