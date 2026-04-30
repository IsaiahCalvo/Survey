---
phase: 30
slug: migration-dual-write
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-28
revised: 2026-04-28
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Revised after revision-iteration-1 of plan-phase: per-task table populated, file extensions corrected to `.mjs`, banner test name reconciled to plan's `StorageFailureBanner.syncQueueStuck.test.mjs`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (unit) + Playwright (E2E) — both already in project |
| **Config file** | `playwright.config.mjs` (E2E); `package.json` test scripts (unit) |
| **Quick run command** | `node --test <file path>.test.mjs` (per-file, < 5s); full unit: `npm test` |
| **Full suite command** | `npm test && npx playwright test --grep phase30` |
| **Estimated runtime** | ~45 seconds (unit) + ~120 seconds (E2E) |

---

## Sampling Rate

- **After every task commit:** Run unit quick command for the touched module(s)
- **After every plan wave:** Run full unit suite + relevant Playwright specs
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds (unit-only loop)

---

## Per-Task Verification Map

Acceptance criterion shorthand (from `30-CONTEXT.md ## Acceptance Criteria`, ordered top-to-bottom):
- AC-1  Dual-write produces both legacy + CRDT row on save
- AC-2  Silent first-open backfill (no banner / spinner / completion toast)
- AC-3  Idempotent re-runs (zero duplicates)
- AC-4  No "diff = delete" pattern anywhere (CI gate green)
- AC-5  meta.authorId = legacy user_id, meta.deviceId = "before-v2.4", meta.createdAt preserved
- AC-6  Properties device row reads "Before v2.4" (data path; rendering Phase 33)
- AC-7  Migrated annotations render visually identical to native v2.4
- AC-8  Half-failed save → silent retry queue (no error UI)
- AC-9  ~30s stuck-queue banner appears when threshold crossed
- AC-10 Queue persists across app close
- AC-11 Re-edit replaces queued entry (latest-wins)
- AC-12 ~10-attempt quarantine + inline marker
- AC-13 Document tile "unsaved changes" indicator
- AC-14 Offline first-open works (defers backfill until online)
- AC-15 Kill-switch (crdtFeatureFlag.isCRDTEnabled) gates dual-write
- AC-16 Mid-session flip = next-document-open semantics
- AC-17 Live-flippable kill switch (no re-deploy)
- AC-18 Highlights bypass dual-write (legacy-only)
- AC-19 Phase 33 single "Document migrated" log row per document (data path only this phase)

| Task ID | Plan | Wave | Requirement | AC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|----|-----------|-------------------|-------------|--------|
| 30-01-T1 | 01 | 0 | MIGRATE-01 | AC-1..3,5,8,9,11,12,15,18 | unit (scaffolds) | `npm test 2>&1 \| grep phase30\\|crdtBackfill\\|crdtDualWriteQueue\\|annotationCloudSync\\.dualWrite\\|StorageFailureBanner\\.syncQueueStuck\\|useDualWriteQueue` | ❌ W0 | ⬜ pending |
| 30-01-T2 | 01 | 0 | MIGRATE-01 | AC-1..3,8,9,12 | e2e (fixme'd scaffolds) | `npx playwright test --list 2>&1 \| grep phase30 \| wc -l` | ❌ W0 | ⬜ pending |
| 30-01-T3 | 01 | 0 | MIGRATE-01 | AC-4 | smoke (CI grep) | `node scripts/check-no-diff-delete.mjs` | ❌ W0 | ⬜ pending |
| 30-02-T1 | 02 | 1 | MIGRATE-01 | AC-2,3,5,14,18,19 | unit | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs` | ❌ W0 | ⬜ pending |
| 30-03-T1 | 03 | 1 | MIGRATE-01 | AC-8,9,10,11,12,15 | unit | `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | ❌ W0 | ⬜ pending |
| 30-04-T1 | 04 | 2 | MIGRATE-01 | AC-1,4,8,15,18 | unit | `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs && node scripts/check-no-diff-delete.mjs` | ❌ W0 | ⬜ pending |
| 30-05-T1 | 05 | 2 | MIGRATE-01 | AC-9 | unit (banner copy) | `node --test src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs` | ❌ W0 | ⬜ pending |
| 30-05-T2 | 05 | 2 | MIGRATE-01 | AC-12,13 | unit + manual (component shape) | `node --test src/hooks/__tests__/useDualWriteQueue.test.mjs && test -f src/components/collab/QuarantineMarkerOverlay.jsx && grep -c "didn't save, please try redrawing" src/components/collab/QuarantineMarkerOverlay.jsx` | ❌ W0 | ⬜ pending |
| 30-05-T3 | 05 | 2 | MIGRATE-01 | AC-13 | grep (TabBar capability) | `grep -c "hasPendingDualWrite" src/TabBar.jsx` | ❌ W0 | ⬜ pending |
| 30-06-T1 | 06 | 3 | MIGRATE-01 | AC-2,9,12,14,16,17 | unit + integration | `node --test src/lib/collab/__tests__/ src/services/__tests__/annotationCloudSync.dualWrite.test.mjs src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs && node scripts/check-no-diff-delete.mjs` | ❌ W0 | ⬜ pending |
| 30-06-T2 | 06 | 3 | MIGRATE-01 | AC-2,9,12 | manual UAT (checkpoint) | n/a — user resume signal gates this task | n/a | ⬜ pending |
| 30-07-T1 | 07 | 4 | MIGRATE-01 | AC-1,15,18 | unit + grep (live wire) | `node --test src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs && grep -c "dualWriteFabricCommit\\|dualWriteFabricDelete" src/hooks/useAnnotationCloudSync.js` | ❌ W0 | ⬜ pending |
| 30-07-T2 | 07 | 4 | MIGRATE-01 | AC-13 | unit + grep (TabBar wiring) | `node --test src/hooks/__tests__/useTabPendingDualWrite.test.mjs && grep -c "useTabPendingDualWrite" src/TabBar.jsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Coverage check:** Every AC-1..AC-19 except AC-6, AC-7, AC-19 has at least one automated test row. AC-6/7/19 are explicitly Phase 33 surface concerns (data path verified by AC-5; rendering deferred). They appear in the Manual-Only Verifications table below as planned-deferred.

---

## Wave 0 Requirements

Per research: 6 unit test files + 4 Playwright specs + the `check-no-diff-delete.mjs` CI gate. Each test uses `existsSync` skip-guards so the file lands red and auto-flips green as production modules land. **All filenames use `.mjs` extension** to match Phase 27/28/29 convention and what Plan 30-01 actually creates.

- [ ] `src/lib/collab/__tests__/crdtBackfill.test.mjs` — idempotency, `client_anno_id` keying, `meta.authorId`/`meta.deviceId`/`meta.createdAt` preservation, deferred-task timing, offline-defer-then-run path, highlight skip
- [ ] `src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs` — Web Locks election (1 leader + 1 no-op loser)
- [ ] `src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` — half-failed save retry, latest-version-wins replacement, persistence across app close, quarantine after ~10 retries, queue stays moving when one item is quarantined
- [ ] `src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` — fan-out to both legacy + CRDT, kill-switch reverts to legacy-only, highlight-skip filter, no-diff-delete invariant
- [ ] `src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs` — new `code: 'sync_queue_stuck'` copy variant, sticky / role=alert / locked CSS variables preserved
- [ ] `src/hooks/__tests__/useDualWriteQueue.test.mjs` — React-state surface for the in-doc banner trigger and quarantine marker flag (existsSync skip-guard, fixme'd until Plan 30-05 ships the hook)
- [ ] `src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs` — Plan 30-07 live-dual-write wire (existsSync skip-guard, flips skip→green when Plan 30-07 lands)
- [ ] `src/hooks/__tests__/useTabPendingDualWrite.test.mjs` — Plan 30-07 TabBar consumer hook (existsSync skip-guard, flips skip→green when Plan 30-07 lands)
- [ ] `tests/phase30/phase30-backfill-roundtrip.spec.mjs` — v2.4 user creates annotation → verify both `document_annotations` row + `doc_yjs_updates` row land
- [ ] `tests/phase30/phase30-stuck-queue-banner.spec.mjs` — force one side of dual-write to fail → after ~30s banner surfaces with stuck-queue copy → user can still draw
- [ ] `tests/phase30/phase30-edit-during-backfill.spec.mjs` — edit during backfill — user creates a new annotation while backfill is in flight; both annotations land in Y.Map without collision
- [ ] `tests/phase30/phase30-quarantine-marker.spec.mjs` — force ~10 retry failures on one annotation → inline marker `"didn't save, please try redrawing"` renders → rest of queue keeps moving
- [ ] `scripts/check-no-diff-delete.mjs` — CI gate that greps the dual-write surface (`crdtBackfill.js`, `crdtDualWriteQueue.js`, `annotationCloudSync.js` dual-write fan-out only) for delete-to-reconcile patterns; honors `// NO_DIFF_DELETE_OK:` escape hatch comment

**Note:** Plan 30-01 owns the first 5 unit scaffolds + 4 Playwright specs + the CI gate. The 3 additional `__tests__/*.test.mjs` files (useDualWriteQueue / useAnnotationCloudSync.dualWrite / useTabPendingDualWrite) are added by Plan 30-01 (revised) so all 8 unit scaffolds land in Wave 0 together.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Banner visual parity with Phase 27 `StorageFailureBanner` | MIGRATE-01 (AC-9 banner reuse) | Visual regression — token + spacing match easier to eyeball than diff-snapshot | Open dev server, force `code: 'sync_queue_stuck'`, compare banner layout / typography / spacing against Phase 27 banner side-by-side |
| TabBar "unsaved changes" red dot location + size | MIGRATE-01 (AC-13 tile signal) | Visual placement; relies on Plan 30-07 wiring useTabPendingDualWrite into TabBar item render | Open dev server, force a stuck queue (set `__crdtForceLegacyFail = true` then draw an annotation, wait 31s), verify red 6px dot appears on the affected tab pill BEFORE opening the dot tooltip; verify per-user (other collaborators don't see it) |
| Migrated annotation visual parity with native v2.4 annotation | MIGRATE-01 (AC-7 no "imported" pill) | Visual — confirm zero rendering differentiation | Open a v2.3 doc on v2.4; compare migrated annotation against a freshly drawn one on the same page; verify identical |
| Properties panel device row "Before v2.4" | MIGRATE-01 (AC-6) | Phase 33 owns the rendering surface; Phase 30 only ships the data | DEFERRED to Phase 33 — Phase 30 verifies via AC-5 unit tests (meta.deviceId === 'before-v2.4' on imported rows) |
| Activity log "Document migrated to collaborative version" row | MIGRATE-01 (AC-19) | Phase 33 owns the rendering surface; Phase 30 only ships the origin tag | DEFERRED to Phase 33 — Phase 30 verifies via origin-tag unit test (Plan 30-02 test 6: source: 'crdt-backfill' captured via afterTransaction observer) |
| Quarantine marker positioning at correct annotation bounding box | MIGRATE-01 (AC-12 marker visibility) | Phase 32 hardening required for per-page bbox feed (Always-Protected SVGAnnotationLayer / PAL surface) | **Phase 30 ships the overlay component, the queue → quarantinedAnnoIds wire, and the YDocProvider sibling mount only.** Markers float at (0,0) on every page by design until Phase 32 plugs in real per-annotation bboxes. Phase 30 acceptance is "the marker renders with correct copy in the React tree when an annotation is quarantined", verified by `grep -c "didn't save, please try redrawing" src/components/collab/QuarantineMarkerOverlay.jsx` + the e2e quarantine spec asserting the text node exists in the DOM. Visual placement is a Phase 32 follow-up logged in 30-deferred-items.md. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (12 of 13 task rows have automated commands; row 30-06-T2 is the only exception — manual UAT checkpoint per Plan 30-06)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (verified by inspecting Per-Task Verification Map column 7)
- [x] Wave 0 covers all MISSING references (all 8 unit scaffolds + 4 e2e specs + CI gate listed)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (revision iteration 1, 2026-04-28)
