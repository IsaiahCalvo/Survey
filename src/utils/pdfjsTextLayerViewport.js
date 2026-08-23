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
