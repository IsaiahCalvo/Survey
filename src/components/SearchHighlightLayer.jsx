import React, { memo, useMemo } from 'react';

const MAX_RENDERED_MATCHES_PER_PAGE = 140;
const MAX_RENDERED_RECTANGLES_PER_PAGE = 900;
const INACTIVE_PAGE_MATCH_LIMIT = 60;

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
  highlights = [],
  maxRenderedMatches = MAX_RENDERED_MATCHES_PER_PAGE,
  activeMatchId = null,
  isActiveMatchOnThisPage = false,
  activeOnly = false,
  activeGlowOnly = false
}) => {
  // Filter highlights for this page and calculate scaled positions
  const scaledHighlights = useMemo(() => {
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

    const scaled = [];
    let remainingRectangles = MAX_RENDERED_RECTANGLES_PER_PAGE;

    for (const match of selectedMatches) {
      if (!match.rectangles || match.rectangles.length === 0) continue;
      if (remainingRectangles <= 0) break;

      const isActive = activeMatchId === match.id;
      const allowedRectangles = isActive
        ? match.rectangles
        : match.rectangles.slice(0, Math.max(1, remainingRectangles));

      const scaledRectangles = allowedRectangles.map((rect) => {
        const baseHeight = rect.height * scale;
        const topPad = activeGlowOnly ? Math.max(1, baseHeight * 0.06) : 0;
        const bottomPad = activeGlowOnly ? Math.max(2, baseHeight * 0.24) : 0;
        return {
          x: rect.x * scale,
          y: rect.y * scale - topPad,
          width: rect.width * scale,
          height: baseHeight + topPad + bottomPad
        };
      });

      if (scaledRectangles.length === 0) continue;

      scaled.push({
        ...match,
        scaledRectangles,
        isActive
      });

      if (!isActive) {
        remainingRectangles -= scaledRectangles.length;
      }
    }

    return scaled;
  }, [highlights, scale, activeMatchId, isActiveMatchOnThisPage, maxRenderedMatches, activeOnly]);

  if (!width || !height || scaledHighlights.length === 0) {
    return null;
  }

  return (
    <div
      data-search-highlight-layer={pageNumber}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width * scale}px`,
        height: `${height * scale}px`,
        pointerEvents: 'none',
        zIndex: 9,
        overflow: 'hidden',
        contain: 'layout style paint'
      }}
    >
      {activeGlowOnly && (
        <style>{`
          @keyframes search-active-glow-pulse {
            from {
              box-shadow: 0 0 3px 1px rgba(255, 213, 79, 0.45), 0 0 8px 2px rgba(255, 193, 7, 0.22);
            }
            to {
              box-shadow: 0 0 5px 2px rgba(255, 245, 157, 0.9), 0 0 14px 4px rgba(255, 193, 7, 0.45);
            }
          }
        `}</style>
      )}
      {scaledHighlights.map((match) => (
        <React.Fragment key={match.id}>
          {match.scaledRectangles.map((rect, rectIndex) => {
            const isActive = match.isActive;
            const glowOnly = activeGlowOnly && isActive;

            return (
              <div
                key={`${match.id}-${rectIndex}`}
                className={isActive ? 'search-highlight-active' : 'search-highlight'}
                style={{
                  position: 'absolute',
                  left: `${Math.max(rect.x, 0)}px`,
                  top: `${Math.max(rect.y, 0)}px`,
                  width: `${Math.max(rect.width, 2)}px`,
                  height: `${Math.max(rect.height, 6)}px`,
                  background: glowOnly
                    ? 'rgba(255, 230, 0, 0.44)'
                    : isActive
                    ? 'rgba(255, 180, 0, 0.55)'
                    : 'rgba(255, 230, 0, 0.42)',
                  border: glowOnly
                    ? '1px solid rgba(255, 245, 157, 0.95)'
                    : isActive
                    ? '2px solid rgba(255, 140, 0, 0.9)'
                    : '1px solid rgba(255, 255, 0, 0.5)',
                  borderRadius: '2px',
                  boxShadow: isActive ? '0 0 6px 1px rgba(255, 180, 0, 0.55)' : 'none',
                  boxSizing: 'border-box',
                  animation: glowOnly ? 'search-active-glow-pulse 1.1s ease-in-out infinite alternate' : undefined,
                  willChange: glowOnly ? 'box-shadow' : undefined
                }}
              />
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
});

SearchHighlightLayer.displayName = 'SearchHighlightLayer';

export default SearchHighlightLayer;
