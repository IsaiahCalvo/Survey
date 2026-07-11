# PDF.js Feature Demo Parity Handoff

Date: 2026-07-09  
Owner target: next AI/agent

## How To Use This Document

This is a guide, not a verdict. Treat every finding below as a starting hypothesis that must be verified against the current code and rendered app behavior before implementation.

The next agent should take the lead:

- investigate whether each claim is still true
- identify root causes, not just symptoms
- look for gaps not listed here
- decide the safest implementation path
- add tests before or alongside fixes
- optimize the app for the real production experience, using the demo as the zoom/overlay reference

If the investigation disproves part of this handoff, update the plan and proceed with the better evidence.

## Mission

Make the production PDF viewer feel and behave like the reference demo at:

`http://localhost:5173/?spike=features`

Primary user complaint: the demo zoom feels better than the app. Production appears to already have much of the same pdf.js engine, but extra app integration code may make zoom/overlays/edit surfaces feel worse. Verify this before changing code.

Do not treat the demo as perfect. It is the zoom/overlay reference, but it has at least one known feature bug listed below.

## Reference Routes

- Demo/reference: `http://localhost:5173/?spike=features`
- Current app test route: `http://localhost:5173/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`
- Fixture: `debug/fixtures/Package 2 - Rev 4 -- IC.pdf`
- Prior rendered audit evidence: `/tmp/betasafe-pdf-audit-20260709/audit-results.json`

## Current Hypotheses To Verify

### Demo May Be Better At

- Simple cursor-anchored zoom contract.
- One transformed content stack.
- Page overlays live directly in the page/content stack.
- `scale` is committed layout/raster scale.
- `liveZoom` is transient CSS-only scale during gesture.
- Wheel updates are rAF-coalesced.
- Commit after 110ms.
- Overlays/text/forms/markups ride the same transform during live zoom.
- Bookmarks and find work on the package fixture.

### App May Be Better At

- Full production editing tools.
- Toolbar/page navigation.
- Existing PDF.js cutover container.
- Real app annotation, text, form, search, bookmark integration.
- Basic zoom works on `?testPdf` route.
- App overlay page bbox matched PDF page bbox within about 0.5px in the audit.

### Known Demo Bug

On the `Annotation test` fixture, demo links are broken:

`TypeError: vp.convertToViewportRectangle is not a function`

Likely file: `src/prototype/SpikeLinkLayer.jsx`

Do not copy this bug into production. Fix or avoid it if touching demo link parity.

## Main Suspected Gap

Production appears to have the same zoom engine shape in `src/components/PdfjsViewerContainer.jsx`, but `src/PDFViewer.jsx` wraps it with extra state and legacy coordination:

- parent scale/page-container state can lag engine state
- `onZoomChanged` is disabled
- `onPageContainersChange` is disabled
- app manually probes page containers and overlay geometry
- legacy overlay freeze/proxy/snapshot logic still exists around zoom
- toolbar/keyboard zoom can still use older coordination paths
- Fabric drawing/erasing/editing surfaces are separate canvas layers, not pure SVG

Suspected result: core zoom may be correct, but production feels worse because app-layer overlays/tools do not follow the clean demo contract. Confirm with rendered tests and source inspection.

## Key Files

### Zoom Engine

- `src/prototype/PdfjsArm.jsx`
- `src/components/PdfjsViewerContainer.jsx`

Important production areas:

- wheel gesture and settle: `PdfjsViewerContainer.jsx`
- content transform: `PdfjsViewerContainer.jsx`
- overlay host: `getOverlayHost()`
- bookmarks: `extractPdfOutlineBookmarks()` path inside `PdfjsViewerContainer.jsx`

### App Integration

- `src/PDFViewer.jsx`
- `src/components/PdfjsTextLayer.jsx`
- `src/components/PdfjsLinkLayer.jsx`
- `src/components/PdfjsFormLayer.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `src/components/LightweightAnnotationOverlay.jsx`

Important production areas:

- `PDFViewer.jsx` around `PdfjsViewerContainer` mount
- `attachOverlayToPageDiv()`
- `handlePdfjsZoomPhase()`
- toolbar/keyboard zoom path
- `pdfjsCommittedPageScales`
- `pdfjsInteractionPhase`
- `zoomOverlayTransformActiveRef`
- `pdfjsOverlayTransformRatioByPageRef`

### Drawing / Erasing

- `src/components/FabricDrawingCanvas.jsx`
- `src/components/FabricEraserCanvas.jsx`
- `src/utils/geometryEraser.js`
- `src/utils/eraserHitTest.js`
- `src/utils/svgPathAttrs.js`
- `src/utils/svgAnnotationRenderers.jsx`
- `src/services/annotationTypeSerializers.js`

## Required Work

Before implementing, validate the current state. Do not assume this list is complete.

### 1. Make Production Zoom Match Demo Feel

Goal: production wheel zoom should use the demo contract, with app overlays riding the engine transform without parent-side chasing.

Tasks:

- Re-enable or replace `onZoomChanged` plumbing so `PDFViewer.jsx` receives committed engine scale immediately.
- Re-enable or replace `onPageContainersChange` so overlay page/container state is engine-owned, not stale/probed.
- Audit and reduce legacy zoom paths in `PDFViewer.jsx`:
  - freeze/proxy/snapshot state
  - `zoomOverlayTransformActiveRef`
  - parent-side overlay transform loops
  - old toolbar/keyboard zoom coordination
- Keep overlays under `PdfjsViewerContainer.getOverlayHost()` so they ride the engine content transform.
- Avoid per-frame overlay repositioning during scroll/zoom.
- Ensure toolbar zoom, keyboard zoom, and wheel zoom all converge to the same engine path.

Acceptance:

- Ctrl/meta wheel feels like demo.
- No snap-back.
- Cursor point stays anchored.
- App toolbar zoom percent updates immediately after settle.
- Page overlays stay locked during live zoom and after settle.
- No extra overlay scale transform remains after settle.
- Forms, text selection, search highlights, links, bookmarks, annotations still work.

### 2. Preserve Editability While Using Demo Overlay Contract

Goal: app annotations still editable, but visual surfaces stay page-locked like demo.

Tasks:

- Keep SVG annotations in page-space `viewBox`.
- Keep Fabric draw/edit/erase canvases sized by page container width, but verify they inherit same page/content transform.
- Flush active Fabric work before zoom re-layout via `zoomGeneration`.
- Remove any duplicate scale compensation that can double-scale or lag.
- Confirm per-page overlay div dimensions exactly match `.survey-pdfjs-page-div`.

Acceptance:

- Draw pen/highlighter before and after zoom.
- Select/move/resize annotations before and after zoom.
- Form widgets stay aligned.
- Search highlights stay aligned.
- Bookmarks jump to correct page.
- No annotation disappears during page virtualization.

### 3. Fix Partial Erase To Match Job Board PDF Behavior

User expectation: clipping only the edge of a pen stroke should cut a semicircle/crescent bite into the stroke. It should not remove the full eraser-width/circumference through the stroke unless the eraser actually crosses that area.

Current behavior:

- `FabricEraserCanvas.jsx` collects eraser points from Fabric.
- Radius is computed as `eraserSize * (viewerScale / effectiveScale)`.
- `geometryEraser.js` converts stroked path centerline to filled ribbon polygon.
- It subtracts a union of 16-sided eraser disks with Martinez.
- Result is persisted as filled outline: `strokeWidth=0`, `fill=originalStroke`.

Likely problems:

- radius may be wrong or double-compensated when `viewerScale` and `effectiveScale` diverge
- stroke outline lacks true round caps/joins
- eraser disk is low-resolution 16-gon
- boolean erase uses raw pointer disks, not the same densified swept stroke as hit testing
- repeat erase on filled outlines/hole rings may mis-hit
- non-uniform transform only uses `scaleX`

Tasks:

- Add geometry tests before changing algorithm.
- Verify radius in page units at 80%, 200%, 500%.
- Implement robust visible-ink outline:
  - true round caps
  - true round joins
  - correct stroke width
  - support imported and internal paths
- Subtract swept eraser geometry, not just sparse raw points.
- Increase disk/capsule resolution or use a better geometry library.
- Preserve fill-rule/hole behavior after repeated erases.

Research candidates:

- Existing `martinez-polygon-clipping`: keep if outline/swept geometry can be fixed.
- Clipper2 / `clipper2-ts`: likely best next option for offsetting + boolean ops.
- Paper.js boolean ops: good model but heavier dependency/integration.
- Mask/stencil approach: keep original path plus persisted eraser masks, render via SVG mask/clipPath; flatten later for export.

Acceptance:

- Edge clip makes visible crescent bite.
- Centerline-crossing eraser splits/cuts as expected.
- Repeat erase works.
- Imported PDF ink and native app pen behave the same.
- Undo restores exact pre-erase geometry.
- Sync/history precise changed/deleted IDs still work.

### 4. Fix Live Stroke vs Released Stroke Parity

User sees strokes thicker while pointer is down than after release.

Current pipeline:

- Live draw: Fabric `PencilBrush` on Canvas2D.
- Commit: Fabric object serialized, then Fabric path removed.
- Final visual: SVG path via `renderPath()` and `renderPathToSvgAttrs()`.

Likely causes:

- Canvas2D vs SVG rasterizer difference
- Fabric zoom/retina scaling vs SVG viewBox scaling
- highlighter live path does not use final multiply blend until after commit
- `strokeUniform` / `vectorEffect` policy differs between imported/native/erased paths
- erased strokes become filled outlines instead of stroked paths

Tasks:

- Define a single stroke visual contract for pen/highlighter.
- Match Fabric live brush caps/joins/blend to final SVG attrs.
- Consider hiding live Fabric visual and rendering live stroke through SVG preview if Fabric cannot match.
- Confirm highlighter live uses multiply or an equivalent visual.
- Remove `flushSync` warning if possible:
  - current warning from `FabricDrawingCanvas.jsx`
  - `Warning: flushSync was called from inside a lifecycle method`

Acceptance:

- Screenshot diff: live pointer-down stroke and released stroke same thickness.
- Pen and highlighter both pass.
- At 80%, 200%, 500% zoom.
- No blank frame between Fabric removal and SVG commit.

### 5. Fix Demo Link Layer Or Port Production Link Layer

Demo link fixture currently errors.

Tasks:

- Fix `SpikeLinkLayer.jsx` API usage for current pdfjs-dist.
- Or replace demo link handling with production `PdfjsLinkLayer` if compatible.

Acceptance:

- `?spike=features` with `Annotation test` shows clickable `<a>` overlays.
- No console error.
- Link rectangles align after zoom.

## Required Tests

Add tests before/with implementation:

- zoom wheel parity e2e: demo vs app route
- toolbar zoom parity e2e
- overlay bbox parity after wheel zoom
- bookmark detection + jump
- find/search highlight alignment
- forms alignment through zoom
- link overlay alignment through zoom
- draw live vs final screenshot diff
- highlighter live vs final screenshot diff
- partial erase crescent geometry unit test
- partial erase radius across zoom e2e
- repeat erase hole/ring test
- undo after partial erase restores original stroke

Useful existing tests:

- `tests/eraserHitTest.test.mjs`
- `tests/eraserSaveHistorySyncContracts.test.mjs`
- `tests/pdfAnnotationNormalization.test.mjs`
- `debug/scenarios/pal-zoom.spec.mjs`
- `debug/scenarios/overlay-attachment.spec.mjs`
- `debug/scenarios/zoom-flicker.spec.mjs`
- `debug/scenarios/annotation-draw-render.spec.mjs`

## Validation Commands

Use current repo scripts:

```bash
npm run test
npm run build
npm run test:debug -- --grep "zoom|overlay|annotation|eraser"
```

For manual/browser validation:

```text
http://localhost:5173/?spike=features
http://localhost:5173/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf
```

## Implementation Order

Recommended starting order, subject to investigation:

1. Reproduce and measure the zoom feel gap.
2. Verify or falsify the suspected stale parent scale/page-container state issue.
3. Add failing tests for confirmed gaps.
4. Fix production zoom state plumbing and remove stale overlay chasing if confirmed.
5. Validate overlays/edit tools through zoom.
6. Fix demo link layer or align it to production if still relevant.
7. Fix live stroke/final stroke parity if confirmed.
8. Fix partial erase geometry.
9. Run full rendered QA.

## Non-Negotiables

- Do not remove `src/prototype/` or `?spike=features`.
- Do not degrade annotation editability.
- Do not hide bugs with screenshots only; add geometry/unit tests for eraser.
- Do not copy legacy Pdfjs zoom compensation back into pdf.js engine path.
- Do not make overlays chase scroll/zoom per frame if they can ride the engine transform.
- Do not assume the demo is correct for links.

---

## 2026-07-09 Investigation Addendum (verified against code + rendered app)

Findings that CORRECT the hypotheses above:

- **Overlay transform chasing: NOT the problem.** App overlays already mount inside `getOverlayHost()` and ride the engine transform (verified live, frame-by-frame). The legacy chase/freeze/proxy/snapshot system is dead-by-default behind hard `if (true) return` guards and never engages on the wheel path.
- **Real staleness mechanism:** with `onZoomChanged`/`onPageContainersChange` wired to `undefined`, committed zoom reached app state ONLY via DOM remeasure after `onPageRendered` — and raster-cache hits never fire it. Fixed by wiring slim handlers (`handlePdfjsEngineZoomCommitted` → existing reconcile; container refresh queue). Result: toolbar % updates ~instantly at settle (was stuck), and the measured settle hitch (112ms worst frame, 79ms long task) dropped to ZERO dropped frames — demo-parity on frame metrics. Guarded by `tests/pdfjsZoomCommitWiring.test.mjs`.
- **Links were broken in PRODUCTION too, silently:** pdfjs-dist 6.1.200 removed `convertToViewportRectangle`; `PdfjsLinkLayer` swallowed the TypeError and rendered zero links everywhere. Demo (`SpikeLinkLayer`) just errored loudly on the same call. Both fixed via `convertToViewportPoint` on both rect corners; verified rendering clickable boxes on `clickable-link-test.pdf` (app + demo).
- **Eraser "oversized cuts" root causes (all fixed in `geometryEraser.js`, tests in `tests/geometryEraserPartialErase.test.mjs`):** sparse raw-point 16-gon disks with NO swept capsule (fast swipes tunneled/beaded — a crossing drag could even miss the centerline entirely), butt-cap/miter ribbon vs round-cap rendering, scaleX-only radius under non-uniform transforms (now: world-space capsules inverse-transformed per-vertex), and repeat-erase treating hole rings as solid polygons (now grouped into polygons-with-holes).
  **NOTE:** branch `claude/eraser-live-feedback` (3 commits, awaiting push) REPLACES the boolean path with `src/utils/inkEraser.js` exact capsules for stroked ink. No file overlap with this work; after both merge, geometryEraser still owns legacy already-outlined (fill-ribbon) objects, where these fixes still apply.
- **Live vs final stroke width: the scale math is provably symmetric** (Fabric CTM zoom vs SVG viewBox — identical at any zoom). The real, fixable mismatch was the HIGHLIGHTER: live brush painted source-over while committed SVG uses multiply — fixed by `mix-blend-mode: multiply` on the drawing canvas's upper canvas while the highlighter is armed. Pen residual difference is the documented Canvas2D-vs-SVG rasterizer gotcha (CLAUDE.md 2026-04-10) — do not chase.
- **Stale-spec warning:** `pal-zoom` ZOOM-09, both `overlay-attachment` tests, and `zoom-flicker` wait for `.survey-pdfjs-viewer-container`, which no code renders — they fail on every branch. `annotation-draw-render` is the live guard (passes).
- `flushSync` warning in FabricDrawingCanvas intentionally kept: it prevents the blank frame between Fabric preview removal and SVG commit.
