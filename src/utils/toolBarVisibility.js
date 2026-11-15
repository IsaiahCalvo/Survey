/**
 * Show/hide the tool bar (Nightly flag 'toolbar-settings'; Drawboard Projects
 * VT-33 "Show/hide toolbars"). With the tool bar hidden, the desktop viewer
 * drops the top tool row and the settings row under it, and the page moves up
 * into the room. The left rail, bottom bar, keys and right-click menu stay,
 * and the left rail's Toolbars card brings it back.
 *
 * Saved per device (every storage access wrapped). The state lives on
 * <html data-tool-bar="hidden"> so the CSS (styles/toolBarVisibility.css)
 * needs no props threaded through the shell; AppShell only sets it on the
 * desktop viewer, never the phone, whose header is its only way back.
 */
import { useEffect, useState } from 'react';

export const TOOL_BAR_HIDDEN_KEY = 'survey.toolBar.hidden.v1';
export const TOOL_BAR_ATTR = 'data-tool-bar';
export const TOOL_BAR_EVENT = 'survey:tool-bar-change';

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const loadToolBarHidden = (storage = defaultStorage()) => {
    try { return storage?.getItem(TOOL_BAR_HIDDEN_KEY) === '1'; } catch { return false; }
};

export const applyToolBarHidden = (hidden, root = (typeof document !== 'undefined' ? document.documentElement : null)) => {
    if (!root) return;
    if (hidden) root.setAttribute(TOOL_BAR_ATTR, 'hidden');
    else root.removeAttribute(TOOL_BAR_ATTR);
};

/** Save the choice and tell every switch on screen (the shell applies it). */
export const setToolBarHidden = (hidden, { storage } = {}) => {
    const value = Boolean(hidden);
    try { (storage === undefined ? defaultStorage() : storage)?.setItem(TOOL_BAR_HIDDEN_KEY, value ? '1' : '0'); } catch { /* storage unavailable */ }
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOOL_BAR_EVENT, { detail: value }));
    } catch { /* no window */ }
    return value;
};

export const useToolBarHidden = () => {
    const [hidden, setHidden] = useState(() => loadToolBarHidden());
    useEffect(() => {
        const onEvent = (e) => setHidden(Boolean(e.detail));
        window.addEventListener(TOOL_BAR_EVENT, onEvent);
        return () => window.removeEventListener(TOOL_BAR_EVENT, onEvent);
    }, []);
    return [hidden, (next) => setHidden(setToolBarHidden(next))];
};
