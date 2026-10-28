/**
 * The small parts of the pinned tools dock the viewer chrome needs on every
 * load: the shared store, its hook, and the pin glyph on the show / hide
 * button. The dock itself (components/PinnedToolsDock.jsx) is a beta, so it
 * sits in its own chunk and loads only when the 'pinned-tools' flag is on.
 */
import { useSyncExternalStore } from 'react';
import { createPinnedToolsStore } from './pinnedTools.js';

let sharedStore = null;
export function getPinnedToolsStore() {
  sharedStore ??= createPinnedToolsStore();
  return sharedStore;
}

export function usePinnedTools(store = getPinnedToolsStore()) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

// Lucide's `pin` (lucide-static 1.61.0, ISC), drawn at the chrome's 1.5 stroke.
export function PinIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}
