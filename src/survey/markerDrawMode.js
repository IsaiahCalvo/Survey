/**
 * markerDrawMode.js — which way the next Survey Marker is drawn.
 *
 * Owner 2026-10-13: Rectangle (the marquee box, default), Freehand (a
 * highlighter-like stroke) or Smart fill (only while a provider is registered,
 * see markerShapeProviders.js). The last pick is remembered on this device.
 *
 * The tool-bar group (SurveyMarkerModeTools) is the only place a mode is
 * picked. It says so while it is on screen (setMarkerModeToolsShown), and the
 * page layers read the EFFECTIVE mode: while no picker is showing — the phone
 * has none yet — every marker is a rectangle, so a mode remembered on a
 * desktop can never change what a press does where it cannot be seen.
 */
import { useSyncExternalStore } from 'react';
import { MARKER_DRAW_MODES } from './markerShapes.js';
import { getMarkerShapeProvider, subscribeMarkerShapeProviders } from './markerShapeProviders.js';

export const MARKER_DRAW_MODE_STORAGE_KEY = 'survey.markerDrawMode';
const DEFAULT_MODE = 'rectangle';

function readStored() {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(MARKER_DRAW_MODE_STORAGE_KEY) : null;
    return MARKER_DRAW_MODES.includes(value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

let pickedMode = readStored();
let toolsShown = 0;
const listeners = new Set();

function emit() {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* ignore */ }
  }
}

function subscribe(listener) {
  listeners.add(listener);
  const offProviders = subscribeMarkerShapeProviders(listener);
  return () => {
    listeners.delete(listener);
    offProviders();
  };
}

/** The mode the user last picked (may be one whose provider is gone). */
export function getPickedMarkerDrawMode() {
  return pickedMode;
}

export function setMarkerDrawMode(mode) {
  if (!MARKER_DRAW_MODES.includes(mode) || mode === pickedMode) return;
  pickedMode = mode;
  try { localStorage.setItem(MARKER_DRAW_MODE_STORAGE_KEY, mode); } catch { /* private mode */ }
  emit();
}

/** Whether a mode can be used right now (Smart fill needs its provider). */
export function isMarkerDrawModeAvailable(mode) {
  if (mode === 'smartFill') return Boolean(getMarkerShapeProvider('smartFill'));
  return mode === 'rectangle' || mode === 'freehand';
}

/** What the picker shows as lit: the pick, or Rectangle if it is unavailable. */
export function getShownMarkerDrawMode() {
  return isMarkerDrawModeAvailable(pickedMode) ? pickedMode : DEFAULT_MODE;
}

/** What a press on the page does: the shown mode while a picker is visible. */
export function getEffectiveMarkerDrawMode() {
  return toolsShown > 0 ? getShownMarkerDrawMode() : DEFAULT_MODE;
}

/** The picker reports itself on / off screen (counted, so remounts are safe). */
export function setMarkerModeToolsShown(shown) {
  toolsShown = Math.max(0, toolsShown + (shown ? 1 : -1));
  emit();
}

export function useShownMarkerDrawMode() {
  return useSyncExternalStore(subscribe, getShownMarkerDrawMode, () => DEFAULT_MODE);
}

export function useEffectiveMarkerDrawMode() {
  return useSyncExternalStore(subscribe, getEffectiveMarkerDrawMode, () => DEFAULT_MODE);
}

/** Test-only reset. */
export function resetMarkerDrawModeForTests() {
  pickedMode = readStored();
  toolsShown = 0;
  emit();
}
