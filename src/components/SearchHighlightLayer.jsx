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
  isActiveMatchOnThisPage = false
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

    for (const match of highlights) {
      if (!match) continue;
      if (activeMatch && match.id === activeMatch.id) continue;
      if (selectedMatches.length >= effectiveMatchBudget) break;
      selectedMatches.push(match);
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

      const scaledRectangles = allowedRectangles.map((rect) => ({
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale
      }));

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
  }, [highlights, scale, activeMatchId, isActiveMatchOnThisPage, maxRenderedMatches]);

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
      {scaledHighlights.map((match) => (
        <React.Fragment key={match.id}>
          {match.scaledRectangles.map((rect, rectIndex) => {
            const isActive = match.isActive;

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
                  background: isActive
                    ? 'rgba(255, 180, 0, 0.55)'
                    : 'rgba(255, 255, 0, 0.35)',
                  border: isActive
                    ? '2px solid rgba(255, 140, 0, 0.9)'
                    : '1px solid rgba(255, 255, 0, 0.5)',
                  borderRadius: '2px',
                  boxShadow: isActive ? '0 0 6px 1px rgba(255, 180, 0, 0.55)' : 'none',
                  boxSizing: 'border-box'
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
