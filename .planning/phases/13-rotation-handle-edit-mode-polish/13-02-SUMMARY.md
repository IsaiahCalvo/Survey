---
phase: 13-rotation-handle-edit-mode-polish
plan: "02"
subsystem: ui
tags: [fabric, edit-mode, transform-handles, rescope, waiver]

# Dependency graph
requires:
  - phase: 12-shape-edit-polish
    provides: "Shape edit-mode flow (double-click → FabricEditCanvas mount)"
  - plan: 13-01
    provides: "Baseline Phase 13 commits, counter-session lane protocol"
provides:
  - "No Fabric transform handles visible in edit mode for any shape type (rect/circle/ellipse/text/counter)"
  - "Figma-style separation: edit mode = content editing (fill/stroke/text), select mode = transform (resize/rotate)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Kill Fabric transform chrome at the edit-mount site (hasControls: false on obj.set) instead of trying to hide it via SVG chrome short-circuits"

key-files:
  created: []
  modified:
    - src/components/FabricEditCanvas.jsx

key-decisions:
  - "Original AC rescoped mid-plan: from 'mtr handle visible with no clipping on pre-rotated edit entry' to 'no transform handles in edit mode for ANY shape' — user decision after Fix A caused a React render loop"
  - "One-time narrow lane waiver to touch src/components/FabricEditCanvas.jsx — normally counter-session-forbidden per feedback_no_rotation_input_field.md. Waiver scoped to one specific change (hasControls: false) only"
  - "Counter-session WIP stash conflict resolved in favor of hasControls: false (the old stashed WIP had hasControls: true for counters; user confirmed counter session is also moving to 'no handles in edit mode')"

patterns-established:
  - "Lane-waiver protocol: when a locked strategy fails and the only viable fix requires touching a counter-session lane file, STOP and escalate; do not self-pivot. User-authorized waivers must be narrow, explicit, and logged in the session moments file"

requirements-completed:
  - EDIT-14 (rescoped — see Deviations below)

# Metrics
duration: ~2h (including render-loop debug + full revert sequence + rescope)
completed: 2026-04-14
---

# Phase 13 Plan 02: EDIT-14 No Transform Handles in Edit Mode Summary

**Kill all Fabric.js transform handles (corner scale boxes, mid-point resize, rotation mtr) in edit mode for every shape type via a single `hasControls: false` change in `FabricEditCanvas.jsx`. Rescoped mid-plan after the original SVG-side approach caused a React "Maximum update depth exceeded" render loop.**

## Performance

- **Duration:** ~2h (original approach 45min + revert 15min + rescope debate 20min + Fabric-side fix 5min + stash dance 10min + UAT 10min)
- **Started:** 2026-04-14
- **Completed:** 2026-04-14 (UAT verified across rect/circle/counter/text shape types)
- **Tasks:** 3 (original implementation → revert → rescoped re-implementation)
- **Files modified:** 1 (`src/components/FabricEditCanvas.jsx` — net 3-line delta: 2 × `hasControls: false`, 1 × inline UX comment)

## Accomplishments

- Eliminated all Fabric transform chrome from edit mode for rect, circle, ellipse, text, and counter shapes via two targeted `hasControls: false` edits in FabricEditCanvas.jsx:
  - `:1320` (shape-edit mount path) — `obj.set({ ..., hasControls: false, ... })`
  - Full-page callout mount path at ~`:1570` — same pattern
- UAT verified 7 clean probe hits across rect/circle/counter/text shape types in `1.log` — every shape type logs `hasControls:false` at the edit-mount site before Fabric's controls layer ever paints
- Figma-style separation achieved: edit mode exposes content-editing affordances only (fill, stroke, text); all transform operations (resize, rotate) require exiting edit mode back to select mode where the SVG selection overlay still owns the chrome
- Move-in-edit-mode still works (shape is draggable with `selectable: true, evented: true`) — only the scale/rotate handles were killed, the hit zone and drag behavior are intact

## Task Commits

1. **Task 1: Original SVG-side implementation (REVERTED)** — `0a7248ab` — `fix(13-02): EDIT-14 mtr handle visible on pre-rotated edit entry` — narrowed `SVGAnnotationLayer.jsx:1050` short-circuit to `editIsBorderFlush && angle === 0`, added `isEditing` prop + mtr-only branch in `SVGSelectionOverlay.jsx`. Caused infinite React render loop.
2. **Task 1 deviation: UAT diagnostic probe (REVERTED)** — `8de06e94` — `chore(13-02): temp UAT diagnostic probe for EDIT-14 pre-rotated mtr`
3. **Task 1 deviation: docs checkpoint (REVERTED)** — `b550eecb` — `docs(13-02): mark plan at human UAT checkpoint in STATE.md`
4. **Revert sequence (3 commits)** — `5e8f4cdb`, `76e18f67`, `c5dad8cb` — reverted the three 13-02 commits in reverse order after the render loop was discovered via `1.log`
5. **Task 2: Rescoped Fabric-side implementation** — `6d0b56b6` — `fix(13-02): EDIT-14 no transform handles in edit mode (all shapes)` — three-line change in `src/components/FabricEditCanvas.jsx` (+ one UAT probe console.log at the shape-edit path). Committed with a one-time narrow user waiver to touch the counter-session lane file
6. **Task 3: UAT probe removal** — `4fe9e210` — `chore(13-02): remove EDIT-14 UAT probe` — stash-dance revert: counter-session WIP in FabricEditCanvas.jsx stashed, probe removed, committed, stash popped with auto-merge (no conflicts)
7. **Task 4: Human UAT** — Approved by user on 2026-04-14 via `1.log` probe evidence (7 clean hits across rect/circle/counter/text) — "i did the test and it worked"

## Files Created/Modified

- `src/components/FabricEditCanvas.jsx` — two edit-mount paths (`:1320` shape-edit and `:~1570` full-page callout) now set `hasControls: false` with an inline UX comment explaining the Figma-style separation. Net source delta: 3 added lines, 0 removed lines (not counting the probe lifecycle).

## Decisions Made

- **Rescope: "mtr handle visible on pre-rotated edit entry" → "no transform handles in edit mode at all"** — User decision mid-plan after seeing the render-loop bug via `1.log`. The original AC described a specific symptom (clipped mtr handle on pre-rotated shapes); the rescoped solution satisfies the intent more completely by eliminating the entire class of "transform chrome during edit mode" issues. Edit mode is for content; transform happens in select mode. Logged as DECISION in session-moments/2026-04-14.md.
- **Narrow one-time waiver to touch `src/components/FabricEditCanvas.jsx`** — Normally forbidden per `feedback_no_rotation_input_field.md` and explicitly called out in `13-CONTEXT.md` DO NOT CHANGE section ("If Fix A is insufficient, STOP and escalate to user — do not self-pivot"). I did stop and escalate. User authorized exactly one change: `hasControls: false` in edit paths. Future-Claude: treat as ONE-TIME exception, NOT a blanket unlock. Logged as WAIVER in session-moments/2026-04-14.md.
- **Stash conflict resolved in favor of `hasControls: false`** — The stashed counter-session WIP had `hasControls: true` on counters (to support a custom rotate control in edit mode). User confirmed the counter session is also moving to "no handles in edit mode", so the stashed value is obsolete. The other ~545 lines of counter-session MiniToolbar WIP applied cleanly on stash pop (auto-merge, no conflicts).
- **UAT probe lifecycle (add + commit + test + stash-dance revert)** — Matches `feedback_one_fix_one_test.md`. The stash dance was required because `FabricEditCanvas.jsx` has 545+ lines of unstaged counter-session WIP that must not land in any Phase 13 commit.

## Deviations from Plan

### Rescope: "visible mtr on pre-rotated edit entry" → "no transform handles in edit mode"

- **Found during:** Task 1 (original SVG-side implementation, post-commit browser test)
- **Issue:** The locked strategy (Fix A / Option C: narrow `SVGAnnotationLayer.jsx:1050` short-circuit + `SVGSelectionOverlay.jsx isEditing` prop) caused a React "Maximum update depth exceeded" render loop. Render loop was diagnosed via `1.log` output.
- **Fix:** Reverted all three 13-02 commits. Escalated to user. User rescoped the plan from "fix mtr clipping" to "kill all transform handles in edit mode (Figma-style)". The rescoped approach required touching `FabricEditCanvas.jsx` (counter-session lane) which is explicitly DO NOT CHANGE in `13-CONTEXT.md`. User authorized a one-time narrow waiver for this specific change.
- **Files modified:** `src/components/FabricEditCanvas.jsx` (3-line delta)
- **Verification:** `1.log` shows 7 clean probe hits across rect/circle/counter/text shape types at the edit-mount site — every shape logs `hasControls:false` as expected
- **Committed in:** Revert sequence (`5e8f4cdb`, `76e18f67`, `c5dad8cb`) + rescoped fix (`6d0b56b6`) + probe revert (`4fe9e210`)

### AC delta vs original plan

Original `13-CONTEXT.md` Acceptance Criteria for EDIT-14 (lines 198-206) said:
> "Given a rect annotation with angle=30, when the user double-clicks to enter edit mode, then the full rotation handle (circle + connector + icon) is visible with no clipping"

The rescoped implementation does NOT make the mtr handle visible in edit mode — it makes NO handles visible in edit mode. The underlying user pain (frustration with the edit-mode rotation affordance) is addressed more completely by moving rotation to select mode. See RECONCILIATION.md for the full AC reconciliation matrix.

---

**Total deviations:** 2 (render loop revert + full rescope) — user-approved, documented, bounded by a one-time waiver
**Impact on plan:** The original AC is no longer literally satisfied; the rescoped AC ("no transform handles in edit mode") is fully satisfied. User explicitly approved the rescope.

## Issues Encountered

- **React render loop in original SVG-side approach** — The `isEditing` prop threaded from `SVGAnnotationLayer.jsx` to `SVGSelectionOverlay.jsx` triggered a re-render cascade when combined with the existing selection overlay's own state subscriptions. Not investigated to root cause because the rescope eliminated the need for the prop entirely.
- **Counter-session WIP collision on FabricEditCanvas.jsx** — The file had 545+ lines of unstaged counter-session MiniToolbar WIP. Required a stash dance for both the implementation commit (stashed WIP, committed `hasControls: false`, popped with one conflict at the same line resolved in favor of `hasControls: false`) and the probe revert commit (stashed WIP, removed probe, committed, popped with auto-merge succeeding cleanly).

## User Setup Required

None — no external service configuration required. Verification requires only a hard-reload of the dev server (`http://localhost:5173/`).

## Next Phase Readiness

- EDIT-14 fully closed under the rescoped AC ("no transform handles in edit mode"). Reconciliation of the original AC vs rescoped AC is documented in `13-RECONCILIATION.md`.
- Phase 13 is ready for RECONCILIATION.md + `gsd-tools phase complete 13`.
- Counter-session WIP lane remains intact in the working tree (all 7 files still modified, ready for the counter session to test).
- v2.2 milestone is ready to close after Phase 13 RECONCILIATION.

## Self-Check: PASSED

- `src/components/FabricEditCanvas.jsx` — modified (implementation in `6d0b56b6`, probe removed in `4fe9e210`)
- Original implementation revert sequence — 3 commits verified in git log
- Rescoped implementation commit `6d0b56b6` — verified exists
- Probe revert commit `4fe9e210` — verified exists
- Counter-session WIP — 7 files still modified in working tree, zero Phase 13 leakage
- UAT evidence — `1.log` has 7 clean `[EDIT-14 probe]` hits across rect/circle/counter/text
- User explicitly approved: "i did the test and it worked"
- SUMMARY.md written at `.planning/phases/13-rotation-handle-edit-mode-polish/13-02-SUMMARY.md`

---
*Phase: 13-rotation-handle-edit-mode-polish*
*Completed: 2026-04-14*
