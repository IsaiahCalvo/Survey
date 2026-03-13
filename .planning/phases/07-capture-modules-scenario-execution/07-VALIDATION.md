---
phase: 7
slug: capture-modules-scenario-execution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | @playwright/test 1.58.2 |
| **Config file** | `debug/playwright.config.mjs` |
| **Quick run command** | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x` |
| **Full suite command** | `npx playwright test --config debug/playwright.config.mjs` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x`
- **After every plan wave:** Run `npx playwright test --config debug/playwright.config.mjs`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | CAPT-01 | integration | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | CAPT-02 | integration | (verify recording.webm exists in session folder) | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | CAPT-03 | integration | (verify console.jsonl has entries) | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | CAPT-04 | integration | (verify state.jsonl entries match step count) | ❌ W0 | ⬜ pending |
| 07-01-05 | 01 | 1 | CAPT-05 | integration | (verify manifest.json result field) | ❌ W0 | ⬜ pending |
| 07-01-06 | 01 | 1 | CAPT-06 | integration | (verify all JSONL entries have valid sessionMs) | ❌ W0 | ⬜ pending |
| 07-01-07 | 01 | 1 | CAPT-07 | integration | (verify performance.jsonl has mark and cdp entries) | ❌ W0 | ⬜ pending |
| 07-01-08 | 01 | 1 | CAPT-08 | integration | (verify non-blank screenshots after zoom) | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | FOUN-07 | integration | `ZOOM_MAX=150 npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 1 | FOUN-08 | smoke | `npm run debug:scenario -- zoom-flicker` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `debug/scenarios/zoom-flicker.spec.mjs` — main scenario test file (CAPT-01 through CAPT-08, FOUN-07)
- [ ] `debug/lib/capture.mjs` — capture coordinator module
- [ ] `debug/lib/console-capture.mjs` — console capture module
- [ ] `debug/lib/state-capture.mjs` — state capture module
- [ ] `debug/lib/perf-capture.mjs` — performance capture module
- [ ] `debug/lib/screenshot.mjs` — readiness-gated screenshot module
- [ ] `package.json` script `debug:scenario` — CLI entry point (FOUN-08)
- [ ] `debug/playwright.config.mjs` update — video enabled

*Existing infrastructure covers Playwright framework and session management.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Video contains visible zoom transitions | CAPT-02 | Visual quality check | Play recording.webm, confirm zoom transitions are visible frames |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
