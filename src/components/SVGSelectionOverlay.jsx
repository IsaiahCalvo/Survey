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
import { memo } from 'react';
import { getCursorForHandle, clampInverseScale } from '../utils/svgTransformMath';
import { getHandlePositions } from '../utils/svgBoundingBox';
import {
  getAdaptiveSelectionHandleSpec,
  getSelectionHandleVisualMetrics,
} from '../utils/selectionHandleVisibility.js';
import rotateIconSvg from '../assets/rotate-icon.svg';
import { HANDLE_FILL, HANDLE_RING } from '../utils/handleStyle';

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
  // Text marks keep their line height and angle. These two side handles
  // rewrite only the first/last selected text quad instead of scaling it.
  horizontalResizeOnly = false,
  horizontalHandlePositions = null,
  // UX 2026-09-09: revision clouds anchor their eight resize handles on the
  // outer scallop cusps and draw the dashed frame on the outer hull of the
  // humps (Drawboard PDF behaviour), not on the inner box the cloud was
  // built from. Both are in the overlay's unrotated frame; the resize math
  // is untouched - the handle id is what drives the drag, the anchor is
  // only where the grabber is drawn.
  handleAnchors = null,   // { tl, mt, tr, mr, br, mb, bl, ml } -> { x, y } | null
  frameRect = null,       // { left, top, width, height } | null
}) => {
  if (!bbox) return null;

  const { left, top, width, height, angle } = bbox;
  // Zoom-out balloon fix: clamp the inverseScale used for VISUAL SIZING so
  // halos/handles/shadows stop growing once zoomed out past the cap. At rest
  // (inverseScale ≈ 1) and on zoom-in (< 1) the clamp is a no-op, so the
  // appearance is unchanged there. The tier/visibility math below intentionally
  // keeps the RAW inverseScale so crowded handles still hide on zoom-out.
  const visualInverseScale = clampInverseScale(inverseScale);
  // Dampened inverse scale: sqrt curve softens handle sizing at extreme zooms
  // so handles don't balloon at low zoom or vanish at high zoom.
  const is = Math.sqrt(visualInverseScale);
  const handleMetrics = getSelectionHandleVisualMetrics(visualInverseScale);
  const handleSpec = getAdaptiveSelectionHandleSpec({
    bboxWidth: width,
    bboxHeight: height,
    inverseScale,
    padding,
  });
  const visibleResizeHandles = new Set(handleSpec.resizeHandles);
  const baseHandles = { ...getHandlePositions(bbox, padding), ...(handleAnchors || {}) };
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

  // Bounding box rect dimensions (with padding). A cloud's frame is the outer
  // hull of its humps (frameRect), which the caller already sized.
  const frame = frameRect || { left, top, width, height };
  const boxX = frame.left - padding;
  const boxY = frame.top - padding;
  const boxW = frame.width + padding * 2;
  const boxH = frame.height + padding * 2;

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
  const textRangeHitSize = 44 * visualInverseScale;

  return (
    <g
      className="svg-selection-overlay"
      transform={angle ? `rotate(${angle}, ${cx}, ${cy})` : undefined}
      style={{
        pointerEvents: 'none',
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
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
          style={{
            pointerEvents: 'none',
          }}
        />
      )}

      {/* --- Handles (hidden for group selection -- Plan 03 renders group handles) --- */}
      {!isGroupSelection && !moveOnly && (
        <>
          {/* Corner handles (tl, tr, bl, br) - circles */}
          {!horizontalResizeOnly && !hideResizeHandles && cornerHandles.filter((id) => visibleResizeHandles.has(id)).map((id) => {
            const pos = handles[id];
            return (
              <circle
                key={`corner-${id}`}
                data-resize-handle={id}
                cx={pos.x}
                cy={pos.y}
                r={handleMetrics.cornerR}
                fill={HANDLE_FILL}
                stroke={HANDLE_RING}
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
          {!horizontalResizeOnly && !hideResizeHandles && ['mt', 'mb'].filter((id) => visibleResizeHandles.has(id)).map((id) => {
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
                fill={HANDLE_FILL}
                stroke={HANDLE_RING}
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
          {!hideResizeHandles && ['ml', 'mr'].filter((id) => horizontalResizeOnly || visibleResizeHandles.has(id)).map((id) => {
            const pos = horizontalResizeOnly && horizontalHandlePositions?.[id]
              ? horizontalHandlePositions[id]
              : handles[id];
            return (
              <g key={`pill-${id}`}>
                {horizontalResizeOnly && (
                  <rect
                    data-resize-handle={id}
                    data-text-range-handle={id}
                    data-text-range-handle-hit-target="true"
                    x={pos.x - textRangeHitSize / 2}
                    y={pos.y - textRangeHitSize / 2}
                    width={textRangeHitSize}
                    height={textRangeHitSize}
                    rx={textRangeHitSize / 2}
                    fill="transparent"
                    style={{
                      cursor: getCursorForHandle(id, angle || 0),
                      pointerEvents: 'auto',
                      touchAction: 'none',
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onHandleDrag?.(e, id);
                    }}
                  />
                )}
                <rect
                  data-resize-handle={id}
                  data-text-range-handle-visual={horizontalResizeOnly ? id : undefined}
                  x={pos.x - vPillW / 2}
                  y={pos.y - vPillH / 2}
                  width={vPillW}
                  height={vPillH}
                  rx={pillRx}
                  fill={HANDLE_FILL}
                  stroke={HANDLE_RING}
                  strokeWidth={1 * is}
                  style={{
                    filter: pillShadow,
                    cursor: getCursorForHandle(id, angle || 0),
                    pointerEvents: horizontalResizeOnly ? 'none' : 'auto',
                  }}
                  onPointerDown={horizontalResizeOnly ? undefined : (e) => {
                    e.stopPropagation();
                    onHandleDrag?.(e, id);
                  }}
                />
              </g>
            );
          })}

          {/* Rotation handle (mtr) */}
          {!horizontalResizeOnly && !hideRotationHandle && (
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
              fill={HANDLE_FILL}
              stroke={HANDLE_RING}
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
