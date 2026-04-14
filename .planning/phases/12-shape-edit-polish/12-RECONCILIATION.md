# Phase 12 Reconciliation

**Phase:** 12 — Shape Edit Polish
**Milestone:** v2.1 Shape Edit Polish & Foundation Wins
**Closed:** 2026-04-14
**Status:** DONE_WITH_CONCERNS
**Companion report:** `.planning/phases/12-shape-edit-polish/12-VERIFICATION.md`

---

## Plan vs Actual

### Planned (from ROADMAP.md v2.1)

- **Plan 12-01** — EDIT-11 soft Shift-snap (3° threshold) via new `snapAngleToNearest45` helper wired into `useSVGInteraction.js` rotate branch + ZOOM-09 zoom floor 10% atomic bundle (`zoomController.js:15` MIN_SCALE 0.5→0.1 AND `App.jsx:21999` pre-clamp 50→10 in the SAME commit) + Wave 0 unit tests. 4 tasks, Wave 1, low risk.
- **Plan 12-02** — EDIT-12 rotation degree input field via new `RotationInputField` HTML portal component + `rotationInputHelpers` module + parent wiring in `SVGAnnotationLayer.jsx`. 5 tasks, Wave 2, moderate risk.
- **Plan 12-03** — NOT originally planned. Gap-closure plan authored after 12-02 UAT surfaced a commit-latency issue on typed rotation commits (Gap 1).

### Actual (what shipped)

- **Plan 12-01** — Delivered exactly as scoped. `snapAngleToNearest45` landed in `src/utils/svgTransformMath.js:121-127` with `% 360` defensive wrap. Wired at `src/hooks/useSVGInteraction.js:456-461` (const→let promotion + shift-guard + snap call). ZOOM-09 shipped atomically in commit `df43b0f8`: `src/utils/zoomController.js:15` (MIN_SCALE=0.1) + `src/App.jsx` pre-clamp (`Math.max(parsed, 10)`). 10 snap unit tests + 7 clampScale boundary tests all green.
- **Plan 12-02** — Delivered with architecture locked to HTML portal (per 12-CONTEXT + 12-UI-SPEC research). Shipped `src/utils/rotationInputHelpers.js` (184 LOC, `normalizeTypedDegrees` + `computeInputPosition` with constant-radius extension), `src/components/RotationInputField.jsx` (646 LOC, createPortal, uncontrolled input, hover-intent + drag-wins visibility state machine, Enter/Escape/blur/Arrow semantics), `SVGSelectionOverlay.jsx:168` data-rotation-handle="mtr" attribute, and `SVGAnnotationLayer.jsx` parent wiring. 34 helper unit tests green. UAT: 11 pass / 2 issue / 1 skip / 1 feature request. Gap 1 (commit latency on Enter and Arrow) identified as blocker to phase close.
- **Plan 12-03 (unplanned gap-closure)** — Added `applyOptimisticRotation(idx, newAngle)` helper to `useSVGInteraction.js:835-855` and `clearOptimisticRotation` at `useSVGInteraction.js:861-863`. Wired `handleRotationInputCommit` and post-commit cleanup `useEffect` through it in `SVGAnnotationLayer.jsx:132,365-439,1299-1309`. Mirrors drag-rotate's existing visual-first commit-second pattern. User confirmed "100% approved" on UAT re-run Tests 6 and 9 at commits `ecd51419` and `70189b0f`. Test count rose to 113/113 green.

### Deltas

1. **Plan 12-03 was not in the original phase roadmap.** It was spun as an unplanned gap-closure plan mid-phase when 12-02 UAT surfaced Gap 1. Without 12-03, EDIT-12 would have shipped broken on the most common user path (Enter to commit a typed angle). The plan was authored, executed, and closed inside the same phase rather than deferred — correct call.

2. **EDIT-12 LOC overage.** Original backlog estimate was ~11 LOC for "Shift+rotate snaps" + "zoom floor at 10%" combined. Actual EDIT-12 shipped `RotationInputField.jsx` at 646 LOC + `rotationInputHelpers.js` at 184 LOC + wiring + test file at 365 LOC. This is not a regression — EDIT-12 was explicitly flagged in STATE.md decisions as "a scope expansion" once the user confirmed they wanted exact typed angles, not just Shift-snap. The expansion was approved during /gsd:discuss-phase.

3. **Plan 12-03 prescribed an incorrect JSDoc count.** The 12-03 plan prescribed a specific JSDoc comment block; the executor shipped a more extensive `SIDE EFFECT` / `drag-wins invariant` marker block on `useSVGInteraction.js:835-888`. This is documented as intentional in 12-03-SUMMARY.md and serves as a guardrail for future refactors of `RotationInputField.jsx:312-320`. Not a regression — intentional improvement over the plan.

4. **AC `setVisualTransform` count miscount in 12-03 plan.** The plan assumed a single call site; actual implementation has one call site for `applyOptimisticRotation` plus one for `clearOptimisticRotation` (on cleanup). Documented in 12-03-SUMMARY deviations. Functionally identical to plan intent.

5. **`src/App.jsx` line number drift.** The 12-01-SUMMARY references `App.jsx:21999` as the `commitZoomInput` site. Actual current location is `App.jsx:22441`. The drift is NOT a regression of ZOOM-09 — it is caused by the uncommitted parallel counter-tool WIP in `src/App.jsx` (inserted code earlier in the file shifts later line numbers). The `Math.max(parsed, 10)` token itself is intact and unchanged. Verifier cross-checked and confirmed.

6. **2 pre-existing 12-02 polish gaps surfaced during 12-03 UAT re-run.** Gaps 3 and 4 in `12-02-UAT.md`. Both are minor severity. Both are NOT regressions from Plan 12-03 (12-03 touched only `useSVGInteraction.js` commit helpers and `SVGAnnotationLayer.jsx` wiring/cleanup — did not touch hover-intent logic or FabricEditCanvas clip/overflow rules). User chose Option A: backlog them to v2.2+ and close Phase 12. Now filed in `.planning/FEATURE-BACKLOG.md` Stage 0.

---

## Acceptance Criteria Results

Criteria from `12-CONTEXT.md` and ROADMAP.md Phase 12 success criteria.

- [x] **Given** user drags the rotation handle with Shift held, **when** the free angle is within 3° of a 45° increment, **then** the angle snaps to that increment — **PASSED**. Evidence: `src/utils/svgTransformMath.js:121-127` + `src/hooks/useSVGInteraction.js:456-461` wiring + 10/10 `tests/svgTransformMath.test.mjs` cases (44→45, 41 free, 23 free, 358→0 wrap, exact 0/45/135, 317→315).

- [x] **Given** Shift is held, **when** the free angle is outside the 3° threshold, **then** rotation remains free (Shift-at-41° stays 41°) — **PASSED**. Same evidence as above; 41° and 23° cases explicitly tested.

- [x] **Given** user releases Shift during rotation, **when** drag continues, **then** rotation returns to free — **PASSED**. The shift-guard in `useSVGInteraction.js:459` is a per-event read, not a sticky latch.

- [x] **Given** user zooms out, **when** the target scale would drop below 10%, **then** the scale clamps at 10% floor — **PASSED**. Evidence: `src/utils/zoomController.js:15` MIN_SCALE=0.1 + `src/App.jsx:22441` `Math.max(parsed, 10)` in `commitZoomInput` + 7/7 `tests/zoomController.test.mjs` boundary tests (0.1 floor, 0.05→0.1 clamp, 0.5 untouched, 5.0 ceiling, 6.0→5.0, NaN→1.0, string→1.0). Atomic commit at `df43b0f8`.

- [x] **Given** user selects a shape and hovers the mtr handle, **when** 150ms elapses, **then** a degree input pill appears 16px above the handle — **PASSED**. 12-02-UAT Test 2.

- [x] **Given** pill is visible, **when** user clicks INTO pill and releases mouse, **then** focus stays in pill and typing is possible — **PASSED**. 12-02-UAT Test 5, fixed by commit `82d80c3b` (nativeStop removal during the rotation input pill click cycle).

- [x] **Given** pill focused on a value, **when** user presses Enter, **then** shape rotates to the typed angle with **instant** visual update — **PASSED**. 12-02-UAT Test 6, fixed by Plan 12-03 `applyOptimisticRotation` helper. Re-run: "100% approved".

- [x] **Given** pill focused on a value like 90, **when** user presses Arrow Up, **then** shape rotates to 91° **instantly** — **PASSED**. 12-02-UAT Test 9, fixed by Plan 12-03. Re-run: "100% approved".

- [x] **Given** pill focused with typed value, **when** user presses Escape, **then** shape reverts to pre-edit angle — **PASSED**. 12-02-UAT Test 7.

- [x] **Given** shape near page edge, **when** rotation handle would render off-screen, **then** the pill position clamps to viewport — **PASSED**. 12-02-UAT Test 14 (pill clamp portion). The handle relocation portion is a separate feature request (Gap 2, FEATURE-BACKLOG.md Stage 0).

- [x] **Given** zoom at 100%, **when** user types "10" into the zoom input, **then** the page zooms to 10% without silent re-clamp — **PASSED**. `commitZoomInput` path at `App.jsx:22441-22462` funnels through `clampScale` which has MIN_SCALE=0.1.

- [x] **Given** zoom ≥ 25%, **when** user uses toolbar +/- or keyboard shortcuts, **then** zoom floor at 10% holds — **PASSED**. All zoom entry points funnel through `clampScale`. 12-01 verification confirms.

- [x] **Given** drag-rotate and typed-rotate both commit through optimistic paint, **when** user alternates between them, **then** the SVG visual transform is consistent — **PASSED** at the core level. 12-03-SUMMARY confirms matching `visualTransform.rotate` payload shapes between drag-rotate and typed-rotate paths.

- [ ] **Given** drag-rotate and typed rotation both visible, **when** user interacts with either path, **then** both should feel indistinguishable in polish — **DEFERRED**. Core commit path is indistinguishable (Tests 6 and 9 "100% approved"). BUT 2 minor polish gaps (3 and 4 in 12-02-UAT.md) break the indistinguishability claim at the edges: (Gap 3) pill doesn't reappear on hover after edit-mode click-off until full deselect+reselect; (Gap 4) mtr handle is visibly clipped when a pre-rotated shape enters edit mode. Both are pre-existing 12-02 bugs, not 12-03 regressions. User chose Option A: backlog to v2.2+, close phase now.

- [~] **AC #7 — blur-commit of typed value** and **AC #8 — invalid-value revert** — **DE-SCOPED**. User explicitly declined during 12-02 UAT: "no but thats fine, i dont want that". The pill currently commits on Enter and reverts on Escape; blur is treated as "no change" rather than "commit last edit". This is tracked in 12-02-UAT.md and documented in 12-02-SUMMARY.md as an intentional de-scope. Milestone v2.1 close may optionally remove these ACs from 12-CONTEXT.md for cleanliness, but they are NOT gating Phase 12.

---

## Boundaries Honored

**DO NOT CHANGE list (from global CLAUDE.md "Always Protected"):**

- [x] **`src/App.jsx`** — Phase 12 touched exactly ONE location for ZOOM-09: `Math.max(parsed, 10)` pre-clamp in `commitZoomInput` at current line 22441 (originally line 21999 in 12-01-SUMMARY, drifted due to parallel counter-tool WIP). No ownership of zoom logic, render loop, portal host resolution, or `zoomGeneration` signal changed. Counter-session's parallel uncommitted WIP in App.jsx is OUT of Phase 12's lane and was never staged by Phase 12 commits.
- [x] **`src/components/PageAnnotationLayer.jsx`** — UNTOUCHED by Phase 12.
- [x] **`src/components/FabricDrawingCanvas.jsx`** — UNTOUCHED by Phase 12.
- [x] **`src/components/FabricEraserCanvas.jsx`** — UNTOUCHED by Phase 12.
- [x] **`src/components/FabricEditCanvas.jsx`** — UNTOUCHED by Phase 12 scope (Gap 4 investigation deferred to v2.2+; counter-session has dirty WIP here that is not Phase 12's lane).
- [x] **`src/components/SVGAnnotationLayer.jsx`** — Modified by Plan 12-02 (RotationInputField mount + hover-intent wiring) and Plan 12-03 (handleRotationInputCommit uses `applyOptimisticRotation`; cleanup useEffect on `[annotations]` at 412-426). SVG viewBox zoom scaling preserved. No JavaScript zoom coordination reintroduced. All changes are additive on the existing architecture.
- [x] **`src/components/SVGSelectionOverlay.jsx`** — Modified by Plan 12-02 to add `data-rotation-handle="mtr"` attribute at line 168. Additive, no regressions.
- [x] **`src/components/RotationInputField.jsx`** — NEW file created by Plan 12-02. This file is OWNED by the main Phase 12 lane, NOT the counter-session (feedback_no_rotation_input_field.md applies to the counter-session Claude, not to Phase 12 itself).
- [x] **`src/hooks/useSVGInteraction.js`** — Modified by Plan 12-01 (snap wire) and Plan 12-03 (applyOptimisticRotation + clearOptimisticRotation helpers). `zoomGeneration` signal contract preserved (this hook does not participate in canvas commit lifecycle).
- [x] **`src/utils/svgTransformMath.js`** — Extended by Plan 12-01 with `snapAngleToNearest45` helper. Additive, no existing helpers modified.
- [x] **`src/utils/zoomController.js`** — Modified by Plan 12-01: `MIN_SCALE: 0.5 → 0.1`. One constant change; `clampScale` structure unchanged.
- [x] **`src/utils/rotationInputHelpers.js`** — NEW file created by Plan 12-02.
- [x] **`package.json` / `vite.config.js`** — UNTOUCHED by Phase 12.
- [x] **12-01 / 12-02 / 12-03 PLAN and SUMMARY files** — Never retroactively modified. Reconciliation is a separate file, not an edit to prior SUMMARY.md.

**Counter-session parallel WIP awareness:**

The parallel counter-tool session has uncommitted changes in `src/App.jsx`, `src/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, and `src/utils/svgAnnotationRenderers.jsx`. Phase 12 strictly limited its commits to additive changes in Phase-12-owned files. No Phase 12 commit staged a counter-session file. No cross-session merge conflicts resulted.

**No boundary violations.**

---

## Lessons / Carry-forward

1. **The drag-rotate optimistic-paint pattern is the canonical pattern for any commit-path performance issue in the SVG annotation layer.** Plan 12-03 literally copy-pasted the drag-rotate visual-first-commit-second pattern into a reusable `applyOptimisticRotation` helper. Any future commit latency in hover/input/menu paths in `SVGAnnotationLayer` should apply the same "paint via `visualTransform.rotate` first, commit state second" pattern. Documented inline in `useSVGInteraction.js:835-888` with `SIDE EFFECT` and `drag-wins invariant` JSDoc markers to guard against refactors.

2. **UAT re-runs surface adjacent bugs.** The 12-03 UAT re-run was scoped to Tests 6 and 9 (the fixed gap). But the user's natural exploration (double-click to edit → click off → back to select → hover) exposed two pre-existing 12-02 bugs (Gaps 3 and 4) that the original 12-02 UAT never hit. Lesson: every re-run should include a short "golden path exploration" loop alongside the targeted tests. Plan templates should bake this in for future gap-closure plans.

3. **Unit-test seeds pay compound interest.** Wave 0 test scaffolds created in Plan 12-01 (`tests/svgTransformMath.test.mjs`, `tests/zoomController.test.mjs`) survived the whole phase unchanged and still provide regression coverage. Plan 12-02 added `tests/rotationInputHelpers.test.mjs`. Total test surface went from ~85 to 113 green tests across Phase 12. Every v2.x phase should allocate a Wave 0 test-seed task.

4. **Gap 2 (rotation handle off-screen)** is a standing v2.2+ feature request already logged in `FEATURE-BACKLOG.md` Stage 0. Do NOT attempt during v2.1 close — it is a feature request, not a defect.

5. **Gaps 3 and 4 are newly filed v2.2+ polish items.** Filed in `FEATURE-BACKLOG.md` Stage 0 during this reconciliation. Triage priority: Gap 3 first (more discoverable via user's natural flow); Gap 4 second (only reproduces when shape is pre-rotated AND entered via edit mode). Neither is daily-workflow blocker territory per user's "100% approved" on the 12-03 core fix.

6. **Parallel counter-tool session awareness worked.** Phase 12 strictly limited its commits to additive changes and never staged counter-session files. This pattern worked — no cross-session merge conflicts. The feedback memo `feedback_no_rotation_input_field.md` correctly isolated the counter-session Claude's lane from Phase 12's lane.

7. **Stale REQUIREMENTS.md checkboxes** for EDIT-11 and ZOOM-09 were discovered during verification (they shipped in 12-01 at commit `df43b0f8` but the phase-complete CLI didn't catch them because Plan 12-01's frontmatter `requirements:` traceability was incomplete). Flipped to `[x]` during this reconciliation (Task A). Lesson: the `gsd-tools state advance-plan` and/or plan frontmatter linter should verify that every `requirements:` entry in plan frontmatter exists in REQUIREMENTS.md — filed as a minor GSD tooling nit, not actionable here.

8. **Verification report stayed `human_needed` historically.** `12-VERIFICATION.md` frontmatter status remains `human_needed` because that was the verifier's honest judgment at the time. The user's Option A decision to close anyway is recorded HERE (in reconciliation) and in the ROADMAP.md footer, preserving the audit trail. The verifier did the right thing by refusing to auto-mark `passed`.

9. **Scope expansion between backlog and phase is normal.** EDIT-12 grew from an ~11-LOC "Shift+rotate snaps" backlog item to a 1,195-LOC rotation input field feature during /gsd:discuss-phase. The scope expansion was explicit and approved. Future phases should treat backlog-estimate LOCs as priors, not ceilings.

---

## Status: DONE_WITH_CONCERNS

Phase 12 is functionally complete per all ROADMAP must-haves and user-confirmed "100% approved" on the 12-03 gap-closure fix. All three requirements (EDIT-11, EDIT-12, ZOOM-09) delivered with working tests at 113/113 green. Two minor polish gaps (Gaps 3 and 4 in `12-02-UAT.md`) are deferred to v2.2+ backlog per user Option A.

**Milestone v2.1 ready to close on this reconciliation.**

---

_Written: 2026-04-14_
_Author: Claude (gsd-executor, phase-close lane)_
_Companion: 12-VERIFICATION.md (status: human_needed, decision: Option A — close with gaps backlogged)_
