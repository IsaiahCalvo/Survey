/**
 * useBrushAdjustGesture — hands one document viewer's armed-tool settings to
 * the Photoshop-style on-page width / opacity drag (utils/brushAdjustGesture.js).
 *
 * `config` is read at the moment a press might start the gesture, so it is
 * always this render's values; `getContainer()` returns the element that holds
 * this viewer's pages (a press on another tab's pages is not ours).
 */
import { useEffect, useRef } from 'react';
import { registerBrushAdjustSource } from '../utils/brushAdjustGesture.js';

export function useBrushAdjustGesture(config) {
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => registerBrushAdjustSource(() => {
    const current = configRef.current;
    return current ? { ...current, container: current.getContainer?.() || null } : null;
  }), []);
}
