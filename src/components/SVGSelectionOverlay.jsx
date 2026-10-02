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
import { resolveHandleHitPadPageSize } from '../utils/handleHitPad.js';
import useCoarsePointer from '../hooks/useCoarsePointer.js';

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
  // UX 2026-09-09: revision clouds draw the dashed frame on the outer hull of
  // the humps padded by one stroke width and anchor their eight resize
  // handles on that frame's corners and edge midpoints (Drawboard PDF
  // behaviour), not on the inner box the cloud was built from. Both are in
  // the overlay's unrotated frame; the resize math is untouched - the handle
  // id is what drives the drag, the anchor is only where the grabber is drawn.
  handleAnchors = null,   // { tl, mt, tr, mr, br, mb, bl, ml } -> { x, y } | null
  frameRect = null,       // { left, top, width, height } | null
  // UX 2026-09-10 (round 4, defect 2): a revision cloud in bbox mode always
  // exposes all EIGHT grabbers. A 2-point polyline cloud's frame is 157 x 20
  // page units and the edge PILLS need 47 units on the short axis, so the
  // adaptive tier culled them and the cloud's vertical axis could not be
  // resized at all. With this flag the four edge grabbers fall back to dots the
  // size of the corner dots (see getAdaptiveSelectionHandleSpec) instead of
  // disappearing; they drive exactly the same resize math, and on a frame too
  // thin to hold a dot between its corner dots they are pushed straight out
  // along the frame normal so no two grabbers can ever overlap.
  alwaysShowResizeHandles = false,
  // RULED 2026-09-28 owner: open editing + lock. A user-locked mark is still
  // selectable: its frame shows with NO resize / rotate grabbers (it cannot
  // be resized or rotated) and a small lock badge on the frame's top-right
  // corner, in the handles' own white-and-blue, so the reason is visible.
  locked = false,
}) => {
  // UX 2026-09-16: hit pads grow on a finger (44 pt) and stay tight on a mouse
  // (the grabber + 4 px, min 20 px - w63). Read before the bbox early-return
  // because hooks cannot run conditionally.
  const isCoarsePointer = useCoarsePointer();
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
  // The frame the grabbers are actually DRAWN on. For every ordinary shape it
  // IS the bbox; a revision cloud passes the padded outer hull of its humps
  // (frameRect), which is a crown depth plus the pad bigger on every side.
  // UX 2026-09-09 (defect 3): the "do the handles fit?" question has to be
  // asked about this frame, not about the inner box the cloud was built from.
  // Measuring the inner box culled the four edge pills off a 45x45 cloud whose
  // frame is 68.7 wide, and left a 2-point polyline cloud (inner height 0)
  // showing a single 'br' grabber, while Drawboard shows all eight.
  const frame = frameRect || { left, top, width, height };
  const handleSpec = getAdaptiveSelectionHandleSpec({
    bboxWidth: frame.width,
    bboxHeight: frame.height,
    inverseScale,
    padding,
    alwaysAllHandles: alwaysShowResizeHandles,
  });
  const visibleResizeHandles = new Set(handleSpec.resizeHandles);
  // 'dot' = this frame cannot hold the 28-unit edge pills, so the edge
  // grabbers render as corner-sized circles pushed clear of their neighbours.
  const edgeHandlesAreDots = handleSpec.edgeHandleShape === 'dot';
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
  // hull of its humps (frameRect), which the caller already sized — resolved
  // above, next to the handle-fit question it also answers.
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

  // Where an edge grabber is DRAWN. Identical to the frame midpoint unless it
  // is a dot on a frame too thin to hold it, in which case it steps outward
  // along that edge's own normal by the spec's computed clearance.
  const edgeHandlePos = (id) => {
    const pos = handles[id];
    if (!edgeHandlesAreDots) return pos;
    const out = handleSpec.edgeDotOutset || { x: 0, y: 0 };
    if (id === 'mt') return { x: pos.x, y: pos.y - out.y };
    if (id === 'mb') return { x: pos.x, y: pos.y + out.y };
    if (id === 'ml') return { x: pos.x - out.x, y: pos.y };
    if (id === 'mr') return { x: pos.x + out.x, y: pos.y };
    return pos;
  };

  // One ELEMENT TYPE for an edge grabber, whatever shape it is wearing. A dot
  // is a <rect> with rx = half its side, which renders as a circle — so when a
  // drag grows the frame past the pill threshold mid-gesture, React updates
  // attributes instead of unmounting the node. That matters because the hook
  // calls setPointerCapture on the grabber at pointerdown: swapping <circle>
  // for <rect> would detach the captured element and the drag would die on the
  // spot (measured live 2026-09-10 on a 2-point polyline cloud's 'mb' dot).
  const edgeHandleGeometry = (pos, axis, asPill = false) => {
    const isDot = edgeHandlesAreDots && !asPill;
    if (isDot) {
      const side = handleMetrics.cornerR * 2;
      return {
        isDot: true,
        x: pos.x - handleMetrics.cornerR,
        y: pos.y - handleMetrics.cornerR,
        width: side,
        height: side,
        rx: handleMetrics.cornerR,
        strokeWidth: handleMetrics.cornerStrokeWidth,
        shadow: cornerShadow,
      };
    }
    const w = axis === 'h' ? hPillW : vPillW;
    const h = axis === 'h' ? hPillH : vPillH;
    return {
      isDot: false,
      x: pos.x - w / 2,
      y: pos.y - h / 2,
      width: w,
      height: h,
      rx: pillRx,
      strokeWidth: 1 * is,
      shadow: pillShadow,
    };
  };

  // Pill dimensions
  const hPillW = handleMetrics.hPillW;
  const hPillH = handleMetrics.hPillH;
  const vPillW = handleMetrics.vPillW;
  const vPillH = handleMetrics.vPillH;
  const pillRx = handleMetrics.pillRx;
  const textRangeHitSize = 44 * visualInverseScale;

  // --- Invisible hit pads -------------------------------------------------
  // UX 2026-09-16 (Drawboard PDF parity): the dot you SEE keeps exactly the
  // size it has today; a transparent square behind it catches the click. Before
  // this, a corner was grabbable only to +-5.5 px and an edge pill was 8 px
  // thick, so a mouse that missed by 6 px hit the page and started a new mark.
  // Drawboard puts a 34 x 34 px pad on every one of its eight handles (measured
  // 2026-09-16); we shipped 32 on a mouse and 44 on a finger. w63 (2026-09-28)
  // took the mouse pad down to the grabber + 4 px (min 20): 32 reached 16 px
  // off a corner, so a box-select started just outside a selected mark
  // resized it. Sizes live in utils/handleHitPad.js.
  //
  // Screen-constant: sized in page units from the CLAMPED inverse scale, so it
  // covers the same screen area at 50 % and at 400 % zoom, and stops growing on
  // extreme zoom-out exactly like the visible handles do.
  //
  // Crowding: on a small mark two full pads would overlap and the wrong handle
  // would win in the overlap. The spacing below is the centre-to-centre gap to
  // the nearest other grabber (corners are a frame apart; with the edge
  // grabbers showing, half a frame), and the pad shrinks to it so pads tile
  // instead of stacking. It never goes below the visible dot's own size.
  const resizeHandleSpacing = (() => {
    const shortestSide = Math.min(boxW, boxH);
    if (!Number.isFinite(shortestSide) || shortestSide <= 0) return undefined;
    if (visibleResizeHandles.size >= 8) return shortestSide / 2;
    if (visibleResizeHandles.size >= 2) return shortestSide;
    return undefined; // lone 'br' grabber has no neighbour to crowd
  })();
  const resizeHitPad = resolveHandleHitPadPageSize({
    isCoarsePointer,
    inverseScale: visualInverseScale,
    neighbourSpacingPageUnits: resizeHandleSpacing,
    minPadPageUnits: handleMetrics.cornerR * 2,
  });
  // The rotation grabber sits `rotationOffset` clear of the top edge, so its
  // only close neighbour is whatever grabber is on that edge.
  const rotationHitPad = resolveHandleHitPadPageSize({
    isCoarsePointer,
    inverseScale: visualInverseScale,
    neighbourSpacingPageUnits: handleSpec.rotationOffset,
    minPadPageUnits: handleMetrics.rotationR * 2,
  });
  // One shape for every pad: a rounded square centred on the grabber. Rendered
  // BEFORE the visible dot so the dot still wins where the two overlap, and
  // carrying the same data-resize-handle id so the drag dispatcher and the
  // hit-test resolver treat a pad hit exactly like a hit on the dot.
  //
  // The pad carries `data-handle-hit-pad`, NOT `data-resize-handle`: the
  // visible dot stays the one element that answers "is this a handle?" for
  // anything counting them, and the touch / pan guards that have to treat a pad
  // press as a handle press match on the pad attribute instead (see
  // PdfjsViewerContainer and PDFViewer's long-press guard).
  const renderHitPad = (id, pos, size, cursor) => (
    <rect
      key={`hit-${id}`}
      data-handle-hit-pad={id}
      x={pos.x - size / 2}
      y={pos.y - size / 2}
      width={size}
      height={size}
      rx={size / 4}
      fill="transparent"
      stroke="none"
      style={{
        cursor,
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onHandleDrag?.(e, id);
      }}
    />
  );

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

      {/* --- Lock badge (user-locked mark) --- */}
      {locked && (
        <SelectionLockBadge x={boxX + boxW} y={boxY} radius={handleMetrics.rotationR} />
      )}

      {/* --- Handles (hidden for group selection -- Plan 03 renders group handles) --- */}
      {!isGroupSelection && !moveOnly && !locked && (
        <>
          {/* Invisible hit pads, drawn first so every visible grabber sits on
              top of its own pad and still wins a direct hit. */}
          {!horizontalResizeOnly && !hideResizeHandles && cornerHandles
            .filter((id) => visibleResizeHandles.has(id))
            .map((id) => renderHitPad(id, handles[id], resizeHitPad, getCursorForHandle(id, angle || 0)))}
          {!horizontalResizeOnly && !hideResizeHandles && ['mt', 'mb']
            .filter((id) => visibleResizeHandles.has(id))
            .map((id) => renderHitPad(id, edgeHandlePos(id), resizeHitPad, getCursorForHandle(id, angle || 0)))}
          {!horizontalResizeOnly && !hideResizeHandles && ['ml', 'mr']
            .filter((id) => visibleResizeHandles.has(id))
            .map((id) => renderHitPad(id, edgeHandlePos(id), resizeHitPad, getCursorForHandle(id, angle || 0)))}

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
            const pos = edgeHandlePos(id);
            const geom = edgeHandleGeometry(pos, 'h');
            return (
              <rect
                key={`pill-${id}`}
                data-resize-handle={id}
                data-edge-handle-shape={edgeHandlesAreDots ? 'dot' : undefined}
                x={geom.x}
                y={geom.y}
                width={geom.width}
                height={geom.height}
                rx={geom.rx}
                fill={HANDLE_FILL}
                stroke={HANDLE_RING}
                strokeWidth={geom.strokeWidth}
                style={{
                  filter: geom.shadow,
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
              : edgeHandlePos(id);
            const geom = edgeHandleGeometry(pos, 'v', horizontalResizeOnly);
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
                  data-edge-handle-shape={geom.isDot ? 'dot' : undefined}
                  data-text-range-handle-visual={horizontalResizeOnly ? id : undefined}
                  x={geom.x}
                  y={geom.y}
                  width={geom.width}
                  height={geom.height}
                  rx={geom.rx}
                  fill={HANDLE_FILL}
                  stroke={HANDLE_RING}
                  strokeWidth={geom.strokeWidth}
                  style={{
                    filter: geom.shadow,
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
            {/* Invisible hit pad — same grab area rule as the resize
                grabbers, drawn under the visible circle. */}
            {renderHitPad('mtr', handles.mtr, rotationHitPad, 'crosshair')}
            {/* UX 2026-10-02 (owner): no connector line to the box — the
                grabber floats on its own; position and hit pad unchanged. */}
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

/**
 * The small lock shown on a selected user-locked mark (owner ruling
 * 2026-09-28). Drawn in page units at the radius of the rotation grabber, so
 * it keeps the handles' screen size at every zoom. The glyph is the app's own
 * `lock` icon (Icons.jsx) — one icon set everywhere. Look-only: it takes no
 * pointer events.
 */
export function SelectionLockBadge({ x, y, radius }) {
  const r = Number(radius) > 0 ? Number(radius) : 6;
  const glyph = r * 1.25;
  return (
    <g data-selection-lock-badge="true" style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={r} fill={HANDLE_FILL} stroke={HANDLE_RING} strokeWidth={r / 7} />
      <svg
        x={x - glyph / 2}
        y={y - glyph / 2}
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        overflow="visible"
      >
        <rect x="4" y="11" width="16" height="10" rx="1.11" stroke={HANDLE_RING} strokeWidth="2.2" />
        <path d="M8 11V7A4 4 0 0 1 16 7V11" stroke={HANDLE_RING} strokeWidth="2.2" />
      </svg>
    </g>
  );
}

export default SVGSelectionOverlay;
