/**
 * pageSpreadSetting.js — the reader's page view (Single / Double / Cover,
 * Nightly 'page-spreads'). One setting for the app, kept on this device, so
 * every open document and the next one open the same way (Drawboard's "Set
 * as default" without the extra step). Without the flag it is always Single.
 */
import { useSyncExternalStore } from 'react';
import { isFeatureOn } from '../featureFlags.js';
import { normalizeSpreadMode } from './pageSpreads.js';

const KEY = 'survey.pageSpread.v1';
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
  const next = normalizeSpreadMode(mode);
  current = next;
  try { globalThis.localStorage?.setItem(KEY, next); } catch { /* private window */ }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePageSpreadMode() {
  return useSyncExternalStore(subscribe, getPageSpreadMode, () => 'single');
}
