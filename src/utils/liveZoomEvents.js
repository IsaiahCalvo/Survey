export const LIVE_ZOOM_EVENT = 'survey-pdfjs-live-zoom';

export function getLiveZoomViewerId(tabId) {
  return `pdfjs-pdf-viewer-${tabId || 'default'}`;
}

export function isLiveZoomEventForViewer(detail, viewerId) {
  return Boolean(viewerId) && detail?.viewerId === viewerId;
}
