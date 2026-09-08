import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createQuitSaveRegistry } from '../services/quitSaveRegistry.js';
import { createNativeQuitHandler } from '../services/nativeQuitHandler.js';

export function useNativeQuitSave(tabs) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const confirmedRef = useRef(false);
  const pointersRef = useRef(new Set());
  const freezeStateRef = useRef({ owners: 0, element: null, wasInert: false });
  const nativeOwnersRef = useRef(0);
  const mountedRef = useRef(false);
  const registryRef = useRef(null);
  if (!registryRef.current) registryRef.current = createQuitSaveRegistry(
    () => tabsRef.current.filter((tab) => !tab.isHome && tab.file),
  );
  const freeze = useCallback(() => {
    if (!mountedRef.current) throw new Error('This window is no longer open.');
    if (pointersRef.current.size || document.querySelector('[data-text-edit-overlay]')) {
      throw new Error('Finish the current drawing or text edit, then close again. The app was kept open.');
    }
    // Both close paths use the PDF field's existing blur commit. Drain React
    // before the registry reads any tab snapshot, without a timer.
    flushSync(() => { document.activeElement?.blur?.(); });
    const state = freezeStateRef.current;
    if (!state.owners) {
      state.element = document.documentElement;
      state.wasInert = state.element.inert;
    }
    state.owners++;
    state.element.inert = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--state.owners === 0) {
        state.element.inert = state.wasInert;
        state.element = null;
      }
    };
  }, []);
  const prepareTabClose = useCallback(async tabId => {
    let release;
    try {
      // A native confirmation may already be in flight to the main process.
      // A tab close must not replace that proof after its positive reply.
      if (nativeOwnersRef.current) throw new Error('The app is already checking its saved files before closing. Wait for that check to finish.');
      release = freeze();
      return await registryRef.current.prepareTabClose(tabId);
    } catch (error) {
      return { saved: false, tabIds: [], reason: error?.message || 'The document could not be saved before closing.' };
    } finally { release?.(); }
  }, [freeze]);
  useEffect(() => {
    mountedRef.current = true;
    const api = window.electronAPI;
    const pointerDown = (event) => pointersRef.current.add(event.pointerId);
    const pointerUp = (event) => pointersRef.current.delete(event.pointerId);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('pointercancel', pointerUp, true);
    const handler = api?.onBeforeQuit && api?.notifySaveComplete ? createNativeQuitHandler({
      registry: registryRef.current, confirmedRef,
      send: (result) => api.notifySaveComplete(result),
      freeze: () => {
        const release = freeze();
        nativeOwnersRef.current++;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          nativeOwnersRef.current--;
          release();
        };
      },
    }) : null;
    const unsubscribe = handler ? api.onBeforeQuit((request) => { void handler.receive(request); }) : null;
    return () => {
      mountedRef.current = false;
      unsubscribe?.(); handler?.cancel(); registryRef.current.cancel();
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerUp, true);
      document.removeEventListener('pointercancel', pointerUp, true);
      pointersRef.current.clear();
    };
  }, [freeze]);
  return { register: registryRef.current.register,
    prepareTabClose, confirmedRef };
}
