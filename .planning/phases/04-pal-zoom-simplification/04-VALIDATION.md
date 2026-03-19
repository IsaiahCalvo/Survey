---
phase: 4
slug: pal-zoom-simplification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (via @playwright/test) |
| **Config file** | `playwright.config.cjs` |
| **Quick run command** | `npx playwright test --grep "zoom" --reporter=line` |
| **Full suite command** | `npx playwright test --reporter=line` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test --grep "zoom" --reporter=line`
- **After every plan wave:** Run `npx playwright test --reporter=line`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | ZOOM-09 | e2e | `npx playwright test --grep "zoom"` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | OVLY-04 | e2e | `npx playwright test --grep "overlay"` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 1 | PRES-01 | e2e | `npx playwright test --grep "render-loop"` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 1 | PRES-02, PRES-03 | e2e | `npx playwright test --grep "render-loop"` | ✅ | ⬜ pending |
| 04-02-03 | 02 | 1 | PRES-04, PRES-05 | e2e | `npx playwright test --grep "render-loop"` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Canvas appears crisp (not blurry) after zoom | ZOOM-09 | Visual quality requires human eye | Zoom to 200%, inspect annotation edges for blur |
| Drawing strokes land where cursor is | PRES-01 | Sub-pixel accuracy hard to automate | Draw pen stroke at 150%, verify path matches cursor position |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
