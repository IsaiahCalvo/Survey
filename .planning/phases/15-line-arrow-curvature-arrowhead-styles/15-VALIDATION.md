---
phase: 15
slug: line-arrow-curvature-arrowhead-styles
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `15-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (unit) + Playwright `debug:scenario` (visual/regression) |
| **Config file** | `playwright.config.js` (existing) — no new framework install |
| **Quick run command** | `node --test tests/unit/lineGeometry.test.js tests/unit/arrowheadStyles.test.js` |
| **Full suite command** | `npm run test:visual` (Playwright 113-test baseline + new scenarios) |
| **Estimated runtime** | ~6s quick · ~120s full |

---

## Sampling Rate

- **After every task commit:** Run quick command (unit only — sub-10s feedback)
- **After every plan wave:** Run full suite command (Playwright + units)
- **Before `/gsd:verify-work`:** Full suite must be green AND 113/113 baseline must still pass
- **Max feedback latency:** 10 seconds per task commit

---

## Per-Task Verification Map

> Filled in by gsd-planner during plan creation. Each plan task MUST appear here with one of: automated test command, Wave-0 dependency, or manual-only entry below.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| _to be filled by planner_ |  |  |  |  |  |  |  |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Test scaffolding that must land before Wave 1 implementation. Sources: Research § Validation Architecture, Open Question 1.

- [ ] `tests/unit/lineGeometry.test.js` — assertions for `getCurvedPath` (B(0.5)=midpoint), `getCurveEndAngle` (tangent at t=1 in degrees), `shouldSnapToLinear` (10px threshold), `getControlPoint` (cx=2·mx−0.5·sx−0.5·ex)
- [ ] `tests/unit/arrowheadStyles.test.js` — geometry assertions for all 6 styles (NONE, SOLID_TRIANGLE, V_SHAPE, OPEN_CIRCLE, OPEN_TRIANGLE, HORIZONTAL_LINE) at multiple stroke widths
- [ ] `tests/visual/scenarios/15-curvature.spec.js` — Playwright visual scenarios: curve passes through midpoint, snap-to-straight at 10px, endpoint preserves midpoint, curved-arrow tangent
- [ ] `tests/visual/scenarios/15-arrowheads.spec.js` — Playwright visual: each of 6 styles renders correctly at zoom 50%, 100%, 200%
- [ ] `tests/visual/baseline/15-no-regression.spec.js` — DOM-snapshot regression: existing straight `<line>` markup unchanged for legacy data with no `data.midpoint`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Picker UI for `arrowheadStyle` | ARROW-04 (read/write only) | Picker UI deferred to Phase 16 | Verify programmatically: edit Fabric JSON `data.arrowheadStyle` → reload → confirm new style renders |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
