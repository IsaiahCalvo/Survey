---
phase: 32
slug: multi-tab-persistence-hardening
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
revised: 2026-05-14
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (built-in Node test runner) for unit/integration; `@playwright/test` v1.58.2 for browser/multi-tab scenarios |
| **Config file** | `package.json` script `"test": "node --test 'tests/**/*.test.mjs'"`; Playwright config at `debug/playwright.config.mjs` |
| **Quick run command** | `npm test -- --run` (unit, fast, ~30s) |
| **Full suite command** | `npm test && npx playwright test --config debug/playwright.config.mjs` |
| **Estimated runtime** | ~30s unit / ~5 min E2E (full Phase 32 grep ~90s) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test && npx playwright test --config debug/playwright.config.mjs --grep phase32`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit) / 120 seconds (E2E)

---

## Per-Task Verification Map

One row per task across Plans 32-01..32-07. Links each task to its `<automated>` command from the PLAN file's `<verify>` block. Status reflects the file-existence side of Nyquist (scaffold present in Wave 0 = ✅ W0; production code present = ✅).

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 32-01-1 | 32-01 | 0 | OFFLINE-01/02/03/04 | unit (scaffolds) | `npm test -- --run 2>&1 \| grep -E "(phase32\|yDocCompaction\|multiTabSync\|storageQuotaMonitor)" \| head -20` | ✅ W0 | ⬜ pending |
| 32-01-2 | 32-01 | 0 | OFFLINE-04 | unit (scaffolds) | `npm test -- --run 2>&1 \| grep -E "(syncStatusViewModel\|compactionRpcAtomic)" \| head -20` | ✅ W0 | ⬜ pending |
| 32-01-3 | 32-01 | 0 | OFFLINE-01/02/03/04 + multi-tab + compaction | E2E (scaffolds, fixme'd) | `npx playwright test --config debug/playwright.config.mjs --grep phase32 --list \| head -20` | ✅ W0 | ⬜ pending |
| 32-02-1 | 32-02 | 1 | OFFLINE-01/02 | sql/migration | `node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/migrations/20260520000000_phase32_compaction_rpc.sql','utf8'); const ok = sql.includes('CREATE OR REPLACE FUNCTION compact_yjs_doc'); process.exit(ok ? 0 : 1)"` | ❌ W0 | ⬜ pending |
| 32-02-2 | 32-02 | 1 | OFFLINE-01/02 (Pitfall 1) | unit | `npm test -- --run tests/phase32/yDocCompaction.test.mjs tests/phase32/compactionRpcAtomic.test.mjs 2>&1 \| tail -20` | ❌ W0 | ⬜ pending |
| 32-03-1 | 32-03 | 1 | OFFLINE-04 (Pitfall 2) | unit | `npm test -- --run tests/phase32/multiTabSync.test.mjs 2>&1 \| tail -20` | ❌ W0 | ⬜ pending |
| 32-04-1 | 32-04 | 1 | OFFLINE-04 (Pitfall 4) | unit | `npm test -- --run tests/phase32/storageQuotaMonitor.test.mjs 2>&1 \| tail -20` | ❌ W0 | ⬜ pending |
| 32-05-1 | 32-05 | 2 | OFFLINE-04 | unit | `npm test -- --run tests/phase32/syncStatusViewModel.test.mjs 2>&1 \| tail -20` | ✅ (file exists) | ⬜ pending |
| 32-05-2 | 32-05 | 2 | OFFLINE-04 | unit (integration via chip render) | `npm test -- --run 2>&1 \| tail -10 && grep -c "quotaTier" src/components/SyncStatusChip.jsx` | ✅ (file exists) | ⬜ pending |
| 32-05-3 | 32-05 | 2 | OFFLINE-04 | grep + unit | `grep -E "Couldn['’]t reach the cloud\|Local storage is almost full" src/components/collab/StorageFailureBanner.jsx; npm test -- --run 2>&1 \| tail -10` | ✅ (file exists) | ⬜ pending |
| 32-06-1 | 32-06 | 3 | OFFLINE-01/02/03/04 | grep + unit | `grep -c "attachCompaction\|attachMultiTabSync\|attachStorageQuotaMonitor\|__yDocLeaderRole" src/components/collab/YDocProvider.jsx; npm test -- --run 2>&1 \| tail -10` | ✅ (file exists) | ⬜ pending |
| 32-06-2 | 32-06 | 3 | OFFLINE-04 | grep + unit | `grep -c "__phase32" src/App.jsx; grep -c "cloudSyncQuotaTier\|quotaTier" src/App.jsx; grep -c "quotaTier" src/PDFSidebar.jsx; npm test -- --run 2>&1 \| tail -10` | ✅ (file exists) | ⬜ pending |
| 32-07-1 | 32-07 | 4 | OFFLINE-01/02/03/04 | E2E | `npx playwright test --config debug/playwright.config.mjs --grep "phase32-(offline-edit-persist\|reconnect-silent-merge\|two-device-offline-merge\|sync-chip-three-states)" 2>&1 \| tail -30` | ✅ W0 | ⬜ pending |
| 32-07-2 | 32-07 | 4 | success criterion 5 + 6 | E2E | `npx playwright test --config debug/playwright.config.mjs --grep "phase32-(multi-tab-stress\|compaction-roundtrip)" 2>&1 \| tail -30` | ✅ W0 | ⬜ pending |
| 32-07-3 | 32-07 | 4 | doc artifact | file existence | `test -f .planning/phases/32-multi-tab-persistence-hardening/32-VERIFICATION.md && grep -c "OFFLINE-0[1-4]" .planning/phases/32-multi-tab-persistence-hardening/32-VERIFICATION.md` | ❌ produced by 32-07 | ⬜ pending |
| 32-07-4 | 32-07 | 4 | UAT (checkpoint) | manual (logged in 32-VERIFICATION.md) | n/a — checkpoint task; result captured in `## Manual UAT` table inside 32-VERIFICATION.md | n/a | ⬜ pending |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · n/a checkpoint*
*"File Exists" reflects whether the production target file exists at phase open. ✅ W0 = test scaffold landed in Wave 0; ❌ W0 = production code not yet present and the Wave 0 scaffold skips cleanly per existsSync guard.*

---

## Wave 0 Requirements

Wave 0 (Plan 32-01) ships scaffolds for ALL production targets in Plans 32-02..32-07. Each scaffold uses the per-test `existsSync` skip-guard pattern verbatim from Phase 27/28/29/30/31 so it auto-flips skip→run when the corresponding production module lands.

- [x] `tests/phase32/yDocCompaction.test.mjs` — covers threshold trigger + `_forceCompactForTest` round-trip + onError surfacing (Pitfall 3). Skip guard targets `src/lib/collab/yDocCompaction.js` (lands Plan 32-02).
- [x] `tests/phase32/multiTabSync.test.mjs` — covers BroadcastChannel awareness routing + `REMOTE_AWARE_ORIGIN` echo guard (Pitfall 2). Skip guard targets `src/lib/collab/multiTabSync.js` (lands Plan 32-03).
- [x] `tests/phase32/storageQuotaMonitor.test.mjs` — covers Tier-1 (~80%) and Tier-2 (~95% or QuotaExceededError) + Electron-vs-browser branching (Pitfall 4). Skip guard targets `src/lib/collab/storageQuotaMonitor.js` (lands Plan 32-04).
- [x] `tests/phase32/syncStatusViewModel.test.mjs` — covers the three locked-copy strings exactly + queueSize pluralization + quotaTier passthrough. Skip guard is CONTENT-based (checks for em-dash + "changes queued" in the existing file body) so the suite skips until Plan 32-05 lands the locked copy.
- [x] `tests/phase32/compactionRpcAtomic.test.mjs` — covers Pitfall 1 atomicity by asserting `supabase.rpc` is called exactly ONCE and `supabase.from` is NEVER called. Skip guard targets `src/lib/collab/yDocCompaction.js` (lands Plan 32-02).
- [x] Six Playwright scaffolds under `debug/scenarios/phase32-*.spec.mjs` for OFFLINE-01..04 + multi-tab stress + compaction roundtrip — all `test.fixme`'d today; Plan 32-07 un-fixmes after production code lands.
- [x] Window test seams enumerated in Plan 32-06 acceptance criteria: `__phase32CreateAnnotation`, `__phase32CountAnnotations`, `__phase32QueueSize` (owned by App.jsx); `__phase32ForceCompact`, `__yDocLeaderRole`, `__phase32WaitForLeaderRole` (owned by YDocProvider.jsx). All gated on `import.meta.env.MODE !== 'production'`.

Wave 0 status: 5 unit test scaffolds + 6 Playwright spec scaffolds in place; production code lands per plan. No Playwright/Vitest install needed — `node --test` is built-in, Playwright is already in devDeps.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Electron quota tier thresholds | OFFLINE-04 (Tier-1/Tier-2 surface variant) | `navigator.storage.estimate()` reports free disk on Electron, not the 1/3-of-disk quota — must verify against real packaged build per Pitfall 4 + Open Question 3 | Wave 4 UAT (Plan 32-07 Task 4 checkpoint): package Electron build, fill IndexedDB to ~1 GB / ~4 GB, confirm Tier-1 chip ring + Tier-2 banner trigger. DEFERRED acceptable if Electron build not packaged this session — document in 32-RECONCILIATION.md. |
| Sync chip visual distinctness | OFFLINE-04 | Three states must be visually distinct (not subtle dot colors) — judgement call | Wave 4 UAT (Plan 32-07 Task 4 checkpoint): open dev app, toggle offline → online → idle, screenshot all three states + Tier-1 ring variant. |
| Two-device offline merge | OFFLINE-03 | Browser-context simulation in Playwright (covers it) is solid, but real two-device adds confidence | Wave 4 UAT (Plan 32-07 Task 4 checkpoint): Device A + Device B both edit offline, both reconnect, both see merged state. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (one row per task across Plans 32-01..32-07; every row links to its `<automated>` command from the PLAN's `<verify>` block)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has unit grep or E2E test)
- [x] Wave 0 covers all MISSING references (every scaffold in Plan 32-01 is checked above; production targets are listed in `files_modified` of Plans 32-02..32-06)
- [x] No watch-mode flags (every `<automated>` uses `--run` for vitest-shape compatibility or one-shot for node:test / Playwright)
- [x] Feedback latency < 30s (unit) / 120s (E2E)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready for execution
