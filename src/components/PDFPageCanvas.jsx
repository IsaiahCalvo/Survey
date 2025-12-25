/**
 * PDFPageCanvas - Optimized PDF Page Renderer
 *
 * Professional rendering optimizations:
 * 1. CSS transform for instant zoom feedback (GPU accelerated)
 * 2. Debounced high-quality re-rendering after zoom settles
 * 3. Keeps last render as placeholder during zoom animation
 * 4. Smooth transition animation hiding render latency
 * 5. Concurrent render limiting via queue
 * 6. Visibility-aware rendering (skip off-screen pages)
 */

import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import { perfRender } from '../utils/performanceLogger';

// Configuration
const RENDER_DEBOUNCE_MS = 200; // Wait after zoom before re-rendering
const ZOOM_TRANSITION_MS = 150; // CSS transition duration for smooth zoom
const MAX_CONCURRENT_RENDERS = 3; // Global limit on simultaneous renders

// Global render queue for limiting concurrent renders
let activeRenderCount = 0;
const renderQueue = [];

const processRenderQueue = () => {
  while (activeRenderCount < MAX_CONCURRENT_RENDERS && renderQueue.length > 0) {
    // Sort by priority before taking next item
    renderQueue.sort((a, b) => a.priority - b.priority);
    const next = renderQueue.shift();
    if (next && next.execute) {
      activeRenderCount++;
      next.execute().finally(() => {
        activeRenderCount--;
        processRenderQueue();
      });
    }
  }
};

const enqueueRender = (priority, execute) => {
  const item = { priority, execute };
  renderQueue.push(item);
  processRenderQueue();
  return () => {
    const index = renderQueue.indexOf(item);
    if (index > -1) {
      renderQueue.splice(index, 1);
    }
  };
};

const PDFPageCanvas = ({
  page,
  scale,
  pageNum,
  isVisible = true,
  priority = 2, // 0 = high, 1 = medium, 2 = low
  onFinishRender
}) => {
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastRenderedScaleRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const cancelQueueRef = useRef(null);
  const isMountedRef = useRef(true);

  // Track CSS scale for smooth zoom animation
  const [cssScale, setCssScale] = useState(1);
  const [isRendering, setIsRendering] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);

  // Cancel any ongoing render
  const cancelCurrentRender = useCallback(() => {
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch (e) {
        // Ignore cancel errors
      }
      renderTaskRef.current = null;
    }
    if (cancelQueueRef.current) {
      cancelQueueRef.current();
      cancelQueueRef.current = null;
    }
  }, []);

  // Perform the actual canvas render
  const performRender = useCallback(async (targetScale) => {
    if (!page || !canvasRef.current || !isMountedRef.current) return;

    const canvas = canvasRef.current;
    const pageLabel = pageNum || 'unknown';

    // Cancel any ongoing render first
    cancelCurrentRender();

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

      if (!isMountedRef.current) return;

      // Update last rendered scale and reset CSS transform
      lastRenderedScaleRef.current = targetScale;
      setCssScale(1);
      setHasRendered(true);

      perfRender.end(pageLabel);

      if (onFinishRender) {
        onFinishRender();
      }
    } catch (error) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsRendering(false);
      }
    }
  }, [page, pageNum, onFinishRender, cancelCurrentRender]);

  // Queued render with priority
  const queueRender = useCallback((targetScale, renderPriority) => {
    cancelQueueRef.current = enqueueRender(renderPriority, () => performRender(targetScale));
  }, [performRender]);

  // Handle scale changes with CSS transform + debounced re-render
  useEffect(() => {
    if (!page) return;

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // If we have a previous render, use CSS transform for instant visual feedback
    if (lastRenderedScaleRef.current && hasRendered) {
      const newCssScale = scale / lastRenderedScaleRef.current;
      setCssScale(newCssScale);
    }

    // Calculate render priority based on visibility
    const renderPriority = isVisible ? 0 : priority;

    // Skip rendering if not visible and low priority
    if (!isVisible && priority > 1 && hasRendered) {
      return;
    }

    // Debounce the actual high-quality render
    const debounceTime = hasRendered ? RENDER_DEBOUNCE_MS : 0;

    debounceTimerRef.current = setTimeout(() => {
      // Only re-render if scale actually changed significantly
      if (!lastRenderedScaleRef.current ||
          Math.abs(scale - lastRenderedScaleRef.current) > 0.001) {
        queueRender(scale, renderPriority);
      }
    }, debounceTime);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [page, scale, isVisible, priority, hasRendered, queueRender]);

  // Initial render when becoming visible
  useEffect(() => {
    if (page && !hasRendered && isVisible) {
      queueRender(scale, 0); // High priority for initial visible render
    }
  }, [page, isVisible, hasRendered, scale, queueRender]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelCurrentRender();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [cancelCurrentRender]);

  if (!page) return null;

  // Calculate display dimensions
  const baseScale = lastRenderedScaleRef.current || scale;
  const viewport = page.getViewport({ scale: baseScale });
  const displayWidth = Math.floor(viewport.width * cssScale);
  const displayHeight = Math.floor(viewport.height * cssScale);

  // Determine if we should show transition (only when CSS scaling)
  const shouldTransition = cssScale !== 1 && hasRendered;

  return (
    <div
      style={{
        position: 'relative',
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
        overflow: 'hidden',
        // Background placeholder while loading
        backgroundColor: hasRendered ? 'transparent' : '#f5f5f5',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          transformOrigin: 'top left',
          transform: cssScale !== 1 ? `scale(${cssScale})` : 'none',
          // Smooth transition for zoom animation
          transition: shouldTransition
            ? `transform ${ZOOM_TRANSITION_MS}ms cubic-bezier(0.25, 0.1, 0.25, 1)`
            : 'none',
          // GPU acceleration hints
          willChange: shouldTransition ? 'transform' : 'auto',
          backfaceVisibility: 'hidden',
        }}
      />
      {/* Loading placeholder for initial render */}
      {!hasRendered && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#999',
            fontSize: 14,
          }}
        >
          Loading page {pageNum}...
        </div>
      )}
    </div>
  );
};

PDFPageCanvas.displayName = 'PDFPageCanvas';

// Optimized comparison - avoid re-renders for scale changes (handled internally)
const arePropsEqual = (prevProps, nextProps) => {
  // Re-render if page object changes
  if (prevProps.page !== nextProps.page) return false;
  // Re-render if page number changes
  if (prevProps.pageNum !== nextProps.pageNum) return false;
  // Re-render if visibility changes
  if (prevProps.isVisible !== nextProps.isVisible) return false;

  // Scale changes trigger internal useEffect, not React re-render
  // This is key to performance - we handle scale with CSS transform + debounce
  return true;
};

export default memo(PDFPageCanvas, arePropsEqual);
