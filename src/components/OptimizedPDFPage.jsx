/**
 * OptimizedPDFPage - High-Performance PDF Page with Isolated Annotation Layer
 *
 * This component implements Adobe Acrobat-style layer architecture:
 * 1. Static PDF canvas (rarely re-renders)
 * 2. Text selection layer (independent)
 * 3. Annotation layer (isolated, frequent updates)
 *
 * Key optimizations:
 * - Annotations use Context, not props (no re-render cascades)
 * - CSS containment and isolation prevent cross-layer repaints
 * - GPU acceleration hints for smooth scrolling
 * - Per-page annotation subscription (only re-render affected pages)
 */

import { memo, useRef, useEffect, useState } from 'react';
import { usePageAnnotations } from '../contexts/AnnotationContext';
import {
  PAGE_CONTAINER_STYLES,
  PDF_LAYER_STYLES,
  ANNOTATION_LAYER_STYLES,
  setHighPerformanceMode,
} from '../utils/layerPerformance';

const OptimizedPDFPage = memo(({
  pageNum,
  scale,
  pdfPage,
  isVisible,
  renderPDFLayer,      // Function to render PDF canvas
  renderTextLayer,     // Function to render text selection layer
  renderAnnotationLayer, // Function to render annotation canvas/components
}) => {
  const containerRef = useRef(null);
  const [isInteracting, setIsInteracting] = useState(false);

  // Subscribe ONLY to annotations for THIS page
  // When annotations change on OTHER pages, this component doesn't re-render
  const { annotations } = usePageAnnotations(pageNum);

  // Enable high-performance mode during scroll
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let scrollTimeout;

    const handleScroll = () => {
      setIsInteracting(true);
      setHighPerformanceMode(container, true);

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        setIsInteracting(false);
        setHighPerformanceMode(container, false);
      }, 150);
    };

    // Listen for scroll on window
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, []);

  // Viewport dimensions
  const viewport = pdfPage?.getViewport({ scale }) || { width: 0, height: 0 };

  return (
    <div
      ref={containerRef}
      style={{
        ...PAGE_CONTAINER_STYLES,
        width: `${Math.floor(viewport.width)}px`,
        height: `${Math.floor(viewport.height)}px`,
      }}
      data-page-number={pageNum}
    >
      {/* Layer 1: PDF Canvas (static, rarely changes) */}
      <div style={{ ...PDF_LAYER_STYLES, position: 'relative' }}>
        {renderPDFLayer && renderPDFLayer({
          page: pdfPage,
          scale,
          pageNum,
          isVisible,
        })}
      </div>

      {/* Layer 2: Text Selection Layer (independent) */}
      {renderTextLayer && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {renderTextLayer({
            page: pdfPage,
            scale,
            pageNum,
          })}
        </div>
      )}

      {/* Layer 3: Annotation Layer (isolated, uses Context) */}
      <div
        style={{
          ...ANNOTATION_LAYER_STYLES,
          // Remove will-change when idle to save GPU memory
          willChange: isInteracting ? 'transform, opacity' : 'auto',
        }}
      >
        {renderAnnotationLayer && renderAnnotationLayer({
          pageNum,
          scale,
          annotations, // From Context, not props!
          viewport,
        })}
      </div>
    </div>
  );
});

OptimizedPDFPage.displayName = 'OptimizedPDFPage';

// Only re-render if page, scale, or visibility changes
// Annotations come from Context, so they don't cause prop changes
const arePropsEqual = (prevProps, nextProps) => {
  return (
    prevProps.pageNum === nextProps.pageNum &&
    prevProps.scale === nextProps.scale &&
    prevProps.pdfPage === nextProps.pdfPage &&
    prevProps.isVisible === nextProps.isVisible
    // Note: annotations are NOT in props, so they don't trigger re-renders
  );
};

export default memo(OptimizedPDFPage, arePropsEqual);
