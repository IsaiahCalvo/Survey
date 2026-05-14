---
phase: 32
slug: multi-tab-persistence-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E) + Vitest (unit) — confirm in Wave 0 |
| **Config file** | `playwright.config.js` / `vitest.config.js` (Wave 0 installs if missing) |
| **Quick run command** | `npm test -- --run` (unit, fast) |
| **Full suite command** | `npm test && npx playwright test` |
| **Estimated runtime** | ~120 seconds (unit + E2E) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test && npx playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit) / 120 seconds (E2E)

---

## Per-Task Verification Map

*(Populated by gsd-planner — one row per task, links to OFFLINE-01..04 and the multi-tab + compaction success criteria.)*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 32-XX-XX | XX | X | OFFLINE-XX | unit/E2E | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Playwright config + 2-tab scenario harness
- [ ] `tests/collab/yDocCompaction.test.js` — unit stubs for snapshot + prune
- [ ] `tests/collab/multiTabSync.test.js` — unit stubs for BroadcastChannel awareness channel
- [ ] Postgres migration smoke test scaffold for `compact_yjs_doc` RPC
- [ ] Window test seams (expose hooks for offline simulation + leader-tab inspection)

*If existing Playwright + Vitest already cover infrastructure, Wave 0 only adds new test files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Electron quota tier thresholds | quota UX | `navigator.storage.estimate()` broken in Electron — must verify against real packaged build | Wave 0 one-time UAT: package Electron build, fill IndexedDB to 1GB / 4GB, confirm Tier-1 chip + Tier-2 banner trigger |
| Sync chip visual distinctness | OFFLINE-04 | Three states must be visually distinct (not subtle dot colors) — judgement call | Open dev app, toggle offline → online → idle, screenshot all three states |
| Two-device offline merge | OFFLINE-03 | Requires two physical or two profile-isolated browser contexts editing same doc offline | Manual UAT: Device A + Device B both edit offline, both reconnect, both see merged state |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit) / 120s (E2E)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
