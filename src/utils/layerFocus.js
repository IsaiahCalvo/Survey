/**
 * Layer focus (Nightly flag 'layer-focus'; Drawboard Projects LY focus
 * mode): marks on every layer but the active one fade to the Focus level, so
 * the layer you draw on stands out. The PDF itself is not faded. View only
 * and for this sitting: nothing is saved, and other people see nothing.
 *
 * Drawn by one generated stylesheet (no re-render of the marks): each mark's
 * wrapper carries data-mark-layer (SVGAnnotationLayer), and the rule fades
 * the wrappers whose layer is not the active one. A mark naming a layer
 * that no longer exists counts as the default layer, as everywhere else.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_LAYER_ID, normalizeLayerState } from './layers.js';

export const LAYER_FOCUS_STYLE_ID = 'survey-layer-focus';
export const LAYER_FOCUS_LEVELS = Object.freeze([10, 20, 40, 60, 80]);
export const DEFAULT_LAYER_FOCUS_LEVEL = 20;

let state = Object.freeze({ on: false, level: DEFAULT_LAYER_FOCUS_LEVEL });
const listeners = new Set();

export const getLayerFocus = () => state;
export const subscribeLayerFocus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const setLayerFocus = (patch) => {
    const level = LAYER_FOCUS_LEVELS.includes(patch?.level) ? patch.level : state.level;
    const on = typeof patch?.on === 'boolean' ? patch.on : state.on;
    if (on === state.on && level === state.level) return state;
    state = Object.freeze({ on, level });
    listeners.forEach((fn) => fn());
    return state;
};
export const useLayerFocus = () => useSyncExternalStore(subscribeLayerFocus, getLayerFocus, getLayerFocus);

const cssString = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The stylesheet text for this focus, or '' when there is nothing to fade. */
export function layerFocusCss({ on, level }, activeLayerId, layerState) {
    if (!on) return '';
    const layers = normalizeLayerState(layerState).layers;
    const active = layers.some((l) => l.id === activeLayerId) ? activeLayerId : DEFAULT_LAYER_ID;
    const marks = '[data-svg-annotation-layer] [data-annotation-index]';
    const opacity = `opacity: ${level / 100} !important;`;
    if (active !== DEFAULT_LAYER_ID) return `${marks}:not([data-mark-layer=${cssString(active)}]) { ${opacity} }`;
    // Default layer active: fade only the named layers, so a mark on a layer
    // that is gone (it reads as the default layer) stays bright.
    const others = layers.filter((l) => l.id !== DEFAULT_LAYER_ID);
    if (!others.length) return '';
    return `${others.map((l) => `${marks}[data-mark-layer=${cssString(l.id)}]`).join(',\n')} { ${opacity} }`;
}

/** Put the stylesheet in the page (or take it out). */
export function applyLayerFocusCss(css, doc = (typeof document !== 'undefined' ? document : null)) {
    if (!doc?.head) return;
    let el = doc.getElementById(LAYER_FOCUS_STYLE_ID);
    if (!css) { el?.remove(); return; }
    if (!el) {
        el = doc.createElement('style');
        el.id = LAYER_FOCUS_STYLE_ID;
        doc.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
}
