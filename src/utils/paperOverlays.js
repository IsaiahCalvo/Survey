/**
 * Paper overlays (Nightly flag 'paper-overlays'; Drawboard Projects VT-46).
 * A view setting that lays a paper pattern (notebook rules, graph paper,
 * isometric and hex grids, music staves) over every page: above the PDF,
 * under the marks. It lives in CSS only (src/styles/paperOverlays.css), so
 * it follows zoom with no JavaScript and never reaches exports, prints or
 * the saved PDF. Session only and per viewer, like Drawboard: a reload
 * brings the plain page back.
 *
 * Each kind is up to PAPER_LAYER_COUNT background layers. A layer is an
 * image (an SVG tile as a data URI) with a size and a position, each given
 * as PDF points plus a percent of the page: CSS works out
 * `scale * pt * 1px + pct * 1%`, so a 1/4" square is 18pt at any zoom and a
 * margin line can be "50% across".
 */
export const PAPER_OVERLAY_ATTR = 'data-paper-overlay';
export const PAPER_OVERLAY_EVENT = 'survey:paper-overlay-change';
export const PAPER_LAYER_COUNT = 3;
export const PAPER_NONE = 'none';

const IN = 72;
const CM = 72 / 2.54;
const MM = CM / 10;

// Drawboard's look: light cyan lines, major lines stronger (about #72BCD4).
const MINOR = 'rgba(114,188,212,0.45)';
const MAJOR = 'rgba(114,188,212,0.9)';
const RULE = 'rgba(96,150,214,0.7)';
const MARGIN = 'rgba(224,92,92,0.75)';
const INK = 'rgba(90,96,104,0.55)';
const HEX = 'rgba(132,160,184,0.6)';

const r = (n) => Math.round(n * 1000) / 1000;

const svgUri = (w, h, body) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}" preserveAspectRatio="none">${body}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

const rect = (x, y, w, h, fill) => `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}"/>`;
const line = (x1, y1, x2, y2, stroke, width) => `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${r(width)}"/>`;

/** A layer that fills the page with one repeating tile. */
const tile = (w, h, body) => ({ img: svgUri(w, h, body), w, h, repeat: 'repeat' });

/** Square grid: minor lines every `step`, a stronger line every `every` steps. */
const squareGrid = (step, every = 1, { minor = MINOR, major = MAJOR, width = 0.5 } = {}) => {
    const size = step * every;
    let body = '';
    for (let i = 1; i < every; i += 1) {
        body += rect(i * step, 0, width, size, minor) + rect(0, i * step, size, width, minor);
    }
    const edge = every > 1 ? major : minor;
    const edgeWidth = every > 1 ? width * 1.6 : width;
    body += rect(0, 0, edgeWidth, size, edge) + rect(0, 0, size, edgeWidth, edge);
    return tile(size, size, body);
};

/** Triangle grid of side `a`: verticals and two 30-degree slopes. */
const isoGrid = (a, color = MINOR, width = 0.5) => {
    const w = a * Math.sqrt(3);
    const h = a;
    const body = rect(0, 0, width, h, color) + rect(w / 2, 0, width, h, color)
        + line(0, 0, w, h, color, width) + line(0, h, w, 0, color, width);
    return tile(w, h, body);
};

/** Dots on the corners of a triangle grid of side `a`. */
const isoDots = (a, color = MAJOR, radius = 1.1) => {
    const w = a * Math.sqrt(3);
    const h = a;
    const dot = (x, y) => `<circle cx="${r(x)}" cy="${r(y)}" r="${r(radius)}" fill="${color}"/>`;
    const body = dot(0, 0) + dot(w, 0) + dot(0, h) + dot(w, h) + dot(w / 2, h / 2);
    return tile(w, h, body);
};

/** Flat-topped hexagons, `across` points from corner to corner. */
const hexGrid = (across, color = HEX, width = 0.6) => {
    const R = across / 2;
    const w = 3 * R;
    const h = Math.sqrt(3) * R;
    const path = `M0 ${r(h / 2)} L${r(R / 2)} 0 L${r(1.5 * R)} 0 L${r(2 * R)} ${r(h / 2)} L${r(1.5 * R)} ${r(h)} L${r(R / 2)} ${r(h)} Z M${r(2 * R)} ${r(h / 2)} L${r(w)} ${r(h / 2)}`;
    return tile(w, h, `<path d="${path}" fill="none" stroke="${color}" stroke-width="${r(width)}"/>`);
};

/** Ruled lines every `gap` points, the full width of the page. */
const rules = (gap, color = RULE, width = 0.6) => ({
    img: svgUri(10, gap, rect(0, gap - width, 10, width, color)),
    w: 0, wp: 100, h: gap, repeat: 'repeat-y',
});

/** One vertical line: `x` points from the left, or `xp` percent across. */
const vLine = (x, color, width = 1, xp = 0) => ({
    img: svgUri(width, 10, rect(0, 0, width, 10, color)),
    w: width, h: 0, hp: 100, x, xp, repeat: 'no-repeat',
});

/** One horizontal line: `y` points from the top (negative with yp 100: from the bottom). */
const hLine = (y, color, width = 1, yp = 0) => ({
    img: svgUri(10, width, rect(0, 0, 10, width, color)),
    w: 0, wp: 100, h: width, y, yp, repeat: 'no-repeat',
});

/** Music lines: `count` lines `gap` apart in groups, each group `block` tall. */
const staves = (groups, block, color = INK, width = 0.6) => {
    let body = '';
    for (const { top, count, gap } of groups) {
        for (let i = 0; i < count; i += 1) body += rect(0, top + i * gap, 10, width, color);
    }
    return { img: svgUri(10, block, body), w: 0, wp: 100, h: block, y: 36, repeat: 'repeat-y' };
};

const kind = (id, label, layers) => Object.freeze({ id, label, layers: Object.freeze(layers) });

/**
 * The 23 entries, in Drawboard's menu order and groups. Names are ours:
 * Drawboard shows three names twice and writes "1cm"" for the 1 cm isometric
 * grid; each here says what makes it different.
 */
export const PAPER_OVERLAY_GROUPS = Object.freeze([
    Object.freeze({
        id: 'notes',
        label: 'Notetaking',
        kinds: Object.freeze([
            kind(PAPER_NONE, 'Blank page', []),
            kind('notebook', 'Notebook paper', [rules(24), vLine(90, MARGIN, 1)]),
            kind('gregg', 'Gregg ruled', [rules(24), vLine(0, MARGIN, 1, 50)]),
            kind('pitman', 'Pitman ruled', [rules(18), vLine(0, MARGIN, 1, 50)]),
            kind('cornell', 'Cornell notes', [rules(24, INK), vLine(180, INK, 1.2), hLine(-144, INK, 1.2, 100)]),
        ]),
    }),
    Object.freeze({
        id: 'grids',
        label: 'Grids and graphs',
        kinds: Object.freeze([
            kind('engineering', 'Engineering grid', [squareGrid(IN / 2, 2)]),
            kind('graph-quarter-in', 'Graph paper 1/4"', [squareGrid(IN / 4, 4)]),
            kind('graph-eighth-in', 'Graph paper 1/8"', [squareGrid(IN / 8, 8)]),
            kind('graph-1cm', 'Graph paper 1 cm', [squareGrid(CM, 5)]),
            kind('graph-half-cm', 'Graph paper 1/2 cm', [squareGrid(CM / 2, 2)]),
            kind('graph-1mm', 'Graph paper 1 mm', [squareGrid(MM, 10, { width: 0.3 })]),
            kind('graph-1cm-plain', 'Graph paper 1 cm (plain)', [squareGrid(CM, 1)]),
            kind('graph-half-cm-plain', 'Graph paper 1/2 cm (plain)', [squareGrid(CM / 2, 1)]),
            kind('iso-half-in', 'Isometric grid 1/2"', [isoGrid(IN / 2)]),
            kind('iso-1cm', 'Isometric grid 1 cm', [isoGrid(CM)]),
            kind('iso-dots-2cm', 'Isometric dots 2 cm', [isoDots(2 * CM)]),
            kind('hex-1in', 'Hexagon grid 1"', [hexGrid(IN)]),
            kind('iso-half-in-bold', 'Isometric grid 1/2" (bold)', [isoGrid(IN / 2, MAJOR, 0.8)]),
            kind('hex-quarter-in', 'Hexagon grid 1/4"', [hexGrid(IN / 4, HEX, 0.4)]),
            kind('hex-eighth-in', 'Hexagon grid 1/8"', [hexGrid(IN / 8, HEX, 0.3)]),
        ]),
    }),
    Object.freeze({
        id: 'music',
        label: 'Music',
        kinds: Object.freeze([
            kind('stave', 'Blank staves', [staves([{ top: 18, count: 5, gap: 7 }], 72)]),
            kind('tab-6', '6-line tab', [staves([{ top: 16, count: 6, gap: 8 }], 84)]),
            kind('grand-stave', 'Double staves', [staves([{ top: 18, count: 5, gap: 7 }, { top: 72, count: 5, gap: 7 }], 132)]),
        ]),
    }),
]);

export const PAPER_OVERLAY_KINDS = Object.freeze(PAPER_OVERLAY_GROUPS.flatMap((g) => g.kinds));
const BY_ID = new Map(PAPER_OVERLAY_KINDS.map((k) => [k.id, k]));

export const paperOverlayKind = (id) => BY_ID.get(id) || BY_ID.get(PAPER_NONE);

/**
 * The CSS custom properties for a kind: --paper-N-img, -w, -wp, -h, -hp,
 * -x, -xp, -y, -yp, -repeat for each of the PAPER_LAYER_COUNT layers.
 * Unused layers get `none`. Numbers stay bare: the page rule multiplies
 * them by the page's own --survey-page-scale.
 */
export const paperOverlayVars = (id) => {
    const layers = paperOverlayKind(id).layers;
    const vars = {};
    for (let i = 0; i < PAPER_LAYER_COUNT; i += 1) {
        const layer = layers[i];
        const n = i + 1;
        vars[`--paper-${n}-img`] = layer ? layer.img : 'none';
        vars[`--paper-${n}-w`] = String(layer ? r(layer.w ?? 0) : 1);
        vars[`--paper-${n}-wp`] = String(layer?.wp ?? 0);
        vars[`--paper-${n}-h`] = String(layer ? r(layer.h ?? 0) : 1);
        vars[`--paper-${n}-hp`] = String(layer?.hp ?? 0);
        vars[`--paper-${n}-x`] = String(r(layer?.x ?? 0));
        vars[`--paper-${n}-xp`] = String(layer?.xp ?? 0);
        vars[`--paper-${n}-y`] = String(r(layer?.y ?? 0));
        vars[`--paper-${n}-yp`] = String(layer?.yp ?? 0);
        vars[`--paper-${n}-repeat`] = layer?.repeat || 'no-repeat';
    }
    return vars;
};

const VAR_NAMES = Object.keys(paperOverlayVars(PAPER_NONE));

// This sitting's choice. Not saved anywhere: Drawboard drops it on reload.
let current = PAPER_NONE;

export const getPaperOverlay = () => current;

export const applyPaperOverlay = (id, root = (typeof document !== 'undefined' ? document.documentElement : null)) => {
    if (!root) return;
    const k = paperOverlayKind(id);
    if (k.id === PAPER_NONE) {
        root.removeAttribute(PAPER_OVERLAY_ATTR);
        for (const name of VAR_NAMES) root.style.removeProperty(name);
        return;
    }
    const vars = paperOverlayVars(k.id);
    for (const name of VAR_NAMES) root.style.setProperty(name, vars[name]);
    root.setAttribute(PAPER_OVERLAY_ATTR, k.id);
};

/** Pick a paper for every page and tell every picker on screen. */
export const setPaperOverlay = (id, { root } = {}) => {
    const k = paperOverlayKind(id);
    current = k.id;
    applyPaperOverlay(k.id, root);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PAPER_OVERLAY_EVENT, { detail: k.id }));
    } catch { /* no window */ }
    return k.id;
};
