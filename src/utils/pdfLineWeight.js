/**
 * Ignore PDF line weight (Nightly flag 'thin-lines'; Drawboard Projects:
 * "Ignore line weight"). Every line the PDF strokes is drawn one screen pixel
 * wide, whatever weight the drawing gave it, so a busy CAD sheet reads as
 * clean hairlines. Screen only: never the marks, the PDF, a print or an
 * export, which draw their own canvases.
 *
 * How: the viewer's page and deep-zoom canvases get their stroke() and
 * strokeRect() wrapped (applyUniformLineWeight). At each stroke the wrapper
 * reads the context's current transform and sets lineWidth so the line is
 * one canvas pixel (= one device pixel) wide, then puts the old width back.
 * pdf.js only sets lineWidth and strokes, so nothing else changes. Strokes
 * pdf.js draws on its own scratch canvases (transparency groups, patterns)
 * keep their weight.
 *
 * The page bitmaps are cached by document key, so the key carries a suffix
 * while this is on (uniformLineWeightKeySuffix) and the two looks never mix.
 *
 * Saved per device, like the other view settings (every storage access
 * wrapped).
 */
import { useEffect, useState } from 'react';

export const PDF_LINE_WEIGHT_KEY = 'survey.pdfLineWeight.v1';
export const PDF_LINE_WEIGHT_EVENT = 'survey:pdf-line-weight-change';
const PATCHED = Symbol.for('survey.uniformLineWeight');

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const loadIgnoreLineWeight = (storage = defaultStorage()) => {
    try { return storage?.getItem(PDF_LINE_WEIGHT_KEY) === 'uniform'; } catch { return false; }
};

// The live value every page canvas reads. Seeded from storage, so the first
// draw after a reload already has it.
let current = loadIgnoreLineWeight();

export const isIgnoreLineWeightOn = () => current;

/** Cache-key suffix for page bitmaps drawn while this is on. */
export const uniformLineWeightKeySuffix = () => (current ? '~uniform-lines' : '');

/** Save the choice, update the live value and tell every listener. */
export const setIgnoreLineWeight = (on, { storage } = {}) => {
    const value = Boolean(on);
    current = value;
    try { (storage === undefined ? defaultStorage() : storage)?.setItem(PDF_LINE_WEIGHT_KEY, value ? 'uniform' : 'as-drawn'); } catch { /* storage unavailable */ }
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PDF_LINE_WEIGHT_EVENT, { detail: value }));
    } catch { /* no window */ }
    return value;
};

/** The line width that draws one canvas pixel under transform `m`. */
export const uniformLineWidthFor = (m) => {
    const det = m ? Math.abs((m.a * m.d) - (m.b * m.c)) : 1;
    const k = Math.sqrt(det);
    return k > 0 && Number.isFinite(k) ? 1 / k : 1;
};

/**
 * Wrap this context's stroke() and strokeRect() once. The wrapper checks the
 * live value at every stroke, so a reused canvas follows the switch.
 */
export const applyUniformLineWeight = (ctx) => {
    if (!ctx || ctx[PATCHED]) return ctx;
    const wrap = (name) => {
        const original = ctx[name];
        if (typeof original !== 'function') return;
        ctx[name] = function uniformStroke(...args) {
            if (!current) return original.apply(this, args);
            const before = this.lineWidth;
            try {
                this.lineWidth = uniformLineWidthFor(this.getTransform?.());
                return original.apply(this, args);
            } finally {
                this.lineWidth = before;
            }
        };
    };
    wrap('stroke');
    wrap('strokeRect');
    try { Object.defineProperty(ctx, PATCHED, { value: true }); } catch { /* frozen */ }
    return ctx;
};

export const useIgnoreLineWeight = () => {
    const [on, setOn] = useState(() => current);
    useEffect(() => {
        const onEvent = (e) => setOn(Boolean(e.detail));
        window.addEventListener(PDF_LINE_WEIGHT_EVENT, onEvent);
        return () => window.removeEventListener(PDF_LINE_WEIGHT_EVENT, onEvent);
    }, []);
    return [on, (next) => setOn(setIgnoreLineWeight(next))];
};
