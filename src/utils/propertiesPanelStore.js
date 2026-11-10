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
