---
phase: 9
slug: svg-selection-interaction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-24
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (existing) |
| **Config file** | `playwright.config.js` |
| **Quick run command** | `npx playwright test tests/svg-interaction --reporter=line` |
| **Full suite command** | `npx playwright test --reporter=html` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test tests/svg-interaction --reporter=line`
- **After every plan wave:** Run `npx playwright test --reporter=html`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | INTR-01 | integration | `npx playwright test tests/svg-interaction/click-select.spec.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | INTR-02 | integration | `npx playwright test tests/svg-interaction/resize-handles.spec.ts` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | INTR-03, INTR-04 | integration | `npx playwright test tests/svg-interaction/drag-move.spec.ts` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | INTR-05, INTR-06 | integration | `npx playwright test tests/svg-interaction/resize-scale.spec.ts` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 2 | INTR-07, INTR-08 | integration | `npx playwright test tests/svg-interaction/multi-select.spec.ts` | ❌ W0 | ⬜ pending |
| 09-02-03 | 02 | 2 | INTR-09, INTR-10 | integration | `npx playwright test tests/svg-interaction/double-click-edit.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/svg-interaction/click-select.spec.ts` — stubs for INTR-01
- [ ] `tests/svg-interaction/resize-handles.spec.ts` — stubs for INTR-02
- [ ] `tests/svg-interaction/drag-move.spec.ts` — stubs for INTR-03, INTR-04
- [ ] `tests/svg-interaction/resize-scale.spec.ts` — stubs for INTR-05, INTR-06
- [ ] `tests/svg-interaction/multi-select.spec.ts` — stubs for INTR-07, INTR-08
- [ ] `tests/svg-interaction/double-click-edit.spec.ts` — stubs for INTR-09, INTR-10

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual smoothness of drag (60fps) | INTR-04 | Performance feel is subjective | Drag annotation across page, verify no stutter or jank |
| Handle visual appearance matches Fabric.js design | INTR-02 | Visual fidelity comparison | Compare handle rendering to current Fabric.js handles in side-by-side |
| Zoom interaction during drag | INTR-04 | Complex browser interaction | Start dragging, zoom in/out mid-drag, verify annotation stays under cursor |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
