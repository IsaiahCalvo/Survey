import React, { memo, useEffect, useMemo, useRef } from 'react';
import { emitTextSearchDiag } from '../utils/textSearchDiag';

const MAX_RENDERED_MATCHES_PER_PAGE = 140;
const MAX_RENDERED_RECTANGLES_PER_PAGE = 900;
const INACTIVE_PAGE_MATCH_LIMIT = 60;
const EMPTY_HIGHLIGHTS = [];

/**
 * SearchHighlightLayer renders highlight overlays for search matches on a PDF page.
 *
 * Key features:
 * - Renders all matches on the current page with yellow highlights
 * - Highlights the active/current match with a brighter golden color and glow effect
 * - Properly scales and positions highlights based on the page scale
 * - Uses pointer-events: none to not interfere with other interactions
 * - Positioned below annotation layers (z-index: 9) but above the canvas
 */
const SearchHighlightLayer = memo(({
  pageNumber,
  width,
  height,
  scale,
  highlights = EMPTY_HIGHLIGHTS,
  maxRenderedMatches = MAX_RENDERED_MATCHES_PER_PAGE,
  activeMatchId = null,
  isActiveMatchOnThisPage = false,
  activeOnly = false,
  activeGlowOnly = false,
  fillContainer = false
}) => {
  const layerRef = useRef(null);
  const lastDiagKeyRef = useRef('');

  const preparedHighlights = useMemo(() => {
    if (!highlights || highlights.length === 0) {
      return [];
    }

    const effectiveMatchBudget = Math.max(
      1,
      Math.min(
        Number(maxRenderedMatches) || MAX_RENDERED_MATCHES_PER_PAGE,
        isActiveMatchOnThisPage
          ? MAX_RENDERED_MATCHES_PER_PAGE
          : INACTIVE_PAGE_MATCH_LIMIT
      )
    );

    const activeMatch = activeMatchId
      ? highlights.find((match) => match?.id === activeMatchId) || null
      : null;

    const selectedMatches = [];
    if (activeMatch) {
      selectedMatches.push(activeMatch);
    }

    if (!activeOnly) {
      for (const match of highlights) {
        if (!match) continue;
        if (activeMatch && match.id === activeMatch.id) continue;
        if (selectedMatches.length >= effectiveMatchBudget) break;
        selectedMatches.push(match);
      }
    }

    const prepared = [];
    let remainingRectangles = MAX_RENDERED_RECTANGLES_PER_PAGE;

    for (const match of selectedMatches) {
      if (!match.rectangles || match.rectangles.length === 0) continue;
      if (remainingRectangles <= 0) break;

      const isActive = activeMatchId === match.id;
      const allowedRectangles = isActive
        ? match.rectangles
        : match.rectangles.slice(0, Math.max(1, remainingRectangles));

      const rectangles = allowedRectangles
        .map((rect) => ({
          x: Math.max(Number(rect.x) || 0, 0),
          y: Math.max(Number(rect.y) || 0, 0),
          width: Math.max(Number(rect.width) || 0, 1),
          height: Math.max(Number(rect.height) || 0, 1)
        }))
        .filter((rect) => rect.width > 0 && rect.height > 0);

      if (rectangles.length === 0) continue;

      prepared.push({
        ...match,
        rectangles,
        isActive
      });

      if (!isActive) {
        remainingRectangles -= rectangles.length;
      }
    }

    return prepared;
  }, [highlights, activeMatchId, isActiveMatchOnThisPage, maxRenderedMatches, activeOnly]);

  const layerWidth = Math.max((Number(width) || 0) * (Number(scale) || 1), 1);
  const layerHeight = Math.max((Number(height) || 0) * (Number(scale) || 1), 1);
  const totalRectangles = preparedHighlights.reduce((sum, match) => sum + match.rectangles.length, 0);
  const firstRect = preparedHighlights[0]?.rectangles?.[0] || null;

  const readLayerGeometry = () => {
    const layerNode = layerRef.current;
    const layerRect = layerNode?.getBoundingClientRect?.() || null;
    const pageHostNode = layerNode?.closest?.('.e-pv-page-div') || null;
    const pageHostRect = pageHostNode?.getBoundingClientRect?.() || null;
    const contentNode = layerNode?.closest?.('[data-pdfjs-overlay-content]') || null;
    const contentRect = contentNode?.getBoundingClientRect?.() || null;

    return {
      layerRect: layerRect ? {
        left: Math.round(layerRect.left),
        top: Math.round(layerRect.top),
        width: Math.round(layerRect.width),
        height: Math.round(layerRect.height)
      } : null,
      pageHostRect: pageHostRect ? {
        left: Math.round(pageHostRect.left),
        top: Math.round(pageHostRect.top),
        width: Math.round(pageHostRect.width),
        height: Math.round(pageHostRect.height)
      } : null,
      contentRect: contentRect ? {
        left: Math.round(contentRect.left),
        top: Math.round(contentRect.top),
        width: Math.round(contentRect.width),
        height: Math.round(contentRect.height)
      } : null,
      contentTransform: contentNode?.style?.transform || null,
      hostWidthDelta: layerRect && pageHostRect
        ? Math.round((layerRect.width - pageHostRect.width) * 100) / 100
        : null,
      hostHeightDelta: layerRect && pageHostRect
        ? Math.round((layerRect.height - pageHostRect.height) * 100) / 100
        : null
    };
  };

  useEffect(() => {
    if (!layerRef.current || preparedHighlights.length === 0) return;

    const diagKey = [
      pageNumber,
      preparedHighlights.length,
      totalRectangles,
      activeMatchId || 'none',
      fillContainer ? 'fill' : 'scaled',
      Math.round(layerWidth),
      Math.round(layerHeight),
      firstRect
        ? `${Math.round(firstRect.x * 100) / 100}:${Math.round(firstRect.y * 100) / 100}:${Math.round(firstRect.width * 100) / 100}:${Math.round(firstRect.height * 100) / 100}`
        : 'none'
    ].join('|');

    if (diagKey === lastDiagKeyRef.current) return;
    lastDiagKeyRef.current = diagKey;

    const frame = window.requestAnimationFrame?.(() => {
      emitTextSearchDiag('svg_layer_render', {
        pageNumber,
        matchCount: preparedHighlights.length,
        rectangleCount: totalRectangles,
        activeMatchId,
        fillContainer,
        scale: Number(scale) || 1,
        width: Number(width) || 0,
        height: Number(height) || 0,
        cssWidth: fillContainer ? '100%' : Math.round(layerWidth),
        cssHeight: fillContainer ? '100%' : Math.round(layerHeight),
        firstRect,
        ...readLayerGeometry()
      });
    });

    return () => {
      if (frame && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    activeMatchId,
    fillContainer,
    firstRect,
    height,
    layerHeight,
    layerWidth,
    pageNumber,
    preparedHighlights.length,
    scale,
    totalRectangles,
    width
  ]);

  useEffect(() => {
    if (!layerRef.current || preparedHighlights.length === 0 || !isActiveMatchOnThisPage) return undefined;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return undefined;

    let cancelled = false;
    let frame = null;
    let sampleCount = 0;
    const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    const sample = () => {
      if (cancelled) return;
      const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
      emitTextSearchDiag('svg_layer_live_sample', {
        pageNumber,
        activeMatchId,
        fillContainer,
        sample: sampleCount,
        elapsedMs: Math.round(now - startedAt),
        scale: Number(scale) || 1,
        cssWidth: fillContainer ? '100%' : Math.round(layerWidth),
        cssHeight: fillContainer ? '100%' : Math.round(layerHeight),
        ...readLayerGeometry()
      });
      sampleCount += 1;
      if (sampleCount < 10) {
        frame = window.requestAnimationFrame(sample);
      }
    };

    frame = window.requestAnimationFrame(sample);
    return () => {
      cancelled = true;
      if (frame !== null && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    activeMatchId,
    fillContainer,
    isActiveMatchOnThisPage,
    layerHeight,
    layerWidth,
    pageNumber,
    preparedHighlights.length,
    scale
  ]);

  if (!width || !height || preparedHighlights.length === 0) {
    return null;
  }

  return (
    <svg
      ref={layerRef}
      data-search-highlight-layer={pageNumber}
      data-search-highlight-renderer="svg"
      data-search-highlight-count={preparedHighlights.length}
      data-search-highlight-rect-count={totalRectangles}
      data-search-highlight-active={activeMatchId || ''}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: fillContainer ? '100%' : `${layerWidth}px`,
        height: fillContainer ? '100%' : `${layerHeight}px`,
        pointerEvents: 'none',
        zIndex: 9,
        overflow: 'hidden',
        contain: 'layout style paint',
        display: 'block'
      }}
    >
      <defs>
        <style>{`
          @keyframes search-active-highlight-pulse {
            from {
              opacity: 0.62;
              stroke-opacity: 0.72;
            }
            to {
              opacity: 0.94;
              stroke-opacity: 1;
            }
          }
          .search-highlight-svg-rect {
            shape-rendering: geometricPrecision;
          }
          .search-highlight-svg-active-pulse {
            animation: search-active-highlight-pulse 1.05s ease-in-out infinite alternate;
          }
        `}</style>
      </defs>
      {preparedHighlights.map((match) => (
        <React.Fragment key={match.id}>
          {match.rectangles.map((rect, rectIndex) => {
            const isActive = match.isActive;
            const shouldPulse = activeGlowOnly && isActive;

            return (
              <rect
                key={`${match.id}-${rectIndex}`}
                className={`search-highlight-svg-rect${isActive ? ' search-highlight-svg-active' : ''}${shouldPulse ? ' search-highlight-svg-active-pulse' : ''}`}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={1.5}
                ry={1.5}
                fill={isActive ? 'rgba(255, 216, 0, 0.58)' : 'rgba(255, 230, 0, 0.34)'}
                stroke={isActive ? 'rgba(255, 160, 0, 0.95)' : 'rgba(255, 224, 80, 0.38)'}
                strokeWidth={isActive ? 1.15 : 0.65}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </React.Fragment>
      ))}
    </svg>
  );
});

SearchHighlightLayer.displayName = 'SearchHighlightLayer';

export default SearchHighlightLayer;
