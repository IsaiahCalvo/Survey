/**
 * Workspaces (Nightly flag 'toolbar-settings'; Drawboard Projects
 * "Workspaces"): save how the screen is laid out under a name and put it back
 * with one press. A workspace keeps:
 *
 *   - the left rail: which panel, and whether it is open;
 *   - the tool bar: shown or hidden, compact or full;
 *   - the pinned tools dock: shown, where it sits, its size and its pins;
 *   - the picked marks' bar docked or floating, and the properties panel
 *     pinned or not;
 *   - the PDF line look: Thin PDF lines level and Ignore line weight.
 *
 * It never keeps marks, pages or anything in the document.
 *
 * Saved on this device (every storage access wrapped), so it works offline.
 * Each part is a small adapter over the setting's own module, so putting a
 * workspace back updates every switch on screen the same way a press does.
 * The left rail and the pinned tools store are passed in by the caller
 * (`panel` / `applyPanel`, `pinnedStore`), so this module stays plain JS.
 */
import { useEffect, useState } from 'react';
import { loadToolBarCompact, loadToolBarHidden, setToolBarCompact, setToolBarHidden } from './toolBarVisibility.js';
import { loadThinLines, setThinLines } from './thinLines.js';
import { isIgnoreLineWeightOn, setIgnoreLineWeight } from './pdfLineWeight.js';
import { isSelectionBarDocked, setSelectionBarDocked } from './selectionBarDock.js';
import { isPropertiesPanelPinned, setPropertiesPanelPinned } from './propertiesPanelStore.js';

export const WORKSPACES_KEY = 'survey.workspaces.v1';
export const WORKSPACES_EVENT = 'survey:workspaces-change';
export const WORKSPACE_NAME_MAX = 40;
export const WORKSPACES_MAX = 20;

const defaultStorage = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

const newId = () => {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return `ws-${crypto.randomUUID()}`; } catch { /* no crypto */ }
    return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export const cleanWorkspaceName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, WORKSPACE_NAME_MAX);

const cleanPanel = (raw) => (raw && typeof raw === 'object' && typeof raw.panel === 'string'
    ? { open: Boolean(raw.open), panel: raw.panel.slice(0, 40) }
    : null);

/** Keep only the parts this module knows; anything else is dropped. */
export function normalizeLayout(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    if (typeof input.toolBarHidden === 'boolean') out.toolBarHidden = input.toolBarHidden;
    if (typeof input.toolBarCompact === 'boolean') out.toolBarCompact = input.toolBarCompact;
    if (typeof input.thinLines === 'string') out.thinLines = input.thinLines;
    if (typeof input.ignoreLineWeight === 'boolean') out.ignoreLineWeight = input.ignoreLineWeight;
    if (typeof input.selectionBarDocked === 'boolean') out.selectionBarDocked = input.selectionBarDocked;
    if (typeof input.propertiesPanelPinned === 'boolean') out.propertiesPanelPinned = input.propertiesPanelPinned;
    if (input.pinnedTools && typeof input.pinnedTools === 'object') out.pinnedTools = input.pinnedTools;
    const panel = cleanPanel(input.leftPanel);
    if (panel) out.leftPanel = panel;
    return out;
}

export function loadWorkspaces(storage = defaultStorage()) {
    let list = [];
    try { list = JSON.parse(storage?.getItem(WORKSPACES_KEY) || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list
        .filter((w) => w && typeof w === 'object' && typeof w.id === 'string' && !seen.has(w.id) && seen.add(w.id))
        .map((w) => ({ id: w.id, name: cleanWorkspaceName(w.name) || 'Workspace', savedAt: Number(w.savedAt) || 0, layout: normalizeLayout(w.layout) }))
        .slice(0, WORKSPACES_MAX);
}

const saveAll = (list, storage) => {
    try { (storage === undefined ? defaultStorage() : storage)?.setItem(WORKSPACES_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKSPACES_EVENT, { detail: list }));
    } catch { /* no window */ }
    return list;
};

/** What the screen looks like now. `panel` is the left rail's { open, panel }. */
export function captureLayout({ panel = null, pinnedStore = null } = {}) {
    return normalizeLayout({
        toolBarHidden: loadToolBarHidden(),
        toolBarCompact: loadToolBarCompact(),
        thinLines: loadThinLines(),
        ignoreLineWeight: isIgnoreLineWeightOn(),
        selectionBarDocked: isSelectionBarDocked(),
        propertiesPanelPinned: isPropertiesPanelPinned(),
        pinnedTools: pinnedStore?.exportLayout?.() || null,
        leftPanel: panel,
    });
}

/** Put a layout back through each setting's own setter. */
export function applyLayout(layout, { applyPanel = null, pinnedStore = null } = {}) {
    const l = normalizeLayout(layout);
    if ('toolBarHidden' in l) setToolBarHidden(l.toolBarHidden);
    if ('toolBarCompact' in l) setToolBarCompact(l.toolBarCompact);
    if ('thinLines' in l) setThinLines(l.thinLines);
    if ('ignoreLineWeight' in l && l.ignoreLineWeight !== isIgnoreLineWeightOn()) setIgnoreLineWeight(l.ignoreLineWeight);
    if ('selectionBarDocked' in l) setSelectionBarDocked(l.selectionBarDocked);
    if ('propertiesPanelPinned' in l) setPropertiesPanelPinned(l.propertiesPanelPinned);
    if (l.pinnedTools) pinnedStore?.importLayout?.(l.pinnedTools);
    if (l.leftPanel && typeof applyPanel === 'function') applyPanel(l.leftPanel);
    return l;
}

/** Save the screen as it is now; the same name (any case) is replaced. */
export function saveWorkspace(name, layout, { storage, now = Date.now() } = {}) {
    const clean = cleanWorkspaceName(name);
    if (!clean) return null;
    const list = loadWorkspaces(storage === undefined ? defaultStorage() : storage);
    const existing = list.find((w) => w.name.toLowerCase() === clean.toLowerCase());
    const entry = { id: existing?.id || newId(), name: clean, savedAt: now, layout: normalizeLayout(layout) };
    const next = existing ? list.map((w) => (w.id === existing.id ? entry : w)) : [...list, entry].slice(-WORKSPACES_MAX);
    saveAll(next, storage);
    return entry;
}

export function deleteWorkspace(id, { storage } = {}) {
    const list = loadWorkspaces(storage === undefined ? defaultStorage() : storage);
    return saveAll(list.filter((w) => w.id !== id), storage);
}

export function useWorkspaces() {
    const [list, setList] = useState(() => loadWorkspaces());
    useEffect(() => {
        const onEvent = () => setList(loadWorkspaces());
        window.addEventListener(WORKSPACES_EVENT, onEvent);
        return () => window.removeEventListener(WORKSPACES_EVENT, onEvent);
    }, []);
    return list;
}
