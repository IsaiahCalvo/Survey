---
phase: 2
slug: positional-accuracy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual visual verification (no browser test infra in project) |
| **Config file** | none |
| **Quick run command** | `npm run dev` then manually zoom, verify alignment |
| **Full suite command** | `npm run dev` then full manual checklist below |
| **Estimated runtime** | ~2 minutes (manual) |

---

## Sampling Rate

- **After every task commit:** Run `npm run dev`, enable debug crosshairs, zoom at annotation, verify crosshair stays on content landmark
- **After every plan wave:** Full manual test: zoom via all three methods (Ctrl+scroll, toolbar, pinch if supported) across 25%-400% range; verify on multi-page document with annotations on different pages
- **Before `/gsd:verify-work`:** Full suite must pass manual checklist
- **Max feedback latency:** ~120 seconds (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | ZCOR-01, ZCOR-03 | manual | Visual: zoom on annotation, verify no drift from page content | N/A | pending |
| 02-01-02 | 01 | 1 | ZPOL-01 | manual | Visual: hover annotation, Ctrl+scroll zoom, verify cursor point stays fixed | N/A | pending |
| 02-02-01 | 02 | 1 | ZCOR-03 | manual | Visual: zoom via toolbar, verify annotation zoom matches page zoom from viewport center | N/A | pending |
| 02-02-02 | 02 | 1 | ZCOR-01 | manual | Visual: enable debug crosshairs, verify alignment at 25%, 100%, 200%, 400% | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Debug alignment markers are part of implementation (not test infrastructure).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Annotations stay aligned with page content during zoom | ZCOR-01 | Visual rendering alignment dependent on live Syncfusion PDF viewer DOM, CSS compositor, and sub-pixel positioning | 1. Load multi-page PDF with annotations 2. Hover over an annotation 3. Ctrl+scroll zoom in/out 4. Verify annotation stays aligned with underlying content |
| Transform-origin matches across zoom methods | ZCOR-03 | Requires testing with actual Syncfusion viewer zoom behavior per method | 1. Zoom via Ctrl+scroll, note anchor behavior 2. Zoom via toolbar buttons, verify viewport-center anchor 3. Compare annotation movement with page content movement |
| Cursor-centered zoom | ZPOL-01 | Requires visual verification that point under cursor remains stationary | 1. Position cursor over a known content/annotation landmark 2. Ctrl+scroll zoom in 3. Verify the point under cursor does not move 4. Repeat at multiple zoom levels across 25%-400% range |

---

## Validation Sign-Off

- [ ] All tasks have manual verify instructions
- [ ] Sampling continuity: every task commit includes visual verification
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
