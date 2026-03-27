---
phase: 11
slug: text-shape-editing-zoom-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (existing from Phase 10) |
| **Config file** | `playwright.config.ts` |
| **Quick run command** | `npx playwright test --grep "phase-11"` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test --grep "phase-11"`
- **After every plan wave:** Run `npx playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | EDIT-06 | e2e | `npx playwright test --grep "text-edit"` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | EDIT-07 | e2e | `npx playwright test --grep "shape-edit"` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | EDIT-08 | e2e | `npx playwright test --grep "callout-edit"` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 2 | ZOOM-01 | e2e | `npx playwright test --grep "zoom"` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 2 | ZOOM-02 | e2e | `npx playwright test --grep "zoom"` | ❌ W0 | ⬜ pending |
| 11-02-03 | 02 | 2 | ZOOM-03 | e2e | `npx playwright test --grep "zoom"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/phase-11-text-edit.spec.ts` — stubs for EDIT-06, EDIT-07, EDIT-08
- [ ] `tests/phase-11-zoom-cleanup.spec.ts` — stubs for ZOOM-01 through ZOOM-08

*Existing Playwright infrastructure from Phase 10 covers test runner setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| IText cursor/selection appearance | EDIT-06 | Visual styling verification | Double-click text annotation, verify cursor blinks, select text, verify highlight |
| CSS transform during zoom | ZOOM-03 | Visual stability during animation | Zoom while Canvas is mounted, verify no visible jump/flash |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
