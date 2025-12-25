/**
 * useZoomState Hook
 *
 * Coordinates zoom state between PDF canvas and annotation layers.
 * Provides:
 * - Instant CSS transform for visual zoom feedback
 * - Debounced "rendered scale" for actual re-rendering
 * - Cursor-centered zoom via dynamic transform origin
 * - Both layers stay in sync
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Debounce for re-render after zoom settles
// 150ms provides good balance: fast enough to feel responsive,
// slow enough to batch rapid wheel events
const RENDER_DEBOUNCE_MS = 150;

export function useZoomState(targetScale, anchorPoint = null) {
  // The scale we've actually rendered at
  const [renderedScale, setRenderedScale] = useState(targetScale);
  const debounceRef = useRef(null);
  const initialRenderRef = useRef(true);

  // Calculate CSS transform scale
  const cssScale = renderedScale > 0 ? targetScale / renderedScale : 1;

  // Whether we're in "zooming" state (CSS transform active)
  const isZooming = Math.abs(cssScale - 1) > 0.001;

  // Debounced update to trigger re-render
  useEffect(() => {
    // Skip debounce for initial render
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      setRenderedScale(targetScale);
      return;
    }

    // Clear existing debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Debounce the actual render
    debounceRef.current = setTimeout(() => {
      setRenderedScale(targetScale);
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [targetScale]);

  // Force immediate render (for critical operations)
  const forceRender = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setRenderedScale(targetScale);
  }, [targetScale]);

  return {
    // The scale to actually render at (use for canvas/fabric operations)
    renderedScale,
    // CSS transform to apply for instant visual feedback
    cssScale,
    // Whether we're in zooming transition state
    isZooming,
    // Force immediate re-render
    forceRender,
    // Style object to apply to container - INSTANT transform (no transition)
    // Smoothness comes from debounced re-render + immediate scroll adjustment
    // Using transition here causes visual disconnect with scroll adjustment
    zoomStyle: isZooming ? {
      transform: `scale(${cssScale})`,
      transformOrigin: 'top left',
      willChange: 'transform',
    } : {},
  };
}

export default useZoomState;
