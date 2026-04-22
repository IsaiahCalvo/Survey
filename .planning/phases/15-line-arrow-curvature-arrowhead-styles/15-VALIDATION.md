---
phase: 15
slug: line-arrow-curvature-arrowhead-styles
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-16
updated: 2026-04-16
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `15-RESEARCH.md` § Validation Architecture and populated from
> Plans 15-01 / 15-02 / 15-03.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (unit, `.mjs` files under `tests/`) + Playwright (visual/regression via `debug/playwright.config.mjs`) |
| **Config file** | `debug/playwright.config.mjs` (existing — do NOT modify) |
| **Quick run command** | `node --test tests/lineGeometry.test.mjs tests/lineArrowPersistence.test.mjs tests/lineDragMath.test.mjs tests/svgLineRenderer.test.mjs tests/renderArrowhead.test.mjs` |
| **Full suite command** | `node --test tests/*.test.mjs` (unit baseline — currently 113 tests + Phase 15 additions) |
| **Playwright list** | `npx playwright test --config debug/playwright.config.mjs --list` |
| **Estimated runtime** | ~6s quick (unit) · ~60s full (unit) · ~120s Playwright scenarios (not yet green, mostly `fixme`) |

---

## Sampling Rate

- **After every task commit:** Run quick command (unit only — sub-10s feedback).
- **After every plan wave:** Run full suite command (unit) + `npm run build`.
- **Before `/gsd:verify-work`:** Full unit suite must be green AND the 113-test baseline must still pass (file-level `test.describe.skip` on Plan 15-01's two red files keeps it intact through Wave 0; Plan 15-02 Task 1 flips the skip as its first step).
- **Max feedback latency:** 10 seconds per task commit.

---

## Per-Task Verification Map

> Populated from Plans 15-01 / 15-02 / 15-03. Each task's `<automated>` verify command is reproduced below for orchestrator fast-lookup. Status reflects Wave 0 state at validation-doc creation time.

| Task ID | Plan | Wave | Requirements | Test Type | Automated Command | File Exists | Status |
|---------|------|------|--------------|-----------|-------------------|-------------|--------|
| 15-01 T1 | 15-01 | 0 | LINE-01/02, ARROW-01/02/04 | Unit (node --test) | `node --test tests/lineGeometry.test.mjs tests/lineArrowPersistence.test.mjs` | Y | ⬜ pending |
| 15-01 T2 | 15-01 | 0 | LINE-01/02, ARROW-01/02/04 | Unit (node --test, skipped) | `node --test tests/svgLineRenderer.test.mjs tests/renderArrowhead.test.mjs 2>&1 \| head -30` | Y | ⬜ pending (skipped via `test.describe.skip` until Plan 15-02 T1 flips) |
| 15-01 T3 | 15-01 | 0 | LINE-01/02/03, ARROW-01/02/03/04 | Playwright discovery | `npx playwright test --config debug/playwright.config.mjs --list` | Y | ⬜ pending (scaffolds use `test.fixme` until Plan 15-03 T4 un-skips) |
| 15-02 T1 | 15-02 | 1 | LINE-01/02, ARROW-01/02/04 | Unit (node --test) | `node --test tests/svgLineRenderer.test.mjs tests/renderArrowhead.test.mjs` | — | ⬜ pending (creates `src/utils/lineRenderHelpers.js`) |
| 15-02 T2 | 15-02 | 1 | LINE-01/02, ARROW-01/02/04 | Unit (node --test) + build | `node --test tests/svgLineRenderer.test.mjs tests/renderArrowhead.test.mjs tests/lineGeometry.test.mjs tests/lineArrowPersistence.test.mjs` | — | ⬜ pending (edits `src/utils/svgAnnotationRenderers.jsx`) |
| 15-02 T3 | 15-02 | 1 | ARROW-04 | Playwright discovery + unit | `node --test tests/*.test.mjs && npx playwright test --config debug/playwright.config.mjs --list \| grep -c "phase15-"` | — | ⬜ pending (un-skips / fixme gates phase15-arrowhead-styles.spec.mjs, writes 15-02-SUMMARY.md) |
| 15-03 T1 | 15-03 | 1 | LINE-01/02/03, ARROW-01/02/03 | Unit (node --test) | `node --test tests/lineDragMath.test.mjs` | — | ⬜ pending (creates `src/utils/lineDragMath.js` + `tests/lineDragMath.test.mjs`) |
| 15-03 T2 | 15-03 | 1 | LINE-01, ARROW-01 | Build + grep | `node --test tests/*.test.mjs && grep -c "data-handle=\"midpoint\"" src/components/SVGAnnotationLayer.jsx` | — | ⬜ pending (adds 3rd handle to SVGAnnotationLayer) |
| 15-03 T3 | 15-03 | 1 | LINE-01/02/03, ARROW-01/02/03 | Unit + grep | `node --test tests/*.test.mjs && grep -c "mode: 'midpoint'\|mode === 'midpoint'" src/hooks/useSVGInteraction.js` | — | ⬜ pending (four-place invariant + endpoint auto-revert in useSVGInteraction.js) |
| 15-03 T4 | 15-03 | 1 | LINE-01/02/03, ARROW-01/02/03 | Unit + Playwright discovery | `node --test tests/*.test.mjs && npx playwright test --config debug/playwright.config.mjs --list \| grep -c "phase15-"` | — | ⬜ pending (un-skip or `fixme`-rationale the 3 Playwright scenarios + write 15-03-SUMMARY.md) |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · skipped (annotated inline)*

---

## Wave 0 Requirements

> Test scaffolding that must land before Wave 1 implementation. Sources: Plan 15-01 (owns Wave 0), Research § Validation Architecture.

**Unit test files (`tests/*.test.mjs`):**
- [ ] `tests/lineGeometry.test.mjs` — at least 10 tests against `src/utils/lineGeometry.js`: `getCurvedPath` (B(0.5)=midpoint), `getCurveEndAngle` (tangent at t=1), `shouldSnapToLinear` (10px threshold + custom threshold), `getControlPoint` (closed-form solution), `distanceToLineSegment` (perpendicular + zero-length edge cases), `getMidpoint`. GREEN on first run (math is pre-ported).
- [ ] `tests/lineArrowPersistence.test.mjs` — at least 4 tests for Fabric.Line `toJSON(['data'])` round-trip of `data.midpoint` + `data.arrowheadStyle`, plus `JSON.parse(JSON.stringify(...))` deep-clone preservation. GREEN on first run (Fabric 5.5.2 CUSTOM_PROPS already includes `data`).
- [ ] `tests/svgLineRenderer.test.mjs` — at least 6 tests against `src/utils/lineRenderHelpers.js` (Plan 15-02 target). File-level `test.describe.skip` on first run so baseline stays intact; Plan 15-02 Task 1 flips to `test.describe` atomically.
- [ ] `tests/renderArrowhead.test.mjs` — at least 8 tests against `buildArrowheadRenderSpec` from `src/utils/lineRenderHelpers.js` (Plan 15-02 target). File-level `test.describe.skip` on first run.

**Playwright scenario scaffolds (`debug/scenarios/*.spec.mjs`):**
- [ ] `debug/scenarios/phase15-line-curve.spec.mjs` — `test.fixme` scaffold for LINE-01 + ARROW-01 midpoint-drag-creates-curve smoke test; Plan 15-03 Task 4 un-skips.
- [ ] `debug/scenarios/phase15-snap-to-straight.spec.mjs` — `test.fixme` scaffold for LINE-02 + ARROW-02 silent snap-to-straight at 10px threshold + 1px render hysteresis; Plan 15-03 Task 4 un-skips.
- [ ] `debug/scenarios/phase15-endpoint-auto-revert.spec.mjs` — `test.fixme` scaffold for LINE-03 + ARROW-03 endpoint-drag preserves midpoint + auto-revert on collinear; Plan 15-03 Task 4 un-skips.
- [ ] `debug/scenarios/phase15-arrowhead-styles.spec.mjs` — `test.fixme` scaffold for ARROW-04 6-style arrowhead dispatch; Plan 15-02 Task 3 un-skips (or keeps as `fixme` with rationale if no `window.__injectAnnotation` harness is available).

**Baseline capture:**
- [ ] `debug/baselines/phase15-pre/README.md` — instructions for capturing pre-Phase-15 visual baseline on `Package 2 - Rev 4 -- IC.pdf` at Page 6 (zoom 50%, 100%, 200%) for straight-line no-regression contract.

**Drag-math unit test (Plan 15-03 owns, listed here for Wave 0 completeness):**
- [ ] `tests/lineDragMath.test.mjs` — at least 10 tests for `deriveMidpointFromPointer`, `shouldRevertEndpointCurve`, `applyMidpointToAnnotation`, `clearMidpointFromAnnotation`, `resolveMidpointHandlePosition` (created by Plan 15-03 Task 1, not Plan 15-01 — flagged here so Wave 0 audit is complete).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Picker UI for `arrowheadStyle` | ARROW-04 (programmatic read/write only in Phase 15) | Picker UI deferred to Phase 16 mini-toolbar | Edit Fabric JSON `data.arrowheadStyle` directly (or via `window.__injectAnnotation`) → reload → confirm the correct SVG primitive renders for each of 6 styles |
| Visual no-regression on straight lines/arrows | LINE/ARROW all | Playwright visual-diff not yet wired to `phase15-pre` baseline | UAT on `Package 2 - Rev 4 -- IC.pdf` Page 6: verify straight lines/arrows look byte-identical to v2.2 (eyeball, then diff `debug/baselines/phase15-pre/` vs `debug/baselines/phase15-post/` if captured) |
| End-to-end midpoint-handle UAT | LINE-01/02/03, ARROW-01/02/03 | Human feel-check for "silent snap" at 10px threshold and grab/grabbing cursor semantics | On `Package 2 - Rev 4 -- IC.pdf` Page 6: draw line, select, drag midpoint ±50px, verify curve; drag back within 10px, verify snap; drag endpoint on curved line, verify midpoint stays fixed; drag endpoint to collinear position, verify auto-revert on pointerup |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands or Wave 0 dependencies (Per-Task Verification Map above).
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (all 10 tasks have `<automated>` entries).
- [x] Wave 0 covers all MISSING references (see Wave 0 Requirements section).
- [x] No watch-mode flags (`node --test` + Playwright `--list` are one-shot).
- [x] Feedback latency < 10s (quick unit command targets ~6s).
- [x] `nyquist_compliant: true` set in frontmatter.
- [x] `wave_0_complete: true` set in frontmatter (Plan 15-01 owns Wave 0; this doc is its contract).

**Approval:** approved (revision iteration 1 — file paths aligned to plan `files_modified` lists, Per-Task Verification Map populated from plans 15-01/02/03).
