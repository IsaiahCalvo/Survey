# Annotation Fix 19: Annotation Contract Regression Coverage

Date: 2026-05-12

## Summary

This pass inspected the shared annotation contract paths and added focused regression coverage without changing runtime code. The shared Fabric-family contract is:

`annotationsByPage.objects[]` -> `SVGAnnotationLayer` render/filter/select -> `useSVGInteraction` edit/move/delete -> `App.handleSaveAnnotations` local history -> `buildFabricSyncDelta` -> Supabase `document_annotations` upsert/delete -> `dualWriteFabricCommit` / `applyFabricCommit` into Y.Doc `annotations`.

Callouts intentionally use a separate state slice and Y.Doc map:

`callouts[]` -> `SVGAnnotationLayer` callout render/select -> callout update/delete handlers -> legacy/callout history snapshots -> `buildCalloutSyncDelta` -> Supabase `document_annotations` callout rows -> `applyCalloutCommit` into Y.Doc `callouts`.

Survey highlights remain the legacy highlight pipeline:

`highlightAnnotations` -> `SVGAnnotationLayer` synthetic survey highlight rects / `PageAnnotationLayer` legacy highlight rendering -> `documentAnnotationService` highlight-only Supabase rows. They are not in the shared Fabric/Y.Doc annotation map.

## Contract Table

| Annotation type | Render path | Selection path | Save path | Supabase row type | Y.Doc path | Undo/redo path | Reload behavior | Result |
|---|---|---|---|---|---|---|---|---|
| Pen strokes | `SVGAnnotationLayer` -> `renderPath` | SVG hit wrapper / `data-annotation-index` / `useSVGInteraction` | `annotationsByPage` -> `buildFabricSyncDelta` -> `upsertAnnotationsByPage` | `ink` | `annotations` map via `applyFabricCommit` | `buildAnnotationHistoryAction` / local Fabric history | Supabase rows deserialize to page objects; sealed docs materialize from Y.Map | Pass |
| Highlighter strokes | `SVGAnnotationLayer` -> `renderPath` with multiply style | Same Fabric annotation index path | Same Fabric path | `ink` | `annotations` map | Same Fabric local history | Same as pen | Pass |
| Survey highlights | Synthetic rects in `SVGAnnotationLayer` from `surveyHighlights`; legacy PAL also handles highlight objects | Display-only SVG survey highlight group in this layer; legacy PAL owns highlight selection/delete | `highlightAnnotations` -> `documentAnnotationService.syncAnnotationsToSupabase` | `highlight` | No shared Fabric Y.Doc path found | Legacy snapshot history with `highlightAnnotations` | `loadAnnotationsFromSupabase` highlight-only loader | Gap documented: separate legacy path, not shared Fabric/Y.Doc |
| Survey annotations | Normal Fabric object with `moduleId` | Same Fabric annotation index path after survey visibility filter | Same Fabric path | Based on shape, e.g. `square`, `circle`, `line`, `ink`, `freetext` | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Region annotations | Normal Fabric object with `regionId` | Same path, interactive only in active space/region | Same Fabric path | Based on shape | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Survey-region annotations | Normal Fabric object with both `moduleId` and `regionId` | Same path, gated by both survey and region context | Same Fabric path | Based on shape | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Rectangles | `renderRect` | Shape hit area / annotation index | Same Fabric path | `square` | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Circles | `renderEllipse` | Shape hit area / annotation index | Same Fabric path | `circle` | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Lines | `renderLine` | Stroke hit area / annotation index | Same Fabric path | `line` | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Arrows | `renderLine` for current line+arrowhead data; legacy grouped arrow branch also exists | Stroke hit area / annotation index | Same Fabric path | `line` | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Text boxes | `renderText` | Text/shape hit area / annotation index | Same Fabric path | `freetext` | `annotations` map | Same Fabric local history | Same as Fabric | Pass |
| Callouts | `SVGAnnotationLayer` callout render path / `renderCallout` helpers | `data-callout-id`, callout part hit areas, callout selection set | `callouts[]` -> `buildCalloutSyncDelta` -> `upsertCallouts` | `callout` | dedicated `callouts` map via `applyCalloutCommit` | legacy/callout history snapshots plus callout owner scoping | Supabase callout rows deserialize to `callouts[]`; sealed docs materialize from Y.Map `callouts` | Pass |
| Counter pins | `renderCounter` | Counter hit area / annotation index | Same Fabric path | `counter` | `annotations` map | Same Fabric local history; counter renumber policy tested separately | Same as Fabric | Pass |
| Imported squiggles | PDF importer creates selectable/evented Fabric `polyline`; rendered by `renderPolyline` | Polyline hit area / annotation index | Same Fabric path | `polyline` | `annotations` map | Same Fabric local history | PDF import dedupe by page + `pdfAnnotationId`; row reload dedupes | Pass |
| Imported polylines | PDF importer creates selectable/evented Fabric `polyline`; rendered by `renderPolyline` | Polyline hit area / annotation index | Same Fabric path | `polyline` | `annotations` map | Same Fabric local history | PDF import dedupe by page + `pdfAnnotationId`; row reload dedupes | Pass |
| Imported polygons | PDF importer creates selectable/evented Fabric `polygon`; rendered by `renderPolygon` | Polygon hit area / annotation index | Same Fabric path | `polygon` | `annotations` map | Same Fabric local history | PDF import dedupe by page + `pdfAnnotationId`; row reload dedupes | Pass |

## Files Changed

- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/tests/annotationContractRegression.test.mjs`
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/scripts/fix19-live-auth-contract-e2e.mjs`
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/src/App.jsx`
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/ANNOTATION_FIX_19_ANNOTATION_CONTRACT_REGRESSION_LOG.md`

Runtime change in this follow-up is limited to a dev-only Fix 19 harness hook, `window.__fix19ImportPdfAnnotations`, gated by `import.meta.env.DEV`. It uses the existing `importAnnotationsFromPdf` importer and commits imported app copies through `handleSaveAnnotations`, so Supabase/Y.Doc persistence still goes through the normal cloud sync path. Production behavior is unchanged.

Cleanup check: `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-12.md` exists as an untracked local memory file, but the Fix 19 note added there was removed and `.claude` is not part of this app fix.

## Tests Added

Added `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/tests/annotationContractRegression.test.mjs` covering:

- each generated Fabric annotation type produces and reuses a stable ID
- each generated Fabric annotation type participates in one-object sync delta with no whole-page fan-out
- each generated Fabric annotation type can be represented in local history and undone
- each generated Fabric annotation type writes to Y.Doc `annotations`
- imported polyline, polygon, and squiggle annotations remain selectable/evented and dedupe on reload
- survey, regular, region, and survey-region visibility rules do not leak modes
- callouts use their separate Supabase, sync delta, and Y.Doc `callouts` path

## Tests Run

Passed:

```bash
node --test tests/annotationContractRegression.test.mjs
```

Passed:

```bash
node --test \
  tests/annotationContractRegression.test.mjs \
  tests/cloudSyncAllTypes/serializers.test.mjs \
  tests/annotationSyncDelta.test.mjs \
  tests/annotationLocalHistory.test.mjs \
  tests/annotationVisibilityRules.test.mjs \
  tests/pdfAnnotationImporter.test.mjs \
  tests/crdtCalloutBridge.test.mjs \
  tests/phase29/identityContract.test.mjs \
  tests/phase29/echoLoopGuard.test.mjs
```

Result: 118 passing tests. Node emitted the existing module-type warning for ES modules in a package without `"type": "module"`.

Fresh live harness run:

```bash
node scripts/fix19-live-auth-contract-e2e.mjs
```

Result: historical blocked exit after producing fresh evidence. The proved families passed; survey setup remained blocked. The imported PDF gap from that run is superseded by the fresh authenticated imported-PDF section below.

## Fresh Live Authenticated Runtime Evidence

Fresh harness added:

```bash
node scripts/fix19-live-auth-contract-e2e.mjs
```

The harness signs in through the existing dev auto-login credentials, creates a disposable PDF/document in Supabase storage, opens it through the normal dashboard, creates/moves annotations through the real browser UI, reloads the app, reopens the same document, and writes fresh evidence under `Logs`.

Fresh run used:

- Document: `Fix19 Live Contract 20260512180438.pdf`
- Document ID: `58c80bb3-0ba7-484e-999a-5daec6ba2a88`
- Log folder: `Logs/2026-05-12_18-04-37_fix19-live-auth`
- Evidence file: `Logs/2026-05-12_18-04-37_fix19-live-auth/fix19-evidence.json`

| Annotation family | Exact document/PDF used | Action performed | Fresh log folder | Supabase row type | `changedCount` | `supabaseUpsertCount` | `yDocUpdateCount` | Reload result | Pass/fail |
|---|---|---|---|---|---:|---:|---:|---|---|
| Pen stroke | `Fix19 Live Contract 20260512180438.pdf` | Created by pen drag, selected, moved, synced, reloaded | `Logs/2026-05-12_18-04-37_fix19-live-auth` | `ink` | 1 | 1 | 1 | Returned after reload | Pass |
| Highlighter stroke | Same | Created by highlighter drag, selected, moved, synced, reloaded | Same | `ink` | 1 | 1 | 1 | Returned after reload | Pass |
| Rectangle | Same | Created by rectangle drag, selected, moved, synced, reloaded | Same | `square` | 1 | 1 | 1 | Returned after reload | Pass |
| Line | Same | Created by line drag, selected, moved, synced, reloaded | Same | `line` | 1 | 1 | 1 | Returned after reload | Pass |
| Arrow | Same | Created by arrow drag, selected, moved, synced, reloaded | Same | `line` | 1 | 1 | 1 | Returned after reload | Pass |
| Counter pin | Same | Created by counter drag, selected, moved, synced, reloaded | Same | `counter` | 1 | 1 | 1 | Returned after reload | Pass |
| Text box | Same | Created by text-box drag/type/commit, selected, moved, synced, reloaded | Same | `freetext` | 1 | 1 | 1 | Returned after reload | Pass |
| Callout | Same | Created by callout drag, selected, moved/edited, synced, reloaded | Same | `callout` | 1 | 1 | 1 | Returned after reload | Pass |
| Imported polyline / polygon / squiggle | Same | Not run in this earlier pass | Same | `polyline`, `polygon` | n/a | n/a | n/a | n/a | Superseded below |
| Survey annotation | Same | Not run | Same | Shape-specific | n/a | n/a | n/a | n/a | Blocked |
| Region annotation | Same | Not run | Same | Shape-specific | n/a | n/a | n/a | n/a | Blocked |
| Survey-region annotation | Same | Not run | Same | Shape-specific | n/a | n/a | n/a | n/a | Blocked |
| Survey highlight legacy path | Same | Not run | Same | `highlight` | n/a | n/a | n/a | n/a | Blocked |

Fresh run summary:

- Supabase durable rows after run: `{"ink":2,"line":2,"counter":1,"square":1,"freetext":1,"callout":1}`.
- Reload source: the reloaded app reopened the same Supabase document and returned all seven Fabric objects plus one callout.
- Network failed request count: 12 requestfailed events, all `net::ERR_ABORTED` during dashboard navigation/reload or browser close; HTTP `>=400` response count was 0.
- Console error count: 0.
- Whole-page fan-out: none; every proved family logged `fullFanOutReason:null` and one changed row.
- Phantom selection: none detected by the harness; select captures showed the expected SVG element counts.

Blocked families and exact technical blocker:

- Survey annotation / region annotation / survey-region annotation / survey highlight: the disposable document has no seeded survey template/module or region setup. I found no safe utility that creates a disposable authenticated survey template/document with one module and one region.

Reproducible next step:

- Add a seeded authenticated fixture route or harness setup that creates one disposable survey template/module and one region, then run the same script against those scopes.

## Fresh Live Authenticated Imported PDF Evidence

Fresh follow-up run:

```bash
node scripts/fix19-live-auth-contract-e2e.mjs
```

Result: pass.

Fresh corrected run used:

- Document/PDF: `Fix19 Imported PDF Gap 20260512191126.pdf`
- Document ID: `d0778843-add1-468f-bd82-de863661d6f4`
- Log folder: `Logs/2026-05-12_19-11-25_fix19-live-auth`
- Evidence file: `Logs/2026-05-12_19-11-25_fix19-live-auth/fix19-evidence.json`
- Harness path: dev-only `window.__fix19ImportPdfAnnotations`, `window.__fix19SelectAnnotation`, and `window.__fix19MoveAnnotationById`, all gated by `import.meta.env.DEV`.

| Imported annotation type | App ID | `pdfAnnotationId` | Fabric selectable after reload | Fabric evented after reload | SVG element found after reload | SVG bounding box found | Post-reload move/edit result | Exact post-reload `changedCount` | Exact post-reload `supabaseUpsertCount` | Exact post-reload `yDocUpdateCount` | Exact post-reload `fullFanOutReason` | Duplicate count after reload | Pass/fail |
|---|---|---|---|---|---|---|---|---:|---:|---:|---|---:|---|
| Imported squiggle (`Squiggly`) | `7R` | `7R` | `false` | `false` | Yes | Yes | SVG drag did not produce a delta; dev-only Fix19 move hook committed through `handleSaveAnnotations` | 1 | 1 | 1 | `null` | 0 | Pass |
| Imported polyline (`PolyLine`) | `8R` | `8R` | `false` | `false` | Yes | Yes | Edited by SVG vertex-handle drag after reload | 1 | 1 | 1 | `null` | 0 | Pass |
| Imported polygon (`Polygon`) | `9R` | `9R` | `false` | `false` | Yes | Yes | Moved by SVG body drag after reload | 1 | 1 | 1 | `null` | 0 | Pass |

Exact post-reload move delta lines:

- `7R`: `[CloudSync][delta] fabric prepared {"actionType":"move","changedIds":["7R"],"deletedIds":[],"changedObjectCount":1,"changedCount":1,"dispatchedCount":1,"supabaseUpsertCount":1,"yDocUpdateCount":1,"fullFanOutReason":null,...}`
- `8R`: `[CloudSync][delta] fabric prepared {"actionType":"vertex-move","changedIds":["8R"],"deletedIds":[],"changedObjectCount":1,"changedCount":1,"dispatchedCount":1,"supabaseUpsertCount":1,"yDocUpdateCount":1,"fullFanOutReason":null,...}`
- `9R`: `[CloudSync][delta] fabric prepared {"actionType":"move","changedIds":["9R"],"deletedIds":[],"changedObjectCount":1,"changedCount":1,"dispatchedCount":1,"supabaseUpsertCount":1,"yDocUpdateCount":1,"fullFanOutReason":null,...}`

Required checks:

- Supabase rows after run: `{"polyline":2,"polygon":1}`.
- Y.Doc evidence: each post-reload move/edit logged `yDocUpdateCount: 1`.
- Network failed Supabase write count: `0`.
- Console error count: `0`.
- Whole-page fan-out count: `0`; all post-reload per-ID moves logged `fullFanOutReason: null`.
- Native PDF layer handling result: app imported IDs `7R`, `8R`, `9R` were present after reload. Native layer diag reported `importedCopiesAvailable: true`; the fixture’s native annotations did not require keeping a separate native renderable layer visible.
- Duplicate import result: second import returned no new imports and reported existing app copies for `Squiggly` `7R`, `PolyLine` `8R`, and `Polygon` `9R`.

## Supabase / Sync Evidence

Fresh authenticated runtime evidence verifies the normal Fabric/callout push shape:

- Pen, highlighter, rectangle, line, arrow, counter, textbox, and callout each dispatched one changed object.
- Each proved family logged `changedCount: 1`, `supabaseUpsertCount: 1`, `yDocUpdateCount: 1`, and `fullFanOutReason: null`.
- Supabase durable rows after reload matched the created family set: `ink:2`, `line:2`, `counter:1`, `square:1`, `freetext:1`, `callout:1`.

Unit coverage still fills contracts that the current live harness cannot safely seed:

- Fabric objects dispatch `changedCount: 1`, `supabaseUpsertCount: 1`, `yDocUpdateCount: 1`, `fullFanOutReason: null`.
- Deletes dispatch delete IDs without upsert rows in existing `annotationSyncDelta` coverage.
- Callouts dispatch one `callout` row and one Y.Doc `callouts` map update.
- Imported PDF duplicate rows normalize to one object per page + `pdfAnnotationId`.

## Remaining Risks

- Survey highlights are still a separate legacy `highlight` pipeline, not part of the shared Fabric/Y.Doc annotation contract.
- Fresh UI-driven live coverage is complete for pen, highlighter, rectangle, line, arrow, counter, textbox, and callout.
- Imported PDF squiggle/polyline/polygon now have fresh authenticated live evidence through a dev-only harness path that uses the same importer and normal cloud sync save path.
- Survey/region/survey-region/survey-highlight mode behavior remains blocked because no safe disposable authenticated survey template/module/region seed exists in this repo.
- Two-client live Y.Doc behavior still needs a real multi-client session or dedicated e2e harness with seeded auth/document state.
- Export/Print UI was intentionally not touched.

## Survey Region Live Contract Proof

Root cause of previous blocker:

- The earlier Fix 19 live harness could create a disposable authenticated PDF, but it had no safe disposable survey template/module/space/region setup. Survey mode, region overlays, and survey-highlight rendering depend on viewer state (`selectedTemplate`, `selectedModuleId`, `spaces`, `activeSpaceId`, `activeRegionId`), not just rows in `document_annotations`.
- Existing template creation is dashboard/Supabase owned through the `templates` table and `useTemplates`; region geometry is stored inside template/module/space config. I found no existing seed route or helper that created a throwaway authenticated template plus region and activated it in the PDF viewer.

Files changed:

- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/src/App.jsx`
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/scripts/fix19-survey-region-live-contract-e2e.mjs`
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/ANNOTATION_FIX_19_ANNOTATION_CONTRACT_REGRESSION_LOG.md`

Disposable survey/region setup:

- Added a dev-only viewer hook, `window.__fix19SurveyRegionHarness`, gated by `import.meta.env.DEV`.
- The hook creates an in-memory disposable template with two modules, two spaces, and one rectangular region per space. It does not persist template rows and does not affect production behavior.
- The live script still creates a real authenticated disposable PDF/document in Supabase storage and inserts real `document_annotations` rows for the five proof annotations.

Latest live harness:

- Command: `node scripts/fix19-survey-region-live-contract-e2e.mjs`
- Result: pass.
- Document: `Fix19 Survey Region Contract 20260512235459.pdf`
- Document ID: `cad2c817-3630-4435-b821-1743466a30d9`
- Log folder: `Logs/2026-05-12_23-54-58_fix19-survey-region-live`
- Evidence file: `Logs/2026-05-12_23-54-58_fix19-survey-region-live/fix19-survey-region-evidence.json`

Visibility proof:

| Context | Regular | Survey | Region | Survey-region | Survey highlight |
|---|---:|---:|---:|---:|---:|
| Normal mode | visible | hidden | hidden | hidden | hidden |
| Correct survey module | hidden | visible | hidden | hidden | visible |
| Wrong survey module | hidden | hidden | hidden | hidden | hidden |
| Correct region | visible | hidden | visible | hidden | hidden |
| Wrong region | visible | hidden | hidden | hidden | hidden |
| Correct survey and region | hidden | visible | visible | visible | visible |
| Wrong survey with correct region | hidden | hidden | visible | hidden | hidden |

Selection proof:

- The harness selected `fix19-regular-annotation` in normal mode, then switched to survey mode.
- Selected count before switch: `1`.
- Selected count after switch: `0`.
- Result: pass.

Sync delta proof:

| Saved annotation | Row type | `changedCount` | `supabaseUpsertCount` | `yDocUpdateCount` | `fullFanOutReason` | Result |
|---|---|---:|---:|---:|---|---|
| Regular annotation | `square` | 1 | 1 | 1 | `null` | Pass |
| Survey annotation | `square` | 1 | 1 | 1 | `null` | Pass |
| Region annotation | `square` | 1 | 1 | 1 | `null` | Pass |
| Survey-region annotation | `square` | 1 | 1 | 1 | `null` | Pass |
| Survey highlight | `highlight` | 1 | 1 | n/a | `null` | Pass |

Final row count from the live document:

- `square`: 4
- `highlight`: 1

Required safety checks:

- Network failed Supabase write count: `0`.
- Console error count: `0`.
- Whole-page fan-out: `false`.
- Imported Squiggly path was not touched by this pass.
- Survey highlights remained hidden outside survey mode.
- Region annotations remained hidden outside the active region/space context.

Remaining limitations:

- The disposable survey template/space data is an in-memory dev harness fixture, not a persisted Supabase `templates` row. That is intentional for safe cleanup and keeps the setup test-only.
- Survey highlights still use the legacy highlight sync path and do not write to the shared Fabric/Y.Doc annotation map, so `yDocUpdateCount` is not applicable for that row.

Tests run:

```bash
node --test \
  tests/annotationVisibilityRules.test.mjs \
  tests/annotationSelectionContext.test.mjs \
  tests/annotationContractRegression.test.mjs
```

Result: pass, 33 tests. Node emitted the existing module-type warning for ES modules in a package without `"type": "module"`.

## Imported Squiggly Stroke Contract Correction

Status: not accepted yet. The importer/runtime correction is in place, but the live authenticated post-reload Squiggly drag still did not emit the required per-ID sync delta.

Root cause found:

- PDF-native `/Squiggly` had been imported as `polyline`, so prior proof compared it to PolyLine/Polygon vertex geometry instead of app stroke/path behavior.
- App-created pen/highlighter strokes are Fabric `path` objects. They render through `renderPath`, select through the SVG path hit target, move through `useSVGInteraction` path movement, save as Supabase `ink`, and write one Y.Doc annotation update when the path changes.
- Imported Squiggly is now mapped to the same path/storage shape as app-created strokes: `type:"path"`, page-space path commands, `left:0`, `top:0`, round caps/joins, no `strokeUniform`, provenance metadata only.

Files changed:

- `src/utils/pdfAnnotationImporter.js`
- `src/components/SVGAnnotationLayer.jsx`
- `src/App.jsx`
- `scripts/fix19-live-auth-contract-e2e.mjs`
- `tests/pdfAnnotationImporter.test.mjs`
- `tests/pdfAnnotationNormalization.test.mjs`

Live harness run:

- Document/PDF: `Fix19 Imported PDF Gap 20260512200558.pdf`
- Document ID: `a48d1909-e498-4f18-8efb-4083ef23542b`
- Log folder: `Logs/2026-05-12_20-05-57_fix19-live-auth`
- Result: fail only for imported Squiggly post-reload move delta.

Observed live results:

| Imported annotation type | App ID | Row type | Reload result | Post-reload move delta | Pass/fail |
|---|---|---|---|---|---|
| Squiggly | `7R` | `ink` | returned once | no `[CloudSync][delta]` for `7R` | Fail |
| PolyLine | `8R` | `polyline` | returned once | `changedIds:["8R"]`, `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`, `fullFanOutReason:null` | Pass |
| Polygon | `9R` | `polygon` | returned once | `changedIds:["9R"]`, `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`, `fullFanOutReason:null` | Pass |

Proof no dev-only move fallback was used:

- `window.__fix19MoveAnnotationById` was removed from the app harness hooks.
- The harness pass condition rejects `devMoveFallbackUsed:true`.
- The latest Squiggly result failed instead of falling back, which is the correct failure mode for this correction.

Required checks from the latest run:

- Console error count: `0`.
- Failed Supabase write count: `0`.
- Whole-page fan-out count: `0`.
- Duplicate count after reload: `0` for Squiggly, PolyLine, and Polygon.
- Native layer handling: imported app copies were present after reload; no native-layer proof was used for the failed Squiggly move.

Regression test command:

```bash
node --test \
  tests/annotationContractRegression.test.mjs \
  tests/cloudSyncAllTypes/serializers.test.mjs \
  tests/annotationSyncDelta.test.mjs \
  tests/annotationLocalHistory.test.mjs \
  tests/annotationVisibilityRules.test.mjs \
  tests/pdfAnnotationImporter.test.mjs \
  tests/crdtCalloutBridge.test.mjs \
  tests/phase29/identityContract.test.mjs \
  tests/phase29/echoLoopGuard.test.mjs
```

Result: `119` pass, `0` fail.

## Imported Squiggly Drag Sync Fresh Fix

Status: blocked. I did not get the required accepted live proof.

Root cause found:

- Imported Squiggly is now correctly present as `annotation_type:"ink"` / Fabric `type:"path"` and returns once after reload.
- The current divergence is before save: the live harness can hit-test the Squiggly SVG element, but the Squiggly click/drag still does not reach `handleAnnotationPointerDown`, so drag state never enters `mode:"move"` and `handlePointerUp` never reaches `onSaveAnnotations`.
- Latest evidence shows `document.elementFromPoint(...)` returns the Squiggly path or thin-path hit box under the cursor, but there is no `[BboxScaleDiag] annotation-pointerdown`, no `[PreviewDiag] start` for `7R`, and no `[CloudSync][delta]` for `7R`.

Files changed in this fresh attempt:

- `src/components/SVGAnnotationLayer.jsx`
- `ANNOTATION_FIX_19_ANNOTATION_CONTRACT_REGRESSION_LOG.md`

What changed:

- Removed the Squiggly-only drag surfaces and diagnostic native handlers from prior attempts so Squiggly uses the normal path annotation path.
- Added generic path interaction hardening: path hit targets now use `pointer-events: all`, mouse fallbacks, a root-level annotation-index fallback, and a thin-path hit box for very thin path annotations.
- These changes still did not make the Squiggly harness drag enter the normal move/save path.

Why previous attempts failed:

- Earlier attempts focused on import shape and duplicate behavior. Those are now mostly correct, but the remaining issue is interaction dispatch after reload.
- Squiggly-only hit boxes hid the real divergence: the harness could find a hit element, but that element did not start the normal annotation gesture.
- Switching back to the normal path target showed the same blocker: the target is under the cursor, but no annotation pointer-down reaches the hook.

Why normal pen strokes worked but imported Squiggly did not:

- Normal app-created pen strokes use the path family and, when their pointer-down reaches `handleAnnotationPointerDown`, they mutate path data on move and save through `onSaveAnnotations`.
- Imported Squiggly now has compatible path storage, but its very thin generated path/hit geometry after reload is not producing a delivered pointer-down in the live harness, so it never reaches the shared path mutation/save code.

Latest live harness:

- Document/PDF: `Fix19 Imported PDF Gap 20260512232657.pdf`
- Document ID: `1faec840-7bec-43a7-8eba-b60c03a2557e`
- Log folder: `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-12_23-26-56_fix19-live-auth`

Latest Squiggly result:

- Squiggly id: `7R`
- Row type: `ink`
- Reload result: returned once
- Duplicate count after reload: `0`
- Dev-only move/save fallback used: `false`
- `changedIds`: none, because no delta line was emitted
- `changedCount`: `null`
- Supabase upsert count: `null`
- Y.Doc update count: `null`
- `fullFanOutReason`: `null`

PolyLine and Polygon regression result:

- PolyLine `8R`: pass, `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`, `fullFanOutReason:null`
- Polygon `9R`: pass, `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`, `fullFanOutReason:null`
- Supabase write failures: `0`

Test command:

```bash
node --test \
  tests/pdfAnnotationImporter.test.mjs \
  tests/pdfAnnotationNormalization.test.mjs \
  tests/annotationContractRegression.test.mjs
```

Result: `39` pass, `0` fail.
