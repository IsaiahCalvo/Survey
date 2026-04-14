---
phase: 13
slug: rotation-handle-edit-mode-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in Node test runner) |
| **Config file** | `package.json` `test` script |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` (same — 113 cases, ~2 seconds) |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green (113/113)
- **Max feedback latency:** ~2 seconds

---

## Per-Task Verification Map

*Per the research finding: zero unit tests exercise event delegation, hover-intent, or edit-mode mtr visibility. Phase 13's two fixes are integration-level DOM behavior that cannot be meaningfully covered by `node:test`. The 113-case suite is a regression shield ONLY — Phase 13 adds no new unit tests (locked decision in CONTEXT.md). All behavior verification is Manual UAT per the grids below.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-* | 01 | 1 | EDIT-13 | regression | `npm test` | ✅ | ⬜ pending |
| 13-02-* | 02 | 1 | EDIT-14 | regression | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*None. Existing 113-case `node:test` infrastructure covers all phase regression needs. Phase 13 adds no new unit tests per locked decision (CONTEXT.md `<decisions>` — "Test additions — no new unit tests, rely on UAT + baseline").*

---

## Manual-Only Verifications

**EDIT-13 — Hover pill re-arms after every edit-mode exit path**

UAT grid: `{rect, circle, ellipse, text} × {angle=0, angle=30} × {exit click-off, exit Escape, exit Enter-commit}` = **24 cells**.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pill re-arms after click-off exit (rect, angle=0) | EDIT-13 | DOM event delegation + hover-intent timing not covered by unit tests | Select rect → dbl-click into edit → click outside bbox → hover mtr handle → pill appears within 150ms without deselect/reselect |
| Pill re-arms after click-off exit (rect, angle=30) | EDIT-13 | same | same, but rect pre-rotated to 30° |
| Pill re-arms after Escape exit (circle, angle=0) | EDIT-13 | same | Select circle → dbl-click → Escape → hover mtr → pill within 150ms |
| Pill re-arms after Escape exit (circle, angle=30) | EDIT-13 | same | same, pre-rotated |
| Pill re-arms after Enter-commit exit (ellipse, angle=0) | EDIT-13 | same | Select ellipse → dbl-click → type → Enter → hover mtr → pill within 150ms |
| Pill re-arms after Enter-commit exit (ellipse, angle=30) | EDIT-13 | same | same, pre-rotated |
| Pill re-arms after all 3 exits (text, angle=0) | EDIT-13 | same | Text edit: click-off, Escape, Enter-commit — hover pill re-arms in each case |
| Pill re-arms after all 3 exits (text, angle=30) | EDIT-13 | same | same, pre-rotated |
| Edit-mode gate holds (any shape in active edit) | EDIT-13 | same | Mid-edit: hover mtr → pill does NOT arm (effect-top gate) |
| Optimistic-paint invariant preserved | EDIT-13 | Performance characteristic | Attach `console.count` to hover-intent effect body; drag-rotate 2s; count ≤3 (never 60fps) |

**EDIT-14 — mtr handle visible on edit-mode entry for pre-rotated shapes**

UAT grid: `{rect, circle, ellipse, text} × {angle=0, angle=30}` = **8 cells**.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wave 1 Task 1: live-DOM clipper diagnostic | EDIT-14 | Runtime DOM inspection — requires running app | Start dev server, open pre-rotated rect (angle=30), dbl-click into edit mode, paste DevTools script from research, copy output table back, confirm clipper identity |
| mtr visible — rect angle=30 | EDIT-14 | Visual render branch not covered by units | dbl-click pre-rotated rect → full mtr (circle + connector + icon) visible, no clipping |
| mtr visible — circle angle=30 | EDIT-14 | same | same, circle |
| mtr visible — ellipse angle=30 | EDIT-14 | same | same, ellipse |
| mtr visible — text angle=30 | EDIT-14 | same | same, text |
| Border-flush baseline preserved — rect angle=0 | EDIT-14 | Regression — must STILL short-circuit | dbl-click rect at angle=0 → NO mtr, NO bbox, NO resize pills (clean edit surface) |
| mtr visual-only during edit | EDIT-14 | Pointer-events gating | Pre-rotated shape in edit mode: hover mtr → pill does NOT arm (pointerEvents:none via isInteractive=false), drag does nothing |
| Counter branch untouched | EDIT-14 | Counter has its own nubbin rotation handle | Counter annotation in edit mode: existing nubbin branch at `SVGAnnotationLayer.jsx:1052-1099` unchanged |

**v2.1 regression shield (both plans)**

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Plan 12-02 7-round focus-loss — Tab | regression | Integration behavior | RotationInputField focus on Tab works |
| Plan 12-02 7-round focus-loss — click-out | regression | same | focus on click-out works |
| Plan 12-02 7-round focus-loss — Arrow nudge | regression | same | Arrow nudge works |
| Plan 12-02 7-round focus-loss — Enter commit | regression | same | Enter commit works |
| Plan 12-02 7-round focus-loss — hover during drag | regression | same | hover during drag works |
| Plan 12-02 7-round focus-loss — Shift modifier | regression | same | Shift modifier works |
| Plan 12-02 7-round focus-loss — blur | regression | same | blur behavior works |
| activeElement guard preserved | regression | Load-bearing fix from Phase 12 Plan 02 Round 7 | `SVGAnnotationLayer.jsx:282-290` — `document.activeElement?.closest('[data-rotation-input-field]')` check still present after Plan 13-01 delegation rewrite |
| eslint-disable at `:312` preserved | regression | Load-bearing invariant | grep confirms `eslint-disable react-hooks/exhaustive-deps` still at `:312` with minimal dep array `[selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]` |

**Counter-session lane integrity (both plans)**

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 7-file counter-session allowlist untouched | Success Criterion 4 | Boundary enforcement | `git show --stat` on each Phase 13 commit — ZERO files from allowlist appear: `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, `src/utils/svgAnnotationRenderers.jsx`, `dist/index.html` |
| Explicit-path staging only | Success Criterion 4 | `git add .` / `git add -A` HARD BANNED | Before every commit: `git status` cross-check. Stage via explicit paths or `--files` arg to GSD commit tool. If allowlist file appears staged, `git reset HEAD <file>` before committing. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies *(N/A — locked decision: UAT-only for behavior, `npm test` regression-only)*
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify *(satisfied via `npm test` after every task commit)*
- [ ] Wave 0 covers all MISSING references *(N/A — no Wave 0)*
- [ ] No watch-mode flags *(satisfied — `npm test` is one-shot)*
- [ ] Feedback latency < 5s *(~2s actual)*
- [ ] `nyquist_compliant: true` set in frontmatter *(set when all acceptance criteria pass UAT and 113/113 regression green)*

**Approval:** pending
