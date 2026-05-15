/**
 * SVGSelectionOverlay
 *
 * Renders the selection bounding box and handles (8 resize + 1 rotation)
 * as SVG elements inside the annotation layer's <svg>.
 *
 * All handle sizes are multiplied by inverseScale to remain a constant
 * visual pixel size regardless of zoom level.
 *
 * Handles use compact, zoom-aware sizing so small annotations stay editable
 * without the chrome crowding the mark itself.
 *
 * Phase 9 Plan 01: Selection overlay foundation.
 */
import React, { memo } from 'react';
import { getCursorForHandle } from '../utils/svgTransformMath';
import { getHandlePositions } from '../utils/svgBoundingBox';
import {
  getAdaptiveSelectionHandleSpec,
  getSelectionHandleVisualMetrics,
} from '../utils/selectionHandleVisibility.js';
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
  hideRotationHandle = false,
}) => {
  if (!bbox) return null;

  const { left, top, width, height, angle } = bbox;
  // Dampened inverse scale: sqrt curve softens handle sizing at extreme zooms
  // so handles don't balloon at low zoom or vanish at high zoom.
  const is = Math.sqrt(inverseScale);
  const handleMetrics = getSelectionHandleVisualMetrics(inverseScale);
  const handleSpec = getAdaptiveSelectionHandleSpec({
    bboxWidth: width,
    bboxHeight: height,
    inverseScale,
    padding,
  });
  const visibleResizeHandles = new Set(handleSpec.resizeHandles);
  const baseHandles = getHandlePositions(bbox, padding);
  const handles = {
    ...baseHandles,
    mtr: {
      x: baseHandles.mt.x,
      y: baseHandles.mt.y - handleSpec.rotationOffset,
    },
  };

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
  const hPillW = handleMetrics.hPillW;
  const hPillH = handleMetrics.hPillH;
  const vPillW = handleMetrics.vPillW;
  const vPillH = handleMetrics.vPillH;
  const pillRx = handleMetrics.pillRx;

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
          {!hideResizeHandles && cornerHandles.filter((id) => visibleResizeHandles.has(id)).map((id) => {
            const pos = handles[id];
            return (
              <circle
                key={`corner-${id}`}
                data-resize-handle={id}
                cx={pos.x}
                cy={pos.y}
                r={handleMetrics.cornerR}
                fill="#ffffff"
                stroke="#d1d1d1"
                strokeWidth={handleMetrics.cornerStrokeWidth}
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
          {!hideResizeHandles && ['mt', 'mb'].filter((id) => visibleResizeHandles.has(id)).map((id) => {
            const pos = handles[id];
            return (
              <rect
                key={`pill-${id}`}
                data-resize-handle={id}
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
          {!hideResizeHandles && ['ml', 'mr'].filter((id) => visibleResizeHandles.has(id)).map((id) => {
            const pos = handles[id];
            return (
              <rect
                key={`pill-${id}`}
                data-resize-handle={id}
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
          {!hideRotationHandle && (
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
              r={handleMetrics.rotationR}
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
              x={handles.mtr.x - handleMetrics.rotationIconSize / 2}
              y={handles.mtr.y - handleMetrics.rotationIconSize / 2}
              width={handleMetrics.rotationIconSize}
              height={handleMetrics.rotationIconSize}
              style={{ pointerEvents: 'none' }}
            />
          </g>
          )}
        </>
      )}
    </g>
  );
});

SVGSelectionOverlay.displayName = 'SVGSelectionOverlay';

export default SVGSelectionOverlay;
