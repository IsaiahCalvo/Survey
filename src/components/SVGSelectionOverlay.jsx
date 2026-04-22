/**
 * SVGSelectionOverlay
 *
 * Renders the selection bounding box and handles (8 resize + 1 rotation)
 * as SVG elements inside the annotation layer's <svg>.
 *
 * All handle sizes are multiplied by inverseScale to remain a constant
 * visual pixel size regardless of zoom level.
 *
 * Visual specs match fabricCustomization.js (Phase 8 Canvas handles)
 * so users see no difference between SVG display and Canvas edit modes.
 *
 * Phase 9 Plan 01: Selection overlay foundation.
 */
import React, { memo } from 'react';
import { getCursorForHandle } from '../utils/svgTransformMath';
import { getHandlePositions } from '../utils/svgBoundingBox';
import rotateIconSvg from '../assets/rotate-icon.svg';

const SVGSelectionOverlay = memo(({
  bbox,             // { left, top, width, height, angle }
  inverseScale,     // number -- for constant-size handles
  onHandleDrag,     // (e, handleId) => void
  isGroupSelection, // boolean -- true for multi-select (hides individual handles)
  strokeOpacity = 1.0, // number -- opacity for bounding box stroke (Plan 03: group union box uses 0.6)
  hideBoundingBox = false, // boolean -- hide the blue dashed rect (border-flush types)
  padding = 2,      // number -- padding around bbox; 0 places handles directly on stroke
  // UX 2026-04-20: optional external rotation pivot for shapes whose
  // visual rotation center differs from their tight-wrap bbox center.
  // Used for curved lines/arrows where the shape rotates around the
  // endpoint midpoint (matching the renderer + drag-math pivot) while
  // the bbox hugs the asymmetric curve. Undefined = fall back to
  // bbox center, which is correct for every other shape type.
  rotationCenter = null, // { x, y } | null
  // UX 2026-04-20: when true, drop the 8 resize handles AND the rotation
  // handle, leaving just the dashed bbox. Used for the multi-selection
  // outer frame whenever a callout is part of the group — matches Drawboard
  // PDF's "grouped callouts can only be moved" behavior. Move drag itself
  // is a separate code path (member shape pointerdown initiates group-move),
  // so the bbox staying visible is enough for the user to see the group.
  moveOnly = false,
  // UX 2026-04-20: independently hide the 8 resize handles while keeping
  // the rotation handle visible. Reserved for future per-shape policies;
  // currently unused. moveOnly takes precedence (hides everything).
  hideResizeHandles = false,
}) => {
  if (!bbox) return null;

  const { left, top, width, height, angle } = bbox;
  const handles = getHandlePositions(bbox, padding);
  // Dampened inverse scale: sqrt curve softens handle sizing at extreme zooms
  // so handles don't balloon at low zoom or vanish at high zoom.
  const is = Math.sqrt(inverseScale);

  // Center of the bounding box for rotation transform. `rotationCenter`
  // (when supplied) overrides the geometric center so the rotation
  // pivot can live outside the bbox's own midpoint without having to
  // pad the bbox asymmetrically. Curved rotated lines are the prime
  // use case: tight frame + pivot-at-endpoint-midpoint.
  const cx = rotationCenter?.x ?? (left + width / 2);
  const cy = rotationCenter?.y ?? (top + height / 2);

  // Bounding box rect dimensions (with padding)
  const boxX = left - padding;
  const boxY = top - padding;
  const boxW = width + padding * 2;
  const boxH = height + padding * 2;

  // Shadow filter strings
  const cornerShadow = `drop-shadow(0 ${1 * is}px ${3 * is}px rgba(0,0,0,0.15))`;
  const pillShadow = `drop-shadow(0 ${2 * is}px ${4 * is}px rgba(0,0,0,0.15))`;
  const rotationShadow = `drop-shadow(0 ${2 * is}px ${5 * is}px rgba(0,0,0,0.1))`;

  // Corner handle IDs
  const cornerHandles = ['tl', 'tr', 'bl', 'br'];

  // Pill dimensions
  const hPillW = 36 * is;  // Horizontal pill width
  const hPillH = 10 * is;  // Horizontal pill height
  const vPillW = 10 * is;  // Vertical pill width
  const vPillH = 36 * is;  // Vertical pill height
  const pillRx = 5 * is;   // Corner radius (fully rounded ends)

  return (
    <g
      className="svg-selection-overlay"
      transform={angle ? `rotate(${angle}, ${cx}, ${cy})` : undefined}
      style={{ pointerEvents: 'none' }}
    >
      {/* --- Bounding box rect --- */}
      {!hideBoundingBox && (
        <rect
          x={boxX}
          y={boxY}
          width={boxW}
          height={boxH}
          fill="none"
          stroke="#4a90e2"
          strokeOpacity={strokeOpacity}
          strokeWidth={2}
          strokeDasharray="4,4"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* --- Handles (hidden for group selection -- Plan 03 renders group handles) --- */}
      {!isGroupSelection && !moveOnly && (
        <>
          {/* Corner handles (tl, tr, bl, br) - circles */}
          {!hideResizeHandles && cornerHandles.map((id) => {
            const pos = handles[id];
            return (
              <circle
                key={`corner-${id}`}
                cx={pos.x}
                cy={pos.y}
                r={7 * is}
                fill="#ffffff"
                stroke="#d1d1d1"
                strokeWidth={1 * is}
                style={{
                  filter: cornerShadow,
                  cursor: getCursorForHandle(id, angle || 0),
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onHandleDrag?.(e, id);
                }}
              />
            );
          })}

          {/* Horizontal pills (mt, mb) */}
          {!hideResizeHandles && ['mt', 'mb'].map((id) => {
            const pos = handles[id];
            return (
              <rect
                key={`pill-${id}`}
                x={pos.x - hPillW / 2}
                y={pos.y - hPillH / 2}
                width={hPillW}
                height={hPillH}
                rx={pillRx}
                fill="#ffffff"
                stroke="#d1d1d1"
                strokeWidth={1 * is}
                style={{
                  filter: pillShadow,
                  cursor: getCursorForHandle(id, angle || 0),
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onHandleDrag?.(e, id);
                }}
              />
            );
          })}

          {/* Vertical pills (ml, mr) */}
          {!hideResizeHandles && ['ml', 'mr'].map((id) => {
            const pos = handles[id];
            return (
              <rect
                key={`pill-${id}`}
                x={pos.x - vPillW / 2}
                y={pos.y - vPillH / 2}
                width={vPillW}
                height={vPillH}
                rx={pillRx}
                fill="#ffffff"
                stroke="#d1d1d1"
                strokeWidth={1 * is}
                style={{
                  filter: pillShadow,
                  cursor: getCursorForHandle(id, angle || 0),
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onHandleDrag?.(e, id);
                }}
              />
            );
          })}

          {/* Rotation handle (mtr) */}
          <g className="rotation-handle" data-rotation-handle="mtr">
            {/* Connector line from top-center of bbox to rotation handle */}
            <line
              x1={handles.mt.x}
              y1={handles.mt.y}
              x2={handles.mtr.x}
              y2={handles.mtr.y}
              stroke="#d1d1d1"
              strokeWidth={1 * is}
              style={{ pointerEvents: 'none' }}
            />
            {/* Rotation circle */}
            <circle
              cx={handles.mtr.x}
              cy={handles.mtr.y}
              r={12 * is}
              fill="#ffffff"
              stroke="#e0e0e0"
              strokeWidth={1 * is}
              style={{
                filter: rotationShadow,
                cursor: 'crosshair',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandleDrag?.(e, 'mtr');
              }}
            />
            {/* Rotation icon image (70% of circle diameter) */}
            <image
              href={rotateIconSvg}
              x={handles.mtr.x - (16.8 * is) / 2}
              y={handles.mtr.y - (16.8 * is) / 2}
              width={16.8 * is}
              height={16.8 * is}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        </>
      )}
    </g>
  );
});

SVGSelectionOverlay.displayName = 'SVGSelectionOverlay';

export default SVGSelectionOverlay;
