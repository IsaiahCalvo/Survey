---
phase: 1
slug: css-transform-scaling
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual visual verification (no browser test infra in project) |
| **Config file** | none |
| **Quick run command** | `npm run dev` then manually zoom in/out |
| **Full suite command** | `npm run dev` then full manual checklist below |
| **Estimated runtime** | ~60 seconds per manual check |

---

## Sampling Rate

- **After every task commit:** Manual visual verification: open app, load PDF, zoom in/out, verify annotations stay visible and scale smoothly
- **After every plan wave:** Full manual test: zoom in/out via trackpad pinch, toolbar buttons, Ctrl+scroll; verify across multiple pages
- **Before `/gsd:verify-work`:** Full suite must pass
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-xx | 01 | 1 | ZVIS-01 | manual | Visual: zoom in/out, annotations never disappear | N/A | pending |
| 01-01-xx | 01 | 1 | ZVIS-02 | manual | Visual: annotations scale smoothly with CSS transform | N/A | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No test stubs or framework installation needed.

*Justification: Both ZVIS-01 and ZVIS-02 describe visual rendering behavior dependent on Syncfusion's PDF viewer DOM lifecycle, Fabric.js canvas rendering, and CSS compositor behavior. These cannot be meaningfully tested without a running browser with Syncfusion initialized. The codebase has no browser-based test infrastructure (no Playwright, Cypress, or JSDOM component tests). Adding browser testing is out of Phase 1 scope.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Annotations never disappear during zoom | ZVIS-01 | Requires running Syncfusion viewer with DOM lifecycle; no browser test infra | 1. Open app with `npm run dev` 2. Load a PDF with annotations 3. Zoom in/out via trackpad pinch, Ctrl+scroll, toolbar buttons 4. Verify annotations remain visible throughout entire zoom operation |
| Annotations scale smoothly via CSS transform | ZVIS-02 | Requires visual verification of GPU-accelerated rendering; no browser test infra | 1. Open Chrome DevTools Performance tab 2. Zoom in/out 3. Verify annotations grow/shrink in sync with page 4. Verify compositor-only frames (no layout/paint during zoom) |

---

## Validation Sign-Off

- [x] All tasks have manual verify or Wave 0 dependencies
- [x] Sampling continuity: manual verification after every task commit
- [x] Wave 0 covers all MISSING references (none needed)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
