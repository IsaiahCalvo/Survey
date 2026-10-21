/**
 * Recent colours for the shared CompactColorPicker (Drawboard gap #7).
 *
 * The last few colours the user picked, newest first, kept per device in
 * localStorage. Storage can be missing or throw (private windows, blocked site
 * data, node tests), so every access is wrapped and the picker simply shows no
 * recent row when nothing can be read.
 */
export const RECENT_COLORS_KEY = 'survey.recentColors.v1';
export const RECENT_COLORS_MAX = 8;

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** '#abc123' / 'ABC123' -> '#ABC123'; anything else (transparent, rgba) -> null. */
export const normaliseRecentColor = (value) => {
    const m = HEX_RE.exec(String(value ?? '').trim());
    return m ? `#${m[1].toUpperCase()}` : null;
};

/** Pure: put `color` at the front, drop its older copy, cap the list. */
export const pushRecentColor = (list, color, max = RECENT_COLORS_MAX) => {
    const hex = normaliseRecentColor(color);
    const clean = (Array.isArray(list) ? list : []).map(normaliseRecentColor).filter(Boolean);
    if (!hex) return clean.slice(0, max);
    return [hex, ...clean.filter((c) => c !== hex)].slice(0, max);
};

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const loadRecentColors = (storage = defaultStorage()) => {
    try {
        const raw = storage?.getItem(RECENT_COLORS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return pushRecentColor(parsed, null);
    } catch {
        return [];
    }
};

/** Records a colour and returns the new list (still returned if saving fails). */
export const rememberRecentColor = (color, storage = defaultStorage()) => {
    const next = pushRecentColor(loadRecentColors(storage), color);
    try { storage?.setItem(RECENT_COLORS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
};
