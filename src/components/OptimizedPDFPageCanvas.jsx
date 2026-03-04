/**
 * OptimizedPDFPageCanvas
 *
 * Professional PDF rendering with smooth zoom:
 * 1. CSS transform for instant zoom feedback (GPU accelerated)
 * 2. Debounced high-quality re-rendering after zoom settles
 * 3. Keeps last render as placeholder during zoom animation
 * 4. Smooth transition animation during zoom
 */

import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import { perfRender } from '../utils/performanceLogger';

// How long to wait after zoom before re-rendering at new resolution
// Reduced for faster response during fast scrolling
const RENDER_DEBOUNCE_MS = 50;

// Transition duration for zoom animation
const ZOOM_TRANSITION_MS = 100;

const OptimizedPDFPageCanvas = ({
  page,
  scale,
  pageNum,
  isVisible = true,
  priority = 'low',
  onFinishRender
}) => {
  const canvasRef = useRef(null);
  const placeholderCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastRenderedScaleRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const [isRendering, setIsRendering] = useState(false);
  const [cssScale, setCssScale] = useState(1);
  const [hasPlaceholder, setHasPlaceholder] = useState(false);
  const [hasFullRender, setHasFullRender] = useState(false);

  // Calculate the CSS transform scale relative to last rendered scale
  const getTransformScale = useCallback(() => {
    if (!lastRenderedScaleRef.current) return 1;
    return scale / lastRenderedScaleRef.current;
  }, [scale]);

  // Render a low-resolution placeholder for instant appearance
  const renderPlaceholder = useCallback(async () => {
    if (!page || !placeholderCanvasRef.current || hasPlaceholder) return;

    const canvas = placeholderCanvasRef.current;
    const placeholderScale = scale * 0.25; // Render at 25% resolution for speed

    try {
      const viewport = page.getViewport({ scale: placeholderScale });
      const outputScale = 1; // No DPI scaling for placeholder

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width * 4)}px`; // Scale up via CSS
      canvas.style.height = `${Math.floor(viewport.height * 4)}px`;

      const context = canvas.getContext('2d');
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
        annotationMode: 0
      });

      await renderTask.promise;
      setHasPlaceholder(true);
    } catch (error) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering placeholder:', error);
      }
    }
  }, [page, scale, hasPlaceholder]);

  // Perform the actual canvas render
  const performRender = useCallback(async (targetScale) => {
    if (!page || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const pageLabel = pageNum || 'unknown';

    // Cancel any ongoing render
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch (e) {
        // Ignore cancel errors
      }
    }

    perfRender.start(pageLabel);
    setIsRendering(true);

    try {
      const viewport = page.getViewport({ scale: targetScale });
      const outputScale = window.devicePixelRatio || 1;

      // Set canvas dimensions
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const context = canvas.getContext('2d');
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);

      perfRender.mark(pageLabel, 'Canvas prepared');

      // Render the page
      renderTaskRef.current = page.render({
        canvasContext: context,
        viewport: viewport,
        annotationMode: 0
      });

      await renderTaskRef.current.promise;

      // Update last rendered scale and reset CSS transform
      lastRenderedScaleRef.current = targetScale;
      setCssScale(1);
      setHasFullRender(true);

      perfRender.end(pageLabel);

      if (onFinishRender) {
        onFinishRender();
      }
    } catch (error) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    } finally {
      setIsRendering(false);
    }
  }, [page, pageNum, onFinishRender]);

  // Handle scale changes with debouncing
  useEffect(() => {
    if (!page) return;

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // If we have a previous render, use CSS transform for instant feedback
    if (lastRenderedScaleRef.current) {
      const newCssScale = scale / lastRenderedScaleRef.current;
      setCssScale(newCssScale);
    }

    // Only render if visible or high priority
    if (!isVisible && priority === 'low') {
      return;
    }

    // Debounce the actual render
    debounceTimerRef.current = setTimeout(() => {
      // Only re-render if scale actually changed from last render
      if (!lastRenderedScaleRef.current ||
          Math.abs(scale - lastRenderedScaleRef.current) > 0.001) {
        performRender(scale);
      }
    }, lastRenderedScaleRef.current ? RENDER_DEBOUNCE_MS : 0); // No debounce for first render

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [page, scale, isVisible, priority, performRender]);

  // Initial placeholder render (instant)
  useEffect(() => {
    if (page && isVisible && !hasPlaceholder && !hasFullRender) {
      renderPlaceholder();
    }
  }, [page, isVisible, hasPlaceholder, hasFullRender, renderPlaceholder]);

  // Initial full render
  useEffect(() => {
    if (page && !lastRenderedScaleRef.current && isVisible) {
      performRender(scale);
    }
  }, [page, isVisible]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (e) {
          // Ignore
        }
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  if (!page) return null;

  // Get dimensions for the container
  const viewport = page.getViewport({ scale: lastRenderedScaleRef.current || scale });
  const displayWidth = Math.floor(viewport.width * (lastRenderedScaleRef.current ? cssScale : 1));
  const displayHeight = Math.floor(viewport.height * (lastRenderedScaleRef.current ? cssScale : 1));

  return (
    <div
      style={{
        position: 'relative',
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
        overflow: 'hidden',
      }}
    >
      {/* Low-res placeholder for instant appearance */}
      {hasPlaceholder && !hasFullRender && (
        <canvas
          ref={placeholderCanvasRef}
          style={{
            display: 'block',
            position: 'absolute',
            top: 0,
            left: 0,
            filter: 'blur(1px)', // Slight blur to hide low-res artifacts
            imageRendering: 'auto',
          }}
        />
      )}

      {/* High-quality main canvas */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          position: 'relative',
          transformOrigin: 'top left',
          transform: cssScale !== 1 ? `scale(${cssScale})` : 'none',
          transition: cssScale !== 1 ? `transform ${ZOOM_TRANSITION_MS}ms ease-out` : 'none',
          // GPU acceleration hints
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          // Smooth scaling during CSS transform
          imageRendering: cssScale > 1.2 ? 'auto' : 'auto',
          opacity: hasFullRender ? 1 : 0,
          transition: 'opacity 150ms ease-in',
        }}
      />
    </div>
  );
};

OptimizedPDFPageCanvas.displayName = 'OptimizedPDFPageCanvas';

// Custom comparison - only re-render component if page object or visibility changes
const arePropsEqual = (prevProps, nextProps) => {
  // Always re-render if page changes
  if (prevProps.page !== nextProps.page) return false;

  // Always re-render if visibility changes
  if (prevProps.isVisible !== nextProps.isVisible) return false;

  // Scale changes are handled internally via useEffect, not prop changes
  // This prevents React re-render, we handle it with CSS transform + debounce
  return true;
};

export default memo(OptimizedPDFPageCanvas, arePropsEqual);
