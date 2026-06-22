# Geometry / Math / Hit-Testing Cluster — Fallow Export Audit
**Date:** 2026-06-06
**Method:** grep-based — static imports, re-exports, string usage, git log; no deletions made.

---

## Findings Table

| File | Export (fallow line) | Verdict | Evidence |
|---|---|---|---|
| `src/utils/geometryHitTest.js` | `distanceToLineSegment` (L52) | **KEEP-IN-USE** | Called internally by `isPointNearPolygonStroke`, `isPointOnPath`; those are in the `isPointOnObject` dispatch chain used by `PageAnnotationLayer.jsx:53`, `eraserHitTest.js:9`, `marqueeSelection.js:31`, tests |
| `src/utils/geometryHitTest.js` | `isPointInEllipse` (L92) | **KEEP-IN-USE** | Called internally by `isPointOnCircle` (L458) in the `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointNearEllipseStroke` (L109) | **KEEP-IN-USE** | Called internally by `isPointOnCircle` |
| `src/utils/geometryHitTest.js` | `isPointInPolygon` (L133) | **KEEP-IN-USE** | Called internally by `isPointOnPath` (fill check), `isPointOnPolygon`, `isPointOnGroup` |
| `src/utils/geometryHitTest.js` | `isPointNearPolygonStroke` (L157) | **KEEP-IN-USE** | Called internally by `isPointOnRect`, `isPointOnPolygon` |
| `src/utils/geometryHitTest.js` | `transformPointInverse` (L178) | **KEEP-IN-USE** | Called internally by every `isPointOn*` function to transform to local space |
| `src/utils/geometryHitTest.js` | `getObjectTransformMatrix` (L201) | **KEEP-IN-USE** | Called internally by every `isPointOn*` function |
| `src/utils/geometryHitTest.js` | `isPointOnPath` (L240) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnRect` (L400) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnCircle` (L458) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnLine` (L512) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnTriangle` (L538) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnTextbox` (L593) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnPolyline` (L623) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnPolygon` (L642) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `isPointOnGroup` (L670) | **KEEP-IN-USE** | Part of `isPointOnObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectLineSegment` (L770) | **KEEP-IN-USE** | Called internally by `doesRectIntersectObject` dispatch; `doesRectIntersectObject` imported by `PageAnnotationLayer.jsx:53` and `marqueeSelection.js:31` |
| `src/utils/geometryHitTest.js` | `doesRectIntersectEllipse` (L896) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectPath` (L1012) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectRect` (L1142) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectCircle` (L1439) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectLine` (L1476) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectTextbox` (L1575) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectPolygon` (L1656) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `doesRectIntersectGroup` (L1701) | **KEEP-IN-USE** | Part of `doesRectIntersectObject` dispatch |
| `src/utils/geometryHitTest.js` | `getObjectGeometryBounds` (L1933) | **KEEP-IN-USE** | Called internally by `isObjectFullyInRect`, which is imported by `marqueeSelection.js:31` |
| `src/utils/calloutGeometry.js` | `HANDLE_CLEAR_GAP` (L18) | **KEEP-IN-USE** | Used internally to derive `MIN_KNEE_TO_ARROW_DISTANCE` and `MIN_KNEE_TO_BOX_EDGE_DISTANCE`; those feed `calculateCalloutConnection` imported by 5 files |
| `src/utils/calloutGeometry.js` | `MIN_KNEE_TO_ARROW_DISTANCE` (L23) | **KEEP-IN-USE** | Used internally by `calculateCalloutConnection` |
| `src/utils/calloutGeometry.js` | `MIN_KNEE_TO_BOX_EDGE_DISTANCE` (L26) | **KEEP-IN-USE** | Used internally by `calculateCalloutConnection` |
| `src/utils/calloutGeometry.js` | `MIN_SEGMENT_LENGTH` (L27) | **KEEP-IN-USE** | Used internally by `calculateCalloutConnection` |
| `src/utils/calloutGeometry.js` | `MIN_TEXTBOX_TO_ARROW_DISTANCE` (L30) | **KEEP-IN-USE** | Derived from the two above; no direct external import but public API for callout drag validation |
| `src/utils/calloutGeometry.js` | `findClosestBorderPoint`, `isPointInsideBox`, `isPointOnBorder`, `arePointsStacked`, `distanceToBoxEdge`, `constrainKneePosition` (L635 re-export) | **KEEP-IN-USE** | Internal helpers re-exported for potential external use; they are load-bearing internals of `calculateCalloutConnection` which is imported by 5 live files |
| `src/utils/regionMath.js` | `REGION_OPERATIONS` (L4) | **KEEP-IN-USE** | Imported by `src/RegionSelectionTool.jsx:14` |
| `src/utils/regionMath.js` | `polygonContainsPoint` (L12) | **KEEP-IN-USE** | Called internally by `regionContainsPoint` (L64), which is imported by `PDFViewer.jsx:84` |
| `src/utils/regionMath.js` | `rectangleContainsPoint` (L39) | **KEEP-IN-USE** | Called internally by `regionContainsPoint` (L61) |
| `src/utils/regionMath.js` | `isPointInsideRegionSet` (L67) | **UNCERTAIN** | No external import found in src/, tests/, or agent-cli/. RegionSelectionTool does not use it. Could be intended for future region-based highlighting. |
| `src/utils/regionMath.js` | `mergeOverlappingRegions` (L414) | **UNCERTAIN** | No external import found. RegionSelectionTool has its own inline `mergeRegionWithOverlapping` (L847) that re-implements this logic locally. May be an orphan or a deliberate extract for future reuse. |
| `src/utils/calloutGeometryDiag.js` | `captureFabricCallout` (L226) | **DIAG/DEBUG** | Exported but never imported. FabricEditCanvas does not import it. PDFViewer accesses `window.__calloutGeomBuffer` directly. Intentional diagnostic stub. |
| `src/utils/calloutGeometryDiag.js` | `markDoubleClickEvent` (L453) | **DIAG/DEBUG** | Exported but never imported externally. Diagnostic event recorder for the geom buffer. |
| `src/utils/calloutGeometryDiag.js` | `getCalloutGeomDump` (L466) | **DIAG/DEBUG** | Exported but PDFViewer calls `window.__calloutGeomBuffer.dump()` directly. Convenience wrapper — keep as debugging API. |
| `src/utils/calloutGeometryDiag.js` | `clearCalloutGeomBuffer` (L471) | **DIAG/DEBUG** | Exported but not imported externally. Console-accessible diagnostic utility. |
| `src/utils/lineGeometry.js` | `projectPointToLine` (L56) | **REMOVABLE** | Zero external usages anywhere. Present since Jan 2026 backup; not removed in `ff272116` dead-import sweep. No call site in src/, tests/, agent-cli/, or scripts/. |
| `src/utils/lineGeometry.js` | `getCurveStartAngle` (L145) | **REMOVABLE** | Symmetric counterpart to `getCurveEndAngle` (which IS used in `svgAnnotationRenderers.jsx`, `lineDragMath.js`). `getCurveStartAngle` has zero callers. Introduced for two-headed arrows, never wired. |
| `src/utils/counterGeometry.js` | `getCounterRenderGeometry` (L3) | **KEEP-IN-USE** | Called internally by `updateCounterDragPreview` (same file). `createCounterDragPreview`/`removeCounterDragPreview`/`updateCounterDragPreview` are imported by `PDFViewer.jsx:245`. |
| `src/utils/eraserHitTest.js` | `sampleEraserStroke` (L69) | **KEEP-IN-USE** | Called internally by `eraserStrokeTouchesObject` (same file). `eraserStrokeTouchesObject` is imported by `FabricEraserCanvas.jsx:34` and tested. |
| `src/utils/geometryEraser.js` | `splitPathDataByEraser` (L532) | **REMOVABLE** | Not imported anywhere. `booleanErasePath` is the only exported function actually imported (`PageAnnotationLayer.jsx:54`, `FabricEraserCanvas.jsx:23`). FabricEraserCanvas references it in comments only. L531 comment says "keep for fallback" but no call path exists. |
| `src/utils/handleStyle.js` | `HANDLE_RING_WIDTH` (L32) | **REMOVABLE** | Defined only in `handleStyle.js`. Never imported in any other file. `SVGAnnotationLayer.jsx` imports 5 other `handleStyle` constants but not this one. No usage in RegionSelectionTool, fabricCustomization, calloutGeometry, SVGSelectionOverlay, or useSVGInteraction. |
| `src/utils/menuPositioning.js` | `calculateViewportSafePositionFromElement` (L98) | **REMOVABLE** | Never imported. `PageAnnotationLayer.jsx:56` and `RegionSelectionTool.jsx:15` import only `calculateViewportSafePosition`. The `*FromElement` variant has zero call sites. |
| `src/utils/selectionHandleVisibility.js` | `SIDE_RESIZE_HANDLES` (L14) | **KEEP-IN-USE** | Used internally to build `ALL_RESIZE_HANDLES` at L15, which IS exported and imported by `SVGSelectionOverlay.jsx` and tests. |
| `src/utils/shapeBleedDiagnostics.js` | `captureAllShapes` (L129) | **DIAG/DEBUG** | Registered as `window.__captureAllShapes` and bound to Cmd+Shift+D hotkey within the module (side-effect import via `main.jsx:339`). No ES module import of this export. Diagnostic global — keep. |
| `src/utils/shapeBleedDiagnostics.js` | `isShapeSpyOn` (L317) | **DIAG/DEBUG** | Exported but never imported. Programmatic query hook for spy state. Diagnostic API — keep. |
| `src/utils/calloutHistoryScope.js` | `getCalloutHistoryId` (L11) | **KEEP-IN-USE** | Called internally by `scopeCalloutsForHistoryRestore` (L53, L61, L83). That function is called by `scopeHistoryStateForCalloutRestore`, which is imported by `PDFViewer.jsx:88`. |
| `src/utils/calloutHistoryScope.js` | `getCalloutHistoryAuthorId` (L15) | **KEEP-IN-USE** | Called internally by `isOwnCallout` (same file), called by `scopeCalloutsForHistoryRestore`. |
| `src/utils/calloutHistoryScope.js` | `scopeCalloutsForHistoryRestore` (L40) | **KEEP-IN-USE** | Called internally by `scopeHistoryStateForCalloutRestore` (L104), which is imported by `PDFViewer.jsx:88`. |
| `src/utils/surveyMarkerType.js` | `LEGACY_SURVEY_MARKER_TYPE` (L11) | **KEEP-IN-USE** | Used internally by `isSurveyMarkerType` (L18) and to build `SURVEY_MARKER_TYPE_VALUES` (L14). Both are imported by multiple live files. |

---

## Summary by Verdict

| Verdict | Count |
|---|---|
| KEEP-IN-USE | 42 |
| DIAG/DEBUG | 6 |
| UNCERTAIN | 2 |
| REMOVABLE | 4 |
| **Total exports investigated** | **54** |

---

## REMOVABLE Exports (4)

These have **zero reachability** across src/, tests/, agent-cli/, and scripts/:

| Export | File | Evidence of Absence |
|---|---|---|
| `projectPointToLine` | `src/utils/lineGeometry.js:56` | No import in any file. Only definition is in lineGeometry.js. Present since Jan 2026 backup; not removed in dead-import sweep `ff272116`. |
| `getCurveStartAngle` | `src/utils/lineGeometry.js:145` | `getCurveEndAngle` IS used (svgAnnotationRenderers.jsx, lineDragMath.js). `getCurveStartAngle` has zero callers anywhere. Introduced for two-headed arrows, never wired up. |
| `splitPathDataByEraser` | `src/utils/geometryEraser.js:532` | Only `booleanErasePath` is imported. FabricEraserCanvas mentions `splitPathDataByEraser` in comments only, never calls it. L531 comment says "keep for fallback" but no call path exists in the codebase. |
| `calculateViewportSafePositionFromElement` | `src/utils/menuPositioning.js:98` | Zero imports. Both call sites (`PageAnnotationLayer`, `RegionSelectionTool`) use only `calculateViewportSafePosition`. |

---

## UNCERTAIN Exports (2) — Do Not Delete Without Investigation

| Export | File | Reason |
|---|---|---|
| `isPointInsideRegionSet` | `src/utils/regionMath.js:67` | No external import found. RegionSelectionTool uses its own inline overlap logic. Could be intended for future region highlight checks or is an orphan from a prior refactor. |
| `mergeOverlappingRegions` | `src/utils/regionMath.js:414` | No external import found. RegionSelectionTool has a local duplicate (`mergeRegionWithOverlapping` L847). May be deliberate extract for future reuse or an orphan. |

---

## Notes on Fallow False-Positive Patterns

1. **geometryHitTest dispatch table:** Every `isPointOn*` and `doesRectIntersect*` sub-function is flagged because fallow traces static imports only, not internal call chains. The actual external consumers import only the two top-level dispatchers (`isPointOnObject`, `doesRectIntersectObject`). All 26 flagged geometryHitTest exports are false positives.

2. **Diagnostic files:** `calloutGeometryDiag.js` and `shapeBleedDiagnostics.js` expose functions called via `window.*` globals or side-effect imports — intentionally not ES-module-imported. Their unimported exports are by design.

3. **Internal helpers exported as public API:** `calloutHistoryScope.js` exports `getCalloutHistoryId`, `getCalloutHistoryAuthorId`, and `scopeCalloutsForHistoryRestore` as public symbols even though no external file imports them directly; they are called within the same file's internal chain under the top-level `scopeHistoryStateForCalloutRestore` function. Fallow sees no external import; they are false positives.

4. **Constants used only internally:** `HANDLE_CLEAR_GAP`, `MIN_*` constants in calloutGeometry.js, `LEGACY_SURVEY_MARKER_TYPE`, `SIDE_RESIZE_HANDLES`, `getCounterRenderGeometry`, `polygonContainsPoint`, `rectangleContainsPoint`, `sampleEraserStroke` are all internal building blocks exported as public API surface. All are reachable through the call chain from externally-imported functions.
