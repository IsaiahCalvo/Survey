import React, { memo } from 'react';

const SearchHighlightLayer = memo(({
  pageNumber,
  width,
  height,
  scale,
  highlights = [],
  activeMatchId = null
}) => {
  if (!width || !height || !highlights.length) {
    return null;
  }

  return (
    <div
      data-page-highlight-layer={pageNumber}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        zIndex: 9,
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
    >
      {highlights.map((match) => (
        <React.Fragment key={match.id}>
          {(match.rectangles || []).map((rect, rectIndex) => {
            if (!rect) return null;
            const isActive = activeMatchId === match.id;
            return (
              <div
                key={`${match.id}-${rectIndex}`}
                style={{
                  position: 'absolute',
                  left: `${Math.max(rect.x, 0)}px`,
                  top: `${Math.max(rect.y, 0)}px`,
                  width: `${Math.max(rect.width, 2)}px`,
                  height: `${Math.max(rect.height, 6)}px`,
                  background: isActive ? 'rgba(255, 200, 0, 0.6)' : 'rgba(255, 255, 0, 0.35)',
                  border: isActive ? '1px solid rgba(255, 180, 0, 0.9)' : '1px solid rgba(255, 255, 0, 0.6)',
                  borderRadius: '2px',
                  boxShadow: isActive ? '0 0 6px rgba(255, 180, 0, 0.8)' : 'none'
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



