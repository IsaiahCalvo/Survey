/**
 * PDFPageCanvas - PDF Page Renderer
 *
 * Renders a PDF page to canvas at the specified scale.
 * CSS transform zoom is handled at the parent container level
 * to keep canvas and annotation layers in sync.
 */

import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import { perfRender } from '../utils/performanceLogger';

// Configuration
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
  const cancelQueueRef = useRef(null);
  const isMountedRef = useRef(true);
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

    // Skip if already rendered at this scale
    if (lastRenderedScaleRef.current === targetScale) {
      return;
    }

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

      // Update last rendered scale
      lastRenderedScaleRef.current = targetScale;
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

  // Handle scale changes - re-render when scale changes
  useEffect(() => {
    if (!page) return;

    // Skip if already at this scale
    if (lastRenderedScaleRef.current === scale) {
      return;
    }

    // Calculate render priority based on visibility
    const renderPriority = isVisible ? 0 : priority;

    // Skip rendering if not visible and already has a render
    if (!isVisible && priority > 1 && hasRendered) {
      return;
    }

    queueRender(scale, renderPriority);
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
    };
  }, [cancelCurrentRender]);

  if (!page) return null;

  // Calculate display dimensions
  const viewport = page.getViewport({ scale });

  return (
    <div
      style={{
        position: 'relative',
        width: `${Math.floor(viewport.width)}px`,
        height: `${Math.floor(viewport.height)}px`,
        backgroundColor: hasRendered ? 'transparent' : '#f5f5f5',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
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

// Optimized comparison
const arePropsEqual = (prevProps, nextProps) => {
  if (prevProps.page !== nextProps.page) return false;
  if (prevProps.pageNum !== nextProps.pageNum) return false;
  if (prevProps.isVisible !== nextProps.isVisible) return false;
  if (Math.abs(prevProps.scale - nextProps.scale) > 0.001) return false;
  return true;
};

export default memo(PDFPageCanvas, arePropsEqual);
