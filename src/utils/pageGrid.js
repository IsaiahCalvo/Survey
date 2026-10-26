/**
 * Page grid overlay (Drawboard gap #10): a View toggle that draws a light grid
 * over every page. Purely visual — it is CSS on the page divs (see
 * src/styles/pageGrid.css), so it scales with zoom through the page's own
 * size and never reaches exports, prints or the saved PDF.
 *
 * Remembered per device in localStorage (every access wrapped: storage can be
 * missing or throw). The state lives on <html data-page-grid="on"> so every
 * viewer surface (desktop rail, phone zoom menu) sees the same switch.
 */
export const PAGE_GRID_KEY = 'survey.pageGrid.v1';
export const PAGE_GRID_ATTR = 'data-page-grid';
export const PAGE_GRID_EVENT = 'survey:page-grid-change';
/** Grid step in PDF points (half an inch). CSS multiplies it by the zoom. */
export const PAGE_GRID_STEP_PT = 36;

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const loadPageGrid = (storage = defaultStorage()) => {
    try { return storage?.getItem(PAGE_GRID_KEY) === '1'; } catch { return false; }
};

export const savePageGrid = (on, storage = defaultStorage()) => {
    try { storage?.setItem(PAGE_GRID_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
};

export const applyPageGrid = (on, root = (typeof document !== 'undefined' ? document.documentElement : null)) => {
    if (!root) return;
    if (on) root.setAttribute(PAGE_GRID_ATTR, 'on');
    else root.removeAttribute(PAGE_GRID_ATTR);
};

/** Flip/set the grid: saves, applies, and tells every toggle on screen. */
export const setPageGrid = (on, { storage, root } = {}) => {
    const value = Boolean(on);
    savePageGrid(value, storage === undefined ? defaultStorage() : storage);
    applyPageGrid(value, root);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PAGE_GRID_EVENT, { detail: value }));
    } catch { /* no window */ }
    return value;
};

/*
 * Grid spacing (Nightly, flag 'grid-settings'; owner 2026-10-26: "change the
 * density of the grid and a custom scale"). Paper sizes (in, mm) are the same
 * on every page. Drawing sizes (ft, m) follow each page's own scale, set
 * with the Measure tools; a page with no scale keeps the half-inch grid.
 * The step reaches CSS as --page-grid-base-pt on <html> (paper sizes) and
 * --page-grid-pt on each page div (drawing sizes), both in PDF points.
 */
export const PAGE_GRID_SETTINGS_KEY = 'survey.pageGrid.settings.v1';
export const PAGE_GRID_SETTINGS_EVENT = 'survey:page-grid-settings-change';
export const PAGE_GRID_BASE_VAR = '--page-grid-base-pt';
export const PAGE_GRID_PAGE_VAR = '--page-grid-pt';

export const PAGE_GRID_DENSITIES = Object.freeze([
    { id: 'fine', label: 'Fine', hint: '1/4 in', pt: 18 },
    { id: 'normal', label: 'Normal', hint: '1/2 in', pt: PAGE_GRID_STEP_PT },
    { id: 'wide', label: 'Wide', hint: '1 in', pt: 72 },
]);

// Points per unit for paper sizes; drawing sizes come from the page scale.
const PAPER_PT = Object.freeze({ in: 72, mm: 72 / 25.4 });
export const PAGE_GRID_UNITS = Object.freeze([
    { id: 'in', label: 'in', paper: true },
    { id: 'mm', label: 'mm', paper: true },
    { id: 'ft', label: 'ft (drawing)', paper: false },
    { id: 'm', label: 'm (drawing)', paper: false },
]);

// Below this the lines run together on screen; above it the grid says little.
export const PAGE_GRID_MIN_PT = 2;
export const PAGE_GRID_MAX_PT = 720;

export const DEFAULT_PAGE_GRID_SETTINGS = Object.freeze({ density: 'normal', customValue: 5, customUnit: 'ft' });

export const normalizePageGridSettings = (raw) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    const density = s.density === 'custom' || PAGE_GRID_DENSITIES.some((d) => d.id === s.density) ? s.density : DEFAULT_PAGE_GRID_SETTINGS.density;
    const customValue = Number(s.customValue) > 0 && Number.isFinite(Number(s.customValue)) ? Number(s.customValue) : DEFAULT_PAGE_GRID_SETTINGS.customValue;
    const customUnit = PAGE_GRID_UNITS.some((u) => u.id === s.customUnit) ? s.customUnit : DEFAULT_PAGE_GRID_SETTINGS.customUnit;
    return { density, customValue, customUnit };
};

export const loadPageGridSettings = (storage = defaultStorage()) => {
    try { return normalizePageGridSettings(JSON.parse(storage?.getItem(PAGE_GRID_SETTINGS_KEY) || 'null')); } catch { return { ...DEFAULT_PAGE_GRID_SETTINGS }; }
};

const clampStep = (pt) => (Number.isFinite(pt) && pt > 0 ? Math.min(PAGE_GRID_MAX_PT, Math.max(PAGE_GRID_MIN_PT, pt)) : null);

/** True when the step depends on each page's drawing scale (ft, m). */
export const pageGridUsesDrawingScale = (settings) => {
    const s = normalizePageGridSettings(settings);
    return s.density === 'custom' && !PAPER_PT[s.customUnit];
};

/** The step every page shares, in points (the half inch for drawing sizes). */
export const pageGridBaseStepPt = (settings) => {
    const s = normalizePageGridSettings(settings);
    if (s.density !== 'custom') return PAGE_GRID_DENSITIES.find((d) => d.id === s.density).pt;
    if (PAPER_PT[s.customUnit]) return clampStep(s.customValue * PAPER_PT[s.customUnit]) ?? PAGE_GRID_STEP_PT;
    return PAGE_GRID_STEP_PT;
};

// Drawing units to inches, to reach a page scale held in another unit.
const UNIT_INCHES = Object.freeze({ in: 1, ft: 12, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 });

/**
 * One page's step in points for a drawing size, from its measure scale
 * ({ ptPerUnit, unit }). Null when the page has no scale (it keeps the base).
 */
export const pageGridStepForScale = (settings, scale) => {
    const s = normalizePageGridSettings(settings);
    if (!pageGridUsesDrawingScale(s)) return null;
    const ptPerUnit = Number(scale?.ptPerUnit);
    const from = UNIT_INCHES[scale?.unit];
    if (!(ptPerUnit > 0) || !from) return null;
    const ptPerInchReal = ptPerUnit / from;
    return clampStep(s.customValue * UNIT_INCHES[s.customUnit] * ptPerInchReal);
};

export const applyPageGridSettings = (settings, root = (typeof document !== 'undefined' ? document.documentElement : null)) => {
    if (!root?.style) return;
    root.style.setProperty(PAGE_GRID_BASE_VAR, String(pageGridBaseStepPt(settings)));
};

/** Saves, applies and tells the viewer (it refreshes drawing-size pages). */
export const setPageGridSettings = (next, { storage, root } = {}) => {
    const value = normalizePageGridSettings(next);
    try { (storage === undefined ? defaultStorage() : storage)?.setItem(PAGE_GRID_SETTINGS_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
    applyPageGridSettings(value, root);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PAGE_GRID_SETTINGS_EVENT, { detail: value }));
    } catch { /* no window */ }
    return value;
};

/**
 * Writes each page div's own step for drawing sizes; clears it otherwise.
 * `scaleForPage(n)` gives page n's measure scale or null.
 */
export const applyPageGridPageSteps = (settings, scaleForPage, container = (typeof document !== 'undefined' ? document : null)) => {
    if (!container?.querySelectorAll) return;
    const drawing = pageGridUsesDrawingScale(settings);
    container.querySelectorAll('.survey-pdfjs-page-div[data-page-number]').forEach((div) => {
        const step = drawing ? pageGridStepForScale(settings, scaleForPage(Number(div.getAttribute('data-page-number')))) : null;
        if (step) div.style.setProperty(PAGE_GRID_PAGE_VAR, String(step));
        else div.style.removeProperty(PAGE_GRID_PAGE_VAR);
    });
};
