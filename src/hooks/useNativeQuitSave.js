import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createQuitSaveRegistry } from '../services/quitSaveRegistry.js';
import { createNativeQuitHandler } from '../services/nativeQuitHandler.js';

export function useNativeQuitSave(tabs) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const confirmedRef = useRef(false);
  const pointersRef = useRef(new Set());
  const registryRef = useRef(null);
  if (!registryRef.current) registryRef.current = createQuitSaveRegistry(
    () => tabsRef.current.filter((tab) => !tab.isHome && tab.file),
  );
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onBeforeQuit || !api?.notifySaveComplete) return;
    const pointerDown = (event) => pointersRef.current.add(event.pointerId);
    const pointerUp = (event) => pointersRef.current.delete(event.pointerId);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('pointercancel', pointerUp, true);
    const handler = createNativeQuitHandler({
      registry: registryRef.current, confirmedRef,
      send: (result) => api.notifySaveComplete(result),
      freeze: () => {
        if (pointersRef.current.size || document.querySelector('[data-text-edit-overlay]')) {
          throw new Error('Finish the current drawing or text edit, then close again. The app was kept open.');
        }
        const element = document.documentElement;
        const wasInert = element.inert;
        // PDF form blur uses its existing immediate commit path. Flush React
        // here so all tab snapshot readers see that change, without a sleep.
        flushSync(() => { document.activeElement?.blur?.(); });
        element.inert = true;
        return () => { element.inert = wasInert; };
      },
    });
    const unsubscribe = api.onBeforeQuit((request) => { void handler.receive(request); });
    return () => {
      unsubscribe(); handler.cancel();
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerUp, true);
      document.removeEventListener('pointercancel', pointerUp, true);
      pointersRef.current.clear();
    };
  }, []);
  return { register: registryRef.current.register, confirmedRef };
}
