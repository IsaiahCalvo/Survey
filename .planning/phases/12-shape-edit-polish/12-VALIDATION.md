---
phase: 12
slug: shape-edit-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` + `node:assert/strict` (Node 20+) |
| **Config file** | None — tests discovered via glob in `package.json:13` |
| **Quick run command** | `npm test` (runs `node --test tests/*.test.mjs`) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | <1 second (7 existing files + 3 new) |

**React/JSX testable:** NO — no JSDOM or React Testing Library. React component behavior (RotationInputField visibility, portal mounting, hover intent) is validated via manual smoke in the dev server. Introducing a React test framework is out of scope for Phase 12.

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test` + manual smoke per requirement
- **Before `/gsd:verify-work`:** Full suite green + 8-minute manual smoke (from `.planning/research/PITFALLS.md`)
- **Max feedback latency:** <1 second for unit tests

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-W0-a | 01 | 0 | ZOOM-09 | unit | `npm test` → `tests/zoomController.test.mjs` | ❌ W0 | ⬜ pending |
| 12-01-W0-b | 01 | 0 | EDIT-11 | unit | `npm test` → `tests/svgTransformMath.test.mjs` | ❌ W0 | ⬜ pending |
| 12-01-01 | 01 | 1 | ZOOM-09 | unit | `npm test` → `tests/zoomController.test.mjs` | ✅ after W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | ZOOM-09 | unit | `npm test` → `tests/zoomController.test.mjs` | ✅ after W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | EDIT-11 | unit | `npm test` → `tests/svgTransformMath.test.mjs` | ✅ after W0 | ⬜ pending |
| 12-01-04 | 01 | 1 | EDIT-11 | manual | Shift+drag rotation in dev server | N/A | ⬜ pending |
| 12-01-05 | 01 | 1 | ZOOM-09 | manual | Zoom to 10% via all entry points | N/A | ⬜ pending |
| 12-02-W0 | 02 | 0 | EDIT-12 | unit | `npm test` → `tests/rotationInputHelpers.test.mjs` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | EDIT-12 | unit | `npm test` → `tests/rotationInputHelpers.test.mjs` | ✅ after W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | EDIT-12 | manual | Hover handle → input appears | N/A | ⬜ pending |
| 12-02-03 | 02 | 1 | EDIT-12 | manual | Type angle + Enter → commits | N/A | ⬜ pending |
| 12-02-04 | 02 | 1 | EDIT-12 | manual | Drag overrides typed value mid-interaction | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs are illustrative — final IDs are owned by gsd-planner. This map encodes the coverage contract (every requirement has at least one automated check or explicit manual-smoke row).*

---

## Wave 0 Requirements

Wave 0 creates test files and pure-JS helpers BEFORE any implementation task runs. This enables TDD on the unit-testable slices.

- [ ] `src/utils/rotationInputHelpers.js` — new module exporting `normalizeTypedDegrees(value): number | null`
- [ ] `tests/zoomController.test.mjs` — ZOOM-09 boundary tests (`clampScale(0.1) === 0.1`, `clampScale(0.05) === 0.1`, `clampScale(6.0) === 5.0`, `clampScale(NaN) === 1.0`)
- [ ] `tests/svgTransformMath.test.mjs` — EDIT-11 snap tests IF `snapAngleToNearest` is extracted. Covers the threshold boundary (44°→45°, 41°→41°, 23°→23°, 358°→0° wrap)
- [ ] `tests/rotationInputHelpers.test.mjs` — EDIT-12 normalization tests (`405 → 45`, `-5 → 355`, `'abc' → null`, `'' → null`, edge values 0 and 359)

**No framework install needed** — `node:test` is built into Node 20+ and already in use for 7 existing test files.

**Decision for planner:** If `snapAngleToNearest` is inlined in `useSVGInteraction.js` instead of extracted to `src/utils/svgTransformMath.js`, the `tests/svgTransformMath.test.mjs` file is NOT written and EDIT-11 becomes manual-smoke-only. Research recommends extraction for testability — planner owns the final call.

---

## Manual-Only Verifications

React component behavior cannot be unit-tested under the current infrastructure. The following behaviors are manual-smoke only (all documented as ~8-minute smoke suite in `.planning/research/PITFALLS.md`):

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Shift held mid-drag at 44° snaps to 45°, at 41° stays free | EDIT-11 | Requires pointer event simulation on live SVG | Dev server: rotate shape with Shift at 44°, release, drag to 41° |
| Shift released mid-drag returns to free rotation | EDIT-11 | Pointer + keyboard event stream | Dev server: press Shift at 45°, release, drag to 50° |
| Shift+resize aspect-lock still works — regression guard | EDIT-11 | Resize modifier interaction | Dev server: Shift+drag corner handle |
| Typing `10` in zoom input commits 10% | ZOOM-09 | Syncfusion zoom input integration | Dev server: click zoom input, type `10`, Enter |
| Cmd+- floor stays at 10% | ZOOM-09 | Keyboard shortcut routing | Dev server: Cmd+- from 100% repeatedly |
| Fit-page from 10% recomputes correctly | ZOOM-09 | Viewport math at low zoom | Dev server: at 10%, click Fit-page |
| Pen stroke visible at 10% (non-scaling-stroke) | ZOOM-09 | Stroke rasterization regression | Dev server: at 10%, draw a pen stroke |
| Hover mtr handle >150ms → input appears | EDIT-12 | Hover intent timing | Dev server: hover rotation handle, wait |
| Leave handle → enter input within 500ms → stays visible | EDIT-12 | Hover grace period state machine | Dev server: hover handle, move to input |
| Type `135` + Enter → commits rotation atomically | EDIT-12 | Input commit path | Dev server: focus input, type, Enter |
| Type invalid + Enter → silently reverts | EDIT-12 | Invalid input path | Dev server: type `abc`, Enter |
| ArrowUp → +1°, Shift+ArrowUp → +45° | EDIT-12 | Keyboard nudge scope | Dev server: focus input, press ArrowUp / Shift+ArrowUp |
| Drag overrides typed value mid-interaction | EDIT-12 | Pointer-beats-keyboard priority | Dev server: type in input, then drag handle |
| Input tracks handle during rotation drag | EDIT-12 | Portal position follow | Dev server: rotate handle, watch input |
| Input clamps to viewport near page edge | EDIT-12 | Edge-case positioning | Dev server: rotate near edge at low zoom |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies or explicit manual-smoke row
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`npm test` is one-shot)
- [ ] Feedback latency <1s for unit suite
- [ ] `nyquist_compliant: true` set in frontmatter (after plans written)

**Approval:** pending
