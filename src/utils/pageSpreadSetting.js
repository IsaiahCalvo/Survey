/**
 * pageSpreadSetting.js — the reader's page view (Single / Double / Cover /
 * Grid, Nightly 'page-spreads'). One setting for the app, kept on this device, so
 * every open document and the next one open the same way (Drawboard's "Set
 * as default" without the extra step). Without the flag it is always Single.
 */
import { useSyncExternalStore } from 'react';
import { isFeatureOn } from '../featureFlags.js';
import { DEFAULT_GRID_COLUMNS, GRID_COLUMN_CHOICES, gridColumns, normalizeSpreadMode } from './pageSpreads.js';

const KEY = 'survey.pageSpread.v1';
// The last Grid column count, so Grid opens again with the columns it had.
const GRID_KEY = 'survey.pageGridColumns.v1';
const listeners = new Set();
let current = null;
let flagOn = null;

function read() {
  try {
    return normalizeSpreadMode(globalThis.localStorage?.getItem(KEY));
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
  const next = normalizeSpreadMode(mode === 'grid' ? `grid-${getGridColumns()}` : mode);
  current = next;
  try {
    globalThis.localStorage?.setItem(KEY, next);
    if (gridColumns(next)) globalThis.localStorage?.setItem(GRID_KEY, String(gridColumns(next)));
  } catch { /* private window */ }
  listeners.forEach((fn) => fn());
}

/** The Grid's column count: the current one, else the last one used, else 3. */
export function getGridColumns() {
  const now = gridColumns(current);
  if (now) return now;
  try {
    const kept = Number(globalThis.localStorage?.getItem(GRID_KEY));
    if (GRID_COLUMN_CHOICES.includes(kept)) return kept;
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
