# React Performance Audit - PDF.js Mobile Path - 2026-06-13

## Decision

Mobile field survey performance is now the priority. Optimize the owned PDF.js path, not Syncfusion. Syncfusion should not block React performance work because the target is to remove it.

## Tooling Added

- Installed `react-scan` as a dev dependency.
- Added an opt-in dev bootstrap before the app entry:
  - Enable: `?reactScan=1`
  - Disable: `?reactScan=0`
  - Persisted key: `localStorage.reactScan`
- Production build does not include the React Scan runtime. `npm run build` passed after this change.

## Strategic Calls

- React Scan: use now. It gives visible render fanout while using the actual PDF.js/mobile workflow.
- React Compiler: do not enable globally yet. First split the 35k-line viewer hot path and remove obvious unstable props. Then run compiler diagnostics/spike against the PDF.js route.
- Million.js: do not install broadly. Use its ideas, not the package, until React Scan shows a simple repeated list hotspot. The PDF page overlay path uses portals, canvas, refs, and imperative PDF rendering, which is a poor first Million target.

## Findings

### P0 - Page overlay render fanout

`src/PDFViewer.jsx` builds page overlay portals inside the main component render path around `contentPageNumbers` and `createPortal` (`src/PDFViewer.jsx:27536`). This path reads whole-app state, builds a `Set`, filters, sorts, maps, reads DOM refs, computes scale/annotation/form/search state, and renders PDF.js link/form/text layers.

Risk: one annotation/form/search/tool update can make the whole viewer recompute page overlay work. On tablet/phone, that is the likely lag source.

Fix: extract a memoized `ViewerPageOverlay` or `PdfjsPageInteractiveLayers` component. Pass page-scoped primitives and stable callbacks. Compare by page number, page size, layer scale, active tool, search revision, annotation revision, and form revision.

### P0 - Whole-document annotation state

`annotationsByPage` is a whole-document React state object (`src/PDFViewer.jsx:3784`). Many memos/effects depend on the entire object. Page render uses `annotationsByPage[pageNumber]` but the dependency is still the whole document.

Risk: editing one page can re-render unrelated pages and shared panels.

Fix: add page-level revisions/selectors before optimizing deeper. Keep refs for imperative save/export paths, but make React render depend on `pageAnnotationRevision[pageNumber]` and the page slice.

### P0 - PDF engine branching stays in the hot JSX

`getPDFViewerEngine()` is called repeatedly in the viewer JSX and page map (`src/PDFViewer.jsx:27509`, `src/PDFViewer.jsx:27572`, `src/PDFViewer.jsx:27619`, `src/PDFViewer.jsx:27633`, `src/PDFViewer.jsx:27825`).

Risk: small alone, but it keeps Syncfusion/pdf.js logic interleaved and makes compiler/memo work weaker.

Fix: compute `isPdfjsEngine` once for render. Longer term, split Syncfusion and PDF.js page overlay code so the PDF.js route is not carrying Syncfusion conditions.

### P1 - PDF.js layer props are unstable

`PdfjsLinkLayer` and `PdfjsFormLayer` receive inline callbacks inside the page map (`src/PDFViewer.jsx:27856`, `src/PDFViewer.jsx:27866`). `pageFormFieldValues` is filtered/mapped per page per render (`src/PDFViewer.jsx:27619`).

Risk: layers re-render even when the page content did not change.

Fix: precompute `formValuesByPage` with a memo/revision. Use stable callbacks that accept `{ pageNumber, payload }` or wrap inside the extracted page component.

### P1 - Rasters are virtualized, overlays are less isolated

`PdfjsViewerContainer` mounts raster canvases only for the current range (`src/components/PdfjsViewerContainer.jsx:901`). That is good. The app overlay host is stable (`src/components/PdfjsViewerContainer.jsx:944`), but the parent portal logic can still render broader page work based on annotations/search/current page.

Risk: good PDF.js raster behavior can still feel slow because overlay React work is not equally isolated.

Fix: align overlay mounting with visible/near-visible page range, plus required active editing page. Use React Scan to confirm only visible pages update during pan/zoom.

### P2 - React Compiler readiness

The current viewer has extensive mutable refs, imperative DOM operations, inline style objects, and large mixed responsibilities. Compiler can help later, but it will not rescue this structure by itself.

Fix: after the P0/P1 split, add a compiler diagnostics spike against React 18 with the required runtime. Enable only for the PDF.js/dev route first.

### P2 - Million.js candidates

Good candidates are simple repeated rows, not the PDF page surface: project trees, search rows, template rows, survey tables, or sidebars if React Scan flags them.

Do not apply Million to `PdfjsFormLayer`, `PdfjsLinkLayer`, `PageAnnotationLayer`, or portal/page canvas code until measurements prove a narrow safe target.

## Next Implementation Phase

1. Add `isPdfjsEngine` once per render and replace repeated `getPDFViewerEngine()` checks in the hot JSX.
2. Extract memoized `PdfjsPageInteractiveLayers` from the page portal.
3. Precompute page form values and page annotation revisions.
4. Make overlay render depend on page slices, not the whole `annotationsByPage` object.
5. Run React Scan on `?reactScan=1` with `localStorage.pdfViewerEngine = 'pdfjs'` through open, pan, zoom, annotation draw/edit, search, and form edit.

## Success Signal

During normal field use, React Scan should show updates isolated to the active/visible page layers and tool chrome. Editing one annotation should not light up every page overlay or the whole viewer tree.
