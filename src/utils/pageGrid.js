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
