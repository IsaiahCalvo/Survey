// Nightly 'properties-panel': whether the properties panel is open. Shared by
// the selection quick bar (its "Expand menu" button, and its style buttons
// moving into the panel) and the panel. Stays open across picks until
// Collapse, as Drawboard's does; remembered per browser.
import { useSyncExternalStore } from 'react';

const KEY = 'survey.propertiesPanel.open';
const listeners = new Set();
let open = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch { return false; }
})();

export function isPropertiesPanelOpen() {
  return open;
}

export function setPropertiesPanelOpen(next) {
  const value = Boolean(next);
  if (value === open) return;
  open = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* storage off */ }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function usePropertiesPanelOpen() {
  return useSyncExternalStore(subscribe, isPropertiesPanelOpen, () => false);
}

// Drawboard's "Pin to side panel": the card docks as a full-height side panel
// on the right of the viewer, stays up with nothing picked, and the page
// narrows to make room. Pinned implies open; remembered per browser.
const PIN_KEY = 'survey.propertiesPanel.pinned';
let pinned = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
})();

export function isPropertiesPanelPinned() {
  return pinned;
}

export function setPropertiesPanelPinned(next) {
  const value = Boolean(next);
  if (value === pinned) return;
  pinned = value;
  try { localStorage.setItem(PIN_KEY, value ? '1' : '0'); } catch { /* storage off */ }
  if (value) setPropertiesPanelOpen(true);
  listeners.forEach((listener) => listener());
}

export function usePropertiesPanelPinned() {
  return useSyncExternalStore(subscribe, isPropertiesPanelPinned, () => false);
}

// The element the docked panel sits in (AppShell's dock host).
let dockElement = null;
export function setPropertiesDockElement(el) {
  if (el === dockElement) return;
  dockElement = el;
  listeners.forEach((listener) => listener());
}
export function usePropertiesDockElement() {
  return useSyncExternalStore(subscribe, () => dockElement, () => null);
}
