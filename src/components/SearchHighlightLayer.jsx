import React, { memo, useMemo } from 'react';

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
  activeMatchId = null,
  isActiveMatchOnThisPage = false
}) => {
  // Filter highlights for this page and calculate scaled positions
  const scaledHighlights = useMemo(() => {
    if (!highlights || highlights.length === 0) {
      return [];
    }

    return highlights.map(match => {
      if (!match.rectangles || match.rectangles.length === 0) {
        return null;
      }

      const scaledRectangles = match.rectangles.map(rect => ({
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale
      }));

      return {
        ...match,
        scaledRectangles,
        isActive: activeMatchId === match.id
      };
    }).filter(Boolean);
  }, [highlights, scale, activeMatchId]);

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
        overflow: 'hidden'
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
                  boxShadow: isActive
                    ? '0 0 8px 2px rgba(255, 180, 0, 0.6), inset 0 0 4px rgba(255, 200, 0, 0.3)'
                    : 'none',
                  transition: 'all 0.15s ease',
                  boxSizing: 'border-box'
                }}
              />
            );
          })}
        </React.Fragment>
      ))}

      {/* Pulse animation for active match */}
      {isActiveMatchOnThisPage && (
        <style>{`
          @keyframes searchHighlightPulse {
            0%, 100% {
              box-shadow: 0 0 8px 2px rgba(255, 180, 0, 0.6), inset 0 0 4px rgba(255, 200, 0, 0.3);
            }
            50% {
              box-shadow: 0 0 12px 4px rgba(255, 180, 0, 0.8), inset 0 0 6px rgba(255, 200, 0, 0.4);
            }
          }
          .search-highlight-active {
            animation: searchHighlightPulse 1.5s ease-in-out infinite;
          }
        `}</style>
      )}
    </div>
  );
});

SearchHighlightLayer.displayName = 'SearchHighlightLayer';

export default SearchHighlightLayer;
