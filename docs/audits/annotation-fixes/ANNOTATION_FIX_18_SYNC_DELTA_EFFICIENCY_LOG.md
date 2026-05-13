# Annotation Fix 18 - Sync Delta Efficiency

## Correction Root Cause

The original Fix 18 delta layer was working, but `handleSaveAnnotations` still renumbered counters too broadly:

```js
source.includes('counter')
  || annotationPageHasCounters(current)
  || annotationPageHasCounters(incoming)
```

That meant a normal pen save on any page containing counters could rewrite many counter objects before the sync delta ran. The delta planner then correctly detected those counters as changed and pushed them.

Latest runtime evidence from `Logs/2026-05-12_15-22-53/console.log`:

- Good path move: `actionType:"move"`, `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`.
- Bad path create: `actionType:"path:created"`, `changedCount:79`, `supabaseUpsertCount:79`, `yDocUpdateCount:79`, `rowsByType:{"counter":78,"ink":1}`.

## Exact Code Change

- Added `src/utils/counterRenumberSavePolicy.js`.
- Replaced the broad "page has counters" renumber trigger with `shouldRenumberCountersForSave(...)`.
- Counter renumbering now runs only for:
  - counter create
  - counter delete
  - counter series ID/start changes
- Counter renumbering is skipped for:
  - path creation
  - path move/edit
  - counter move/rotate/resize
  - counter group color-only updates
- Added `preserveExistingCountersOnPage(...)` so non-numbering saves keep existing counters byte-for-byte even if incoming JSON carries stray counter changes.
- Applied the same narrow renumber policy to local undo/redo.
- Added `[CounterRenumber] skipped` and `[CounterRenumber] ran` logs with source/action/reason; run logs include affected counter IDs and count.

## Second Correction Root Cause

The first correction used the same condition for two separate decisions:

- skip counter renumbering
- preserve all existing counters byte-for-byte

That protected path saves correctly, but it could discard legitimate counter edits that also skip renumbering, such as counter move, pointer rotate, resize, and color-only/group updates. Those edits should not renumber display numbers, but they must persist the changed counter object.

## Second Correction Code Change

- `shouldRenumberCountersForSave(...)` now also returns `shouldPreserveExistingCounters`.
- `shouldPreserveExistingCounters:true` is used only for non-counter saves, including dirty incoming counter JSON during path creation or path move/edit.
- Counter-related non-numbering saves now return:
  - `shouldRenumber:false`
  - `shouldPreserveExistingCounters:false`
- `handleSaveAnnotations` now calls `preserveExistingCountersOnPage(...)` only when `shouldPreserveExistingCounters` is true.
- `[CounterRenumber] skipped` logs now include `preserveExistingCounters` so runtime evidence can distinguish path protection from counter edit persistence.

## Mixed Selection Correction Root Cause

`buildAnnotationHistoryAction(...)` represents a mixed counter + non-counter move as:

- `type:"fabric:batch"`
- `updated:[counter update, path/shape update, ...]`

The previous policy still classified that as a non-counter `object:modified` save and set `shouldPreserveExistingCounters:true`. With the old preserve-all helper, that could restore the moved counter from the previous page and silently discard the intended counter edit.

This was proven first with a focused failing test: `mixed counter and path move skips renumbering without preserving over the counter edit` failed because `shouldPreserveExistingCounters` was `true` for the mixed batch.

## Mixed Selection Code Change

- Added intentional counter-change detection in `src/utils/counterRenumberSavePolicy.js`.
- The policy now returns `intentionalCounterChangeIds` for updated counters whose change is not just `data.displayNumber` / `data.seriesStart` churn.
- `preserveExistingCountersOnPage(...)` now accepts `intentionalCounterChangeIds`.
- For intentional counter IDs, the helper preserves the counter edit while restoring stable numbering metadata from the previous counter.
- For all other existing counters, the helper still restores the previous counter byte-for-byte, protecting path saves from accidental dirty counter JSON.
- `handleSaveAnnotations` now calls the helper when either general counter preservation is needed or intentional counter changes need numbering metadata stabilization.

## Files Changed

- `src/App.jsx`
- `src/utils/counterRenumberSavePolicy.js`
- `tests/annotationSyncDelta.test.mjs`
- `tests/counterRenumberSavePolicy.test.mjs`

## Current Contract

- Drawing one pen/path stroke on a counter-heavy page should leave existing counters unchanged and sync only the new stroke.
- Moving/editing a pen/path on a page with counters should sync only that path.
- Moving a counter should sync only that counter unless its numbering metadata changes.
- Moving a mixed selection containing one counter and one path should persist both changes and sync exactly those two annotations.
- Rotating a counter pointer should sync only that counter and persist `data.pointerAngle`.
- Resizing a counter should sync only that counter and persist geometry/radius changes.
- Creating/deleting counters still renumbers the affected series.
- Counter series/start changes still renumber as needed.
- Counter group color-only updates update only the intended group counters.
- Undo/redo uses the same narrow rule, so non-counter undo/redo no longer rewrites counters.

## Tests Run

- `node --test tests/counterRenumberSavePolicy.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs`
  - Pass: 22/22.
- `node --test tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs`
  - Pass: 15/15.
- `node --test tests/counterRenumberSavePolicy.test.mjs`
  - Pre-fix proof: failed 1/7 on the mixed counter + path move test because the policy preserved counters blindly.
  - Post-fix: pass 7/7.
- `npm test`
  - Pass: 607, skipped: 6, failed: 0.
- `npm run build`
  - Pass. Existing Vite/pdf.js eval, dynamic-import, and chunk-size warnings only.

## Runtime Evidence

Runtime log folder used: `Logs/2026-05-12_16-05-27`.

Latest runtime evidence from `Logs/2026-05-12_16-05-27/console.log` proves the original pen-stroke issue is fixed:

- `[CounterRenumber] skipped` for `source:"path:created"`.
- `[CloudSync][delta] fabric prepared` has `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`.
- Supabase upsert has `rowsByType:{"ink":1}`.
- Path move also stayed at `changedCount:1`, `supabaseUpsertCount:1`, `yDocUpdateCount:1`.

Console evidence available from that runtime log:

- pen/path create: `supabaseUpsertCount:1`, `yDocUpdateCount:1`, `rowsByType:{"ink":1}`.
- pen/path move: `supabaseUpsertCount:1`, `yDocUpdateCount:1`, `rowsByType:{"ink":1}`.

Console evidence not captured in this pass:

- counter-only move runtime log.
- mixed counter + path selection move runtime log.

No safe disposable live PDF target was available in the current pass, so I did not mutate a runtime document just to collect those logs. The counter-only and mixed-selection behavior is covered by focused tests.

## Counter Edit Result

Automated coverage now proves:

- `path:created` with dirty incoming counters restores old counters and syncs only the new path.
- counter move skips renumbering and is not overwritten by counter preservation.
- counter rotate skips renumbering and persists `data.pointerAngle`.
- counter resize skips renumbering and persists radius/position changes.
- counter group color-only update skips renumbering and persists only the intended counter color changes.
- mixed counter + path move persists both intended edits, restores unrelated dirty counter numbering churn, and syncs exactly `["counter-1","path-1"]`.
- counter create/delete and series-start/series-id changes still request renumbering.
- final sync delta changed IDs/counts match the intended changed objects for each case.

I did not perform additional live counter edits against a runtime PDF in this pass. The counter edit survival and mixed-selection delta are covered by focused unit tests; a disposable-PDF runtime pass is still useful to capture console evidence for counter-only and mixed-selection moves.

## Remaining Risks

- If a current annotation object has no stable ID, the sync delta planner can still fall back to full fan-out by design.
- Initial hydration/source-of-truth reshape remains bulk by design.
- The mixed-selection fix identifies intentional counter changes by comparing non-numbering fields. That covers move/rotate/resize/color/group metadata changes while still ignoring display-number churn.
- A live disposable-PDF runtime pass is still useful to capture post-correction counter-only and mixed-selection console evidence.
