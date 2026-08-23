// Container-aware text-layer viewport after Pages rotate.
// Never use pageSize * scale. If the page host is landscape (792×612)
// and the pdf.js proxy is still portrait (612×792 / rotate 0), add 90
// so glyphs sit on the displayed raster instead of the pre-rotate offset.

export function resolveTextLayerRotation(
  pageRotate,
  rotation,
  hostWidth,
  hostHeight,
  intrinsicWidth,
  intrinsicHeight,
) {
  let total = Number(pageRotate || 0) + Number(rotation || 0);
  if (hostWidth > 8 && hostHeight > 8 && intrinsicWidth > 0 && intrinsicHeight > 0) {
    const hostLandscape = hostWidth > hostHeight + 8;
    const pageLandscape = intrinsicWidth > intrinsicHeight + 8;
    if (hostLandscape !== pageLandscape) total += 90;
  }
  return ((total % 360) + 360) % 360;
}

export function resolveTextLayerScale(hostWidth, fittedWidth, fallbackScale) {
  if (hostWidth > 8 && fittedWidth > 0) return hostWidth / fittedWidth;
  return fallbackScale;
}

// Search marks use the same host-aware viewport as the text layer.
// After CW the overlay viewBox is already 792×612, but pdf.js getViewport({scale:1})
// can still be leftover portrait (612×792) if the proxy has not baked /Rotate yet.
// Painting those coords into the swapped viewBox offsets hits off the glyphs.
export function resolveSearchPageViewport(page, pageNumber, extraRotation = 0) {
  const host = typeof document !== 'undefined'
    ? document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`)
    : null;
  const hostWidth = Number(host?.offsetWidth) || 0;
  const hostHeight = Number(host?.offsetHeight) || 0;
  const intrinsic = page.getViewport({ scale: 1, rotation: page.rotate + extraRotation });
  const displayRotation = resolveTextLayerRotation(
    page.rotate,
    extraRotation,
    hostWidth,
    hostHeight,
    intrinsic.width,
    intrinsic.height,
  );
  return page.getViewport({ scale: 1, rotation: displayRotation });
}

export function viewportMatchesLiveHost(viewport, pageNumber) {
  if (!viewport || typeof document === 'undefined') return true;
  const host = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  const hostWidth = Number(host?.offsetWidth) || 0;
  const hostHeight = Number(host?.offsetHeight) || 0;
  if (hostWidth <= 8 || hostHeight <= 8) return true;
  const hostLandscape = hostWidth > hostHeight + 8;
  const viewportLandscape = Number(viewport.width) > Number(viewport.height) + 8;
  return hostLandscape === viewportLandscape;
}

// Form widgets use leftover rawDims percentages (unrotated pageWidth/pageHeight).
// After CW those fractions stay 0.363/0.338 on a 792×612 host. Convert the
// PDF rect through the same host-aware viewport as the text layer, then
// re-express as % of the swapped box. Never pageSize * scale.
export function remapFormWidgetRect(rect, viewport) {
  if (!Array.isArray(rect) || rect.length < 4 || !viewport) return null;
  if (typeof viewport.convertToViewportPoint !== 'function') return null;
  const pageWidth = Number(viewport.width) || 0;
  const pageHeight = Number(viewport.height) || 0;
  if (pageWidth <= 0 || pageHeight <= 0) return null;
  const start = viewport.convertToViewportPoint(rect[0], rect[1]);
  const end = viewport.convertToViewportPoint(rect[2], rect[3]);
  if (!start || !end) return null;
  const x = Math.min(Number(start[0]), Number(end[0]));
  const y = Math.min(Number(start[1]), Number(end[1]));
  const w = Math.abs(Number(end[0]) - Number(start[0]));
  const h = Math.abs(Number(end[1]) - Number(start[1]));
  if (!(w > 0) || !(h > 0)) return null;
  return {
    left: (x / pageWidth) * 100,
    top: (y / pageHeight) * 100,
    width: (w / pageWidth) * 100,
    height: (h / pageHeight) * 100,
  };
}
