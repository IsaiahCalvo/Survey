---
phase: 30
slug: migration-dual-write
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (unit) + Playwright (E2E) — both already in project |
| **Config file** | `playwright.config.js` (E2E); `package.json` test scripts (unit) |
| **Quick run command** | `npm run test:unit -- --grep "phase-30"` |
| **Full suite command** | `npm run test:unit && npm run test:e2e -- --grep "phase-30"` |
| **Estimated runtime** | ~45 seconds (unit) + ~120 seconds (E2E) |

---

## Sampling Rate

- **After every task commit:** Run unit quick command for the touched module(s)
- **After every plan wave:** Run full unit suite + relevant Playwright specs
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds (unit-only loop)

---

## Per-Task Verification Map

*To be filled in by gsd-planner. Every task gets a row mapping to MIGRATE-01 plus the specific Acceptance Criterion (AC-1 through AC-19) it satisfies.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 30-XX-XX | XX | N | MIGRATE-01 | unit/E2E | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per research: 5 unit test files + 4 Playwright specs + the `check-no-diff-delete.mjs` CI gate. Each test uses `existsSync` skip-guards so the file lands red and auto-flips green as production modules land.

- [ ] `src/lib/collab/__tests__/crdtBackfill.test.js` — idempotency, `client_anno_id` keying, `meta.authorId`/`meta.deviceId`/`meta.createdAt` preservation, Web Locks arbitration, deferred-task timing, offline-defer-then-run path, highlight skip
- [ ] `src/lib/collab/__tests__/crdtDualWriteQueue.test.js` — half-failed save retry, latest-version-wins replacement, persistence across app close, quarantine after ~10 retries, queue stays moving when one item is quarantined
- [ ] `src/services/__tests__/annotationCloudSync.dualWrite.test.js` — fan-out to both legacy + CRDT, kill-switch reverts to legacy-only, highlight-skip filter, no-diff-delete invariant
- [ ] `src/components/collab/__tests__/StorageFailureBanner.stuckQueue.test.jsx` — new `code: 'sync_queue_stuck'` copy variant, ~30s threshold, sticky / role=alert / locked CSS variables preserved
- [ ] `src/hooks/__tests__/useDualWriteQueue.test.jsx` — React-state surface for the in-doc banner trigger and quarantine marker flag
- [ ] `e2e/phase-30-dual-write.spec.ts` — v2.4 user creates annotation → verify both `document_annotations` row + `doc_yjs_updates` row land
- [ ] `e2e/phase-30-backfill-idempotent.spec.ts` — open v2.3 doc on v2.4 twice → assert zero duplicates in CRDT store
- [ ] `e2e/phase-30-stuck-queue-banner.spec.ts` — force one side of dual-write to fail → after ~30s banner surfaces with stuck-queue copy → user can still draw
- [ ] `e2e/phase-30-quarantine-marker.spec.ts` — force ~10 retry failures on one annotation → inline marker `"didn't save, please try redrawing"` renders → rest of queue keeps moving
- [ ] `scripts/check-no-diff-delete.mjs` — CI gate that greps the dual-write surface (`crdtBackfill.js`, `crdtDualWriteQueue.js`, `annotationCloudSync.js` dual-write fan-out only) for delete-to-reconcile patterns; honors `// NO_DIFF_DELETE_OK:` escape hatch comment

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Banner visual parity with Phase 27 `StorageFailureBanner` | MIGRATE-01 (banner reuse) | Visual regression — token + spacing match easier to eyeball than diff-snapshot | Open dev server, force `code: 'sync_queue_stuck'`, compare banner layout / typography / spacing against Phase 27 banner side-by-side |
| Document tile "unsaved changes" icon location + size | MIGRATE-01 (tile signal) | Depends on dashboard component planner identifies during Wave 0 scout; visual placement | Open dashboard with a doc that has a stuck queue; verify icon visible BEFORE opening doc; verify per-user (other collaborators don't see it) |
| Migrated annotation visual parity with native v2.4 annotation | MIGRATE-01 (no "imported" pill) | Visual — confirm zero rendering differentiation | Open a v2.3 doc on v2.4; compare migrated annotation against a freshly drawn one on the same page; verify identical |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
