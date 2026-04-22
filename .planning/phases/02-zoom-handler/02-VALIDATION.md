---
phase: 2
slug: zoom-handler
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (@playwright/test) |
| **Config file** | `debug/playwright.config.mjs` |
| **Quick run command** | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-handler"` |
| **Full suite command** | `npx playwright test --config debug/playwright.config.mjs` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test --config debug/playwright.config.mjs --grep "zoom-handler"`
- **After every plan wave:** Run `npx playwright test --config debug/playwright.config.mjs`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | OVLY-02, ZOOM-03-08, ZOOM-10 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-handler"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | OVLY-02 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "overlay divs have CSS transform during zoom"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | ZOOM-03 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "ctrl scroll zoom"` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | ZOOM-04 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "toolbar zoom"` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | ZOOM-05 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "dropdown zoom"` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | ZOOM-06 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "fit to page"` | ❌ W0 | ⬜ pending |
| 02-01-07 | 01 | 1 | ZOOM-07 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "fit to width"` | ❌ W0 | ⬜ pending |
| 02-01-08 | 01 | 1 | ZOOM-08 | manual | Manual: pinch-to-zoom requires physical trackpad | N/A | ⬜ pending |
| 02-01-09 | 01 | 1 | ZOOM-10 | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "rapid zoom"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `debug/scenarios/zoom-handler.spec.mjs` — test stubs for OVLY-02, ZOOM-03 through ZOOM-07, ZOOM-10
  - CSS transform application during zoom via `page.evaluate(() => getComputedStyle(overlayDiv).transform)`
  - Transform removal after 1000ms settle
  - Rapid zoom (multiple zoomTo() calls in quick succession)
  - All 5 automatable zoom methods (ctrl+scroll, toolbar buttons, dropdown, fit-to-page, fit-to-width)
  - Old system still functions (canvas containers present after zoom)

*ZOOM-08 (pinch-to-zoom) is manual-only — Playwright cannot synthesize multi-touch trackpad gestures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pinch-to-zoom (trackpad) | ZOOM-08 | Playwright cannot synthesize multi-touch trackpad gestures | 1. Open PDF in dev server. 2. Pinch-zoom on trackpad. 3. Verify overlay divs scale with transform during zoom. 4. Verify transform clears after 1s settle. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
