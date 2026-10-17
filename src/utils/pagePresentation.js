// A page mirror keeps annotation geometry in its own page frame.
export const PAGE_PRESENTATION_META_KEY = 'pagePresentation';
export function normalizePagePresentations(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([page, state]) => Number.isInteger(Number(page)) && Number(page) > 0 && state && typeof state === 'object').map(([page, state]) => [page, { rotation: Number(state.rotation) || 0, mirrorH: state.mirrorH === true, mirrorV: state.mirrorV === true }]));
}
export function pagePresentationFrame(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  const page = element?.closest?.('.survey-pdfjs-page-div') || element;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, mirrorH: page.dataset?.pageMirrorH === 'true', mirrorV: page.dataset?.pageMirrorV === 'true' };
}
export function clientPointInPageFrame(point, frame, size) {
  if (!frame || !size || !point
    || ![frame.left, frame.top, frame.width, frame.height, size.width, size.height, point.clientX, point.clientY].every(Number.isFinite)
    || frame.width <= 0 || frame.height <= 0 || size.width <= 0 || size.height <= 0) return null;
  const x = (point.clientX - frame.left) / frame.width * size.width;
  const y = (point.clientY - frame.top) / frame.height * size.height;
  return { x: frame.mirrorH ? size.width - x : x, y: frame.mirrorV ? size.height - y : y };
}

// Group paste anchors its visible upper-left corner at the pointer. The
// source frame's lower/right corner becomes upper-left after reflection.
export function clientPastePointInPageFrame(point, frame, size, { extent = null, repeatOffset = 0 } = {}) {
  const result = clientPointInPageFrame(point, frame, size);
  if (!result) return null;
  const width = Number(extent?.width ?? 0), height = Number(extent?.height ?? 0);
  if (![width, height, repeatOffset].every(Number.isFinite) || width < 0 || height < 0) return null;
  return {
    x: result.x - (frame.mirrorH ? width : 0) + (frame.mirrorH ? -repeatOffset : repeatOffset),
    y: result.y - (frame.mirrorV ? height : 0) + (frame.mirrorV ? -repeatOffset : repeatOffset),
  };
}
