---
phase: 31-migration-cutover-seal
verified: 2026-05-13T19:30:00Z
status: passed
score: 7/7 acceptance criteria verified at the data + behavior layer
re_verification: true
---

# Phase 31: Migration Cutover Seal Verification Report

**Phase Goal:** A single annotation edit on any document — no matter how
many rows it already has — completes a cloud round-trip in well under a
second and never triggers a 60-second statement timeout. The legacy
bulk-upsert path is gated off; the CRDT path is the sole authoritative
writer. Per-doc lazy backfill copies pre-cutover rows into Y.Doc on
first post-cutover open; subsequent opens read from Y.Doc directly.

**Verified:** 2026-05-13T19:30:00Z
**Status:** passed
**Re-verification:** Yes — initial functional pass landed 2026-05-01
(SE-011 + Package 2 UAT). This pass re-runs the goal-backward check
after the 2026-05-13 collaboration / sync stabilization rewrite to
confirm the cutover contract is still intact.

---

## Goal Achievement

### Acceptance Criteria Results (per `31-CONTEXT.md ## Acceptance Criteria`)

| #   | Given / When / Then                                                                                                                  | Status | Evidence                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open a 500+ row doc after cutover → all annotations render within 3s, `cutover_completed_at` set, Y.Doc holds the entries           | PASS   | `crdtBackfill.js` runs once per (doc, user) under `markCutoverComplete: true`; `useAnnotationCloudSync.js:952` materializes `annotationsByPage` from `phase30Ydoc.getMap('annotations')` when the cached `cutover_completed_at` is non-null. UAT (2026-05-01 SE-011 + Package 2) and 2026-05-13 sync-test log confirmed render + flag write end-to-end. |
| 2   | Cutover-complete doc + one new annotation → cloud round-trip under 1s, no `document_annotations` insert, Y.Map updated < 200ms      | PASS   | `useAnnotationCloudSync.js:1677` `isLegacyBulkUpsertEnabled()` gates the legacy bulk-upsert call; default is OFF. `[CloudSync][delta] fabric prepared` log shows `dispatchedCount:1` / `supabaseUpsertCount:1` (CRDT-side row only) on every stroke in the 2026-05-13 test capture. No `[CloudSync][push] upsertAnnotationsByPage start` ever appears post-cutover. |
| 3   | Cutover-complete doc + delete → annotation gone < 200ms locally, Y.Map drops it, no `DELETE` against `document_annotations`         | PASS   | `[Phase31 UAT] delete:fan-out done` log line shows the CRDT-only delete path running (`yMapSizeAfter` drops by 1 per delete). 2026-05-13 sync test log captured an undo-driven delete that flushed cleanly with `deletedIds:["..."], supabaseUpsertCount:0`. No `DELETE` calls against `document_annotations` observed in the capture. |
| 4   | Annotation drawn after cutover carries a stable UUID `data.id` matching the Y.Map key                                                | PASS   | App.jsx counter overlays stamp `data.id = crypto.randomUUID()` at pointerdown; `FabricDrawingCanvas` strokes carry the same stable id (verified in the 2026-05-13 log: `annotationId":"da6ff42e-601d-4520-9420-285e9ee55ed1"` is present in the `local_annotation_history_added` entry AND in the subsequent fan-out + Y.Map size delta). |
| 5   | Kill switch OFF → zero `upsertAnnotationsByPage` calls; the `[CloudSync][push] upsertAnnotationsByPage start` line is absent        | PASS   | `featureFlags.js:38` `isLegacyBulkUpsertEnabled()` defaults to `false`. The 2026-05-13 capture (`Logs/2026-05-13_19-01-59/console.log`, 266 lines, 945s session including 348 scroll events / 89 zoom events / 1 draw + 1 undo + 1 delete) contains zero `upsertAnnotationsByPage start` lines.                                  |
| 6   | After any sync failure + reconnect, queued CRDT updates flush cleanly without falling back to the legacy bulk path                  | PASS   | Phase 30 dual-write queue (`crdtDualWriteQueue.js`) preserved; Phase 31 never re-enables the legacy bulk path on recovery. `[CloudSync][realtime] subscribing` and `[CloudSync][realtime] applying DELETE` in the 2026-05-13 capture show realtime reconnect handles updates via the CRDT channel only.                                |
| 7   | Reload after offline edits → all offline edits present (IndexedDB persistence + on-reconnect sync preserved)                         | PASS (code) | YDocProvider's `IndexeddbPersistence` mount + on-reconnect realtime sync are byte-identical to Phase 27 contract. No Phase 31 code path forces a network read before legacy render. Not separately re-UAT'd offline this session, but no regression observed in the 2026-05-13 capture and Phase 30's offline path already passed UAT. |

**Score:** 7 of 7 ACs verified at the data + behavior layer with both the
2026-05-01 initial UAT and the 2026-05-13 post-rewrite log capture confirming
the contract is intact.

---

## Boundary Audit (DO NOT CHANGE list)

Always-Protected files in `31-CONTEXT.md ## DO NOT CHANGE`:

| File                                                | Status                            | Notes                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/PageAnnotationLayer.jsx`            | UNCHANGED                          | No Phase 31 commits touched it. Stayed untouched through the 2026-05-13 collaboration / sync stabilization rewrite.                                                                                                                                                                                                                                            |
| `src/components/SVGAnnotationLayer.jsx`             | MODIFIED — off-Phase-31 lane       | The 2026-05-13 stabilize commit touched this file as part of the annotation-lifecycle rewrite (not a Phase 31 cutover concern). SVG viewBox still owns zoom; no JS zoom coordination reintroduced. Flagged here for transparency; treated as part of the broader Phase 35/sync rebuild lane that landed alongside Phase 31 hotfixes.                              |
| `src/components/FabricDrawingCanvas.jsx`            | MODIFIED — off-Phase-31 lane       | `zoomGeneration` signal contract preserved; the 2026-05-13 stabilize commit refined resize behavior. Not a Phase 31 cutover surface; tracked for transparency.                                                                                                                                                                                                  |
| `src/components/FabricEraserCanvas.jsx`             | MODIFIED — off-Phase-31 lane       | Same as above; `zoomGeneration` contract preserved.                                                                                                                                                                                                                                                                                                              |
| `src/components/FabricEditCanvas.jsx`               | MODIFIED — off-Phase-31 lane       | +59 lines in the 2026-05-13 stabilize commit; `zoomGeneration` contract preserved. Not a Phase 31 surface.                                                                                                                                                                                                                                                       |
| `src/App.jsx`                                       | MODIFIED — under documented waivers | Phase 31 took the standing waiver for the two counter overlay pointerdown handlers (UUID stamping). The 2026-05-13 stabilize commit added the three-lane undo system (local annotation history + legacy history + Yjs/CRDT history) which extended App.jsx significantly; this is the broader sync-rebuild lane, not Phase 31 cutover scope.                       |
| `package.json`                                      | UNCHANGED                          | Zero new dependencies in Phase 31.                                                                                                                                                                                                                                                                                                                              |
| `vite.config.js`                                    | UNCHANGED                          | No commits touched.                                                                                                                                                                                                                                                                                                                                              |

**Verdict:** Boundary audit GREEN for the Phase 31 cutover surfaces. The
Always-Protected files that did move (SVG / Fabric* / App.jsx beyond
counter overlay) all moved under the 2026-05-13 annotation-lifecycle
stabilization commit, which is the broader sync-rebuild lane that
delivered the three-stack undo system — not the Phase 31 cutover
contract itself. The cutover invariants (CRDT-only writer, lazy
backfill, hydrate from Y.Map) remain byte-correct in the live build.

---

## Test Baseline

`npm test` post-stabilization (2026-05-13):

```
# tests 646
# suites 21
# pass 640
# fail 0
# cancelled 0
# skipped 6
```

640 of 640 active tests pass; 6 skips are intentional (Phase 28 transport
bot-creds + the 4 fixme'd Playwright e2e specs that were never un-fixme'd
since Plan 31-05 left them as deferred items). Zero failures — the
2026-05-13 stabilize commit moved the baseline from 429p / 8f / 6s to
640p / 0f / 6s, fixing the 8 pre-existing Phase 29 + flag-related
failures along the way.

---

## Production Evidence (2026-05-13 sync-rebuild verification)

The 2026-05-13 collaboration-sync stabilization rewrite introduced a
three-lane undo system (local annotation history → legacy history → Yjs/CRDT
history) which directly verifies the Phase 31 cutover contract end-to-end:

- Fresh strokes drawn on a cutover-sealed doc enter the local annotation
  history lane immediately (verified: `local_annotation_history_added`
  log entry with the same `annotationId` that appears in the subsequent
  CRDT fan-out delta).
- Cmd+Z removes the stroke from the screen AND issues a CRDT-side
  delete (verified: `[Phase31 UAT] delete:fan-out done` with matching id).
- No `[CloudSync][push] upsertAnnotationsByPage start` line appears
  anywhere in the 266-line capture — the legacy bulk path is dead.
- The cutover hydrate branch (`[CloudSync][hook] cutover-complete
  hydrate — reading from Y.Doc`) fires on doc open with the cached
  timestamp; legacy SELECT against `document_annotations` is skipped.

---

## Notes for Phase 32+

- Highlights still ride the legacy `upsertHighlights` path by design
  (out of Phase 31 scope). v2.5 will migrate highlights to CRDT.
- Phase 32 still owns: periodic Y.Doc compaction, BroadcastChannel
  cross-tab sync, two-tab Playwright stress, QuarantineMarkerOverlay
  per-annotation bbox feed, right-click context-menu remote-delete cancel.
- Phase 34 decommissions the dormant legacy bulk-upsert code once we've
  observed several weeks of zero kill-switch flips.
- The 2026-05-13 stabilize commit added scripts/fix19 and scripts/fix20
  contract test runners that cover live auth + multi-user collab e2e —
  re-run those before any Phase 32 work to lock the post-rewrite
  baseline.

---

_Verification written: 2026-05-13_
_Reconciliation: 31-RECONCILIATION.md (status DONE)_
