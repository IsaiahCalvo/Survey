/**
 * Dark pages (Drawboard gap, Nightly flag 'dark-pages'): a View switch that
 * shows each PDF page light-on-dark for night work or glare on site. Purely
 * visual: CSS inverts the pdf.js page canvas and its crisp detail tile only
 * (src/styles/darkPages.css), so marks keep their real colours and nothing
 * reaches exports, prints or the saved PDF.
 *
 * Remembered per device in localStorage (every access wrapped: storage can be
 * missing or throw). The state lives on <html data-dark-pages="on"> so the
 * desktop rail button and the phone zoom menu row show the same switch.
 */
export const DARK_PAGES_KEY = 'survey.darkPages.v1';
export const DARK_PAGES_ATTR = 'data-dark-pages';
export const DARK_PAGES_EVENT = 'survey:dark-pages-change';

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const loadDarkPages = (storage = defaultStorage()) => {
    try { return storage?.getItem(DARK_PAGES_KEY) === '1'; } catch { return false; }
};

export const saveDarkPages = (on, storage = defaultStorage()) => {
    try { storage?.setItem(DARK_PAGES_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
};

export const applyDarkPages = (on, root = (typeof document !== 'undefined' ? document.documentElement : null)) => {
    if (!root) return;
    if (on) root.setAttribute(DARK_PAGES_ATTR, 'on');
    else root.removeAttribute(DARK_PAGES_ATTR);
};

/** Flip/set dark pages: saves, applies, and tells every toggle on screen. */
export const setDarkPages = (on, { storage, root } = {}) => {
    const value = Boolean(on);
    saveDarkPages(value, storage === undefined ? defaultStorage() : storage);
    applyDarkPages(value, root);
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DARK_PAGES_EVENT, { detail: value }));
    } catch { /* no window */ }
    return value;
};
