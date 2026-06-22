# Handoff — Stage 4.3 form-field VALUE persistence (pdf.js cutover)

**Created:** 2026-06-02. Focused handoff for the ONE remaining piece of the forms+links work.
**Branch:** `main` (local-only, direct-to-main; uncommitted working tree — user tests on the symlinked dev server).
**Preview:** dev server :5173 → `http://localhost:5173/?testPdf=clickable-link-test.pdf&pdfEngine=pdfjs` (this fixture has a text field + checkbox + a link + rich imported markups — ideal for testing).

## GOAL
Make filled form-field VALUES persist "like all other annotations": save to the user's account (Supabase),
survive reload, and sync via Yjs. The user explicitly authorized a Supabase change for this.

## ALREADY DONE (this session, runtime-verified, npm test 840/0/6, build clean)
- **Links** — `src/components/PdfjsLinkLayer.jsx` (new): clickable hyperlinks under pdf.js. External URLs →
  `window.electronAPI.openExternal` (window.open fallback); internal dests → `resolvePdfOutlinePageNumber` →
  `goToPage(n,{fallback:'nearest'})`. Page-fraction % positioning (rides zoom, no scale prop). Verified live.
- **Form DISPLAY** — `src/components/PdfjsFormLayer.jsx` (new): pdf.js `AnnotationLayer` `renderForms:true`
  filtered to `Widget` → real interactive text/checkbox/radio/select bound to `pdf.annotationStorage`;
  `/ReadOnly` honored by pdf.js. Verified live (text input + checkbox render + interactive).
  - It ALREADY exposes `onFieldChange/onFieldFocus/onFieldBlur({fieldId, value, element})` via DOM listeners on
    the rendered inputs (currently NOT passed from PDFViewer — that's the persistence hook for Step 3 below).
    `fieldId` = the rendered `<section data-annotation-id>`.
- Both mounted in PDFViewer's per-page overlay portal next to `SearchHighlightLayer` (~`PDFViewer.jsx:25347`),
  guarded by `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS && pdfDoc`, using PDFViewer's own `pdfDoc`
  (engine-agnostic; no container change), interactive only in `activeTool==='pan'||'select'`.
- **Overlay-visibility fix (important):** `hideOverlayUntilPdfReady` (`PDFViewer.jsx:~25158`) was hiding the
  WHOLE overlay (search highlights, links, forms, AND imported SVG markups) in view mode under pdf.js, because
  `readSyncfusionPageVisitState` → `hasSyncfusionPdfSurface` only matches Syncfusion page surfaces (the pdf.js
  container paints a plain classless `<canvas>`). Fixed engine-scoped: the gate now also requires
  `getPDFViewerEngine() !== PDF_VIEWER_ENGINE_PDFJS`. Guard test `tests/performance/overlayPresentationGate.test.mjs:22`
  updated to match. Syncfusion path byte-for-byte unchanged.
- **Migration WRITTEN (not applied):** `supabase/migrations/20260602000000_add_form_field_annotation_type.sql`
  — adds `'form-field'` to the `document_annotations_annotation_type_check`. No new table/column/RLS/index.

## DESIGN (decided — from the persistence understand-workflow)
A filled form value is modeled as a NEW annotation-subtype object that rides the EXISTING
`document_annotations` pipeline (per-user `user_id` + RLS + reload + Yjs), so persistence is free beyond the
allowlist entries. The object is a NON-VISUAL persistence carrier (the form WIDGET shows the value; the
'form-field' object is not drawn by `SVGAnnotationLayer` — no dispatch branch needed, and that is fine).

Object shape (rides annotationsByPage → save → Yjs → Supabase):
```
{ type: 'form-field', data: { id: `form-field:${pageNumber}:${fieldId}`, type: 'form-field',
    fieldId, fieldName, fieldType, value, pageNumber, rect },
  pageNumber, left, top, width, height,  // bounds for the row's bounds column
  meta: { authorId } }
```
Use `data.id` as the stable key (NOT `annotationId` — that triggers the survey-marker skip guard in the SVG
layer). Stable id keyed by page+field so re-edits UPSERT the same row.

## STATUS: COMPLETE (2026-06-02) — all steps below DONE + runtime-validated
## ZOOM-RELIABILITY FOLLOW-UP (2026-06-02, post user report) — FIXED + REVIEWED
User reported fields "stop working" after zoom. Root cause: `PdfjsFormLayer` sized itself from the React
`scale` prop, but under pdf.js `onZoomChanged` is gated off, so wheel/pinch zoom resizes the page host WITHOUT
updating that prop → fields drifted off the page (clicks missed; also explains the "click another annotation"
symptom). Fix: render fields once (render-effect deps `[pdf, pageNumber]`, no rebuild on zoom) + a ResizeObserver
on `div.parentElement` (the overlay host, which always tracks the page) recomputes
`--scale-factor = hostOffsetWidth / pageWidthPoints` on every resize. Inputs are never destroyed, so focus/caret/
in-flight edits survive zoom. Verified live (pinch zoom: form width tracks canvas, same input element survives,
focus kept, typing saves, reload restores). An adversarial review flagged a debounce-timer teardown gap →
added an unmount cleanup that clears pending form-field timers (page nav intentionally does NOT clear them — an
out-of-view page's pending edit must still flush). Build clean, npm test 840/0/6.


Steps 2–4 implemented; Step 5 validated. `npm run build` clean, `npm test` 840/0/6.
Live Playwright run on the pdf.js preview (`clickable-link-test.pdf`): typed a name +
ticked the checkbox → reloaded → BOTH values restored, zero console errors;
`annotationsByPage` page 1 went 8→10 objects with exactly 2 `form-field` carriers
(SVGAnnotationLayer ignores the type — counted as `noElementDispatched`, never drawn).
Changed files: `src/services/annotationTypeSerializers.js`,
`src/services/annotationCloudSync.js`, `src/components/PdfjsFormLayer.jsx`,
`src/PDFViewer.jsx` (capture/read-back wiring only). The forms+links cutover is done.

## REMAINING STEPS (in order) — ✅ all complete
1. ~~Apply the migration~~ **DONE 2026-06-02** — `supabase db push --linked` succeeded (user authorized;
   app is pre-launch, not live). `document_annotations.annotation_type` now accepts `'form-field'`. Nothing
   else to do here; the DB is ready for the wiring below.
2. **Extend the JS type allowlists** so the new type serializes + loads + syncs:
   - `src/services/annotationTypeSerializers.js`: add `'form-field'` to `SUPPORTED_DB_TYPES` (~60-74); add a
     branch in `fabricObjectToDbType` (~141-152) returning `'form-field'` when `fabricObj.data?.type === 'form-field'`;
     verify `deserializeRowToFabricObject` round-trips it (it returns `annotation_data.fabricObject` verbatim, so OK).
   - `src/services/annotationCloudSync.js`: add `'form-field'` to `NON_HIGHLIGHT_TYPES` (~50-53) so it loads on
     reload and routes through realtime (`routeRow` ~620, delete handler ~535).
3. **Capture values → persist:** pass `onFieldChange` (debounced ~400ms) from PDFViewer into `<PdfjsFormLayer>`.
   The handler upserts the 'form-field' object (shape above) into `annotationsByPage[pageNumber].objects` and
   runs it through the existing save path (`handleSaveAnnotations(pageNumber, updatedJSON, {source:'form-field'})`
   — same path SVG edits use, `PDFViewer.jsx:~19747`), which write-throughs to Supabase + Yjs. Read the value
   from `pdf.annotationStorage` (canonical) or the event payload. Stamp `meta.authorId` from the app's origin ctx
   (see `permissionScope.getAnnotationAuthorId` / how other objects get authorId on create).
4. **Read-back on load:** when `PdfjsFormLayer` mounts/renders a page, read the persisted 'form-field' objects
   for that page from `annotationsByPage` (pass them in as a prop) and seed `pdf.annotationStorage.setValue(fieldId, {value})`
   for each BEFORE `AnnotationLayer.render`, so reloaded widgets show saved values. (annotationStorage keys are the
   widget annotation ids; map `fieldId`→widget id.)
5. **Validate:** `npm run build`; `npm test` (expect 840/0/6); runtime on the preview: type a name + tick the box →
   reload the page → values persist; confirm the row lands under the user's account (Supabase `document_annotations`
   `annotation_type='form-field'`, `user_id`=current user). Undo (Ctrl+Z) should revert a value (rides the same
   history as other annotations). Spot-check Syncfusion default is untouched.

## GOTCHAS
- `useSyncfusionRenderer` is hardcoded `true` and does NOT mean Syncfusion — only `getPDFViewerEngine()` does.
- Form widgets render via a SEPARATE pdf.js AnnotationLayer; the page canvas's `annotationMode: DISABLE`
  (set for the markup-erase fix) does NOT affect them.
- Do NOT make 'form-field' render in `SVGAnnotationLayer` (it's a non-visual carrier; the widget is the UI).
- Checkbox/radio values are booleans; text/dropdown are strings — handle both in capture + read-back.
- Keep edits minimal in `PDFViewer.jsx` (highest-risk file); the save path already exists, just feed it.

## KEY FILES
New: `src/components/PdfjsLinkLayer.jsx`, `src/components/PdfjsFormLayer.jsx`,
`supabase/migrations/20260602000000_add_form_field_annotation_type.sql`.
Edit for Step 2-4: `src/services/annotationTypeSerializers.js`, `src/services/annotationCloudSync.js`,
`src/PDFViewer.jsx` (form-layer mount ~25347 + a small onFieldChange handler + the save path ~19747).
Reference: session log `~/.claude/projects/.../memory/session-moments/2026-06-01.md` (22:30 + 22:54 entries).
