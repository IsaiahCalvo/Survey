---
phase: 12-shape-edit-polish
verified: 2026-04-14T00:00:00Z
status: human_needed
human_decision: "2026-04-14 — User chose Option A (close Phase 12, backlog Gaps 3 and 4 to v2.2+). See 12-RECONCILIATION.md."
score: 5/5 must-haves verified (2 open polish gaps deferred)
re_verification: null

requirements:
  EDIT-11:
    status: delivered
    evidence:
      - src/utils/svgTransformMath.js:121-127 (snapAngleToNearest45 helper, % 360 defensive wrap)
      - src/hooks/useSVGInteraction.js:12 (import)
      - src/hooks/useSVGInteraction.js:456-461 (let newAngle + if e.shiftKey wire in rotate branch)
      - tests/svgTransformMath.test.mjs (10 cases, all green)
  EDIT-12:
    status: delivered_with_open_polish_gaps
    evidence:
      - src/utils/rotationInputHelpers.js (184 LOC, normalizeTypedDegrees + computeInputPosition)
      - src/components/RotationInputField.jsx (646 LOC, HTML portal, uncontrolled input)
      - src/components/SVGSelectionOverlay.jsx:168 (data-rotation-handle="mtr" attribute)
      - src/components/SVGAnnotationLayer.jsx:37 (import)
      - src/components/SVGAnnotationLayer.jsx:132,365-439,1299-1309 (parent wiring + optimistic-paint cleanup)
      - src/hooks/useSVGInteraction.js:835-855 (applyOptimisticRotation)
      - src/hooks/useSVGInteraction.js:861-863 (clearOptimisticRotation)
      - tests/rotationInputHelpers.test.mjs (34 cases, all green)
    open_polish_gaps:
      - "Gap 3: pill does not reappear on hover after returning from edit mode via click-off"
      - "Gap 4: rotation handle (mtr) clipped when a pre-rotated shape enters edit mode"
  ZOOM-09:
    status: delivered
    evidence:
      - src/utils/zoomController.js:15 (MIN_SCALE = 0.1)
      - src/App.jsx:22441 (Math.max(parsed, 10) in commitZoomInput — note: line shifted from 21999 to 22441 due to counter-tool WIP edits further up App.jsx, but the ZOOM-09 clamp is intact and unchanged)
      - tests/zoomController.test.mjs (7 cases, floor=0.1, ceiling=5.0, NaN fallback all green)

gaps:
  - truth: "Rotation pill reappears on hover after returning from edit mode via click-off"
    status: failed
    severity: minor
    classification: pre_existing_12-02_bug_surfaced_in_12-03_UAT
    reason: "User repro in 12-03 UAT re-run: double-click shape → edit mode → click off → back in select mode → hover mtr handle → pill does NOT appear. Workaround: full deselect+reselect. Suspected root cause: hover-intent effect in SVGAnnotationLayer.jsx has a stale handleEl ref after React reconciles the overlay post-edit-commit."
    artifacts:
      - path: "src/components/SVGAnnotationLayer.jsx"
        issue: "hover-intent effect (~line 210-250) dep array may not re-run after edit-commit triggers an annotations prop identity change"
    missing:
      - "Code read of hover-intent effect dep array in SVGAnnotationLayer.jsx"
      - "Verify handleEl ref stability across annotation prop identity changes"
  - truth: "Rotation handle (mtr) is fully visible and interactive when a rotated shape enters edit mode"
    status: failed
    severity: minor
    classification: pre_existing_12-02_bug_surfaced_in_12-03_UAT
    reason: "User repro in 12-03 UAT re-run: rotate shape → enter edit mode → rotation handle geometry is clipped by an invisible boundary. Does NOT happen at 0° rotation — only when shape is pre-rotated. Suspected root cause: FabricEditCanvas container has overflow: hidden / tight clip-path cutting off content outside the shape's local bbox."
    artifacts:
      - path: "src/components/FabricEditCanvas.jsx"
        issue: "Container CSS / clip-path may have tight bounds that truncate the mtr handle when its rotated position extends outside the shape's local bbox"
    missing:
      - "Code read of FabricEditCanvas container CSS / overflow rules"
      - "Verify SVGSelectionOverlay z-index during edit mode"
      - "Check whether mtr handle is rendered under the clipped canvas or above it"

human_verification: null
---

# Phase 12: Shape Edit Polish — Verification Report

**Phase Goal (from ROADMAP.md):** Shape rotation feels precise and predictable (soft Shift-snap to 45° when the user is near an increment, exact-value input for typed angles) and the usable zoom range extends down to 10% for whole-page inspection of mechanical/electrical drawings.

**Milestone:** v2.1 Shape Edit Polish & Foundation Wins
**Verified:** 2026-04-14
**Status:** `human_needed` — all 5 core must-haves delivered and code-verified; EDIT-12 has 2 pre-existing polish gaps deferred to a future decimal phase or v2.2+ backlog triage.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can drag the SVG rotation handle with Shift held and angle soft-snaps to nearest 45° only within 3° — free outside the threshold, always free without Shift | VERIFIED | `svgTransformMath.js:121-127` + `useSVGInteraction.js:456-461` + 10 unit tests in `tests/svgTransformMath.test.mjs` covering 44→45, 41 free, 23 free, 358→0 wrap, exact 0/45/135, 317→315 |
| 2 | User sees an inline numeric degree input near the rotation handle; can type, commit with Enter/blur, cancel with Escape; typed values normalize to [0, 360) and apply atomically | VERIFIED WITH POLISH GAPS | `RotationInputField.jsx` (646 LOC), `rotationInputHelpers.js` normalizeTypedDegrees, `SVGAnnotationLayer.jsx` wiring + optimistic paint. UAT re-run: 13/14 pass (1 skipped by user de-scope of blur-commit AC). Polish gaps 3 & 4 discovered during re-run — pre-existing 12-02 bugs, not 12-03 regressions. |
| 3 | User can zoom to 10% via every entry point without silent re-clamp to 50% | VERIFIED | `zoomController.js:15` (MIN_SCALE=0.1 atomic with) `App.jsx:22441` (Math.max(parsed, 10)) + 7 unit tests. Plan 12-01 shipped both values in one atomic commit `df43b0f8`. |
| 4 | At zoom levels below 25% handles remain visible but hard to target (accepted table-stakes) | VERIFIED (by design) | No JS clamp prevents rendering; SVG handles use inverseScale (svgTransformMath.js:72-76). Accepted behavior per CONTEXT.md. |
| 5 | No existing behavior regresses: free rotation still floats, Shift+resize aspect-lock still works, every zoom method funnels through clampScale, zoomGeneration signal contract preserved | VERIFIED | `useSVGInteraction.js:361` Shift+resize aspect-lock untouched. `useSVGInteraction.js:459` adds `if (e.shiftKey) newAngle = snapAngleToNearest45(...)` WITHOUT disturbing the else branch (free rotation preserved). `zoomController.js` clampScale unchanged in structure — only `MIN_SCALE` literal changed. `zoomGeneration` signal untouched (EDIT-12 is SVG+HTML portal, no Fabric Canvas interaction). `npm test` → 113/113 green. |

**Score:** 5/5 truths verified. 2 open polish gaps attached to Truth #2, classified as pre-existing 12-02 defects (not regressions from 12-01 or 12-03).

---

## Required Artifacts — All Three Levels (Exists / Substantive / Wired)

### EDIT-11 Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `src/utils/svgTransformMath.js` (snapAngleToNearest45 export) | yes (line 121) | yes (full body with % 360 wrap + JSDoc) | yes (imported in useSVGInteraction.js:12) | VERIFIED |
| `src/hooks/useSVGInteraction.js` (rotate branch snap wire) | yes | yes (let newAngle at 456, if e.shiftKey at 459, snap call at 460) | yes (runs inside handlePointerMove which is exported as the rotate pointer handler) | VERIFIED |
| `tests/svgTransformMath.test.mjs` | yes | yes (10 TDD cases) | N/A (test file) — all green | VERIFIED |

### EDIT-12 Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `src/utils/rotationInputHelpers.js` | yes (184 LOC) | yes (`normalizeTypedDegrees`, `computeInputPosition`, constant-radius EXTENSION) | yes (imported by RotationInputField.jsx) | VERIFIED |
| `src/components/RotationInputField.jsx` | yes (646 LOC) | yes (HTML portal via createPortal, uncontrolled input, hover-intent, drag-wins sync, Enter/Escape/blur, Arrow nudging, constant-radius pill) | yes (imported and mounted in SVGAnnotationLayer.jsx:37,1299) | VERIFIED |
| `src/components/SVGSelectionOverlay.jsx` (data-rotation-handle="mtr") | yes (line 168) | yes (attribute present on the rotation handle `<g>`) | yes (queried by both RotationInputField.jsx:116 and SVGAnnotationLayer.jsx:232 via querySelector) | VERIFIED |
| `src/components/SVGAnnotationLayer.jsx` (parent wiring) | yes | yes (RotationInputField mounted as sibling with live angle + annotation index + svgRef + shapeCenterViewBox + visibility state machine; handleRotationInputCommit uses optimistic paint; handleRotationInputCancel clears optimistic paint; cleanup useEffect on [annotations] at line 412-426) | yes (onCommit + onCancel wired at line 1307-1308) | VERIFIED |
| `src/hooks/useSVGInteraction.js` (applyOptimisticRotation) | yes (line 835) | yes (computes bbox, center, deltaAngle, dispatches visualTransform.rotate with matching payload shape as drag-rotate) | yes (exported on return API at line 887-888, consumed by SVGAnnotationLayer.jsx:132) | VERIFIED |
| `tests/rotationInputHelpers.test.mjs` | yes (365 LOC, 34 tests) | yes (normalization edge cases + constant-radius placement math) | N/A (test file) — all green | VERIFIED |

### ZOOM-09 Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `src/utils/zoomController.js:15` (MIN_SCALE = 0.1) | yes | yes (literal constant used by `clampScale` at line 23) | yes (`clampScale` is the only funnel all zoom entry points use; exported and imported across App.jsx) | VERIFIED |
| `src/App.jsx` (commitZoomInput pre-clamp) | yes (line 22441) | yes (`Math.max(parsed, 10)` then `clampScale(clamped / 100)`) | yes (called from zoom input onBlur / Enter handler at line 22452-22462) | VERIFIED |
| `tests/zoomController.test.mjs` | yes | yes (7 boundary tests: 0.1 floor, 0.05→0.1 clamp, 0.5 untouched, 5.0 ceiling, 6.0→5.0, NaN→1.0, string→1.0) | N/A (test file) — all green | VERIFIED |

**Note on line number drift for ZOOM-09:** The 12-01-SUMMARY references `App.jsx:21999` as the commitZoomInput site. Actual current location is `App.jsx:22441`. The drift is NOT a regression of ZOOM-09 — it is caused by the uncommitted counter-tool WIP in App.jsx (inserted code earlier in the file shifts later line numbers). The `Math.max(parsed, 10)` token itself is intact and unchanged.

---

## Key Link Verification

| From | To | Via | Status | Evidence |
|------|-----|-----|--------|----------|
| `RotationInputField` | `SVGSelectionOverlay` mtr handle | `querySelector('[data-rotation-handle="mtr"]')` at RotationInputField.jsx:116 | WIRED | Attribute exists at SVGSelectionOverlay.jsx:168 |
| `SVGAnnotationLayer.handleRotationInputCommit` | `useSVGInteraction.applyOptimisticRotation` | Destructured from hook at SVGAnnotationLayer.jsx:132, called at line 377 | WIRED | Hook returns it at useSVGInteraction.js:887 |
| `SVGAnnotationLayer` cleanup useEffect | `clearOptimisticRotation` | Called at SVGAnnotationLayer.jsx:418,424; useEffect watches [annotations] | WIRED | Integer-rounded tolerance check at line 422 |
| `useSVGInteraction` rotate branch | `snapAngleToNearest45` | Imported at line 12, called at line 460 inside `if (e.shiftKey)` guard | WIRED | Line 456 promoted from const to let as required |
| `App.jsx commitZoomInput` | `zoomController.clampScale` + `controller.setScale` | Line 22441 (`Math.max(parsed, 10)`) → 22444 (`clampScale(clamped / 100)`) → 22445 (`controller.setScale`) | WIRED | Both files commit together in `df43b0f8` per 12-01-SUMMARY |
| `FabricEditCanvas` rotation handle | Edit-mode container clip boundary | (unknown — needs code read) | SUSPECT NOT_WIRED | Gap 4: user reports visible clipping of mtr handle when pre-rotated shape enters edit mode |
| `SVGAnnotationLayer` hover-intent effect | `handleEl` ref after annotations prop identity change | (unknown — needs code read) | SUSPECT STALE | Gap 3: user reports pill no longer appears on hover after returning from edit mode via click-off, until full deselect+reselect re-mounts overlay |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| EDIT-11 | 12-01 | Soft Shift-snap rotation to nearest 45° within 3° threshold; free outside threshold; release Shift returns free | SATISFIED | `snapAngleToNearest45` pure helper + `useSVGInteraction.js:459` wire + 10 unit tests green + 12-01-SUMMARY confirms 44°→45°, 41° free, 358°→0° wrap |
| EDIT-12 | 12-02, 12-03 | Inline numeric rotation input near handle; type / Enter / blur / Escape; normalize to [0, 360); atomic apply; tracks handle during rotation; on-screen at zoom ≥ 25% | SATISFIED WITH OPEN POLISH GAPS | `RotationInputField` (646 LOC) + `rotationInputHelpers` (184 LOC + 34 tests) + SVGAnnotationLayer parent wiring + optimistic paint (12-03). 12-02-UAT re-run: 13/14 pass (1 user-descoped). Polish gaps 3 & 4 = pre-existing 12-02 bugs, deferred. |
| ZOOM-09 | 12-01 | Zoom down to 10% via every entry point without silent re-clamp | SATISFIED | `zoomController.js:15` (MIN_SCALE=0.1) + `App.jsx:22441` (Math.max(parsed, 10)) atomic commit + 7 unit tests green + clampScale is the only funnel |

**Cross-reference against REQUIREMENTS.md (lines 67-73):**
- EDIT-11: `[ ]` unchecked in REQUIREMENTS.md (line 67). Traceability table line 147 marks it Pending. **Mismatch**: The implementation is fully delivered per code read + test suite + 12-01-SUMMARY; REQUIREMENTS.md checkbox is stale. **Reconciliation action:** flip EDIT-11 to `[x]` and mark traceability table Complete.
- EDIT-12: `[x]` checked (line 69) with an explicit note about 2 open polish gaps and a pointer to 12-02-UAT.md. Traceability table line 148 marks it Complete. **CONSISTENT.**
- ZOOM-09: `[ ]` unchecked (line 73). Traceability table line 149 marks it Pending. **Mismatch**: Same as EDIT-11 — code is shipped, checkbox is stale. **Reconciliation action:** flip ZOOM-09 to `[x]` and mark traceability Complete.

**Orphaned requirements check:** No requirements IDs appear in `.planning/REQUIREMENTS.md` mapped to Phase 12 that are missing from Phase 12 plan frontmatters. All three (EDIT-11, EDIT-12, ZOOM-09) are claimed by `12-01-PLAN.md` (EDIT-11 + ZOOM-09) and `12-02-PLAN.md` / `12-03-PLAN.md` (EDIT-12).

---

## Anti-Pattern Scan

**Scanned files:** All 10 files modified during Phase 12:
- `src/utils/svgTransformMath.js`
- `src/utils/zoomController.js`
- `src/utils/rotationInputHelpers.js`
- `src/hooks/useSVGInteraction.js`
- `src/components/RotationInputField.jsx`
- `src/components/SVGSelectionOverlay.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/utils/svgAnnotationRenderers.jsx`
- `src/App.jsx` (line 22441 only — Phase 12 scope; other edits are counter-tool WIP)

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `RotationInputField.jsx` | 74-298 (scattered) | Inert diagnostic scaffolding under `const LOG = false` guard | Info | ~80 lines of dead-weight logs; doesn't affect runtime; deferred to optional v2.2+ cleanup per 12-02-SUMMARY. Not a blocker. |
| `useSVGInteraction.js` | 835-863 | Extensive JSDoc with `SIDE EFFECT` / `drag-wins invariant` markers | Info (positive) | This is intentional documentation per 12-03 decisions; prevents future refactors from breaking RotationInputField.jsx:312-320 |
| `App.jsx` | (various lines outside 22441) | Uncommitted counter-tool WIP mixed into working tree | Warning | NOT part of Phase 12. Counter-tool session's lines are untouched by Phase 12. Flagged for git status awareness only. |

**No blocker anti-patterns found in Phase 12 scope.** The `LOG=false` diagnostics and counter-tool WIP are both informational — they do not violate Phase 12 goals.

---

## Test Baseline

`npm test` at verification time: **113/113 pass, 0 fail, 0 skipped.**

Breakdown (relevant to Phase 12):
- `tests/svgTransformMath.test.mjs`: 10/10 (EDIT-11 snap helper)
- `tests/zoomController.test.mjs`: 7/7 (ZOOM-09 clampScale boundaries)
- `tests/rotationInputHelpers.test.mjs`: 34/34 (EDIT-12 helpers + constant-radius placement)

**No regression detected** — baseline matches 12-02-SUMMARY and 12-03-SUMMARY claims.

---

## Gap Surface Summary

Phase 12 delivers all three core requirements (EDIT-11, EDIT-12, ZOOM-09) at the code + test level. **EDIT-12 ships with 2 open polish gaps** (Gaps 3 and 4 in `12-02-UAT.md`) that:

1. Were discovered during the **12-03 UAT re-run**, NOT during the original 12-02 UAT run.
2. Are **pre-existing 12-02 polish bugs** — not regressions from Plan 12-03's optimistic-paint fix. The 12-03 fix touched only `useSVGInteraction.js` (applyOptimisticRotation helper) and `SVGAnnotationLayer.jsx` (handleRotationInputCommit wire + cleanup useEffect). It did NOT touch hover-intent logic (Gap 3) or edit-canvas sizing/overflow (Gap 4).
3. Are both **severity: minor** — neither blocks the core EDIT-12 workflow (hover → type → Enter → commit).
4. Affect **different subsystems** (SVGAnnotationLayer hover-intent vs FabricEditCanvas clip boundary), so they cannot share a root-cause fix.

**Gap 3 — pill doesn't reappear on hover after edit-mode click-off:**
Suspected root cause: the hover-intent effect's `handleEl` ref becomes stale after React reconciles the overlay post-edit-commit. Workaround exists (full deselect+reselect). Code investigation needed in SVGAnnotationLayer.jsx hover-intent effect dependency list and ref stability.

**Gap 4 — mtr handle clipped when pre-rotated shape enters edit mode:**
Suspected root cause: FabricEditCanvas container has `overflow: hidden` or a tight clip-path that truncates content extending beyond the shape's local bbox. Only reproduces at non-zero rotation. Code investigation needed in FabricEditCanvas container CSS + SVGSelectionOverlay z-index during edit mode.

The user **explicitly approved the 12-03 core fix** as "100% approved" on Tests 6 and 9 of the re-run, and confirmed all other regression tests pass (Tests 4, 5, 7, 10, 12, 13, 14 plus 2 new edge cases).

---

## Status Decision: `human_needed`

**Why `human_needed` instead of `passed`:**
- All 5 ROADMAP success criteria are VERIFIED at the code level.
- All three requirements (EDIT-11, EDIT-12, ZOOM-09) ship with working tests and correct wiring.
- However, EDIT-12 has 2 user-observable polish bugs that are NOT hypothetical — they were reproduced during UAT with explicit user narration. Marking this `passed` would hide them from future triage.
- The bugs are NOT blocking the phase goal ("precise and predictable shape rotation"), but they DO leave EDIT-12 in a "delivered-with-known-issues" state that requires a human decision: (a) fold into a decimal phase 12.1, (b) push to v2.2+ backlog, or (c) declare the phase closed and track as forward work.

**Why not `gaps_found`:**
- `gaps_found` would imply the phase goal was not achieved. It WAS achieved: the user can type exact rotation angles, the typed path is visually indistinguishable from drag-rotate (12-03 fix), soft Shift-snap works, and 10% zoom works via every entry point. The polish gaps are edge-case UX bugs, not goal failures.

---

## Recommended Next Action

The user needs to make a triage call on Gaps 3 and 4. Options:

1. **Decimal phase 12.1 (gap closure)** — recommended if the user wants EDIT-12 to feel fully polished before closing v2.1. ~2 small fixes, likely 1 session each. Would close the phase cleanly.

2. **Push to v2.2+ backlog + close Phase 12 now** — recommended if the user wants to lock in the EDIT-11 + ZOOM-09 wins and the EDIT-12 core behavior, and treat the polish bugs as known backlog items. The bugs are minor enough that this is defensible.

3. **Write 12-RECONCILIATION.md now** regardless of option 1 or 2 — per global CLAUDE.md rule, the reconciliation MUST exist before Phase 12 can close. The reconciliation should:
   - Reference this verification report.
   - Fix the stale REQUIREMENTS.md checkboxes for EDIT-11 and ZOOM-09 (both currently `[ ]` but should be `[x]`).
   - Document Gaps 3 and 4 in the "Lessons / Carry-forward" section with a decision on options 1 or 2 above.
   - Confirm the DO NOT CHANGE boundaries were honored (Phase 12 did NOT touch the `src/App.jsx` counter-tool WIP lines, PAL, FabricDrawingCanvas, FabricEraserCanvas signal contracts, or the zoomGeneration signal).

**Verifier recommendation:** Take **option 2 + option 3** (push Gaps 3/4 to v2.2+ backlog triage, write 12-RECONCILIATION.md, close Phase 12 and milestone v2.1). Rationale: the gaps are minor, the core phase goal is fully achieved, the user has already accepted the 12-03 UAT re-run at "100% approved" for the core fix, and extending Phase 12 indefinitely for polish gaps burns momentum. A decimal 12.1 is optional if the gaps accumulate or the user escalates severity.

---

_Verified: 2026-04-14_
_Verifier: Claude (gsd-verifier)_
_Method: Goal-backward verification against ROADMAP.md success criteria + three-level artifact check (exists / substantive / wired) + requirements coverage cross-ref + anti-pattern scan + test baseline confirmation._
