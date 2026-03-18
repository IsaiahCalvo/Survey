---
phase: 1
slug: overlay-attachment-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright ^1.58.2 |
| **Config file** | `debug/playwright.config.mjs` |
| **Quick run command** | `npx playwright test --config debug/playwright.config.mjs --grep "overlay"` |
| **Full suite command** | `npx playwright test --config debug/playwright.config.mjs` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Manual DevTools verification (inspect page div children, check data attributes and styles)
- **After every plan wave:** Run `npx playwright test --config debug/playwright.config.mjs`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | OVLY-01 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "overlay-attachment"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `debug/scenarios/overlay-attachment.spec.mjs` — Playwright test covering OVLY-01: navigates to page with annotations, waits for page load, verifies `[data-overlay-page]` elements exist as direct children of `.e-pv-page-div`, verifies correct CSS properties, verifies existing annotation canvases still render
- No framework install needed — Playwright is already a project dependency

*Existing infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Existing annotations still render correctly | OVLY-01 | Visual regression requires human judgment | Open test PDF, navigate to page 6, verify annotations display identically to pre-change state |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
