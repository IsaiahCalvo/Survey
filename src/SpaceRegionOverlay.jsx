import React, { useMemo } from 'react';

// Component that overlays a dimming effect on pages, keeping only selected regions visible
const SpaceRegionOverlay = ({
  pageNumber,
  regions,
  width,
  height,
  scale = 1
}) => {
  const buildRegionPath = (region) => {
    if (!region || !Array.isArray(region.coordinates)) {
      return null;
    }

    const coords = region.coordinates;
    if (region.shapeType === 'rectangular' && coords.length >= 8) {
      const scaled = coords.map((value) => value * scale);
      return `M ${scaled[0]} ${scaled[1]} L ${scaled[2]} ${scaled[3]} L ${scaled[4]} ${scaled[5]} L ${scaled[6]} ${scaled[7]} Z`;
    }

    if (region.shapeType === 'polygon' && coords.length >= 6) {
      let path = `M ${coords[0] * scale} ${coords[1] * scale}`;
      for (let i = 2; i < coords.length; i += 2) {
        const x = coords[i] * scale;
        const y = coords[i + 1] * scale;
        path += ` L ${x} ${y}`;
      }
      path += ' Z';
      return path;
    }

    return null;
  };

  const overlayPath = useMemo(() => {
    if (!regions || regions.length === 0) {
      return null;
    }

    const outerWidth = width * scale;
    const outerHeight = height * scale;
    const basePath = `M 0 0 H ${outerWidth} V ${outerHeight} H 0 Z`;
    const regionPaths = regions
      .map(buildRegionPath)
      .filter(Boolean)
      .join(' ');

    if (!regionPaths) {
      return null;
    }

    return `${basePath} ${regionPaths}`;
  }, [regions, width, height, scale]);

  const hatchId = useMemo(() => `space-hatch-${pageNumber}`, [pageNumber]);

  if (!overlayPath) {
    return null;
  }

  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${scaledWidth}px`,
        height: `${scaledHeight}px`,
        pointerEvents: 'auto',
        zIndex: 20
      }}
    >
      <svg
        width={scaledWidth}
        height={scaledHeight}
        style={{
          position: 'absolute',
          top: 0,
          left: 0
        }}
      >
        <defs>
          <pattern
            id={hatchId}
            x="0"
            y="0"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path d="M -2 2 L 2 -2" stroke="#000" strokeWidth="1" />
            <path d="M 0 10 L 10 0" stroke="#000" strokeWidth="1" />
            <path d="M 8 12 L 12 8" stroke="#000" strokeWidth="1" />
          </pattern>
        </defs>
        <path
          d={overlayPath}
          fill="rgba(40, 40, 40, 0.55)"
          fillRule="evenodd"
          pointerEvents="auto"
        />
        <path
          d={overlayPath}
          fill={`url(#${hatchId})`}
          fillRule="evenodd"
          opacity={0.3}
          pointerEvents="auto"
        />
      </svg>
    </div>
  );
};

export default SpaceRegionOverlay;