---
phase: 3
slug: render-loop-rewrite
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (via @playwright/test) |
| **Config file** | `playwright.config.cjs` |
| **Quick run command** | `npx playwright test tests/zoom-handler.spec.cjs --reporter=line` |
| **Full suite command** | `npx playwright test --reporter=line` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test tests/zoom-handler.spec.cjs --reporter=line`
- **After every plan wave:** Run `npx playwright test --reporter=line`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | ZOOM-01 | e2e | `npx playwright test tests/zoom-handler.spec.cjs --reporter=line` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | ZOOM-02 | e2e | `npx playwright test tests/zoom-handler.spec.cjs --reporter=line` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* Playwright tests from Phase 2 (`tests/zoom-handler.spec.cjs`) already verify annotations stay visible and positioned correctly during zoom.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual annotation quality during zoom | ZOOM-02 | Pixel-level rendering quality hard to assert | Open page 6, zoom in/out, verify annotations don't blur or shift visually |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
