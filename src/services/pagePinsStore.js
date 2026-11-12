// src/services/pagePinsStore.js
//
// Nightly 'comment-pins': one small shared store for the page pins, so the
// host (PagePinsHost, mounted once by the viewer) and every page's
// PagePinsLayer read the same pins, filter, composer and open card without
// threading props through the page render loop.
import { useSyncExternalStore } from 'react';
import { DEFAULT_PIN_FILTER, pinsFromComments } from '../utils/pagePins.js';

const EMPTY = Object.freeze([]);

let state = {
  enabled: false,
  documentId: null,
  userId: null,
  canWrite: false,
  comments: EMPTY,
  people: EMPTY,
  pins: EMPTY,
  kind: 'comment',
  filter: { ...DEFAULT_PIN_FILTER },
  // { pageNumber, x, y, kind } while the composer is open.
  draft: null,
  // The pin whose card is open.
  openId: null,
  // { id, pageNumber, x, y } while a pin is dragged (shown there at once).
  moving: null,
};
const listeners = new Set();

export function getPagePinsState() {
  return state;
}

export function setPagePinsState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next) return;
  let changed = false;
  for (const key of Object.keys(next)) {
    if (state[key] !== next[key]) { changed = true; break; }
  }
  if (!changed) return;
  state = { ...state, ...next };
  if ('comments' in next) state.pins = pinsFromComments(state.comments);
  listeners.forEach((fn) => fn());
}

export function subscribePagePins(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Read one slice of the pins store; re-renders only when that slice changes. */
export function usePagePins(selector) {
  return useSyncExternalStore(subscribePagePins, () => selector(state), () => selector(state));
}

/** Tests: back to the starting state. */
export function resetPagePinsState() {
  state = { ...state, enabled: false, documentId: null, comments: EMPTY, people: EMPTY, pins: EMPTY, draft: null, openId: null, moving: null, kind: 'comment' };
  listeners.forEach((fn) => fn());
}
