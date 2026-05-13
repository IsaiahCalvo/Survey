# Annotation Fix 13: PDF Import Fidelity and Duplicate Native Rendering

Date: 2026-05-11

## Files Inspected

- `src/utils/pdfAnnotationImporter.js`
- `src/utils/svgAnnotationRenderers.jsx`
- `src/utils/svgPathAttrs.js`
- `src/utils/svgBoundingBox.js`
- `src/App.jsx`
- `src/components/SyncfusionPDFContainer.jsx`
- `src/services/annotationTypeSerializers.js`
- `src/lib/collab/crdtDedupePdfImports.js`
- `tests/pdfAnnotationImporter.test.mjs`

Evidence files saved under `test-logs/annotation-fix-13/`.

## Raw Annotation Inventory

Full machine-readable inventory: `test-logs/annotation-fix-13/raw-page1-inventory.json`.

### `/Users/isaiahcalvo/Desktop/New document.pdf`, page 1

PDF.js reports 3 annotations:

1. `8R`, `Polygon`
   - Rect: `[165.058, 510.986, 429.757, 814.033]`
   - Stroke `/C`: red `[0.980392, 0.196078, 0.215686]`
   - Fill `/IC`: red `[0.980392, 0.196078, 0.215686]`
   - Opacity: `/CA 1`, `/ca 0.301961`
   - Border: `/BS /S`, width `3`; `/Border [0, 0, 3]`
   - Vertices: 9 points
   - `/BE /S /C`: cloudy border
   - `/AP /N`: present, FlateDecode, decoded length `13525`, `w 3`, red stroke/fill, fill operation present

2. `12R`, `PolyLine`
   - Rect: `[179.132, 200.45, 393.543, 429.791]`
   - Stroke `/C`: red `[0.980392, 0.196078, 0.215686]`
   - Fill: none
   - Opacity: `/CA 1`
   - Border: width `3`; `/Border [0, 0, 3]`
   - Vertices: 4 points
   - `/AP /N`: present, decoded length `159`, `w 3`, red stroke

3. `16R`, `Ink`
   - Rect: `[52.5692, 48.4692, 501.126, 398.847]`
   - Stroke `/C`: red `[0.980392, 0.196078, 0.215686]`
   - Opacity: `/CA 1`
   - Border: width `5`; `/Border [0, 0, 5]`
   - InkList: 246 points
   - `/AP /N`: present, decoded length `21989`, red fill color and black stroke color in the appearance stream, no rectangle `re` operators

### `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`, page 1

PDF.js reports 9 annotations: 2 renderable markups and 7 hidden popup companions.

Raw `/Annots` has 10 entries. The first raw entry is a form XObject-like non-annotation object that PDF.js ignores. The meaningful renderable annotations are:

1. `4540R`, `Ink`
   - Rect: `[329.375, 83.5956, 822.607, 264.363]`
   - Stroke `/C`: red `[0.980392, 0.196078, 0.215686]`
   - Opacity: `/CA 1`
   - Border: width `5`; `/Border [0, 0, 5]`
   - InkList: 223 points
   - `/AP /N`: present, decoded length `19554`, red fill color and black stroke color in the appearance stream

2. `4549R`, `Polygon`
   - Rect: `[92.3104, 261.312, 461.196, 710.153]`
   - Stroke `/C`: red `[0.980392, 0.196078, 0.215686]`
   - Fill `/IC`: red `[0.980392, 0.196078, 0.215686]`
   - Opacity: `/CA 1`, `/ca 0.301961`
   - Border: width `3`; `/Border [0, 0, 3]`
   - Vertices: 8 points
   - `/BE /S /C`: cloudy border
   - `/AP /N`: present, decoded length `16109`, `w 3`, red stroke/fill, fill operation present

The 7 popup annotations have no appearance stream and are ignored as companion annotations.

## Existing App Behavior Before Fix

Screenshots:

- `test-logs/annotation-fix-13/new-document-all.png`
- `test-logs/annotation-fix-13/new-document-native-only.png`
- `test-logs/annotation-fix-13/new-document-app-only.png`
- `test-logs/annotation-fix-13/se011-all.png`
- `test-logs/annotation-fix-13/se011-native-only.png`
- `test-logs/annotation-fix-13/se011-app-only.png`

Findings:

- Syncfusion renders embedded PDF annotation appearances into `.e-pv-annotation-canvas`.
- The app imports the same embedded annotations into SVG/Fabric objects.
- With both layers visible, Drawboard annotations are duplicated.
- For `New document.pdf`, hiding app SVG leaves the native PDF annotations visible; hiding Syncfusion annotation canvas leaves only the editable app copies.
- For SE-011, hiding app SVG leaves the thin black squiggle visible. That proves the black squiggle is native Syncfusion/PDF appearance rendering, not the app SVG annotation layer.
- For SE-011, the app imports `4540R` as a red editable path and `4549R` as a red translucent cloud polygon.
- For SE-011, native-only rendering does not show the polygon; app-only rendering does. The “missing polygon” is not lost by the importer.
- The Drawboard ink appearance stream does not contain rectangle operators, so the reported red square/bounding-box artifact is not a literal rectangle in the Ink `/AP` stream.

## Root Causes

1. Duplicate rendering: embedded PDF annotations with appearance streams were rendered natively by Syncfusion and also imported/rendered by the app as editable SVG/Fabric annotations.
2. SE-011 black squiggle: Syncfusion rendered the Ink `/AP` appearance as a thin black native canvas stroke. The app also had a red imported copy, but the native black canvas remained visible underneath/alongside it.
3. SE-011 polygon: the raw PDF contains polygon `4549R`; the importer converted it to an app polygon/cloud. Syncfusion native rendering did not visibly render the polygon in the native-only screenshot.
4. App-created annotations were not the problem; this is specific to embedded PDF annotation appearances that also get imported.

## Source-of-Truth Decision

For this app, imported embedded PDF annotations should become editable app annotations. When that import succeeds for every renderable embedded annotation on a page, the app SVG/Fabric layer should be the visible source of truth and the native Syncfusion annotation canvas for that page should be hidden.

The code does not hide native PDF annotation rendering blindly. If a page contains a renderable embedded annotation that the app did not import, the native canvas stays visible so unsupported content is not lost.

## Diagnostics Added

The importer now publishes:

- `window.__pdfEmbeddedAnnotationDiag`
- `window.__pdfImportedAnnotationDiag`
- `window.__nativePdfAnnotationLayerDiag`

Diagnostics include:

- raw annotation id/subtype/rect/color/fill/opacity/border/vertices/ink lists/appearance summary
- import status per annotation
- app object type, `pdfAnnotationId`, stroke/fill/stroke width, path/point counts, selectability
- page-level native-layer decision: hide or keep visible, with reason

After manual test:

- `New document.pdf` page 1: native layer hidden because imported IDs `8R`, `12R`, `16R` match all native renderable IDs.
- SE-011 page 1: native layer hidden because imported IDs `4540R`, `4549R` match all native renderable IDs.

## Code Changed

- `src/utils/pdfAnnotationImporter.js`
  - Added raw/import/native-layer diagnostics.
  - Added `nativeLayerPolicyByPage`.
  - Added `diagnosticsOnly` mode for cloud/Y.Doc-authoritative documents.
  - Added native renderability check: only appearance-backed, non-companion annotations can require native canvas preservation.

- `src/App.jsx`
  - Stores `pdfNativeAnnotationLayerPolicyByPage`.
  - Exposes resolved runtime native-layer diagnostics on `window.__nativePdfAnnotationLayerDiag`.
  - Hides only the specific Syncfusion annotation canvas for a page, and only when all required imported PDF annotation IDs are present in app state.
  - Leaves native canvases visible on pages with no proven editable replacement.

- `tests/pdfAnnotationImporter.test.mjs`
  - Added tests for safe native-layer hiding when every renderable annotation imports.
  - Added tests proving native stays visible when a renderable unsupported annotation exists.

## Why The Fix Is Safe

- It only targets Syncfusion annotation canvases named for the current page, not the PDF page image/canvas or text layer.
- It requires an importer policy saying all renderable native annotations were imported.
- It also requires the matching imported app copies to be present in `annotationsByPage`.
- Unsupported renderable annotations keep the native layer visible.
- App-created annotations are unaffected.
- No Supabase cleanup, deletion, or destructive data migration was run.

## Test Results

Commands run:

- `npm test -- tests/pdfAnnotationImporter.test.mjs`
  - The package script ran the full Node test suite.
  - Result: `575 pass`, `6 skipped`, `0 fail`.

- `npm run build`
  - Result: passed.
  - Warnings only: existing PDF.js eval warning, existing large chunk warnings, existing dynamic/static import chunk warnings.

Invalid command:

- `node --check src/App.jsx`
  - Not valid for `.jsx` in this repo under Node; failed with `ERR_UNKNOWN_FILE_EXTENSION`.
  - Replaced by `npm run build`, which passed JSX/Vite compilation.

## Manual Browser Results

Manual browser output after fix:

- `test-logs/annotation-fix-13/new-document-after.png`
- `test-logs/annotation-fix-13/new-document-after-diag.json`
- `test-logs/annotation-fix-13/se011-after.png`
- `test-logs/annotation-fix-13/se011-after-diag.json`

`New document.pdf`:

- Page 1 shows the polygon/cloud, polyline, and ink once.
- Syncfusion `annotationCanvas_0` is `visibility: hidden` and `pointer-events: none`.
- App imported annotations are present:
  - `8R` polygon/cloud, selectable app object
  - `12R` polyline, selectable app object
  - `16R` ink path, selectable app object

SE-011:

- Page 1 no longer shows the thin black native squiggle.
- Page 1 shows the red app ink path and red translucent cloud polygon.
- Syncfusion `annotationCanvas_0` is `visibility: hidden` and `pointer-events: none`.
- App imported annotations are present:
  - `4540R` ink path, selectable app object
  - `4549R` polygon/cloud, selectable app object

## Remaining Uncertainty

- Syncfusion’s exact internal reason for painting the SE-011 Ink appearance as thin black is inside its native annotation canvas renderer. The evidence proves the black squiggle comes from that layer, and the raw appearance stream contains black stroke color plus red fill color.
- Some later pages in SE-011 contain imported non-renderable annotation data with no native appearance. The policy leaves their native canvases visible because there is no renderable native annotation to suppress.
