import React, { memo } from 'react';

const PageAnnotationLayer = ({ pageNumber, scale, width, height, regions }) => {
    if (!regions || regions.length === 0) return null;

    return (
        <svg
            width={width}
            height={height}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: 10
            }}
        >
            {regions.map((region, index) => {
                if (!region.coordinates || region.coordinates.length < 4) return null;

                // Convert flat array [x1, y1, x2, y2...] to "x1,y1 x2,y2 ..." string
                const points = [];
                for (let i = 0; i < region.coordinates.length; i += 2) {
                    points.push(`${region.coordinates[i] * scale},${region.coordinates[i + 1] * scale}`);
                }

                return (
                    <polygon
                        key={region.id || index}
                        points={points.join(' ')}
                        fill="rgba(74, 144, 226, 0.2)"
                        stroke="rgba(74, 144, 226, 0.8)"
                        strokeWidth={2}
                    />
                );
            })}
        </svg>
    );
};

export default memo(PageAnnotationLayer);
