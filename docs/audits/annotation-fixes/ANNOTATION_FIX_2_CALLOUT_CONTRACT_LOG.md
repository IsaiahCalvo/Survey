# Annotation Fix 2: Callout Contract Log

## Summary

Callouts were mostly wired as first-class annotations through the restored separate `callouts` state path, but two consistency gaps remained:

- SVG callout rendering only checked page and survey module. It did not use the shared annotation visibility contract for canvas visibility, survey visibility, region scope, active space, and layer visibility.
- Supabase callout serialization computed `bounds` from the older `anchor`/`label` shape only. Current in-app SVG callouts use `arrowTip`, `knee`, `textBoxPosition`, `textBoxWidth`, and `textBoxHeight`, so current callouts could persist with empty or incomplete bounds.

The separate callout state path is still intentional for now: render/edit/drag flows use normalized SVG callout geometry, while regular annotations use Fabric JSON. The safe boundary is that callouts now share the same visibility helper, sync fingerprinting, local history snapshots, delete intent diagnostics, and Supabase row serializer coverage.

## Files Changed

- `src/components/SVGAnnotationLayer.jsx`
  - Callout render filtering now calls `isAnnotationVisibleInContext(...)`, matching regular annotation page/survey/region/layer rules.
- `src/services/annotationTypeSerializers.js`
  - `serializeCalloutToRow()` bounds now include current SVG callout geometry: `arrowTip`, `knee`, `textBoxPosition`, `textBoxWidth`, and `textBoxHeight`, while preserving legacy `anchor`/`label` support.
- `tests/annotationVisibilityRules.test.mjs`
  - Added callout-shaped visibility coverage for page visibility and region visibility rules.
- `tests/cloudSyncAllTypes/serializers.test.mjs`
  - Added current SVG callout schema bounds coverage.

## Tests Run

- `npm run build`
  - PASS. Vite build completed. Existing warnings: pdf.js eval warning, dynamic/static import chunk warnings, large bundle warning.
- `node --test tests/cloudSyncAllTypes/serializers.test.mjs tests/annotationVisibilityRules.test.mjs tests/calloutSyncPayload.test.mjs tests/annotationLocalHistory.test.mjs tests/historyStacks.test.mjs tests/calloutEditAdapter.test.mjs tests/calloutRenderer.test.mjs tests/svgToFabricShape.test.mjs tests/marqueeSelection.test.mjs tests/svgKeyboardHandlers.test.mjs`
  - PASS. 134 tests passed.
  - Log: `test-logs/annotation-fix-2-focused-tests.log`
- `npm test -- --runInBand`
  - PASS. 515 passed, 6 skipped, 0 failed.
  - Note: this package's test script is `node --test 'tests/**/*.test.mjs'`; `--runInBand` is accepted as an extra argument but Node still runs the repo suite.
  - Log: `test-logs/annotation-fix-2-npm-test.log`

## Manual UI Steps

Browser route used:

- `http://127.0.0.1:5173/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`
- This is the repo's dev-only test route from `src/main.jsx` / `src/DevTestRoute.jsx`; it bypasses auth and Supabase services without hardcoded credentials.

Steps performed:

- Loaded the fixture PDF through the dev route.
- Confirmed SVG annotation layer mounted.
- Confirmed imported callouts rendered: `[data-callout-id]` count was `2`.
- Switched tools through visible toolbar buttons (`Draw`, `Text`, `Shapes`) and confirmed callout count stayed `2`.
- Reloaded/reopened the dev route and confirmed callouts returned after PDF load settled: final count `2`.
- Clicked an existing callout area and confirmed callout DOM stayed mounted with callout parts present.

Screenshots:

- `test-logs/annotation-fix-2-browser-before.png`
- `test-logs/annotation-fix-2-browser-after-shapes.png`
- `test-logs/annotation-fix-2-browser-after-reload-settled.png`
- `test-logs/annotation-fix-2-browser-after-callout-click.png`

## Supabase And Local Save Findings

- Supabase live sync was not exercised in browser because the safe dev route intentionally supplies `isSupabaseAvailable: false` and bypasses cloud services.
- Supabase serialization was verified with unit tests:
  - callout rows preserve the callout payload
  - legacy `anchor`/`label` bounds still work
  - current SVG callout bounds now serialize non-empty geometry
- Sync noise protection was verified with existing focused tests:
  - `calloutSyncPayload` ignores transient selection, hover, cursor, and sub-pixel jitter
  - persisted geometry changes still change the sync fingerprint
- Local persistence path was inspected:
  - local-only PDFs save normalized callouts to `localStorage` via `saveCallouts`
  - cloud-backed docs skip local callout cache and hydrate from cloud/Y.Doc paths

## Contract Coverage Notes

- Creation: `handleCreateCallout` adds a history checkpoint and appends to `callouts`.
- Text edit: callout edit mode converts through `calloutEditAdapter`, commits through `setCalloutsIfPersistedChanged`, and checkpoints `callouts:edit-commit`.
- Move / arrow tip / knee / resize: live drag updates callout state without a checkpoint; pointer-up commits one `callouts:update` checkpoint using the saved live baseline.
- Selection / delete: SVG callout hit targets use `data-callout-id` / `data-callout-part`; delete routes through callout delete history and removal intent logging.
- Undo / redo: callouts are included in legacy history snapshots and ordered against local annotation history by checkpoint id.
- Shared-file assumption: regular annotation CRDT undo remains per-user; callouts still use the legacy/callout snapshot lane and preserve author identity in Supabase serialization. Multi-user callout undo isolation remains a residual risk until callouts move fully into the per-user CRDT path.

## Remaining Risks / Follow-Up

- Manual browser testing did not cover creating a brand-new callout or dragging each handle end-to-end because the dev fixture already had imported callouts and the callout-specific creation control was not exposed as a unique accessible toolbar target in the in-app browser snapshot. The underlying create/edit/move/resize paths are covered by focused adapter, renderer, history, and sync tests.
- Supabase live push/delete/realtime behavior was not tested against a real local Supabase session in this run. The serializer and hook-level sync contract are covered by unit tests; live RLS/realtime should be exercised when local Supabase credentials are available.
