/**
 * Enhance thin PDF lines (Nightly flag 'thin-lines'; Drawboard Projects
 * toolbar-settings: "Enhance thin PDF lines", Thin / Medium / Thick).
 * Faint CAD hairlines fade when a big sheet is zoomed out; this darkens and
 * widens them on screen only. It is a CSS filter on the pdf.js page canvas
 * and its deep-zoom tile (an SVG erode: each pixel takes the darkest of its
 * neighbours, so dark ink grows), never the marks, the PDF or an export.
 *
 * Chrome snaps an erode radius to whole device pixels, so the filters are
 * written in device pixels (radius = n / devicePixelRatio) and rebuilt when
 * the ratio changes (browser zoom, another screen). Thin is half way between
 * the page as drawn and one pixel more; Medium is one pixel; Thick is half
 * way between one and two.
 *
 * Saved per device, like the page grid (every storage access wrapped).
 */
export const THIN_LINES_KEY = 'survey.thinLines.v1';
export const THIN_LINES_ATTR = 'data-thin-lines';
export const THIN_LINES_EVENT = 'survey:thin-lines-change';
export const THIN_LINES_DEFS_ID = 'survey-thin-lines-defs';

export const THIN_LINE_LEVELS = Object.freeze([
    Object.freeze({ id: 'off', label: 'Off' }),
    // `from` and `to` are erode sizes in device pixels (0 = as drawn); the
    // filter shows `mix` of `to` over `from`.
    Object.freeze({ id: 'thin', label: 'Thin', from: 0, to: 1, mix: 0.5 }),
    Object.freeze({ id: 'medium', label: 'Medium', from: 1, to: 1, mix: 1 }),
    Object.freeze({ id: 'thick', label: 'Thick', from: 1, to: 2, mix: 0.5 }),
]);

const LEVEL_IDS = new Set(THIN_LINE_LEVELS.map((l) => l.id));
export const normalizeThinLines = (value) => (LEVEL_IDS.has(value) ? value : 'off');

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const loadThinLines = (storage = defaultStorage()) => {
    try { return normalizeThinLines(storage?.getItem(THIN_LINES_KEY)); } catch { return 'off'; }
};

export const saveThinLines = (value, storage = defaultStorage()) => {
    try { storage?.setItem(THIN_LINES_KEY, normalizeThinLines(value)); } catch { /* storage unavailable */ }
};

const fmt = (n) => String(Math.round(n * 10000) / 10000);

/** The SVG filter markup for every level at this pixel ratio. */
export const thinLinesFilterMarkup = (dpr = 1) => {
    const ratio = dpr > 0 ? dpr : 1;
    const erode = (px, result) => (px > 0
        ? `<feMorphology in="SourceGraphic" operator="erode" radius="${fmt(px / ratio)}" result="${result}"/>`
        : `<feOffset in="SourceGraphic" dx="0" dy="0" result="${result}"/>`);
    return THIN_LINE_LEVELS.filter((l) => l.id !== 'off').map((l) => {
        const body = l.mix >= 1 || l.from === l.to
            ? erode(l.to, 'out')
            : `${erode(l.from, 'a')}${erode(l.to, 'b')}<feComposite in="a" in2="b" operator="arithmetic" k1="0" k2="${fmt(1 - l.mix)}" k3="${fmt(l.mix)}" k4="0"/>`;
        return `<filter id="survey-thin-lines-${l.id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${body}</filter>`;
    }).join('');
};

/** Put (or refresh) the hidden filter defs in the page. */
export const ensureThinLinesFilters = (doc = (typeof document !== 'undefined' ? document : null), dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1)) => {
    if (!doc?.body) return null;
    let svg = doc.getElementById(THIN_LINES_DEFS_ID);
    if (!svg) {
        svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', THIN_LINES_DEFS_ID);
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.style.position = 'absolute';
        svg.style.pointerEvents = 'none';
        doc.body.appendChild(svg);
    }
    const markup = `<defs>${thinLinesFilterMarkup(dpr)}</defs>`;
    if (svg.dataset.markup !== markup) {
        svg.innerHTML = markup;
        svg.dataset.markup = markup;
    }
    return svg;
};

export const applyThinLines = (value, root = (typeof document !== 'undefined' ? document.documentElement : null)) => {
    if (!root) return;
    const level = normalizeThinLines(value);
    if (level === 'off') {
        root.removeAttribute(THIN_LINES_ATTR);
        return;
    }
    ensureThinLinesFilters(root.ownerDocument);
    root.setAttribute(THIN_LINES_ATTR, level);
};

/** Pick a level: saves, applies, and tells every picker on screen. */
export const setThinLines = (value, { storage, root } = {}) => {
    const level = normalizeThinLines(value);
    saveThinLines(level, storage === undefined ? defaultStorage() : storage);
    applyThinLines(level, root);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(THIN_LINES_EVENT, { detail: level }));
    } catch { /* no window */ }
    return level;
};
