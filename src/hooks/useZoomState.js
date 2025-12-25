/**
 * useZoomState Hook
 *
 * Implements smooth cursor-centered zoom like Adobe Acrobat and Drawboard PDF.
 *
 * Key technique from Mozilla pdf.js and professional PDF viewers:
 * - CSS transform for INSTANT visual feedback during zoom
 * - Transform origin = cursor position + scroll offset (relative to content)
 * - Canvas re-render only after zoom gesture completes (debounced)
 * - No CSS transition to avoid fighting with scroll adjustment
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Debounce before triggering expensive canvas re-render
// Only render after user stops zooming for this duration
const RENDER_DEBOUNCE_MS = 250;

export function useZoomState(targetScale) {
  // The scale we've actually rendered the canvas at
  const [renderedScale, setRenderedScale] = useState(targetScale);
  // Track zoom anchor point for cursor-centered zoom
  const [zoomAnchor, setZoomAnchor] = useState(null);
  const debounceRef = useRef(null);
  const initialRenderRef = useRef(true);

  // Calculate CSS transform scale ratio
  const cssScale = renderedScale > 0 ? targetScale / renderedScale : 1;

  // Whether we're actively zooming (CSS transform is non-identity)
  const isZooming = Math.abs(cssScale - 1) > 0.001;

  // Debounced update to trigger canvas re-render
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

    // Debounce the actual canvas render - only after zoom stops
    debounceRef.current = setTimeout(() => {
      setRenderedScale(targetScale);
      // Clear anchor after render completes
      setZoomAnchor(null);
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
    setZoomAnchor(null);
  }, [targetScale]);

  // Set zoom anchor point (call this when zoom starts)
  const setAnchor = useCallback((anchor) => {
    setZoomAnchor(anchor);
  }, []);

  // Calculate transform origin from anchor
  // Key insight from pdf.js: origin = cursor + scroll (relative to content)
  const getTransformOrigin = useCallback(() => {
    if (zoomAnchor) {
      return `${zoomAnchor.x}px ${zoomAnchor.y}px`;
    }
    return 'top left';
  }, [zoomAnchor]);

  return {
    // The scale to render canvas at (only updates after zoom settles)
    renderedScale,
    // CSS transform scale for instant visual feedback
    cssScale,
    // Whether CSS zoom is active
    isZooming,
    // Force immediate canvas re-render
    forceRender,
    // Set zoom anchor point for cursor-centered zoom
    setAnchor,
    // Current anchor point
    zoomAnchor,
    // CSS style for zoom container - GPU accelerated, no transition
    zoomStyle: isZooming ? {
      transform: `scale(${cssScale})`,
      transformOrigin: getTransformOrigin(),
      willChange: 'transform',
    } : {
      willChange: 'auto',
    },
  };
}

export default useZoomState;
