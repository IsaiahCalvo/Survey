/**
 * pageSpreadSetting.js — the reader's page view (Single / Double / Cover /
 * Grid, Nightly 'page-spreads'). One setting for the app, kept on this device, so
 * every open document and the next one open the same way (Drawboard's "Set
 * as default" without the extra step). Without the flag it is always Single.
 */
import { useSyncExternalStore } from 'react';
import { isFeatureOn } from '../featureFlags.js';
import { DEFAULT_GRID_COLUMNS, GRID_COLUMN_CHOICES, normalizeSpreadMode } from './pageSpreads.js';

const KEY = 'survey.pageSpread.v1';
// The last Grid column count, so Grid opens again with the columns it had.
const GRID_KEY = 'survey.pageGridColumns.v1';
const listeners = new Set();
let current = null;
let flagOn = null;

function read() {
  try {
    const kept = normalizeSpreadMode(globalThis.localStorage?.getItem(KEY));
    // 'strip' (and 'strip-double' ...) is the viewer's Horizontal layout,
    // never a saved view.
    return kept === 'strip' ? 'single' : kept.startsWith('strip-') ? kept.slice(6) : kept;
  } catch {
    return 'single';
  }
}

export function getPageSpreadMode() {
  // Features read their flag once (featureFlags.js).
  if (flagOn == null) flagOn = isFeatureOn('page-spreads');
  if (!flagOn) return 'single';
  if (current == null) current = read();
  return current;
}

export function setPageSpreadMode(mode) {
  const next = normalizeSpreadMode(mode === 'grid' ? `grid-${getGridChoice()}` : mode);
  current = next;
  try {
    globalThis.localStorage?.setItem(KEY, next);
    if (next.startsWith('grid-')) globalThis.localStorage?.setItem(GRID_KEY, next.slice(5));
  } catch { /* private window */ }
  listeners.forEach((fn) => fn());
}

/**
 * The Grid's columns: the current choice, else the last one used, else 3.
 * A number 2 to 6, or 'auto' (KAL-711).
 */
export function getGridChoice() {
  if (current?.startsWith('grid-')) {
    const now = current.slice(5);
    return now === 'auto' ? now : Number(now);
  }
  try {
    const kept = globalThis.localStorage?.getItem(GRID_KEY);
    if (kept === 'auto') return kept;
    if (GRID_COLUMN_CHOICES.includes(Number(kept))) return Number(kept);
  } catch { /* private window */ }
  return DEFAULT_GRID_COLUMNS;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePageSpreadMode() {
  return useSyncExternalStore(subscribe, getPageSpreadMode, () => 'single');
}

// ---- Continuous (KAL-712, Drawboard's "Continuous mode") -------------------
// On (the default): pages scroll one after another. Off: the viewer shows one
// row at a time (a page, or a pair) and the wheel turns rows. Kept on this
// device like the page view; without the flag it is always on.
const CONTINUOUS_KEY = 'survey.pageContinuous.v1';
const continuousListeners = new Set();
let continuous = null;

export function getPageContinuous() {
  if (flagOn == null) flagOn = isFeatureOn('page-spreads');
  if (!flagOn) return true;
  if (continuous == null) {
    try { continuous = globalThis.localStorage?.getItem(CONTINUOUS_KEY) !== 'off'; } catch { continuous = true; }
  }
  return continuous;
}

export function setPageContinuous(on) {
  continuous = Boolean(on);
  try { globalThis.localStorage?.setItem(CONTINUOUS_KEY, continuous ? 'on' : 'off'); } catch { /* private window */ }
  continuousListeners.forEach((fn) => fn());
}

function subscribeContinuous(fn) {
  continuousListeners.add(fn);
  return () => continuousListeners.delete(fn);
}

export function usePageContinuous() {
  return useSyncExternalStore(subscribeContinuous, getPageContinuous, () => true);
}

// ---- Direction (KAL-713, Drawboard's "Vertical" / "Horizontal") -----------
// Vertical (the default): pages run down. Horizontal: Single pages run left
// to right in one row. Kept on this device; without the flag always vertical.
const DIRECTION_KEY = 'survey.pageDirection.v1';
const directionListeners = new Set();
let direction = null;

export function getPageDirection() {
  if (flagOn == null) flagOn = isFeatureOn('page-spreads');
  if (!flagOn) return 'vertical';
  if (direction == null) {
    try { direction = globalThis.localStorage?.getItem(DIRECTION_KEY) === 'horizontal' ? 'horizontal' : 'vertical'; } catch { direction = 'vertical'; }
  }
  return direction;
}

export function setPageDirection(next) {
  direction = next === 'horizontal' ? 'horizontal' : 'vertical';
  try { globalThis.localStorage?.setItem(DIRECTION_KEY, direction); } catch { /* private window */ }
  directionListeners.forEach((fn) => fn());
}

function subscribeDirection(fn) {
  directionListeners.add(fn);
  return () => directionListeners.delete(fn);
}

export function usePageDirection() {
  return useSyncExternalStore(subscribeDirection, getPageDirection, () => 'vertical');
}
