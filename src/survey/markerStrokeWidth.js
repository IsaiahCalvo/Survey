/**
 * markerStrokeWidth.js — how wide the next freehand Survey Marker is drawn.
 *
 * Owner 2026-10-22: "we should be able to also change the pen stroke of the
 * freehand marker". Picked in the survey bar's Width menu (PDFViewer's survey
 * row) and remembered on this device, like the drawing mode
 * (markerDrawMode.js). The same menu restyles a picked freehand marker.
 */
import { useSyncExternalStore } from 'react';
import { MARKER_STROKE_DEFAULT_WIDTH, normalizeMarkerStrokeWidth } from './markerShapes.js';

export const MARKER_STROKE_WIDTH_STORAGE_KEY = 'survey.markerStrokeWidth';

function readStored() {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(MARKER_STROKE_WIDTH_STORAGE_KEY) : null;
    return value == null ? MARKER_STROKE_DEFAULT_WIDTH : normalizeMarkerStrokeWidth(value);
  } catch {
    return MARKER_STROKE_DEFAULT_WIDTH;
  }
}

let pickedWidth = readStored();
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMarkerStrokeWidth() {
  return pickedWidth;
}

export function setMarkerStrokeWidth(value) {
  const width = normalizeMarkerStrokeWidth(value);
  if (width === pickedWidth) return;
  pickedWidth = width;
  try { localStorage.setItem(MARKER_STROKE_WIDTH_STORAGE_KEY, String(width)); } catch { /* private mode */ }
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* ignore */ }
  }
}

export function useMarkerStrokeWidth() {
  return useSyncExternalStore(subscribe, getMarkerStrokeWidth, () => MARKER_STROKE_DEFAULT_WIDTH);
}

/** Test-only reset. */
export function resetMarkerStrokeWidthForTests() {
  pickedWidth = readStored();
}
