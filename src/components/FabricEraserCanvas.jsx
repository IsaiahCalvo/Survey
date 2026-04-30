/**
 * FabricEraserCanvas
 *
 * Eraser Canvas component that loads ALL page annotations via enlivenObjects,
 * allows eraser strokes with boolean path subtraction via geometryEraser.js,
 * and commits erased results to SVG data per-gesture via onEraseCommit.
 *
 * Key behaviors:
 * - Container-aware sizing via setZoom(effectiveScale) so coordinates match SVG viewBox space
 * - Loading state: cursor 'wait' during enlivenObjects, then 'none' (App.jsx eraser circle overlay provides visual cursor)
 * - isLoadingRef mirrors isLoading state to avoid stale closure in mouse:down handler
 * - Each completed erase gesture serializes entire Canvas and commits via onEraseCommit
 * - Fully erased objects are removed from Canvas
 * - zoomGeneration prop change flushes in-progress erase gesture (EDIT-09)
 * - Pre-unmount commit flushes in-progress erase gesture on tool switch
 * - SVG layer is visibility:hidden while this component is mounted (handled by App.jsx)
 *
 * Phase 10 Plan 02: Eraser Canvas mount/unmount mechanism.
 */
import React, { memo, useState, useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';
import { booleanErasePath } from '../utils/geometryEraser';
// Phase 35 Plan 03 — eraser hit-test gate (AC #2: non-owner eraser swipe
// across a foreign-author mark has no effect; owner short-circuits inside).
import { canModify } from '../lib/collab/permissionScope.js';

// Custom properties to include in object serialization (matches PAL / FabricDrawingCanvas pattern)
// UX 2026-04-25: 'tool' added so arrows survive an erase commit. Without it,
// Fabric's toJSON strips the 'tool' field that FabricDrawingCanvas sets when
// the user draws an arrow ('tool: arrow'). The SVG renderer reads obj.tool
// to decide whether to render the arrowhead — losing the field turns every
// arrow into a plain line on the next render.
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType',
  'tool',
];

const FabricEraserCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  annotations,
  onEraseCommit,
  onEraseCallout,
  eraserSize = 20,
  viewerScale,
  selectedSpaceId,
  activeSpaceId,
  spaces,
  zoomGeneration,
  // Phase 35 Plan 03 — per-user delete authority gate (boot-guarded; legacy
  // mount sites without these props fall through to today's behavior).
  viewerId,
  documentOwnerId,
}) => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [isLoading, setIsLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const mountedRef = useRef(true);

  // CRITICAL: Ref mirror of isLoading for use in mouse:down handler.
  // The mouse:down handler is bound in useEffect([]) and would capture the
  // initial isLoading=true state value forever due to stale closure.
  // The ref is always current.
  const isLoadingRef = useRef(true);

  const eraserPathRef = useRef([]);
  const isErasingRef = useRef(false);

  // Closure-safe refs for props
  const annotationsRef = useRef(annotations);
  const onEraseCommitRef = useRef(onEraseCommit);
  const onEraseCalloutRef = useRef(onEraseCallout);
  const eraserSizeRef = useRef(eraserSize);
  const viewerScaleRef = useRef(viewerScale);
  const effectiveScaleRef = useRef(1);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const spacesRef = useRef(spaces);
  const initialZoomGenRef = useRef(zoomGeneration);
  // Phase 35 Plan 03 — closure-safe refs for the per-user delete authority
  // gate inside applyEraserAndCommit (the loop reads via .current to dodge
  // stale closures, matching every other prop ref above).
  const viewerIdRef = useRef(viewerId);
  const documentOwnerIdRef = useRef(documentOwnerId);

  const getSpaceIdForRegion = (regionId) => {
    if (!regionId) return null;
    const currentSpaces = Array.isArray(spacesRef.current) ? spacesRef.current : [];
    for (const space of currentSpaces) {
      const assignedPages = Array.isArray(space?.assignedPages) ? space.assignedPages : [];
      for (const page of assignedPages) {
        const regions = Array.isArray(page?.regions) ? page.regions : [];
        for (const region of regions) {
          if (region?.regionId === regionId) {
            return space.id;
          }
        }
      }
    }
    return null;
  };

  // Pre-dispose callback: flush in-progress erase gesture before canvas.off()/dispose()
  const onBeforeDisposeRef = useRef((canvas) => {
    if (isErasingRef.current) {
      isErasingRef.current = false;
      try {
        applyEraserAndCommit(canvas);
      } catch (err) {
        console.error('Pre-unmount eraser flush error:', err);
      }
      eraserPathRef.current = [];
    }
    mountedRef.current = false;
  });

  // ---------------------------------------------------------------------------
  // Canvas lifecycle (useFabricCanvas hook)
  // ---------------------------------------------------------------------------
  const { fabricRef } = useFabricCanvas({
    canvasElRef,
    onBeforeDisposeRef,
    options: {
      backgroundColor: 'transparent',
      isDrawingMode: false,
      selection: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
      skipTargetFind: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Helper: apply eraser path to canvas objects and commit
  // ---------------------------------------------------------------------------
  const applyEraserAndCommit = useRef((canvas) => {
    const eraserPathData = eraserPathRef.current;
    if (!eraserPathData || eraserPathData.length === 0) {
      return;
    }

    // Single-click (only M, no L): duplicate the point so geometry eraser
    // treats it as a zero-length segment (eraser radius still applies)
    if (eraserPathData.length === 1 && (eraserPathData[0][0] === 'M')) {
      eraserPathData.push(['L', eraserPathData[0][1], eraserPathData[0][2]]);
    }

    // Adjust eraser radius to match the visual cursor overlay.
    // Cursor overlay uses: eraserSize * viewerScale (screen px).
    // Canvas operates at effectiveScale (container-aware), so page-space radius
    // maps to eraserSize * effectiveScale on screen. Compensate for the difference.
    const vs = viewerScaleRef.current || 1;
    const es = effectiveScaleRef.current || 1;
    const currentEraserSize = eraserSizeRef.current * (vs / es);

    // Build eraser path object compatible with geometryEraser.js
    // Both splitPathDataByEraser and booleanErasePath expect:
    //   eraserPath: { points: [{x, y}, ...] }
    //   eraserRadius: number
    const eraserPoints = [];
    for (const cmd of eraserPathData) {
      if (cmd[0] === 'M' || cmd[0] === 'L') {
        eraserPoints.push({ x: cmd[1], y: cmd[2] });
      }
    }
    const eraserPath = { points: eraserPoints };

    const objects = [...canvas.getObjects()];
    let changed = false;

    for (const obj of objects) {
      // Phase 35 Plan 03 — AC #2 eraser gate. canModify reads authorId via
      // its meta > authorId > data.authorId > data.userId chain, so the shim
      // forwards every surface Fabric might carry it on. Owner short-circuits.
      const _vId = viewerIdRef.current;
      const _oId = documentOwnerIdRef.current;
      if (_vId && _oId && !canModify({
        annotation: { id: obj.id, authorId: obj.authorId, data: obj.data, meta: obj.meta },
        viewerId: _vId,
        documentOwnerId: _oId,
      })) {
        continue;
      }

      const objSpaceId = obj.spaceId || null;
      const objRegionId = obj.regionId || null;
      let shouldSkip = false;

      if (activeSpaceIdRef.current !== null) {
        if (objRegionId !== null) {
          const derivedSpaceId = getSpaceIdForRegion(objRegionId);
          if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) {
            shouldSkip = true;
          }
        } else if (objSpaceId !== null) {
          shouldSkip = objSpaceId !== activeSpaceIdRef.current;
        } else {
          shouldSkip = true;
        }
      } else if (selectedSpaceIdRef.current !== null && objSpaceId !== null) {
        shouldSkip = objSpaceId !== selectedSpaceIdRef.current;
      }

      if (shouldSkip) {
        continue;
      }

      // Only erase path-type objects (same approach as PAL -- non-path objects
      // like rect, ellipse, textbox are removed if touched, path objects get
      // boolean subtraction)
      if (obj.type === 'path' && obj.path) {
        // Short-circuit: booleanErasePath unconditionally converts a stroked
        // polyline into a filled cookie-cutter outline. When the eraser
        // doesn't overlap the path's bounding box at all, that conversion
        // adds no semantic value but visually turns a stroked scribble into
        // a filled polygon whose interior loops show as holes — the
        // "hollow stripe through imported pen stroke" symptom. Guard: only
        // run booleanErasePath when at least one eraser sample is within
        // radius of the path's world-space bounding rect.
        const pathBounds = obj.getBoundingRect ? obj.getBoundingRect(true) : null;
        if (pathBounds) {
          const eraserTouchesPath = eraserPoints.some((point) => {
            return (
              point.x >= pathBounds.left - currentEraserSize &&
              point.x <= pathBounds.left + pathBounds.width + currentEraserSize &&
              point.y >= pathBounds.top - currentEraserSize &&
              point.y <= pathBounds.top + pathBounds.height + currentEraserSize
            );
          });
          if (!eraserTouchesPath) {
            continue;
          }
        }

        // Use booleanErasePath (cookie-cutter) for ALL pen strokes, imported
        // or native. Rationale: once a native pen stroke has been erased
        // once, it's stored as a filled polygon (strokeWidth=0, fill=color)
        // because booleanErasePath's first pass converts the stroked
        // polyline into a filled ribbon outline. Every SUBSEQUENT erase on
        // that stroke then acts on a filled polygon, which is what lets the
        // user carve a crescent-shaped bite from the side of a stroke
        // without cutting through it. The earlier split-path approach
        // avoided the first-erase thickening on imported strokes but also
        // meant imported strokes could never be partially bitten —
        // they always fully split. Switching imported strokes to the same
        // code path restores parity. Any slight thickening on the very
        // first erase is the same transition every native stroke already
        // goes through the first time it's erased.
        let result = booleanErasePath(obj, eraserPath, currentEraserSize);
        let isConverted = false;

        if (result) {
          let newPathData = null;

          if (Array.isArray(result)) {
            // Fully erased (empty array) or direct array return
            if (result.length === 0) {
              canvas.remove(obj);
              changed = true;
              continue;
            }
            newPathData = result;
          } else {
            newPathData = result.pathData;
            isConverted = result.isConvertedToOutline;
          }

          if (newPathData && newPathData.length > 0) {
            // Update the path data
            obj.path = newPathData;

            // If converted to outline, swap stroke and fill (same as PAL erasePathSegment)
            if (isConverted && obj.strokeWidth > 0) {
              const originalStroke = obj.stroke;
              obj.set({
                stroke: 'transparent',
                strokeWidth: 0,
                fill: originalStroke || obj.fill,
              });
            }

            // Recalculate dimensions and offsets for the new path.
            // Imported pen strokes obey a different storage convention from
            // internal live-drawn strokes: left/top carry the world
            // placement and path data is in LOCAL coords starting at (0, 0).
            // After booleanErasePath the path's local min may have shifted,
            // so we translate the path back to (0, 0) and absorb the shift
            // into left/top. Internal strokes keep the legacy behavior
            // (setPositionByOrigin with new pathOffset) so untouched PAL
            // code paths remain identical.
            if (obj._calcDimensions) {
              const dims = obj._calcDimensions();
              if (obj.isPdfImported) {
                const shiftX = dims.left;
                const shiftY = dims.top;
                if (shiftX !== 0 || shiftY !== 0) {
                  const translated = newPathData.map((cmd) => {
                    const next = cmd.slice();
                    for (let j = 1; j + 1 < next.length; j += 2) {
                      if (typeof next[j] === 'number') next[j] -= shiftX;
                      if (typeof next[j + 1] === 'number') next[j + 1] -= shiftY;
                    }
                    return next;
                  });
                  obj.path = translated;
                }
                // pathOffset MUST equal the local-path geometric center for
                // Fabric's hit-test math to match world clicks to path data.
                // splitPathDataByEraser/booleanErasePath both compute
                // `localEraser = inverseMatrix(worldClick) + pathOffset` —
                // with pathOffset at (0, 0) the eraser lands off the stroke
                // after the first erase, producing the "second click
                // extends the previous gap instead of cutting where I
                // clicked" bug.
                obj.set({
                  width: dims.width,
                  height: dims.height,
                  pathOffset: { x: dims.width / 2, y: dims.height / 2 },
                  left: (obj.left || 0) + shiftX,
                  top: (obj.top || 0) + shiftY,
                });
                obj.setCoords();
              } else {
                const newPathOffsetX = dims.left + dims.width / 2;
                const newPathOffsetY = dims.top + dims.height / 2;
                obj.set({
                  width: dims.width,
                  height: dims.height,
                  pathOffset: { x: newPathOffsetX, y: newPathOffsetY },
                });
                // Use setPositionByOrigin to correctly position the erased path,
                // accounting for strokeWidth and scale (same as PencilBrush internals).
                const newPos = new fabric.Point(newPathOffsetX, newPathOffsetY);
                obj.setPositionByOrigin(newPos, 'center', 'center');
              }
            }

            obj.setCoords();
            obj.dirty = true;
            changed = true;
          }
        }
      } else {
        // Non-path objects: remove if eraser touched them (same as PAL partial eraser fallback)
        const bounds = obj.getBoundingRect ? obj.getBoundingRect(true) : null;
        if (bounds) {
          const isTouching = eraserPoints.some(point => {
            return (
              point.x >= bounds.left - currentEraserSize &&
              point.x <= bounds.left + bounds.width + currentEraserSize &&
              point.y >= bounds.top - currentEraserSize &&
              point.y <= bounds.top + bounds.height + currentEraserSize
            );
          });
          if (isTouching) {
            canvas.remove(obj);
            changed = true;
          }
        }
      }
    }

    if (changed) {
      canvas.renderAll();
    }

    // Serialize the entire canvas and commit.
    // Normalize path left/top back to 0 for SVG renderer compatibility.
    // Canvas uses left=pathOffset for display, but SVG expects left=0 with
    // absolute path data (translate(0,0) is a no-op, path coords render directly).
    const canvasObjects = canvas.getObjects();
    const serializedObjects = canvasObjects.map((obj) => {
      // Bypass toJSON for any textbox with stashed original JSON. Two
      // reasons this matters: (1) Fabric 5.5.2 throws inside Text.toObject
      // on PDF-imported Textboxes (styles/textLines indexing crash), so
      // imported textboxes can't be serialized at all. (2) For
      // internally-drawn textboxes, Fabric's toJSON writes back the
      // auto-laid-out width/height, which differs from stored after
      // enliven and would shrink the visible textbox on first eraser
      // click. Textboxes are never partially erased on this canvas —
      // kept whole or removed entirely — so the stashed original JSON is
      // always the correct serialization. Shallow-copy so the caller
      // can't retroactively mutate our stashed reference.
      if (obj.type === 'textbox' && obj.__importedJSON) {
        return { ...obj.__importedJSON };
      }
      const json = obj.toJSON(CUSTOM_PROPS);
      // Internal live-drawn pen strokes store left=0, top=0 with absolute
      // world-coord path data; reset here to match that storage convention.
      // Imported pen strokes store left/top as the world placement with
      // local-coord path data starting at (0, 0); leaving those values
      // alone preserves the imported convention so the stroke does NOT
      // snap to the top-left of the page on commit.
      if (json.type === 'path' && !obj.isPdfImported) {
        json.left = 0;
        json.top = 0;
      }
      // UX: imported-shape parity override (see post-enliven block in the
      // canvas init useEffect) sets opacity: 0 on the live Fabric object
      // to hide it under the SVG visual. Fabric's default toJSON includes
      // opacity/stroke/strokeWidth, so without this restore the override
      // would be persisted back to stored annotation state on every erase
      // commit and corrupt the selector-mode render. Restore from the
      // __orig* values stashed at load time.
      //
      // EXCEPTION: when booleanErasePath converted a stroked polyline into
      // a filled-outline polygon (strokeWidth -> 0, fill -> originalStroke),
      // that conversion is INTENTIONAL and must persist — restoring the
      // original stroke/strokeWidth here would stamp a second stroke on
      // top of the filled polygon and make it render visibly thicker than
      // before the erase (the "first erase makes imported ink fatter" bug).
      // Detect post-conversion by the strokeWidth the eraser set to 0.
      if (obj.isPdfImported && obj.__origOpacity !== undefined) {
        json.opacity = obj.__origOpacity;
        const wasConverted = (obj.strokeWidth || 0) === 0 && !!obj.fill && obj.fill !== 'transparent';
        if (!wasConverted) {
          if (obj.__origStroke !== undefined) json.stroke = obj.__origStroke;
          if (obj.__origStrokeWidth !== undefined) json.strokeWidth = obj.__origStrokeWidth;
        }
      } else if (obj.__origOpacity !== undefined) {
        // UX 2026-04-25 — Internally-drawn marks also get opacity:0 in
        // eraser mode (see post-enliven block). Stroke/strokeWidth were
        // not modified for non-imported types so they don't need
        // restoration here, only opacity.
        json.opacity = obj.__origOpacity;
      }
      return json;
    });
    const updatedJSON = { objects: serializedObjects };
    onEraseCommitRef.current(updatedJSON);

    // Callout hit-test: callouts live in a separate React state, not in the
    // Fabric canvas objects above. Check if the eraser path overlaps any
    // callout's SVG bounding box on this page.
    const calloutCallback = onEraseCalloutRef.current;
    if (calloutCallback) {
      try {
        const svgEl = document.querySelector(
          `[data-diag-svg-wrapper="${pageNumber}"] svg`
        );
        if (svgEl) {
          const hitIds = [];
          const groups = svgEl.querySelectorAll('[data-callout-id]');
          groups.forEach((g) => {
            const cid = g.getAttribute('data-callout-id');
            if (hitIds.includes(cid)) return;
            try {
              const bbox = g.getBBox();
              const hit = eraserPoints.some(
                (p) =>
                  p.x >= bbox.x - currentEraserSize &&
                  p.x <= bbox.x + bbox.width + currentEraserSize &&
                  p.y >= bbox.y - currentEraserSize &&
                  p.y <= bbox.y + bbox.height + currentEraserSize
              );
              if (hit) hitIds.push(cid);
            } catch (_) {}
          });
          if (hitIds.length > 0) {
            calloutCallback(hitIds);
          }
        }
      } catch (_) {}
    }
  }).current;

  // ---------------------------------------------------------------------------
  // Canvas initialization: sizing, cursors, annotation loading, eraser events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !containerRef.current) return;

    // Container-aware sizing (CLAUDE.md rule)
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth > 0 && pageWidth > 0) {
      const effectiveScale = containerWidth / pageWidth;
      effectiveScaleRef.current = effectiveScale;
      canvas.setZoom(effectiveScale);
      canvas.setWidth(Math.floor(pageWidth * effectiveScale));
      canvas.setHeight(Math.floor(pageHeight * effectiveScale));
    }

    // Cursors: 'none' so the existing App.jsx eraser circle overlay provides the visual cursor
    canvas.defaultCursor = 'none';
    canvas.hoverCursor = 'none';
    canvas.moveCursor = 'none';

    // -----------------------------------------------------------------------
    // Load annotations via enlivenObjects
    // -----------------------------------------------------------------------
    const annotationsToLoad = annotationsRef.current;
    const objectsArray = annotationsToLoad?.objects || [];

    // Diagnostics: snapshot what goes into enlivenObjects so we can compare
    // against what comes out. Any type mismatch / silent drop will show up here.
    const inputTypeHistogram = {};
    const inputDetail = objectsArray.map((o, i) => {
      const t = o?.type || 'null';
      inputTypeHistogram[t] = (inputTypeHistogram[t] || 0) + 1;
      return {
        index: i,
        type: t,
        dataType: o?.data?.type || null,
        isPdfImported: !!o?.isPdfImported,
        hasPath: Array.isArray(o?.path) && o.path.length > 0,
        hasObjects: Array.isArray(o?.objects) && o.objects.length > 0,
        visible: o?.visible !== false,
        layer: o?.layer || 'native',
        spaceId: o?.spaceId ?? null,
        moduleId: o?.moduleId ?? null,
        regionId: o?.regionId ?? null,
      };
    });

    if (objectsArray.length > 0) {
      fabric.util.enlivenObjects(objectsArray, (enlivenedObjects) => {
        // Guard: component may have unmounted during async load
        if (!mountedRef.current) return;

        // Diagnostics: compare input vs enlivened. Any array-length mismatch
        // or null slots means enlivenObjects silently dropped something.
        if (typeof window !== 'undefined') {
          const outputTypeHistogram = {};
          const nullIndexes = [];
          enlivenedObjects.forEach((o, i) => {
            if (!o) {
              nullIndexes.push(i);
              return;
            }
            const t = o.type || 'null';
            outputTypeHistogram[t] = (outputTypeHistogram[t] || 0) + 1;
          });
          if (!window.__diagEraserStats) window.__diagEraserStats = {};
          window.__diagEraserStats[pageNumber] = {
            inputCount: objectsArray.length,
            enlivenedCount: enlivenedObjects.length,
            nullIndexes,
            inputTypeHistogram,
            outputTypeHistogram,
            inputDetail,
          };
          console.log(
            `[FabricEraserCanvas p${pageNumber}] enliven — input=${objectsArray.length} output=${enlivenedObjects.length} nulls=${nullIndexes.length} types=${JSON.stringify(inputTypeHistogram)}→${JSON.stringify(outputTypeHistogram)}`
          );
        }

        enlivenedObjects.forEach((obj, index) => {
          if (!obj) return;
          const objData = objectsArray[index];

          obj.set({
            strokeUniform: true,
            selectable: false,
            evented: false,
          });

          // Copy metadata
          if (objData.spaceId) obj.spaceId = objData.spaceId;
          if (objData.moduleId) obj.moduleId = objData.moduleId;
          if (objData.regionId) obj.regionId = objData.regionId;
          if (objData.layer) obj.layer = objData.layer;
          if (objData.highlightId) obj.highlightId = objData.highlightId;
          if (objData.needsBIC) obj.needsBIC = objData.needsBIC;
          if (objData.data) obj.data = objData.data;
          if (objData.name) obj.name = objData.name;
          if (objData.isPdfImported) obj.isPdfImported = objData.isPdfImported;
          if (objData.pdfAnnotationId) obj.pdfAnnotationId = objData.pdfAnnotationId;
          if (objData.pdfAnnotationType) obj.pdfAnnotationType = objData.pdfAnnotationType;
          if (objData.globalCompositeOperation) {
            obj.set({ globalCompositeOperation: objData.globalCompositeOperation });
          }

          // Enforce multiply blend mode for highlights
          if (obj.highlightId || obj.needsBIC) {
            obj.set({ globalCompositeOperation: 'multiply' });
          }

          // PDF-imported shape visual parity with the selector-mode SVG render.
          // UX: imported annotations (circle, polygon, line, polyline, path,
          // ellipse, rect, textbox) must look identical in eraser and
          // selector mode. The SVG layer (selector mode) renders each shape
          // via the browser's SVG rasterizer; Fabric.js renders via Canvas2D
          // which anti-aliases sub-pixel coordinates differently — see
          // CLAUDE.md 2026-04-10 rasterizer-mismatch gotcha: Canvas 2D and
          // SVG produce visibly different strokes at non-integer positions
          // and this is NOT fixable in JS. For textboxes, the same applies
          // to glyph rendering (CLAUDE.md 2026-04-08 + 2026-04-10): SVG
          // uses <foreignObject><div> with browser CSS text layout, Fabric
          // measures at CACHE_FONT_SIZE=400 and scales down (fabric.js
          // 26261, 30731-30745).
          //
          // Structural fix (Phase 2 extension of the 2026-04-10 gotcha
          // resolution): keep the Fabric object as an invisible hit zone
          // (opacity: 0) and let the SVG <g> underneath be the single
          // visible truth in eraser mode. The App.jsx SVG wrapper stays
          // visible in eraser mode and SVGAnnotationLayer renders every
          // imported annotation (not just textboxes). Two side effects:
          //   1. Pixel-perfect visual parity on tool switch (no rasterizer
          //      delta, no ~0.16px edge shift).
          //   2. Eraser-mode zoom becomes as smooth as selector-mode zoom:
          //      the user visually sees the SVG viewBox (GPU-composited,
          //      free) and the Fabric canvas's choppy ResizeObserver redraw
          //      happens invisibly behind opacity: 0.
          //
          // Textbox-specific width/height forcing: Fabric Textbox auto-wraps
          // and recalculates width from text content. Fabric's hit-test
          // uses obj.width/obj.height — getting those wrong misaligns the
          // erase target rectangle. __skipDimension + stored-dim forcing
          // preserves the stored bounds.
          //
          // CRITICAL: the opacity/stroke override must NEVER persist to
          // stored annotation state. Fabric's default toJSON serializes
          // opacity, stroke, and strokeWidth — so we stash the originals on
          // __orig* here and restore them in the serialize path inside
          // applyEraserAndCommit so each erase commit emits the real values,
          // not our invisible override.
          // UX 2026-04-25 — Stash originals on every object (imported or
          // internally-drawn) so the opacity:0 invisible-overlay treatment
          // can extend to every annotation in eraser mode. Without this,
          // internally-drawn marks (counter pins, rectangles, ellipses,
          // text) render visibly on the Fabric eraser canvas while ALSO
          // rendering visibly on the SVG layer below — producing the
          // "doubled / thicker / counter numbers missing" eraser appearance.
          // Originals are restored in the serialize path so the override
          // never persists to stored annotation state.
          obj.__origOpacity = obj.opacity;
          obj.__origStroke = obj.stroke;
          obj.__origStrokeWidth = obj.strokeWidth;

          // UX 2026-04-25 — Textboxes (imported AND internally-drawn) get
          // their original JSON stashed so the serialize path can return
          // it verbatim, bypassing Fabric's toJSON which would write back
          // the auto-laid-out width/height. Without this, the eraser
          // commit persists Fabric's recalculated dimensions to storage,
          // making the textbox visibly shrink (vertically) the first time
          // the user clicks the eraser and never recover. Textboxes are
          // never partially erased — they are kept whole or removed
          // entirely (see the for-loop above) — so the stored JSON is
          // always the correct serialization for kept textboxes.
          if (obj.type === 'textbox') {
            obj.__importedJSON = { ...objData };
          }

          if (objData.isPdfImported) {

            // SERIALIZE BYPASS for imported textboxes: Fabric 5.5.2 has a
            // toJSON bug on PDF-imported Textboxes — serialization throws
            // "Cannot read properties of undefined (reading '0')" inside
            // Text.toObject's styles/textLines path. Root cause is a
            // mismatch between the PDF-sourced `styles` object line-indexing
            // and Fabric's post-initDimensions _textLines array after
            // word-wrap at the stored width. The crash aborts the erase
            // commit for the ENTIRE canvas: click polygon → polygon gets
            // removed from Fabric but serialize throws on the still-present
            // textbox → onEraseCommit never fires → SVG never updates.
            // Workaround: for imported textboxes we never mutate the object
            // on the erase canvas (non-path types are either kept or removed
            // whole — see the for-loop above), so we can safely stash the
            // original import JSON here and short-circuit the serialize loop
            // below to return it directly, skipping the crashing toJSON()
            // call. For non-textbox imported shapes toJSON works fine, so
            // we only stash for textbox.
            if (obj.type === 'textbox') {
              obj.__importedJSON = objData;
            }

            // UX: Textboxes also drop stroke/strokeWidth — belt-and-braces
            // against the PDF-import default red border (if opacity ever
            // flips back to visible accidentally we still don't want that
            // border visible). Other imported types keep their stored
            // stroke because Fabric's erase hit-test uses
            // getBoundingRect(true) which inflates bounds by stroke bleed;
            // zeroing it would shrink the erase target slightly, and the
            // bounds contribute to applyEraserAndCommit's touch-test.
            if (obj.type === 'textbox') {
              obj.set({ stroke: null, strokeWidth: 0, opacity: 0 });
            } else {
              obj.set({ opacity: 0 });
            }
            obj.setCoords();

            if (typeof window !== 'undefined') {
              const label =
                obj.type === 'textbox'
                  ? `text="${(objData.text || '').slice(0, 20)}"`
                  : `type=${obj.type}`;
              console.log(
                `[FabricEraserCanvas p${pageNumber}] imported-override idx=${index} ${label} → hit-zone only, SVG renders visual`
              );
            }
          } else {
            // UX 2026-04-25 — Internally-drawn marks (counter pins,
            // rectangles, ellipses, text, etc.) also become invisible
            // hit zones in eraser mode. Stroke/strokeWidth are left
            // untouched for non-imported types because the SVG layer
            // below renders them verbatim from the stored JSON, and
            // restoring stroke at serialize time matches the imported
            // path. The result: SVG below is the single visual truth
            // in eraser mode for every annotation, no rasterizer
            // doubling, no missing counter numbers.
            obj.set({ opacity: 0 });
            obj.setCoords();
          }

          canvas.add(obj);

          // Fix coordinate space for Canvas rendering.
          // INTERNAL live-drawn pen strokes are stored with left=0, top=0 and
          // path data in absolute page-space — Fabric needs setPositionByOrigin
          // (same method PencilBrush uses internally, accounts for strokeWidth,
          // scale, and skew) to place the obj correctly for hit-testing.
          // IMPORTED pen strokes use the opposite convention: left/top carry
          // the world placement (worldMinX/Y) and path data is in LOCAL coords
          // starting at (0, 0). Applying setPositionByOrigin to imported paths
          // would re-anchor their center to ~(width/2, height/2) in world
          // coords — i.e. the top-left of the page — which is exactly the
          // "snap-to-corner on first eraser click" bug. Skip for imported.
          if (obj.type === 'path' && obj.pathOffset && !obj.isPdfImported) {
            const pos = new fabric.Point(obj.pathOffset.x, obj.pathOffset.y);
            obj.setPositionByOrigin(pos, 'center', 'center');
            obj.setCoords();
          }
        });

        canvas.renderAll();

        // CRITICAL: update both state and ref simultaneously so the mouse:down
        // handler (bound in this useEffect) reads the current value via the ref.
        setIsLoading(false);
        isLoadingRef.current = false;
      });
    } else {
      // No annotations to load -- immediately ready
      canvas.renderAll();
      setIsLoading(false);
      isLoadingRef.current = false;
    }

    // -----------------------------------------------------------------------
    // Eraser gesture handling: mouse:down, mouse:move, mouse:up
    // -----------------------------------------------------------------------

    // mouse:down
    canvas.on('mouse:down', (opt) => {
      // MUST check the ref, NOT the state variable, because this handler is
      // bound in useEffect([]) and the state value would be stale (always true).
      if (isLoadingRef.current) {
        return;
      }

      isErasingRef.current = true;
      const pointer = canvas.getPointer(opt.e);
      eraserPathRef.current = [['M', pointer.x, pointer.y]];
    });

    // mouse:move
    canvas.on('mouse:move', (opt) => {
      if (!isErasingRef.current) return;
      const pointer = canvas.getPointer(opt.e);
      eraserPathRef.current.push(['L', pointer.x, pointer.y]);
    });

    // mouse:up
    canvas.on('mouse:up', () => {
      if (!isErasingRef.current) {
        return;
      }
      isErasingRef.current = false;

      applyEraserAndCommit(canvas);
      eraserPathRef.current = [];
    });

    // Pre-unmount flush is handled by onBeforeDisposeRef (runs before canvas.off()).
    // No cleanup needed here.
  }, []); // Mount only

  // ---------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // ---------------------------------------------------------------------------
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  // Diagnostics: expose this canvas by pageNumber so App.jsx's tool-switch
  // snapshot can dump per-object Fabric state (bounds, strokes, text fields)
  // for side-by-side compare against the SVG selector render. See handleSaveOverlayLagLog.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.__fabricEraserCanvases) window.__fabricEraserCanvases = new Map();
    window.__fabricEraserCanvases.set(pageNumber, fabricRef);
    return () => {
      if (window.__fabricEraserCanvases) {
        window.__fabricEraserCanvases.delete(pageNumber);
      }
    };
  }, [pageNumber, fabricRef]);

  useEffect(() => {
    onEraseCommitRef.current = onEraseCommit;
  }, [onEraseCommit]);

  useEffect(() => {
    onEraseCalloutRef.current = onEraseCallout;
  }, [onEraseCallout]);

  useEffect(() => {
    eraserSizeRef.current = eraserSize;
  }, [eraserSize]);

  useEffect(() => {
    viewerScaleRef.current = viewerScale;
  }, [viewerScale]);

  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
  }, [selectedSpaceId]);

  useEffect(() => {
    activeSpaceIdRef.current = activeSpaceId;
  }, [activeSpaceId]);

  useEffect(() => {
    spacesRef.current = spaces;
  }, [spaces]);

  // Phase 35 Plan 03 — sync gate refs.
  useEffect(() => { viewerIdRef.current = viewerId; }, [viewerId]);
  useEffect(() => { documentOwnerIdRef.current = documentOwnerId; }, [documentOwnerId]);

  // ---------------------------------------------------------------------------
  // Container-aware resize: keep Canvas sized to container after zoom changes.
  // Without this, the Canvas stays at its initial dimensions when zooming,
  // causing annotations to shift relative to the SVG/page (same pattern as
  // FabricDrawingCanvas).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = fabricRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const containerWidth = container.offsetWidth;
      if (containerWidth > 0 && pageWidth > 0) {
        const effectiveScale = containerWidth / pageWidth;
        effectiveScaleRef.current = effectiveScale;
        canvas.setZoom(effectiveScale);
        canvas.setWidth(Math.floor(pageWidth * effectiveScale));
        canvas.setHeight(Math.floor(pageHeight * effectiveScale));
        canvas.renderAll();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  // ---------------------------------------------------------------------------
  // Zoom-triggered flush: force-complete in-progress erase gesture on zoom start
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Skip on first render
    if (zoomGeneration === initialZoomGenRef.current) return;

    const canvas = fabricRef.current;
    if (canvas && isErasingRef.current) {
      isErasingRef.current = false;
      try {
        applyEraserAndCommit(canvas);
      } catch (err) {
        console.error('Zoom-triggered eraser flush error:', err);
      }
      eraserPathRef.current = [];
    }
  }, [zoomGeneration]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      data-diag-eraser-wrapper={pageNumber}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        zIndex: 101,
        cursor: isLoading ? 'wait' : 'none',
      }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
});

FabricEraserCanvas.displayName = 'FabricEraserCanvas';

export default FabricEraserCanvas;
