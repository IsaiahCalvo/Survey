// Nightly 'line-endings': each of the Line and Arrow tools remembers its own
// Start and End head, like Drawboard's Endings section (Start | End switch
// over a grid of ten heads). Defaults are Drawboard's: an Arrow draws no head
// at the start and an open arrow at the end; a Line draws none at either end.
// New marks drawn while the flag is on carry data.lineEndingSet = 'drawboard'
// so they keep Drawboard's sizes; older marks keep their own look.
import { useSyncExternalStore } from 'react';
import { isFeatureOn } from '../featureFlags.js';
import { ARROWHEAD_STYLES, LINE_ENDING_GRID_ORDER } from '../components/Callout/types.js';
import { LINE_ENDING_SET_DRAWBOARD, resolveLineEndingStyles } from './lineRenderHelpers.js';

export const LINE_ENDINGS_STORAGE_KEY = 'survey.lineEndings';

export const LINE_ENDING_DEFAULTS = Object.freeze({
  arrow: Object.freeze({ start: ARROWHEAD_STYLES.NONE, end: ARROWHEAD_STYLES.V_SHAPE }),
  line: Object.freeze({ start: ARROWHEAD_STYLES.NONE, end: ARROWHEAD_STYLES.NONE }),
});

const isEndingTool = (tool) => tool === 'arrow' || tool === 'line';
const isGridHead = (style) => LINE_ENDING_GRID_ORDER.includes(style);

function readStored() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LINE_ENDINGS_STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let state = null;
const listeners = new Set();

function current() {
  if (!state) {
    const stored = readStored();
    state = {};
    for (const tool of Object.keys(LINE_ENDING_DEFAULTS)) {
      const saved = stored[tool] || {};
      state[tool] = Object.freeze({
        start: isGridHead(saved.start) ? saved.start : LINE_ENDING_DEFAULTS[tool].start,
        end: isGridHead(saved.end) ? saved.end : LINE_ENDING_DEFAULTS[tool].end,
      });
    }
    state = Object.freeze(state);
  }
  return state;
}

/** The tool's remembered { start, end }, or null for any other tool. */
export function getLineEndingDefaults(tool) {
  return isEndingTool(tool) ? current()[tool] : null;
}

export function setLineEndingDefault(tool, side, style) {
  if (!isEndingTool(tool) || (side !== 'start' && side !== 'end') || !isGridHead(style)) return;
  const was = current();
  if (was[tool][side] === style) return;
  state = Object.freeze({ ...was, [tool]: Object.freeze({ ...was[tool], [side]: style }) });
  try { localStorage.setItem(LINE_ENDINGS_STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: the tool's { start, end } (null for other tools). */
export function useLineEndingDefaults(tool) {
  const all = useSyncExternalStore(subscribe, current, current);
  return isEndingTool(tool) ? all[tool] : null;
}

/** Tests only: forget the cached state so the next read loads storage again. */
export function resetLineEndingDefaultsForTests() {
  state = null;
}

/**
 * What buildLineCommitJSON takes for a new Line or Arrow while the flag is on
 * (the tool's own Start and End and the Drawboard marker); {} otherwise, so
 * the classic arrowhead picker keeps working unchanged.
 */
export function lineEndingCreateOptions(tool) {
  if (!isEndingTool(tool) || !isFeatureOn('line-endings')) return {};
  const ends = getLineEndingDefaults(tool);
  return {
    endingSet: LINE_ENDING_SET_DRAWBOARD,
    arrowheadStyle: ends.end,
    arrowStartStyle: ends.start,
  };
}

/**
 * The one picked line's heads as a plain string ("start|end|page") so the
 * toolbar API carries a value, not a new object each render (an object would
 * republish the API every render). Null when it is not one line, or the flag is off.
 */
export function pickedLineEndsKey(object, pageNumber) {
  if (!isFeatureOn('line-endings')) return null;
  if (!object || pageNumber == null || String(object.type || '').toLowerCase() !== 'line' || !Number.isFinite(Number(pageNumber))) return null;
  const { startStyle, endStyle } = resolveLineEndingStyles(object);
  return `${startStyle}|${endStyle}|${Number(pageNumber)}`;
}

export function parsePickedLineEnds(key) {
  if (typeof key !== 'string') return null;
  const [start, end, page] = key.split('|');
  const pageNumber = Number(page);
  if (!start || !end || !Number.isFinite(pageNumber)) return null;
  return { start, end, pageNumber };
}
