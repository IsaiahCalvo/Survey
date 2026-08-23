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
