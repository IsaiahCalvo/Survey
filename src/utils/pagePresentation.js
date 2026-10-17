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
  if (!frame || frame.width <= 0 || frame.height <= 0) return null;
  const x = (point.clientX - frame.left) / frame.width * size.width;
  const y = (point.clientY - frame.top) / frame.height * size.height;
  return { x: frame.mirrorH ? size.width - x : x, y: frame.mirrorV ? size.height - y : y };
}
