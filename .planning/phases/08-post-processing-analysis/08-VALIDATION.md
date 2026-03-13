---
phase: 8
slug: post-processing-analysis
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js native test runner (`node:test`) |
| **Config file** | None (uses `--experimental-default-type=module --test`) |
| **Quick run command** | `node --experimental-default-type=module --test tests/post-process.test.mjs` |
| **Full suite command** | `node --experimental-default-type=module --test tests/*.test.mjs` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --experimental-default-type=module --test tests/anomaly-detector.test.mjs tests/timeline-merger.test.mjs tests/visual-diff.test.mjs tests/timeline-writer.test.mjs`
- **After every plan wave:** Run `node --experimental-default-type=module --test tests/*.test.mjs`
- **Before `/gsd:verify-work`:** Full suite must be green + run `npm run debug:process` on actual session folder
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 0 | PROC-01 | unit | `node --experimental-default-type=module --test tests/anomaly-detector.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 0 | PROC-02 | unit | `node --experimental-default-type=module --test tests/anomaly-detector.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 0 | PROC-03 | unit | `node --experimental-default-type=module --test tests/visual-diff.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 0 | PROC-04 | unit | `node --experimental-default-type=module --test tests/timeline-merger.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-05 | 01 | 0 | PROC-05 | unit | `node --experimental-default-type=module --test tests/timeline-writer.test.mjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/anomaly-detector.test.mjs` — stubs for PROC-01, PROC-02
- [ ] `tests/visual-diff.test.mjs` — stubs for PROC-03
- [ ] `tests/timeline-merger.test.mjs` — stubs for PROC-04
- [ ] `tests/timeline-writer.test.mjs` — stubs for PROC-05
- [ ] `debug/fixtures/mock-session/` — synthetic session folder with known JSONL data and small test screenshots

*Framework install: none needed (node:test is built-in)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end on real session | ALL | Real session data from Phase 7 needed | Run `npm run debug:process` on actual session folder, verify all outputs present |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
