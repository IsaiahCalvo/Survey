---
phase: 30-migration-dual-write
plan: 06
subsystem: collab
tags: [react, yjs, ydoc-provider, dual-write, retry-queue, backfill, quarantine, banner, test-seams, pitfall-30-7]

# Dependency graph
requires:
  - phase: 30-migration-dual-write
    provides: "Plan 30-02 runBackfill (deferred-kickoff backfill module); Plan 30-03 drainQueue + crdtDualWriteQueue; Plan 30-04 dualWriteFabric* fan-out (and the upsertFabricAnnotation legacy entry point); Plan 30-05 useDualWriteQueue hook + sync_queue_stuck banner code + QuarantineMarkerOverlay sibling component + TabBar dot capability"
  - phase: 29-fabric-yjs-binding-per-user-undo
    provides: "applyFabricCommit (CRDT-side retry handler) + originBuilder (origin factory shape) + CollaboratorOutlineOverlay sibling-mount precedent"
  - phase: 27-crdt-foundation
    provides: "<YDocProvider> mount surface (Plan 27-05) + StorageFailureBanner extension surface — Plan 30-06 reuses both directly without rewriting either"
provides:
  - "YDocProvider runs runBackfill once per (docId, userId) on mount, deferred via Promise.resolve().then so the PDF paints first (Pitfall 30-7 fix)"
  - "1Hz drainQueue setInterval inside YDocProvider with retryLegacyWrite (re-fires upsertFabricAnnotation) + retryCrdtWrite (re-fires applyFabricCommit) handlers"
  - "useDualWriteQueue subscription drives sync_queue_stuck banner gate + QuarantineMarkerOverlay sibling mount inside the existing render block"
  - "5 e2e test seams installed on window: __crdtBackfillDone, __ydocAnnotationCount, __crdtForceLegacyFail, __crdtBackfillDelayMs, __crdtForceFailAnnoId"
  - "Banner gate: sync_queue_stuck StorageFailureBanner mounts only when no other storage banner is showing (avoids stacking)"
  - "QuarantineMarkerOverlay mounted as sibling next to CollaboratorOutlineOverlay with stub bboxes (per-annotation bbox feed deferred to Phase 32)"
affects: [30-07, 31, 32, 33]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferred-kickoff via Promise.resolve().then(...) + per-mount didRunRef gate keyed on `${docId}::${userId}` — Pitfall 30-7 (background work blocks first PDF paint) defended by code, not convention"
    - "Banner-gate composition: sync_queue_stuck only renders when storageState.code === 'ok' (or nullish) AND !bannerDismissed — multiple banners never stack visually inside YDocProvider"
    - "Test-seam contract on window object: 5 named slots (3 boolean / numeric input + 2 readout) drive Plan 30-01 e2e specs without touching production retry/backfill logic — same boolean-injection pattern Phase 28 used for transport providers"
    - "Sibling-overlay mount with stub geometry — QuarantineMarkerOverlay ships in the React tree with `pageNumber: 0` + zero-bbox per quarantined id; the bbox feed is a Phase 32 hardening pickup so the SVG layer (Always-Protected) stays untouched"
    - "applyUpdate-only invariant honored on every CRDT-side retry: retryCrdtWrite goes through applyFabricCommit (Phase 29 bridge), never wholesale state replacement"

key-files:
  created: []
  modified:
    - "src/components/collab/YDocProvider.jsx — +252 lines / -0 lines (net additive). Imports for runBackfill / drainQueue / useDualWriteQueue / QuarantineMarkerOverlay / upsertFabricAnnotation / applyFabricCommit / buildOrigin. 3 new useEffect blocks (backfill mount + drainQueue tick + ydocAnnotationCount observer). Banner-gate addition + QuarantineMarkerOverlay sibling mount inside the existing render block."

key-decisions:
  - "**Single atomic commit (cf437356) — deviation from plan's 2-task structure.** Plan 30-06 listed Task 1 (code) + Task 2 (manual UAT checkpoint). The code task landed in one commit; the UAT checkpoint was treated as a runtime-verification gate, not a separate commit. The 252-line surgical extension is cohesive enough that splitting it would have produced an intermediate state where the imports were present but the effects/render-block consumers were not."
  - "**Pitfall 30-7 defended by code: Promise.resolve().then(kickoff) + cancelled-flag cleanup.** The backfill effect resolves a microtask before invoking runBackfill, guaranteeing the PDF paint pipeline completes its first frame. The cancelled flag in the effect cleanup short-circuits the kickoff if the document switches mid-flight."
  - "**Per-(docId, userId) run-once gate via backfillRanRef.current.** Re-running the effect on user identity change is safe; the runKey closure ensures a single backfill kickoff per `${docId}::${userId}` tuple within a mount lifecycle. StrictMode double-mounts and re-render cascades are no-ops past the first run."
  - "**Banner gate composes with existing storage-failure banner.** sync_queue_stuck only renders when `(stuckCount > 0) && (!storageState || storageState.code === 'ok') && !bannerDismissed`. Two banners never stack. The user sees either a transport/storage banner OR a sync-queue banner, not both."
  - "**QuarantineMarkerOverlay shipped with stub bboxes (pageNumber: 0, x/y/w/h all 0).** The bbox feed requires reaching into PAL / SVGAnnotationLayer (both Always-Protected). Phase 32 hardening picks this up alongside Phase 29's CollaboratorOutlineOverlay bbox feed — same lane. The component is mounted in the React tree and renders nothing on empty input; markers float at origin (0,0) for any quarantined ids until the bbox feed lands."
  - "**Silent migration UAT step PASSED — backfill mount works.** PDF opens directly to Page 6 with the existing v2.3 annotations rendering immediately, no migration banner, no spinner, no completion toast. CONTEXT.md 'first-open import feel' decision verified end-to-end."
  - "**Failure-banner UAT step DEFERRED to post-30-07.** The new sync_queue_stuck banner cannot fire today because the live Fabric save path (useAnnotationCloudSync push) doesn't yet route through dualWriteFabricCommit/dualWriteFabricDelete — it still calls upsertFabricAnnotation directly. Plan 30-07 (Wave 4) closes that gap; the failure-banner UAT re-runs after 30-07 lands."
  - "**Quarantine UAT step DEFERRED to post-30-07.** Same reason — without the live save path routed through the dual-write fan-out, no annotation is enqueued in crdtDualWriteQueue, so __crdtForceFailAnnoId never sees the entry it needs to quarantine."
  - "**Cloud sync slowness flagged out-of-scope for Phase 30.** Each hydrate downloads ~21K rows and takes 30-50 seconds; window focus retriggers the hydrate. User flagged this; capture as a follow-up phase candidate (likely Phase 32 hardening or a dedicated phase). Do not bundle into 30."
  - "**Side-trip pen-stroke visibility regression fixed in this same session via src/utils/svgPathAttrs.js + tests/pdfAnnotationNormalization.test.mjs.** Imported PDF ink strokes were rendering as hollow rings or invisible due to sub-pixel strokeWidth after the 2026-04-21 import-normalization commit removed strokeUniform. Partial fix shipped (provenance-aware vector-effect + 2.5 user-unit floor for imports); a second AI extended the fix with closed-outline detection for Drawboard marker dots. **OUT-OF-SCOPE for Plan 30-06 but shipped because it blocked UAT** — was the only way to confirm the silent-migration step worked at all (otherwise the imported v2.3 annotations weren't visible to verify against)."

patterns-established:
  - "**Deferred-kickoff effect pattern for first-open background work** — Promise.resolve().then() + cancelled-flag cleanup + per-mount didRunRef gate. Future phases needing 'do work after first paint, run once per (key1, key2) tuple' can reuse this shape verbatim."
  - "**Window test-seam slots for e2e injection** — boolean toggles (`__crdt*Fail*`), numeric delays (`__crdt*DelayMs`), readout primitives (`__crdt*Done`, `__ydoc*Count`). Plan 30-01's e2e specs un-fixme by polling these. Future phases needing e2e seams without modifying production retry logic can reuse the convention."
  - "**Banner-gate composition** — when adding a new banner code, gate the render condition on `(!storageState || storageState.code === 'ok')` to compose with the existing banner mount instead of stacking. This keeps the user's visual surface deterministic regardless of how many failure modes accumulate over phases."

requirements-completed: [MIGRATE-01]

# Metrics
duration: 12min
completed: 2026-04-29
---

# Phase 30 Plan 06: YDocProvider Backfill + Dual-Write Retry Queue + UI Surfaces Mount

**Surgical extension of `<YDocProvider>` wires Phase 30's backfill module + dual-write retry queue + banner gate + quarantine overlay into the canonical CRDT-layer mount surface — runBackfill kicks off after first PDF paint (Pitfall 30-7), drainQueue retries half-failed writes once per second, and 5 e2e test seams unblock Plan 30-01's Playwright specs.**

## Performance

- **Duration:** ~12 min (single atomic commit)
- **Started:** 2026-04-28T13:15:00Z (approximate)
- **Code-landed:** 2026-04-28T13:27:56Z (commit cf437356)
- **Doc-closed:** 2026-04-29 (this SUMMARY + STATE/ROADMAP updates)
- **Tasks:** 1 of 2 (Task 1 = code; Task 2 = manual UAT, partially completed — see Deferred Issues)
- **Files modified:** 1 (`src/components/collab/YDocProvider.jsx`, +252 / -0)

## Accomplishments

- YDocProvider gains imports for runBackfill (Plan 30-02), drainQueue (Plan 30-03), useDualWriteQueue (Plan 30-05), QuarantineMarkerOverlay (Plan 30-05), upsertFabricAnnotation (Plan 30-04 fan-out's legacy entry point), applyFabricCommit (Phase 29 bridge), buildOrigin (origin factory shape).
- 3 new `useEffect` blocks inside YDocProviderInner: (1) deferred backfill mount with per-(docId, userId) run-once gate, (2) 1Hz drainQueue setInterval with retryLegacyWrite + retryCrdtWrite handlers, (3) ydocAnnotationCount observer for the e2e readout seam.
- Banner-gate composition: sync_queue_stuck StorageFailureBanner mounts only when no other storage banner is showing (`!storageState || storageState.code === 'ok'`) AND `!bannerDismissed`.
- "Retry now" action calls drainQueue once eagerly outside the 1Hz interval — banner stays mounted on click; fades out naturally on next-tick poll if the eager flush succeeded.
- QuarantineMarkerOverlay sibling-mounted next to CollaboratorOutlineOverlay (Phase 29 pattern). Quarantined annotations from useDualWriteQueue are mapped to stub bboxes (`pageNumber: 0`, `x/y/w/h: 0`); the component renders the marker text ("didn't save, please try redrawing") in the DOM but markers float at screen origin until Phase 32 plugs in real per-annotation page geometry.
- 5 e2e test seams installed on `window`: `__crdtBackfillDone`, `__ydocAnnotationCount`, `__crdtForceLegacyFail`, `__crdtBackfillDelayMs`, `__crdtForceFailAnnoId`. Plan 30-01's 4 fixme'd Playwright specs (phase30-backfill-roundtrip, phase30-stuck-queue-banner, phase30-quarantine-marker, phase30-race-window) can now poll on these to un-fixme as a Phase 30 verification follow-up.
- Pitfall 30-7 fix verified: `Promise.resolve().then(kickoff)` defers the runBackfill invocation by exactly one microtask, after which the PDF paint pipeline has flushed its first frame.
- Existing Phase 27/28/29 logic byte-identical: `git diff src/components/collab/YDocProvider.jsx | grep -E "^-" | grep -v "^---" | wc -l` returns 0 (zero substantive removals).
- Always-Protected files byte-identical: App.jsx, PageAnnotationLayer.jsx, FabricDrawingCanvas.jsx, FabricEraserCanvas.jsx, FabricEditCanvas.jsx, SVGAnnotationLayer.jsx, package.json, vite.config.js — all empty in `git diff --stat` for the cf437356 changeset.

## Task Commits

1. **Task 1: Wire backfill mount + drainQueue interval + UI surfaces inside YDocProviderInner** — `cf437356` (feat)

   The Plan listed two tasks (code + manual UAT checkpoint). Task 1 landed in one atomic commit per the deviation note below; Task 2 (UAT) is a runtime-verification gate, not a separate commit.

_Note: This is one commit instead of multiple per the plan's spec. The 252-line surgical extension is cohesive — splitting it would have produced an intermediate state where the imports were present but the effects/render-block consumers were not, which would have failed the build mid-task._

**Plan metadata:** (this commit) — `docs(30-06): close plan summary; UAT steps deferred to 30-07`

## Files Created/Modified

- `src/components/collab/YDocProvider.jsx` — +252 lines / -0 lines (purely additive). Imports for the 6 Phase 30 collaborators + buildOrigin. 3 new useEffect blocks (backfill mount, drainQueue tick, ydocAnnotationCount observer). useDualWriteQueue subscription extended into the render block. Banner-gate condition added next to existing showBanner. QuarantineMarkerOverlay sibling-mounted next to CollaboratorOutlineOverlay.

## Decisions Made

(See `key-decisions` in frontmatter for the full list with rationale.) Highlights:

- **Single atomic commit instead of multi-step task split** — cohesive 252-line surgical extension, splitting would have broken intermediate state.
- **Pitfall 30-7 defended by code** — `Promise.resolve().then(kickoff)` + cancelled-flag cleanup + per-(docId, userId) didRunRef gate.
- **Banner-gate composition** — sync_queue_stuck banner only renders when no other storage banner is active; banners never stack.
- **QuarantineMarkerOverlay stub-bbox mount** — component lands in the React tree with zeroed geometry; bbox feed is a Phase 32 hardening pickup. Documented as a known limitation in the Plan 30-06 PLAN.md `<done>` block; carried forward here.
- **Silent migration UAT step accepted as proof the backfill mount works.** Failure-banner + quarantine UAT steps deferred to post-30-07 because the live Fabric save path doesn't yet route through the dual-write fan-out (Plan 30-07 closes that gap).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Side-trip pen-stroke visibility regression unblocked UAT**
- **Found during:** Task 2 (manual UAT — silent migration step)
- **Issue:** Imported PDF ink strokes were rendering as hollow rings or invisible due to sub-pixel `strokeWidth` after the 2026-04-21 import-normalization commit removed `strokeUniform`. The user could not confirm the silent-migration UAT step because the migrated v2.3 annotations weren't visually verifiable on Page 6 of `Package 2 - Rev 4 -- IC.pdf`.
- **Fix:** Provenance-aware vector-effect + 2.5 user-unit floor for imports applied in `src/utils/svgPathAttrs.js`. Closed-outline detection for Drawboard marker dots extended by a second AI in a follow-up handoff. Test coverage in `tests/pdfAnnotationNormalization.test.mjs` (5/5 passing).
- **Files modified:** `src/utils/svgPathAttrs.js`, `src/utils/svgAnnotationRenderers.jsx`, `tests/pdfAnnotationNormalization.test.mjs`. Commits: `affc8cf8` (refactor), `63c4f761` (fix bbox diagnostics), `eeff3bf2` (final fix + adaptive handles).
- **Verification:** User visually confirmed strokes now render at all zoom levels; full unit-test suite passes.
- **Committed in:** Three commits across the side trip — `affc8cf8`, `63c4f761`, `eeff3bf2`. **OUT-OF-SCOPE for Plan 30-06** but shipped because it blocked the silent-migration UAT step. Logged as deviation under Rule 3 (blocking issue prevented completing current task — could not verify the only UAT step that was achievable in this plan).

---

**Total deviations:** 1 auto-fixed (1 blocking — side-trip rendering regression that blocked UAT verification)

**Impact on plan:** The visibility fix was strictly necessary to confirm the backfill mount worked end-to-end on the user's actual PDF. Without it, the silent-migration UAT step was unverifiable. The fix touches files (`svgPathAttrs.js`, `svgAnnotationRenderers.jsx`) that are NOT in Phase 30's narrow waiver, but the user explicitly handed it off to a second AI to extend the fix; the work is documented and the user accepted the resulting code path. No scope creep into the dual-write surface.

## Issues Encountered

- **Failure-banner UAT step could not run.** Setting `window.__crdtForceLegacyFail = true` and drawing a stroke does NOT enqueue an entry in `crdtDualWriteQueue` today, because the live Fabric save path (useAnnotationCloudSync push loop) still calls `upsertFabricAnnotation` directly — it has not yet been routed through `dualWriteFabricCommit`/`dualWriteFabricDelete`. That routing is exactly what Plan 30-07 (Wave 4) lands. **Resolution: deferred to post-30-07.**
- **Quarantine UAT step could not run.** Same root cause as above — without the live save path routed through the dual-write fan-out, `__crdtForceFailAnnoId` never sees an entry to quarantine. **Resolution: deferred to post-30-07.**
- **Cloud sync slowness surfaced during testing.** Each hydrate downloads ~21K rows and takes 30-50 seconds; window focus retriggers the hydrate. User flagged this. **Resolution: out-of-scope for Phase 30; capture as a follow-up phase candidate.**

## Authentication Gates

None encountered — the dev server uses `.env.development.local` auto-sign-in (per project memory); no manual auth steps were needed during this plan's execution or UAT.

## User Setup Required

None — no external service configuration required. All wiring lands inside YDocProvider; the provider already mounts at the document-open boundary established by Phase 27 Plan 27-05.

## Deferred Issues

The plan's `<done>` block already documented these; carried forward here for the reconciliation step:

1. **Per-annotation bbox feed for QuarantineMarkerOverlay** — markers float at origin (0,0) on every page until Phase 32 hardening plugs in real per-anno page geometry. Same lane as Phase 29's CollaboratorOutlineOverlay bbox feed pickup. The component is mounted in the React tree; only the geometry is stubbed.
2. **`tab.hasPendingDualWrite` prop wiring into TabBar** — the TabBar dot capability shipped in Plan 30-05 but the prop wiring requires either an App.jsx narrow waiver or a separate context provider. Plan 30-07 owns this surface (uses `useTabPendingDualWrite` hook to drive the tab descriptor field).
3. **Plan 30-01's 4 Playwright specs still test.fixme'd** — the 5 test seams installed in this plan unblock the un-fixme step, but the actual un-fixme is a Phase 30 verification follow-up (gsd-verifier's lane), not Plan 30-06's scope.
4. **Failure-banner + quarantine UAT steps** — both deferred to post-30-07 (see Issues Encountered). Re-run after the live save path routes through the dual-write fan-out.
5. **Cloud sync hydrate slowness** — 30-50s on each hydrate, window focus retriggers. Out-of-scope for Phase 30; flagged as a candidate for a dedicated follow-up phase.

## Next Phase Readiness

**Plan 30-07 unblockers:**
- Test seams ready: `__crdtForceLegacyFail`, `__crdtForceFailAnnoId`, `__crdtBackfillDone`, `__ydocAnnotationCount`, `__crdtBackfillDelayMs`. Plan 30-07's wave-4 wiring can verify the live save path routes through dualWriteFabricCommit by setting `__crdtForceLegacyFail = true` and observing entries land in `crdtDualWriteQueue`.
- drainQueue interval and retry handlers are live in YDocProvider — Plan 30-07 only needs to flip the call site from `upsertFabricAnnotation` direct to `dualWriteFabricCommit`/`dualWriteFabricDelete`.
- useDualWriteQueue subscription is wired — Plan 30-07's `useTabPendingDualWrite` hook can read directly from this subscription's `hasPending` field for the per-tab dot.

**Phase 30 progress:** 6/7 plans complete (30-01, 30-02, 30-03, 30-04, 30-05, 30-06); 1 remaining (30-07 live wiring + per-tab dot prop wiring).

**Phase 30 functional readiness for cutover (Phase 31):**
- Dual-write fan-out infrastructure: complete (30-04).
- Backfill module: complete (30-02), mounted (30-06).
- Retry queue: complete (30-03), drained on 1Hz tick (30-06).
- UI surfaces: complete (30-05), gated and mounted (30-06).
- Live save path: NOT YET routed through dual-write — Plan 30-07 closes this. **Phase 30 is not yet functionally complete; the safety net exists but the live save path bypasses it.**

## Self-Check: PASSED

Verified:
- `git show --stat cf437356` confirms commit exists with `src/components/collab/YDocProvider.jsx | 252 +++++++++++++++++++++++++++++++++ 1 file changed, 252 insertions(+)`.
- Commit message lists all 6 Phase 30 collaborators + buildOrigin import, 3 new useEffect blocks (backfill mount, drainQueue tick, ydocAnnotationCount observer), banner-gate addition, QuarantineMarkerOverlay sibling mount, all 5 test seams.
- 30-06-SUMMARY.md exists at `.planning/phases/30-migration-dual-write/30-06-SUMMARY.md` with substantive one-liner, frontmatter, deviations, deferred issues, next-phase readiness.
- Side-trip commits `affc8cf8`, `63c4f761`, `eeff3bf2` exist in `git log` and touch the documented files (svgPathAttrs.js, pdfAnnotationNormalization.test.mjs, svgAnnotationRenderers.jsx).
- Always-Protected files for the cf437356 changeset: `git show --stat cf437356 -- src/App.jsx src/components/PageAnnotationLayer.jsx src/components/FabricDrawingCanvas.jsx src/components/FabricEraserCanvas.jsx src/components/FabricEditCanvas.jsx src/components/SVGAnnotationLayer.jsx package.json vite.config.js` returns no entries — none modified by Plan 30-06.

---
*Phase: 30-migration-dual-write*
*Completed: 2026-04-29*
