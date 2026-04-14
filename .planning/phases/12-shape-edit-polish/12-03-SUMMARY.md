---
phase: 12-shape-edit-polish
plan: 03
subsystem: ui
tags: [react, svg, fabric, rotation, optimistic-update, gap-closure]

# Dependency graph
requires:
  - phase: 12-shape-edit-polish
    provides: "RotationInputField component, handleRotationInputCommit wiring, drag-rotate visualTransform pattern (12-01 + 12-02)"
provides:
  - "applyOptimisticRotation(idx, newAngle) helper on useSVGInteraction return API"
  - "Typed-commit path (Enter + Arrow Up/Down) now paints via visualTransform.rotate BEFORE onSaveAnnotations runs"
  - "Cleanup useEffect in SVGAnnotationLayer that clears visualTransform when persisted angle catches up"
  - "Closes 12-02-UAT Gap 1 (Tests 6 and 9 lag)"
affects: [future-shape-rotation-work, rotation-pill-polish, edit-canvas-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optimistic visual-first / commit-second: paint cheap SVG transform before heavy state dispatch (mirrors drag-rotate)"
    - "Cleanup useEffect watches [annotations] prop identity + integer-rounded tolerance to clear visualTransform"

key-files:
  created:
    - ".planning/phases/12-shape-edit-polish/12-03-PLAN.md"
    - ".planning/phases/12-shape-edit-polish/12-03-SUMMARY.md"
  modified:
    - "src/hooks/useSVGInteraction.js (+75 lines — applyOptimisticRotation helper + JSDoc)"
    - "src/components/SVGAnnotationLayer.jsx (+72 / -6 lines — wire handleRotationInputCommit + cleanup effect + cancel path)"

key-decisions:
  - "Fix is exactly the drag-rotate pattern applied to the typed-commit path — no new architecture, no new files, no changes to RotationInputField/App.jsx/PageAnnotationLayer/SVGSelectionOverlay"
  - "JSDoc block on applyOptimisticRotation includes SIDE EFFECT + drag-wins invariant markers so future refactors don't accidentally fight RotationInputField.jsx:312-320"
  - "Cleanup useEffect uses integer-rounded tolerance (Math.round === Math.round) rather than strict equality to account for float-round trip through normalizeTypedDegrees"

patterns-established:
  - "Typed-value commit paths in this codebase should paint optimistic visual first, dispatch state second — matches drag-rotate's existing instant-feel pattern"

requirements-completed: [EDIT-12]

# Metrics
duration: ~35 min (helper + wiring + UAT re-run + metadata closure)
completed: 2026-04-14
---

# Phase 12-03: EDIT-12 Gap Closure — Optimistic Rotation Paint Summary

**Typed-value rotation commits (Enter + Arrow Up/Down) now paint via `visualTransform.rotate` before `onSaveAnnotations` dispatches — mirroring drag-rotate's existing optimistic pattern and making the input field indistinguishable from drag-rotate in perceived speed.**

## Performance

- **Duration:** ~35 min (helper + wiring + UAT re-run + metadata closure)
- **Started:** 2026-04-14T15:30:00Z (approximate, plan kickoff)
- **Completed:** 2026-04-14T16:06:49Z
- **Tasks:** 3 (2 code tasks + 1 metadata closure)
- **Files modified:** 2 source files (+ 6 planning/metadata files in the closure commit)

## Accomplishments
- Closed Gap 1 from Plan 12-02's UAT (the Enter-commit and Arrow-nudge lag)
- Added `applyOptimisticRotation(annotationIndex, newAngle)` helper that exposes the same `visualTransform.rotate` optimistic paint the drag path already uses
- Wired `handleRotationInputCommit` in `SVGAnnotationLayer.jsx` to call the helper BEFORE dispatching `onSaveAnnotations`, so the SVG paints the new angle on the next frame while the heavy reducer + history fingerprinting pipeline runs in parallel
- Added cleanup `useEffect` on `[annotations]` that clears `visualTransform` once the persisted angle catches up (integer-rounded tolerance matches drag-end cleanup)
- Routed `handleRotationInputCancel` through the optimistic-transform clear so Escape-after-Enter doesn't leave a stuck transform on screen
- User confirmed "100% approved" on Tests 6 and 9 during UAT re-run — feels indistinguishable from drag-rotate

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `applyOptimisticRotation` helper to `useSVGInteraction` hook** — `ecd51419` (feat)
2. **Task 2: Wire `handleRotationInputCommit` through `applyOptimisticRotation` in `SVGAnnotationLayer`** — `70189b0f` (feat)
3. **Task 3: Metadata closure (12-02-UAT flip, SUMMARY, STATE/ROADMAP/REQUIREMENTS, FEATURE-BACKLOG)** — final `docs(12-03): complete EDIT-12 gap closure plan` commit

_Note: No TDD split this plan — the fix is a shape-preserving re-use of an existing pattern and is covered by the existing 113-test suite (113/113 green at commit `70189b0f`)._

## Files Created/Modified

- `src/hooks/useSVGInteraction.js` — new `applyOptimisticRotation(annotationIndex, newAngle)` helper (+75 lines including the prescribed JSDoc block with `SIDE EFFECT` + `drag-wins` markers). Zero changes to existing code paths.
- `src/components/SVGAnnotationLayer.jsx` — destructure `applyOptimisticRotation` + `clearOptimisticRotation` from the hook, route `handleRotationInputCommit` through the helper BEFORE `onSaveAnnotations`, add cleanup `useEffect` on `[annotations]` that clears `visualTransform` when the persisted angle catches up (integer-rounded tolerance), route `handleRotationInputCancel` through the optimistic-transform clear (+72 / -6 lines)
- `.planning/phases/12-shape-edit-polish/12-03-PLAN.md` — plan itself (exists since kickoff)
- `.planning/phases/12-shape-edit-polish/12-03-SUMMARY.md` — this file
- `.planning/phases/12-shape-edit-polish/12-02-UAT.md` — Tests 6 and 9 flipped `issue` → `pass`, Gap 1 marked `resolved`, Gaps 3 and 4 added (newly discovered pre-existing 12-02 bugs)
- `.planning/FEATURE-BACKLOG.md` — Rotation-handle-off-screen feature request added under Stage 0
- `.planning/STATE.md` — advanced plan position, recorded 12-03 completion, noted 2 new 12-02 gaps for triage
- `.planning/ROADMAP.md` — plan 12-03 added to Phase 12 plans list and marked complete
- `.planning/REQUIREMENTS.md` — EDIT-12 marked delivered (with note about 2 open polish gaps)

## Decisions Made
- **Apply drag-rotate's existing pattern instead of re-architecting the commit pipeline.** The plan's root-cause reading of `useSVGInteraction.js:469` confirmed drag-rotate already paints first and commits second. The fix is identical shape: expose `visualTransform.rotate` to the typed-commit path via a thin helper, let the existing cleanup pattern handle the clear. Zero new architecture, zero changes to RotationInputField/App.jsx/PageAnnotationLayer/SVGSelectionOverlay (all DO NOT CHANGE per phase 12 boundaries).
- **Cleanup useEffect watches `[annotations]` with integer-rounded tolerance.** Not strict equality — `normalizeTypedDegrees` round-trips through a float path and the persisted angle can come back as e.g. 44.999 or 45.001. `Math.round(persisted) === Math.round(pending)` matches the drag-end cleanup behavior at `useSVGInteraction.js:654` and avoids stuck transforms.
- **Route Escape-after-Enter through `clearOptimisticRotation`.** Cheap insurance against a stuck transform on rapid Enter → Escape sequences. Mirrors drag cancel.

## Deviations from Plan

### Scope deviations noted (all accepted as intent-met, not scope creep)

**1. [Rule 1 — Spec bug] Task 1 LOC overage (+75 vs ≤60 cap)**
- **Found during:** Task 1 implementation
- **Issue:** The plan specified a ≤60 LOC cap on the `applyOptimisticRotation` helper, but the plan ALSO mandated a specific JSDoc block with `SIDE EFFECT` + `drag-wins` invariant markers referencing `RotationInputField.jsx:312-320`. The JSDoc block alone is ~15 lines. The helper body at minimum readable form is ~60 lines. Total: 75 lines.
- **Fix:** Shipped all 75 lines. The LOC cap was inconsistent with the JSDoc requirement the plan itself mandated. Zero scope creep — every line is either the prescribed JSDoc or the minimum-viable helper body.
- **Files modified:** src/hooks/useSVGInteraction.js
- **Verification:** Existing code paths untouched, 113/113 tests green
- **Committed in:** `ecd51419`

**2. [Rule 1 — Spec bug] Task 2 verification script bug (plan used `!/pattern/` instead of `!/pattern/.test(src)`)**
- **Found during:** Task 2 verify step
- **Issue:** The plan's verify script had two checks written as `!/pattern/` which in JavaScript is always truthy (a negated RegExp literal is not the same as `!regex.test(src)`). Those two checks would always return false regardless of file content.
- **Fix:** Manually verified the intent with grep — confirmed zero stray `selectAnnotation` / `deselectAll` occurrences in `SVGAnnotationLayer.jsx`. The intent of "don't modify existing select/deselect code paths" is met.
- **Files modified:** None (verification-only)
- **Verification:** Manual grep confirmed
- **Committed in:** n/a (not a code change)

**3. [Rule 4-adjacent — Spec miscount] Acceptance criterion `setVisualTransform` count mismatch**
- **Found during:** Task 2 post-execution AC verification
- **Issue:** The plan's acceptance criteria expected exactly 6 occurrences of `setVisualTransform` in `SVGAnnotationLayer.jsx` after the fix. Actual count was 9 (the plan author missed the line 41 declaration, the line 654 drag-end cleanup, and one comment reference).
- **Fix:** Did NOT add or remove call sites. All 5 pre-existing call sites at lines 290/296/446/469/654 are preserved verbatim — only the new commit-path call sites were added per plan intent. The AC intent ("don't modify existing code") is met.
- **Files modified:** None (verification-only)
- **Verification:** Confirmed all pre-existing call sites untouched via git diff
- **Committed in:** n/a (not a code change)

---

**Total deviations:** 3 accepted as intent-met (2 spec bugs in the plan itself, 1 spec miscount). **Impact on plan:** None — all three are artifacts of the plan being imperfect, not of the execution drifting. The user-facing behavior matches the acceptance criteria ("typed-commit path is visually indistinguishable from drag-rotate").

## Issues Encountered
- None during implementation (the fix is a shape-preserving re-use of an existing pattern).
- **NEW issues discovered during UAT re-run** (filed as Gaps 3 and 4 in 12-02-UAT.md — NOT regressions from 12-03):
  1. **Rotation pill doesn't appear on hover after returning from edit mode via click-off.** Repro: double-click shape → edit mode → click off → back in select mode → hover mtr handle → pill does NOT appear. Workaround: full deselect + reselect. Log evidence at `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log`. Suspected root cause: hover-intent effect in `SVGAnnotationLayer.jsx` has a stale `handleEl` ref after React reconciles the overlay post-edit-commit. Scope: NOT touched by 12-03.
  2. **Rotation handle (mtr) is clipped when a rotated shape enters edit mode.** Only happens at non-zero rotation. Suspected root cause: `FabricEditCanvas` container has `overflow: hidden` / tight clip-path that cuts off content outside the shape's local bbox. Scope: NOT touched by 12-03.

Both are pre-existing 12-02 bugs that happened to surface during the 12-03 UAT re-run. They will need a future phase (12.1 gap-closure or 13.x) to address.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

**Verification:**
- Commit `ecd51419` (Task 1): `git log --oneline` FOUND — `feat(12-03): add applyOptimisticRotation helper to useSVGInteraction`
- Commit `70189b0f` (Task 2): `git log --oneline` FOUND — `feat(12-03): wire handleRotationInputCommit through optimistic paint`
- `src/hooks/useSVGInteraction.js` modified (+75 lines): verified via `git show ecd51419 --stat`
- `src/components/SVGAnnotationLayer.jsx` modified (+72/-6 lines): verified via `git show 70189b0f --stat`
- Test suite green at `70189b0f`: user-confirmed 113/113 pass
- Build clean at `70189b0f`: user-confirmed 1632 modules, 23.88s
- UAT re-run: Tests 6 and 9 flipped `issue` → `pass`, user-confirmed "100% approved"

## Next Phase Readiness

- **Phase 12 status:** Plan 12-03 complete. Phase 12 now has 3 plans done (12-01, 12-02, 12-03) out of the original 2 planned + 1 gap-closure. Remaining phase work: `/gsd:verify-work` → 12-RECONCILIATION.md → mark Phase 12 complete → close milestone v2.1.
- **Carry-forward for 12-RECONCILIATION.md:**
  - EDIT-12 is delivered WITH two open polish gaps (Gaps 3 and 4 in 12-02-UAT.md). The reconciliation should note this explicitly rather than claiming EDIT-12 is fully done.
  - The two new gaps should be triaged into a future phase (12.1 gap-closure or 13.x). They are pre-existing 12-02 bugs, not 12-03 regressions.
  - The `applyOptimisticRotation` helper establishes a reusable pattern that any future typed-commit path in this codebase should follow. Worth documenting in the reconciliation as a carry-forward convention.

---
*Phase: 12-shape-edit-polish*
*Completed: 2026-04-14*
