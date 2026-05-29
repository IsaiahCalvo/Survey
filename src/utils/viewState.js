// View-state helpers — normalize and compare the persisted per-tab view state
// (page number, scale, zoom mode, scroll position).
//
// Lifted verbatim out of PDFViewer as a capture-free pair: neither function
// touches component state/refs, so both were previously `useCallback(fn, [])`
// (permanently stable references). As plain module functions they remain stable
// references, so the effects that list them as dependencies behave identically.

import { ZOOM_MODES } from './zoomController';
import { coercePageNumber } from '../viewerShared';

export function normalizeViewState(viewState) {
  if (!viewState || typeof viewState !== 'object') return null;
  return {
    pageNum: coercePageNumber(viewState.pageNum, Number.POSITIVE_INFINITY) || 1,
    scale: Number.isFinite(viewState.scale) ? Number(Number(viewState.scale).toFixed(4)) : 1,
    zoomMode: viewState.zoomMode || ZOOM_MODES.MANUAL,
    scrollMode: 'continuous',
    scrollLeft: Number.isFinite(viewState.scrollLeft) ? Math.round(viewState.scrollLeft) : 0,
    scrollTop: Number.isFinite(viewState.scrollTop) ? Math.round(viewState.scrollTop) : 0
  };
}

export function areViewStatesEqual(a, b) {
  if (!a || !b) return false;
  const floatEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.0001;
  return (
    Number(a.pageNum) === Number(b.pageNum) &&
    floatEqual(a.scale, b.scale) &&
    String(a.zoomMode) === String(b.zoomMode) &&
    String(a.scrollMode) === String(b.scrollMode) &&
    Number(a.scrollLeft) === Number(b.scrollLeft) &&
    Number(a.scrollTop) === Number(b.scrollTop)
  );
}
