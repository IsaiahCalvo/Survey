---
phase: 5
slug: pipeline-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | @playwright/test ^1.50.0 |
| **Config file** | `debug/playwright.config.mjs` (Wave 0 — must be created) |
| **Quick run command** | `npx playwright test --config debug/playwright.config.mjs` |
| **Full suite command** | `npx playwright test --config debug/playwright.config.mjs` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test --config debug/playwright.config.mjs`
- **After every plan wave:** Run `npx playwright test --config debug/playwright.config.mjs`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | FOUN-01 | e2e | `npx playwright test --config debug/playwright.config.mjs -g "loads test PDF"` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | FOUN-02 | smoke | `npm run build && ! grep -r "DevTestRoute\|testPdf\|debug-fixtures" dist/assets/` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | FOUN-03 | e2e | `npx playwright test --config debug/playwright.config.mjs -g "chromium"` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 1 | FOUN-04 | e2e | Verified implicitly by any Playwright test passing when Vite is not manually running | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 1 | FOUN-05 | e2e | `npx playwright test --config debug/playwright.config.mjs -g "session folder"` | ❌ W0 | ⬜ pending |
| 05-02-04 | 02 | 1 | FOUN-06 | e2e | `npx playwright test --config debug/playwright.config.mjs -g "manifest"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install -D @playwright/test && npx playwright install chromium` — install Playwright + browser
- [ ] `debug/playwright.config.mjs` — Playwright configuration with webServer, chromium channel
- [ ] `debug/scenarios/smoke.spec.mjs` — smoke test stubs covering FOUN-01 through FOUN-06
- [ ] `debug/lib/session.mjs` — Session folder creation utility
- [ ] `debug/fixtures/Package 2 - Rev 4 -- IC.pdf` — Test PDF fixture (copy from ralph-test/)
- [ ] `src/DevTestRoute.jsx` — Dev-only test route component

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual annotation rendering quality | FOUN-03 | Pixel comparison is brittle for canvas content; human verification of "Fabric.js content visible, not blank" is the Phase 5 gate | 1. Run `npx playwright test --headed` 2. Observe page 6 annotations render visually 3. Check screenshot artifact shows non-blank canvas |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
