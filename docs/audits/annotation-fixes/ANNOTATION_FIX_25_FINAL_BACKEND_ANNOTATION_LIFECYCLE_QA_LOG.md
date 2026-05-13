# Annotation Fix 25 Final Backend Annotation Lifecycle QA Log

Date: 2026-05-13

## Scope

Backend/user-experience regression pass across the current annotation lifecycle. This pass did not build a new print/export UI and did not chase the default macOS print preview.

## Baseline Findings

The required unit/contract suite passed before code changes:

```text
node --test tests/syncStatusUi.test.mjs tests/pdfSaveExportContract.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs tests/annotationVisibilityRules.test.mjs tests/annotationContractRegression.test.mjs
1..65
# tests 81
# suites 7
# pass 81
# fail 0
```

Additional adjacent backend/import/selection/history coverage also passed:

```text
node --test tests/pdfAnnotationImporter.test.mjs tests/pdfAnnotationNormalization.test.mjs tests/annotationHydrationGate.test.mjs tests/annotationInitialHydrationSource.test.mjs tests/annotationLocalHistory.test.mjs tests/annotationSelectionContext.test.mjs tests/calloutSyncPayload.test.mjs tests/calloutHistoryScope.test.mjs tests/crdtCalloutBridge.test.mjs tests/documentAnnotationService.test.mjs tests/documentHighlightMapper.test.mjs tests/highlightSyncDeleteDiff.test.mjs tests/marqueeSelection.test.mjs tests/selectionHandleVisibility.test.mjs tests/svgKeyboardHandlers.test.mjs tests/svgToFabricShape.test.mjs tests/lineArrowPersistence.test.mjs tests/lineGeometry.test.mjs tests/renderArrowhead.test.mjs
1..147
# tests 160
# suites 3
# pass 160
# fail 0
```

`npm run build` passed before the fix.

## Runtime Regression Found

I started the dev server on `http://localhost:5174/` because `5173` was already in use.

The existing authenticated live harnesses could not create disposable documents because Supabase rejected inserts into `documents`:

```text
code: 42501
message: new row violates row-level security policy for table "documents"
```

I switched to the existing cloud-backed dev PDF `Package 2 - Rev 4 -- IC.pdf` (`documentId=d30ac66b-5d2e-4a93-aab3-8fdd84a0af86`) and ran a Playwright runtime probe through the app.

Before the fix, Cmd+S on an already loaded document with no pending local edit still triggered a full Supabase annotation upsert:

```json
{
  "hasPendingFabric": false,
  "hasPendingCallout": false,
  "fabricObjectCount": 2069,
  "queueBefore": 0
}
```

Followed by:

```json
{
  "actionType": null,
  "changedCount": 2069,
  "dispatchedCount": 2069,
  "supabaseUpsertCount": 2069,
  "totalRows": 2069,
  "rowsByType": {
    "counter": 3,
    "ink": 2059,
    "square": 6,
    "freetext": 1
  }
}
```

This violated the acceptance rule: no full-document Supabase upsert for a no-op/small edit unless truly required.

Evidence files:

```text
test-logs/annotation-fix-25/runtime-existing-document.json
test-logs/annotation-fix-25/runtime-console.log
```

## Root Cause

`src/hooks/useAnnotationCloudSync.js` only skipped the direct durable full-state fallback when `statusAfterPending === "synced"`. A cloud-backed document can be idle after hydration even when there is no pending fabric/callout runner and no queued local work. In that idle hydrated state, Cmd+S fell through to `upsertAnnotationsByPage(lastByPageRef.current, ...)`, causing a full-document row upsert.

## Fix

Changed the manual-save no-op guard from "already synced" to "no pending durable work":

- no pending fabric runner consumed
- no pending callout runner consumed
- queue was empty before drain
- queue remained empty after drain

When that is true, `forceFlush()` logs the no-op and still settles manual-save status to synced, but it does not direct-upsert all Fabric/callout state.

Files changed:

- `src/hooks/useAnnotationCloudSync.js`
- `tests/syncStatusUi.test.mjs`

## Targeted Test Added

Updated `tests/syncStatusUi.test.mjs` so the source contract rejects the stale `statusAfterPending === "synced"`-only guard. This specifically protects the idle hydrated Cmd+S path found in runtime.

## Post-Fix Runtime Evidence

Reran the same existing-document Playwright probe.

Result:

```json
{
  "pass": true,
  "noPendingLog": true,
  "synced": true,
  "pushLineCountAfterSave": 0,
  "fullUpsertsAfterSave": [],
  "failedSupabaseWrites": [],
  "consoleErrorCount": 0
}
```

Key force-flush logs:

```text
[CloudSync][forceFlush] start {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","hasUserId":true,"hasPendingFabric":false,"hasPendingCallout":false,"fabricObjectCount":2273,"calloutObjectCount":0,"queueBefore":0}
[CloudSync][forceFlush] no pending work; preserving synced state
[CloudSync][forceFlush] synced {"consumedPendingFabric":false,"consumedPendingCallout":false,"directFabricRows":0,"directCalloutRows":0,"fabricObjectCount":2273,"calloutObjectCount":0,"queueBefore":0,"queueRemaining":0}
```

The document rendered/reloaded with annotations present and no selection overlays:

```json
{
  "before": {
    "totalObjects": 2273,
    "byType": { "path": 2263, "counter": 3, "rect": 6, "textbox": 1 },
    "selectedOverlays": 0,
    "yDocAnnotationCount": 2273
  },
  "afterReload": {
    "totalObjects": 2392,
    "byType": { "path": 2382, "counter": 3, "rect": 6, "textbox": 1 },
    "selectedOverlays": 0,
    "yDocAnnotationCount": 2392
  }
}
```

Evidence files:

```text
test-logs/annotation-fix-25/runtime-existing-document-after-fix.json
test-logs/annotation-fix-25/runtime-console-after-fix.log
```

## Final Verification

Required suite after fix:

```text
node --test tests/syncStatusUi.test.mjs tests/pdfSaveExportContract.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs tests/annotationVisibilityRules.test.mjs tests/annotationContractRegression.test.mjs
1..65
# tests 81
# suites 7
# pass 81
# fail 0
```

Build after fix:

```text
npm run build
✓ built in 28.15s
```

Runtime after fix:

```text
Playwright existing cloud document Cmd+S/reload probe: pass
pushLineCountAfterSave: 0
fullUpsertsAfterSave: []
failedSupabaseWrites: []
consoleErrorCount: 0
```

## Coverage Summary

Validated by unit/contract tests:

- pen/path strokes and highlighter-like paths keep IDs, local history, delta sync, and Y.Doc writes
- rectangles/circles/lines/arrows/text boxes/counter pins keep type and delta behavior
- callouts stay on the dedicated callout Supabase/Y.Doc path
- imported polyline/polygon/squiggle annotations normalize duplicates and remain selectable/evented
- survey, region, and survey-region visibility rules do not leak into normal context
- invisible annotations are excluded from marquee hit resolution by the rendered/selectable index
- deletes and bulk deletes emit delete deltas instead of full upserts
- export/reimport contracts keep counters as counters and skip imported PDF-native copies to prevent duplication

Validated by runtime:

- existing cloud-backed annotations render after load
- no phantom selection overlays after load/save/reload
- Cmd+S on no pending work settles to synced without a full Supabase annotation upsert
- reload uses the current source of truth and does not disappear the loaded annotation set

## Remaining Risks

- Disposable-document authenticated live harnesses are currently blocked by Supabase `documents` RLS. I did not change RLS in this pass because the task was annotation lifecycle QA, and existing cloud documents were available for runtime validation.
- The runtime probe did not chase default macOS print preview. Print preview remains deferred per task instruction.
