---
phase: 6
slug: debug-bridge-readiness-signals
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.x (from Phase 5) |
| **Config file** | `debug/playwright.config.mjs` |
| **Quick run command** | `npx playwright test debug/scenarios/smoke.spec.mjs --project=chromium` |
| **Full suite command** | `npx playwright test --config debug/playwright.config.mjs` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test debug/scenarios/smoke.spec.mjs --project=chromium`
- **After every plan wave:** Run `npx playwright test --config debug/playwright.config.mjs`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | INST-01, INST-02 | integration | `npx playwright test debug/scenarios/bridge-snapshot.spec.mjs --project=chromium -x` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 0 | INST-03 | integration | `npx playwright test debug/scenarios/readiness-signals.spec.mjs --project=chromium -x` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 0 | INST-05 | integration | `npx playwright test debug/scenarios/mutation-tracking.spec.mjs --project=chromium -x` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 0 | INST-04, INST-06 | build check | `npx vite build && grep -c '__debugBridge' dist/assets/*.js` (expect 0) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `debug/scenarios/bridge-snapshot.spec.mjs` — covers INST-01, INST-02: load PDF, call `window.__debugBridge.snapshot()`, assert all required fields present and JSON-serializable
- [ ] `debug/scenarios/readiness-signals.spec.mjs` — covers INST-03: load PDF, navigate to page 6, verify `window.__debugReady.waitFor('ready')` resolves, verify `waitFor('annotationsMounted', { page: 6 })` resolves
- [ ] `debug/scenarios/mutation-tracking.spec.mjs` — covers INST-05: load PDF, trigger zoom, verify `snapshot({ drainMutations: true })` returns mutation records with pageNumber and sessionMs
- [ ] Build check script for INST-04/INST-06: run `vite build`, verify `__debugBridge` and `debugMark` do not appear in production bundle

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
