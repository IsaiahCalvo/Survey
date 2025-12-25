/**
 * PDFPageCanvas - PDF Page Renderer
 *
 * Renders a PDF page to canvas using double-buffering to prevent flicker.
 * CSS transform zoom is handled at the parent container level.
 *
 * Anti-flicker technique (from react-pdf and professional viewers):
 * - Render to off-screen canvas first
 * - Only copy to visible canvas when render is complete
 * - Old content stays visible until new content is ready
 */

import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import { perfRender } from '../utils/performanceLogger';

// Configuration - limit concurrent renders to prevent main thread blocking
const MAX_CONCURRENT_RENDERS = 2;

// Global render queue for limiting concurrent renders
let activeRenderCount = 0;
const renderQueue = [];

const processRenderQueue = () => {
  while (activeRenderCount < MAX_CONCURRENT_RENDERS && renderQueue.length > 0) {
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
  priority = 2,
  onFinishRender
}) => {
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const lastRenderedScaleRef = useRef(null);
  const cancelQueueRef = useRef(null);
  const isMountedRef = useRef(true);
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

  // Perform the actual canvas render using double-buffering
  const performRender = useCallback(async (targetScale) => {
    if (!page || !canvasRef.current || !isMountedRef.current) return;

    const visibleCanvas = canvasRef.current;
    const pageLabel = pageNum || 'unknown';

    // Skip if already rendered at this scale
    if (lastRenderedScaleRef.current === targetScale) {
      return;
    }

    // Cancel any ongoing render first
    cancelCurrentRender();

    perfRender.start(pageLabel);

    try {
      const viewport = page.getViewport({ scale: targetScale });
      const outputScale = window.devicePixelRatio || 1;
      const width = Math.floor(viewport.width * outputScale);
      const height = Math.floor(viewport.height * outputScale);

      // Create or reuse off-screen canvas for double-buffering
      // This prevents flicker by rendering to hidden canvas first
      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
      }
      const offscreen = offscreenCanvasRef.current;
      offscreen.width = width;
      offscreen.height = height;

      const context = offscreen.getContext('2d', {
        alpha: false,  // Opaque for better performance
        willReadFrequently: false  // GPU acceleration
      });
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      perfRender.mark(pageLabel, 'Canvas prepared');

      // Render to off-screen canvas
      renderTaskRef.current = page.render({
        canvasContext: context,
        viewport: viewport,
        annotationMode: 0
      });

      await renderTaskRef.current.promise;

      if (!isMountedRef.current) return;

      // Now copy to visible canvas (atomic operation - no flicker)
      visibleCanvas.width = width;
      visibleCanvas.height = height;
      visibleCanvas.style.width = `${Math.floor(viewport.width)}px`;
      visibleCanvas.style.height = `${Math.floor(viewport.height)}px`;

      const visibleContext = visibleCanvas.getContext('2d');
      visibleContext.drawImage(offscreen, 0, 0);

      // Update state
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
    }
  }, [page, pageNum, onFinishRender, cancelCurrentRender]);

  // Queued render with priority
  const queueRender = useCallback((targetScale, renderPriority) => {
    cancelQueueRef.current = enqueueRender(renderPriority, () => performRender(targetScale));
  }, [performRender]);

  // Handle scale changes
  useEffect(() => {
    if (!page) return;

    if (lastRenderedScaleRef.current === scale) {
      return;
    }

    const renderPriority = isVisible ? 0 : priority;

    // Skip non-visible pages that already have a render
    if (!isVisible && priority > 1 && hasRendered) {
      return;
    }

    queueRender(scale, renderPriority);
  }, [page, scale, isVisible, priority, hasRendered, queueRender]);

  // Initial render when becoming visible
  useEffect(() => {
    if (page && !hasRendered && isVisible) {
      queueRender(scale, 0);
    }
  }, [page, isVisible, hasRendered, scale, queueRender]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelCurrentRender();
      offscreenCanvasRef.current = null;
    };
  }, [cancelCurrentRender]);

  if (!page) return null;

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
