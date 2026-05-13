# Annotation Fix 7: Initial Hydration Gate

Date: 2026-05-10

## Root Cause

The first visible PDF page could paint from local/cache state before the cloud-backed annotation sources finished hydrating.

The concrete paths were:

- `App.jsx` loaded regular local annotation cache and `highlightAnnotations_*` localStorage immediately on cloud-backed PDF open.
- `loadAnnotationsFromSupabase` later replaced/merged survey highlight rows from `document_annotations`, so Supabase-only survey/highlight rows could visibly pop in or disappear after first paint.
- `useAnnotationCloudSync` started its all-types hydrate only when `enabled: cloudSyncActive` became true. `cloudSyncActive` depends on the document sync/presence path, so normal annotation hydration could lag behind initial render.
- Cutover-sealed documents used Y.Doc as authority, but a cold/opening Y.Doc could initially materialize as empty. The hook later probed legacy `document_annotations` rows and restored thousands of normal rows, which was visible without a first-page gate.
- Old logs confirmed this ordering: local cache was used immediately, then `document_annotations` reads completed later.

## Files Changed

- `src/App.jsx`
- `src/hooks/useAnnotationCloudSync.js`
- `src/utils/annotationHydrationGate.js`
- `tests/annotationHydrationGate.test.mjs`
- `tests/annotationInitialHydrationSource.test.mjs`

## Exact Fix

Added a source-aware first-visible-page annotation gate.

- `src/utils/annotationHydrationGate.js` centralizes:
  - first visible page resolution
  - cloud-backed document readiness
  - first visible page gating
  - offscreen page lazy-load allowance
- `useAnnotationCloudSync` now returns `initialHydration` for normal/callout annotations and logs `[AnnotationHydrationGate][normal]`.
- `useAnnotationCloudSync` now accepts `hydrateEnabled`, so initial all-types hydration can start as soon as `documentId`, `userId`, and `pdfId` exist, before live realtime/presence sync is fully active.
- `App.jsx` tracks `surveyAnnotationHydration` separately for Supabase-only survey/highlight rows.
- Cloud-backed PDFs no longer seed survey highlights from localStorage before Supabase has answered.
- Supabase survey highlight load now replaces highlight state with the remote result, including the empty result case, instead of preserving stale local highlights.
- The first visible annotation overlays are hidden/gated until both required sources are ready:
  - normal/callout source: Y.Doc snapshot, or the existing guarded legacy fallback when a sealed Y.Doc opens empty
  - survey/highlight source: Supabase highlight loader
- The gate resets on PDF/document switch because the source states are reset on PDF open and hook hydration restart.

## Loading-Speed Strategy

- The gate is narrow: only the first visible page is blocked from final annotation paint.
- Offscreen pages are not blocked by the gate, so existing lazy materialization/windowing behavior can continue after first paint.
- Normal hydration starts earlier through `hydrateEnabled`, without waiting for the presence/realtime subscription path.
- Cutover-sealed documents still prefer Y.Doc snapshot materialization. Legacy `document_annotations` fallback is used only when the sealed Y.Doc snapshot is empty.
- Supabase survey highlights are fetched once through the existing document highlight loader; no new broad app freeze or extra app-level fetch loop was added.

## Before / After Behavior

Before:

- The PDF page could appear with local/cache or partial Y.Doc annotations.
- Supabase-only survey highlights and legacy fallback rows could appear later after sync settled.
- Empty initial Y.Doc materialization on a cutover-sealed document could show a blank/partial overlay before legacy fallback rows restored it.

After:

- The first visible page does not expose final annotation overlays until normal/callout and survey/highlight sources are both ready.
- Y.Doc remains authoritative for cutover-sealed normal annotations when it materializes a populated snapshot.
- If a sealed Y.Doc opens empty, the existing legacy cloud fallback completes before the first visible page is released.
- Survey highlights no longer paint from stale localStorage on cloud-backed PDFs before Supabase completes.
- Offscreen pages remain eligible for lazy loading after the first visible page is released.

## Tests Run

- `node --test tests/annotationHydrationGate.test.mjs tests/annotationInitialHydrationSource.test.mjs`
  - Result: passed, 8 tests.
- `npm test`
  - Result: passed, 550 tests total, 544 passed, 6 skipped, 0 failed.
- `npm run build`
  - Result: passed.
  - Warnings: existing Vite CJS API deprecation, pdf.js `eval` warning, dynamic/static import chunk warnings, and large bundle warnings.

## Manual Verification

Used the local dev server at `http://127.0.0.1:5173/` and opened `Package 2 - Rev 4 -- IC.pdf`.

Verified:

- Browser console errors: 0.
- First-page gate logged pending before annotation paint.
- Supabase-only survey highlights completed before the first page was marked ready.
- Normal annotations completed before the first page was marked ready.
- Realtime subscription still connected after the gate released.
- Waiting after first-page ready did not produce new hydration/fetch logs or a late first-page readiness transition.

## Relevant Log Snippets

Hydration gate starts before first annotation paint:

```text
[AnnotationHydrationGate][first-page] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"ready":false,"normal":{"ready":false,"source":"starting"},"survey":{"ready":false,"source":"supabase-highlight-starting"}}
```

Supabase-only survey/highlight rows complete while first page is still gated:

```text
[HIGHLIGHT-SYNC][load.legacy][pdf=Package 2 - Rev 4 -- IC.pdf] {documentId: d30ac66b-5d2e-4a93-aab3-8fdd84a0af86, totalRows: 1034, fabricCarryingDropped: 1020, keptCount: 14}
[AnnotationHydrationGate][survey] supabase highlights complete {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","count":14}
[AnnotationHydrationGate][first-page] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"ready":false,"normal":{"ready":false,"source":"starting"},"survey":{"ready":true,"source":"supabase-highlight","count":14}}
```

Normal annotation source completes before first-page release:

```text
[CloudSync][hook] cutover hydrate saw empty Y.Doc — probing legacy cloud rows before painting blank {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","cutoverTs":"2026-05-05T16:30:00.778+00:00"}
[CloudSync][hydrate] loadAllNonHighlightAnnotations start {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86"}
[CloudSync][hydrate] loadAllNonHighlightAnnotations ok {"elapsedMs":2051,"totalRowsScanned":3059,"scanned":{"nonHighlight":2039,"legacyFabricHighlights":1020},"totalRows":3059,"rowsByType":{"callout":3,"ink":2034,"square":2,"highlight":1020},"pagesWithObjects":6,"calloutCount":3}
[AnnotationHydrationGate][normal] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","ready":true,"source":"legacy-cloud-empty-ydoc-fallback","normalReady":true,"cutoverTs":"2026-05-05T16:30:00.778+00:00","count":3050,"calloutCount":3,"firstPaintGate":true}
```

First page is released only after both required sources are ready:

```text
[AnnotationHydrationGate][first-page] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"ready":true,"normal":{"ready":true,"source":"legacy-cloud-empty-ydoc-fallback","count":3050,"calloutCount":3},"survey":{"ready":true,"source":"supabase-highlight","count":14}}
```

No duplicate unnecessary hydration fetches in the manual run:

```text
[CloudSync][hydrate] loadAllNonHighlightAnnotations start {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86"}
[CloudSync][hydrate] loadAllNonHighlightAnnotations ok {"elapsedMs":2051,"totalRowsScanned":3059,...}
[HIGHLIGHT-SYNC][load.legacy][pdf=Package 2 - Rev 4 -- IC.pdf] {... keptCount: 14}
```

The console contained one non-fetch initial skip before `pdfId` was known, then one normal hydration fetch and one survey highlight fetch after prerequisites existed.

Realtime/sync remains active after release:

```text
[CloudSync][realtime] subscribing {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86",...}
[CloudSync][realtime] subscribe status {"status":"SUBSCRIBED","error":null}
[Phase31 UAT] post-subscribe catch-up skipped — doc is cutover-sealed, Y.Doc + realtime is source of truth {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","cutoverTs":"2026-05-05T16:30:00.778+00:00"}
```

## Remaining Risks

- If the Supabase highlight fetch errors, the gate intentionally releases with source `supabase-highlight-error` to avoid indefinitely hiding the first page. In that case survey highlights may be absent until a later successful load.
- The legacy fallback for an empty cutover-sealed Y.Doc is still a full non-highlight cloud read. It is correctness-preserving, but on large documents it can add a short delay to first annotation paint when the local Y.Doc snapshot is empty.
- The existing local annotation cache log still appears for non-survey local regular annotations, but the first visible cloud-backed annotation overlays stay gated until the authoritative source completes.

## Visual Cover Follow-Up

Date: 2026-05-10

### What Was Missing

The data gate and overlay hiding were working, but the PDF page itself could still become visible while the annotation overlay was hidden. That meant the user could briefly see a clean PDF page and then see annotations appear when hydration finished. This still looked like annotation pop-in.

### Files Changed

- `src/App.jsx`
- `src/utils/annotationHydrationGate.js`
- `tests/annotationHydrationGate.test.mjs`
- `tests/annotationInitialHydrationSource.test.mjs`
- `ANNOTATION_FIX_7_INITIAL_HYDRATION_GATE_LOG.md`

### Fix Added

- Added `shouldCoverFirstVisibleAnnotationPage` as the visual-cover counterpart to the existing first-page data gate.
- Added `renderAnnotationHydrationPageCover` in `App.jsx`.
- Syncfusion first-page overlay portals now render a page-sized loading cover while `annotationHydrationGated === true`.
- The Syncfusion portal filter now includes the first gated page even when annotation data is not yet populated, so the cover can appear before annotations exist.
- PDF.js continuous and single-page paths now render the same cover when their first visible page is gated.
- Added data attributes:
  - `data-annotation-hydration-cover="true"`
  - `data-annotation-hydration-cover-active="true"`
  - `data-annotation-visual-cover-active`
- Added `[AnnotationHydrationGate][visual-cover]` logs showing active and release states.

### Tests Run

- `node --test tests/annotationHydrationGate.test.mjs tests/annotationInitialHydrationSource.test.mjs tests/performance/overlayPresentationGate.test.mjs`
  - Result: passed, 23 tests.
- `npm test`
  - Result: passed, 553 tests total, 547 passed, 6 skipped, 0 failed.
- `npm run build`
  - Result: passed.
  - Warnings: existing Vite CJS API deprecation, pdf.js `eval` warning, dynamic/static import chunk warnings, and large bundle warnings.

### Manual Verification

Used the local dev server at `http://127.0.0.1:5173/` and opened `Package 2 - Rev 4 -- IC.pdf`.

Verified:

- Browser console errors: 0.
- Visual cover logged active while the first visible page annotation hydration gate was pending.
- Normal Y.Doc annotations completed before release.
- Supabase survey/highlight rows completed before release.
- Visual cover logged inactive only after the first-page gate reported `ready:true`.
- DOM after release had `activeCoverCount: 0`, `firstPaintGate: null`, and annotation layers present.
- Realtime sync subscribed after hydration.

### Visual Cover Log Snippets

Cover active while first page is gated:

```text
[AnnotationHydrationGate][first-page] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"ready":false,"visualCoverActive":true,"normal":{"ready":false,"source":"starting"},"survey":{"ready":false,"source":"supabase-highlight-starting"}}
[AnnotationHydrationGate][visual-cover] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"active":true,"reason":"annotation-hydration-gated"}
```

Y.Doc normal annotations complete, but cover stays active because survey rows are still pending:

```text
[AnnotationHydrationGate][normal] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","ready":true,"source":"ydoc-snapshot","normalReady":true,"count":2869,"calloutCount":2,"firstPaintGate":true}
[AnnotationHydrationGate][first-page] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"ready":false,"visualCoverActive":true,"normal":{"ready":true,"source":"ydoc-snapshot","count":2869,"calloutCount":2},"survey":{"ready":false,"source":"supabase-highlight-starting"}}
```

Cover releases only after Supabase survey/highlight rows complete:

```text
[AnnotationHydrationGate][survey] supabase highlights complete {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","count":14}
[AnnotationHydrationGate][first-page] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"ready":true,"visualCoverActive":false,"normal":{"ready":true,"source":"ydoc-snapshot","count":2869,"calloutCount":2},"survey":{"ready":true,"source":"supabase-highlight","count":14}}
[AnnotationHydrationGate][visual-cover] {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","pageNumber":1,"active":false,"reason":"hydration-ready"}
```

Post-release DOM check:

```text
{"activeCoverCount":0,"visualCoverAttrs":["false"],"firstPaintGate":null,"annotationLayerCount":2}
```
