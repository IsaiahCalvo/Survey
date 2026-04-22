---
phase: 8
slug: svg-display-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + Playwright |
| **Config file** | vite.config.js (vitest) / playwright.config.js |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~30 seconds (unit) / ~120 seconds (e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | DISP-01 | visual + unit | `npx vitest run svg-layer` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | DISP-02 | visual | `npx playwright test svg-zoom` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | DISP-03 | unit | `npx vitest run path-offset` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 1 | DISP-04 | visual | `npx playwright test stroke-width` | ❌ W0 | ⬜ pending |
| 08-01-05 | 01 | 1 | DISP-05 | unit + visual | `npx vitest run filtering` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/svg-layer.test.jsx` — stubs for DISP-01 through DISP-11
- [ ] `tests/path-offset.test.js` — pathOffset transform chain verification
- [ ] `tests/svg-zoom.spec.js` — Playwright zoom + annotation scaling tests
- [ ] `tests/filtering.test.jsx` — region/space/module visibility filtering

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity match vs Canvas rendering | DISP-01 | Pixel comparison requires human judgment for "close enough" | Open test PDF page 6, compare SVG vs Canvas side-by-side |
| Smooth zoom animation feel | DISP-02 | "Smoothness" is subjective perception | Zoom in/out with scroll wheel, pinch, and toolbar — no jank or flicker |
| Text readability at extreme zoom | DISP-08 | foreignObject text rendering varies by browser | Zoom to 200%+ and 25%-, verify text remains legible |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
