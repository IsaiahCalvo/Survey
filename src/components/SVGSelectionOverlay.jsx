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
import { clampHandleToPage, getHandlePositions, placeRotationHandle, separateRotationHandle } from '../utils/svgBoundingBox';
import {
  getAdaptiveSelectionHandleSpec,
  getRotationHandleHitMetrics,
  getSelectionHandleVisualMetrics,
  shouldShowSelectionTransformHandles,
} from '../utils/selectionHandleVisibility.js';
import rotateIconSvg from '../assets/rotate-icon.svg';
import { HANDLE_FILL, HANDLE_RING } from '../utils/handleStyle';

const SVGSelectionOverlay = memo(({
  bbox,             // { left, top, width, height, angle }
  inverseScale,     // number -- for constant-size handles
  onHandleDrag,     // (e, handleId) => void
  onHandleCancel,   // (e) => void — pointercancel on the captured knob
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
  selectionGlowOnly = false,
  pageWidth,
  pageHeight,
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
  const showTransformHandles = shouldShowSelectionTransformHandles({
    selectionGlowOnly,
    moveOnly,
    isGroupSelection,
  });
  const rotationHit = getRotationHandleHitMetrics(visualInverseScale);
  const baseHandles = getHandlePositions(bbox, padding);
  const rotationHandle = placeRotationHandle(bbox, {
    padding,
    rotationOffset: handleSpec.rotationOffset,
    pageWidth,
    pageHeight,
  });
  // Resize knobs only need a few units of inset (they sit on the box).
  // mtr uses 16 so the stem stays off the pills after both clamp.
  const pageClamp = { pageWidth, pageHeight, inset: 8 };
  const handles = {
    tl: clampHandleToPage(baseHandles.tl, bbox, pageClamp),
    tr: clampHandleToPage(baseHandles.tr, bbox, pageClamp),
    bl: clampHandleToPage(baseHandles.bl, bbox, pageClamp),
    br: clampHandleToPage(baseHandles.br, bbox, pageClamp),
    mt: clampHandleToPage(baseHandles.mt, bbox, pageClamp),
    mb: clampHandleToPage(baseHandles.mb, bbox, pageClamp),
    ml: clampHandleToPage(baseHandles.ml, bbox, pageClamp),
    mr: clampHandleToPage(baseHandles.mr, bbox, pageClamp),
  };
  const separatedMtr = separateRotationHandle(handles.mt, rotationHandle, bbox, {
    minSep: rotationHit.knobHitR + handleMetrics.hPillH / 2 + handleMetrics.minGap,
    pageWidth,
    pageHeight,
  });
  handles.mtr = {
    x: separatedMtr.x,
    y: separatedMtr.y,
  };
  // Stem hit used to start on mt, so the ~16px stroke ate the whole top
  // pill and mt resize never fired. Leave a gap on the mtr side of the
  // pill. After page CW remap both knobs clamp inward, so mtr can sit
  // below local-top — attach that way instead of always "above".
  const mtStemGap = !hideResizeHandles && visibleResizeHandles.has('mt')
    ? handleMetrics.hPillH / 2 + rotationHit.stemHitWidth / 2 + handleMetrics.minGap
    : 0;
  const stemSign = (handles.mtr.y - handles.mt.y) >= 0 ? 1 : -1;
  const stemAttachY = handles.mt.y + stemSign * mtStemGap;

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
          strokeDasharray={selectionGlowOnly ? undefined : '4,4'}
          vectorEffect="non-scaling-stroke"
          data-select-delete-only-selection={selectionGlowOnly ? 'true' : undefined}
          style={{
            pointerEvents: 'none',
            filter: selectionGlowOnly
              ? `drop-shadow(0 0 ${4 * is}px rgba(74,144,226,0.75))`
              : undefined,
          }}
        />
      )}

      {/* --- Handles (hidden for group selection -- Plan 03 renders group handles) --- */}
      {showTransformHandles && (
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
                onPointerCancel={onHandleCancel ? (e) => {
                  e.stopPropagation();
                  onHandleCancel(e);
                } : undefined}
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
                onPointerCancel={onHandleCancel ? (e) => {
                  e.stopPropagation();
                  onHandleCancel(e);
                } : undefined}
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
                onPointerCancel={onHandleCancel ? (e) => {
                  e.stopPropagation();
                  onHandleCancel(e);
                } : undefined}
              />
            );
          })}

          {/* Rotation handle (mtr). The stem used to be pointer-events:none,
              so clicks on the visible connector (the group's bbox center)
              fell through and rotation looked broken. Stem + knob share one
              hit path. selectionGlowOnly still hides this entire block. */}
          {!hideRotationHandle && (
          <g
            className="rotation-handle"
            data-rotation-handle="mtr"
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandleDrag?.(e, 'mtr');
            }}
            onPointerCancel={onHandleCancel ? (e) => {
              e.stopPropagation();
              onHandleCancel(e);
            } : undefined}
          >
            <line
              x1={handles.mt.x}
              y1={stemAttachY}
              x2={handles.mtr.x}
              y2={handles.mtr.y}
              stroke="transparent"
              strokeWidth={rotationHit.stemHitWidth}
              style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
            />
            <line
              x1={handles.mt.x}
              y1={handles.mt.y}
              x2={handles.mtr.x}
              y2={handles.mtr.y}
              stroke="#d1d1d1"
              strokeWidth={1 * is}
              style={{ pointerEvents: 'none' }}
            />
            <circle
              cx={handles.mtr.x}
              cy={handles.mtr.y}
              r={rotationHit.knobHitR}
              fill="transparent"
              data-rotation-handle="mtr"
              style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
            />
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
                pointerEvents: 'none',
              }}
            />
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
