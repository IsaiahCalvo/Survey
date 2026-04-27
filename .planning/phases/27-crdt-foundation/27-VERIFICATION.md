---
phase: 27-crdt-foundation
verified: 2026-04-27T20:30:00Z
status: human_needed
score: 7/8 must-haves verified
re_verification: false
human_verification:
  - test: "Remove test.fixme from all 5 phase27 Playwright scenarios and run them interactively"
    expected: "phase27-roundtrip.spec.mjs and phase27-storage-banner.spec.mjs pass; multi-tab scenarios may require Phase 29 Fabric-Y.Map binding but the leader-handoff and rehydrate scenarios test purely lifecycle-layer behavior that is now wired"
    why_human: "All 5 scenarios still carry stale test.fixme(true) markers with reasons that describe Plan 27-04/27-05 work that has since landed. The plan's must_have truth requires them to 'flip from test.fixme to runnable and pass when run interactively'. Automated verification cannot remove the fixme markers or confirm which scenarios pass/fail against the live dev server."
---

# Phase 27: CRDT Foundation Verification Report

**Phase Goal:** Land the CRDT foundation layer for collaborative editing — Yjs-backed document model with IndexedDB persistence, Web-Locks-elected leader for multi-tab safety, BroadcastChannel handoff, storage-failure detection with user-facing banner, kill-switch feature flag, AUTH-03 server-authoritative timestamp schema, license CI gate, and React surface (YDocProvider/useYDoc/StorageFailureBanner) mounted into App.jsx under a narrow waiver.
**Verified:** 2026-04-27T20:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Y.Doc registry exists as the single allowed `new Y.Doc(` site, HMR-safe via `globalThis.__ydocRegistry__` | VERIFIED | `src/lib/collab/ydocRegistry.js` (69 lines); 1 actual constructor at line 28, 2 comment references; `applyUpdateOnlyInvariant.test.mjs` passes (test 149) |
| 2 | Web Locks election gates IndexedDB persistence; BroadcastChannel handoff uses `Y.applyUpdate` on the loser path | VERIFIED | `src/lib/collab/ydocLifecycle.js` (145 lines); `navigator.locks.request` (1), `new BroadcastChannel` (1), `new IndexeddbPersistence` (1), `Y.applyUpdate` (3), `new Y.Doc(` (0) |
| 3 | Storage failure detector emits typed codes for IDB errors; SSR-safe | VERIFIED | `src/lib/collab/storageFailureDetector.js` (75 lines); tests 153-156 all pass; `QuotaExceededError`, `InvalidStateError`, `VersionError` mappings confirmed |
| 4 | Kill-switch feature flag reads localStorage > env > default-on | VERIFIED | `src/lib/collab/crdtFeatureFlag.js` (48 lines); CRDT_LAYER_DISABLED and VITE_CRDT_LAYER_DISABLED constants present; SSR guard present |
| 5 | AUTH-03: `server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` on `doc_yjs_updates` and `activity_log`; schema idempotent with RLS stubs | VERIFIED | `supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql`; 2 `server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` column definitions; 3 `ENABLE ROW LEVEL SECURITY`; 3 `FOR ALL USING (FALSE)`; 3 `REFERENCES documents`; rollback file present with 3 `DROP TABLE IF EXISTS` |
| 6 | License CI gate blocks non-permissive deps; yjs trio at locked versions | VERIFIED | `.github/workflows/license-gate.yml` (36 lines) with allowlist comment and `node scripts/check-licenses.mjs` invocation; `scripts/check-licenses.mjs` (166 lines); `package.json` contains `yjs@^13.6.30`, `y-protocols@^1.0.7`, `y-indexeddb@^9.0.12`, `license-checker@^25.0.1` |
| 7 | React surface mounted: YDocProvider wires lifecycle on docId change; useYDoc hook exposes locked shape; StorageFailureBanner renders all 4 codes with correct copy, role=alert, aria-live | VERIFIED | `YDocProvider.jsx` (157 lines) imports `getOrCreateYDoc`, `attachLifecycle`, `isCRDTEnabled`, `StorageFailureBanner`; mounted at App.jsx line 38651 with `docId={tab.file?.id}`; `useYDoc.js` (38 lines) returns `YDocContext` via `useContext`; `StorageFailureBanner.jsx` (113 lines) has `role="alert"`, `aria-live="polite"`, all 4 copy variants; 220ms fade-in CSS classes present |
| 8 | All 5 Plan 27-01 Playwright scenarios flip from test.fixme to runnable | PARTIAL | Production code for Plans 27-04 and 27-05 has all landed. All 5 scenarios still carry `test.fixme(true)` markers with stale reasons (e.g. "YDocProvider not yet mounted" — it is mounted; "Web Locks election not yet wired" — it is wired). Explicitly deferred in 27-05-SUMMARY.md deferred items section. Manual run against live dev server required. |

**Score:** 7/8 truths verified (automated) — 1 deferred to human

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/phase27/applyUpdateOnlyInvariant.test.mjs` | grep assertion for Y.Doc site | VERIFIED | Passing (test 149) |
| `tests/phase27/ydocRegistry.test.mjs` | Y.Doc registry API contract | VERIFIED | Passing (tests 157-161) |
| `tests/phase27/schemaPresence.test.mjs` | column presence assertions | VERIFIED (skip-expected) | Skipped — SUPABASE_TEST_URL not set; skip reason is correct and documented |
| `tests/phase27/byteaRoundTrip.test.mjs` | bytea encode/decode round-trip | VERIFIED (skip-expected) | Skipped — SUPABASE_TEST_URL not set; skip reason is correct and documented |
| `tests/phase27/storageFailureDetector.test.mjs` | IDB error code coverage | VERIFIED | Passing (tests 153-156) |
| `tests/phase27/cryptYjsUpdatesSchema.test.mjs` | AUTH-03 server_ts assertion | VERIFIED (skip-expected) | Skipped — SUPABASE_TEST_URL not set; skip reason is correct |
| `debug/scenarios/phase27-roundtrip.spec.mjs` | Open PDF → annotate → reload E2E | PARTIAL | File exists, fixme stale (YDocProvider is now mounted) |
| `debug/scenarios/phase27-two-tab-no-dup.spec.mjs` | Two-tab leader/follower | PARTIAL | File exists, fixme stale (Web Locks now wired) |
| `debug/scenarios/phase27-leader-handoff.spec.mjs` | Tab close → loser promotes | PARTIAL | File exists, fixme stale (Web Locks now wired) |
| `debug/scenarios/phase27-rehydrate-no-wipe.spec.mjs` | Server snapshot + local edit survives | PARTIAL | File exists, fixme stale (applyUpdate-only path wired) |
| `debug/scenarios/phase27-storage-banner.spec.mjs` | IDB failure → banner appears | PARTIAL | File exists, fixme stale (StorageFailureBanner is built) |
| `.github/workflows/license-gate.yml` | MIT/BSD/Apache/ISC/CC0/0BSD/Unlicense allowlist + hard CI block | VERIFIED | File exists, references `node scripts/check-licenses.mjs`, allowlist in comment |
| `scripts/check-licenses.mjs` | license-checker wrapper | VERIFIED | 166 lines, `spawnSync` with `--onlyAllow` |
| `src/lib/collab/ydocRegistry.js` | getOrCreateYDoc / releaseYDoc / _evictForTest / _getRefCountForTest | VERIFIED | All 4 exports present; 69 lines; HMR stash present |
| `src/lib/collab/ydocLifecycle.js` | attachLifecycle (Web Locks + IDB + BC) | VERIFIED | 145 lines; Web Locks, BroadcastChannel, IndexeddbPersistence, Y.applyUpdate all present; 0 `new Y.Doc(` |
| `src/lib/collab/storageFailureDetector.js` | attachStorageFailureDetector | VERIFIED | 75 lines; IDB_ERROR_TO_CODE map present; SSR guard present |
| `src/lib/collab/crdtFeatureFlag.js` | isCRDTEnabled | VERIFIED | 48 lines; 3-tier read order implemented |
| `src/components/collab/YDocProvider.jsx` | React context provider | VERIFIED | 157 lines; 3 exports (YDocProvider default+named, YDocContext) |
| `src/hooks/useYDoc.js` | useYDoc hook | VERIFIED | 38 lines; 2 exports; frozen NULL_VALUE fallback |
| `src/components/collab/StorageFailureBanner.jsx` | Banner with 4 copy variants | VERIFIED | 113 lines; all 4 codes; role=alert; aria-live=polite |
| `src/components/collab/StorageFailureBanner.css` | CSS tokens + fade-in | VERIFIED | 161 lines; .svg-annotations--hydrating + --hydrated present; 220ms cubic-bezier correct |
| `supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql` | 3 tables + AUTH-03 + RLS | VERIFIED | 2 server_ts NOT NULL DEFAULT NOW() columns; 3 RLS enables; 3 REFERENCES documents; 3 BYTEA columns |
| `supabase/rollbacks/20260428000000_phase27_crdt_foundation_schema.down.sql` | Reverse DROP in FK-safe order | VERIFIED | 3 DROP TABLE IF EXISTS; CASCADE on each |
| `src/App.jsx` | YDocProvider mount at document-open boundary | VERIFIED | 1 import (line 80); 1 `<YDocProvider docId={tab.file?.id}>` (line 38651); 1 `</YDocProvider>` (line 38676); narrow waiver scope honored |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/App.jsx` | `YDocProvider.jsx` | import + JSX wrap | WIRED | `import YDocProvider` at line 80; `<YDocProvider docId={tab.file?.id}>` at line 38651 |
| `YDocProvider.jsx` | `ydocRegistry.js` | `getOrCreateYDoc(docId)` | WIRED | Import confirmed; `getOrCreateYDoc(docId)` in useMemo at line 61 |
| `YDocProvider.jsx` | `ydocLifecycle.js` | `attachLifecycle` on mount | WIRED | Import confirmed; `attachLifecycle(ydoc, docId, ...)` in useEffect |
| `YDocProvider.jsx` | `crdtFeatureFlag.js` | `isCRDTEnabled()` guard | WIRED | Import confirmed; kill-switch read in outer routing branch |
| `YDocProvider.jsx` | `StorageFailureBanner.jsx` | `<StorageFailureBanner code=...>` | WIRED | Import confirmed; conditional render on storageState |
| `StorageFailureBanner.jsx` | `useYDoc.js` | context consumption | NOT DIRECTLY WIRED | Banner receives `code` prop from YDocProvider directly; does not import useYDoc. YDocContext state flows down through YDocProvider render — this is correct architecture per the plan (YDocProvider owns the state, passes `code` as prop to the Banner). Not a gap. |
| `ydocLifecycle.js` | `navigator.locks.request` | Web Locks leader election | WIRED | `navigator.locks.request` called with lock-per-documentId pattern |
| `ydocLifecycle.js` | `y-indexeddb (IndexeddbPersistence)` | leader-only persistence | WIRED | `new IndexeddbPersistence(documentId, ydoc)` inside the lock callback only |
| `ydocLifecycle.js` | `BroadcastChannel` | loser-tab cross-tab updates | WIRED | `new BroadcastChannel` + `Y.applyUpdate(ydoc, ..., REMOTE_BC_ORIGIN)` |
| `ydocLifecycle.js` | `Y.applyUpdate` | applyUpdate-only invariant | WIRED | REMOTE_BC_ORIGIN echo-loop guard; no `new Y.Doc(` in file |
| `.github/workflows/license-gate.yml` | `scripts/check-licenses.mjs` | `node scripts/check-licenses.mjs` | WIRED | Step `run: node scripts/check-licenses.mjs` confirmed |
| `tests/phase27/applyUpdateOnlyInvariant.test.mjs` | `src/lib/collab/ydocRegistry.js` | git grep allowlist | WIRED | Test passes (test 149); ydocRegistry.js confirmed as only grep hit |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUTH-03 | 27-01, 27-02, 27-03, 27-04, 27-05 | Every annotation creation/edit/deletion records a server-authoritative timestamp | SATISFIED | `server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` on `doc_yjs_updates` and `activity_log`; `cryptYjsUpdatesSchema.test.mjs` scaffold ready to assert when SUPABASE_TEST_URL is set; REQUIREMENTS.md marks AUTH-03 as `[x] Complete` for Phase 27 |

No orphaned requirements: REQUIREMENTS.md confirms AUTH-03 is the only requirement assigned to Phase 27.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `debug/scenarios/phase27-roundtrip.spec.mjs` | 17 | `test.fixme(true, 'YDocProvider not yet mounted...')` — stale reason; YDocProvider IS mounted | Warning | Scenario does not run; fixme reason describes completed work |
| `debug/scenarios/phase27-storage-banner.spec.mjs` | 25 | `test.fixme(true, 'StorageFailureBanner not yet built...')` — stale reason; banner IS built | Warning | Scenario does not run; fixme reason describes completed work |
| `debug/scenarios/phase27-leader-handoff.spec.mjs` | n/a | `test.fixme(true, 'Web Locks election not yet wired...')` — stale reason; Web Locks IS wired | Warning | Scenario does not run |
| `debug/scenarios/phase27-rehydrate-no-wipe.spec.mjs` | n/a | `test.fixme(true, 'applyUpdate-only path not yet wired...')` — stale reason; path IS wired | Warning | Scenario does not run |
| `debug/scenarios/phase27-two-tab-no-dup.spec.mjs` | n/a | `test.fixme(true, 'BroadcastChannel handoff + Web Locks election not yet wired...')` — stale; both wired | Warning | Scenario does not run |
| `src/lib/collab/__tests__/ydocRegistry.test.mjs` | n/a | Co-located test is NOT picked up by `npm test` (glob is `tests/**/*.test.mjs`, not `src/**`) | Info | Intentional per plan design; mentioned in 27-02 plan as expected behavior |

No blocker anti-patterns found. No `return null` stubs, no TODO placeholders blocking goal achievement. The 6 pre-existing test failures (`migration.test.mjs` tests 43-45, `pdfAnnotationImporter.test.mjs` tests 132/134/135) are from commits predating Phase 27 and are not in scope.

---

### Human Verification Required

#### 1. Remove stale test.fixme markers from Playwright scenarios and run interactively

**Test:** For each of the 5 phase27 Playwright scenario files in `debug/scenarios/`, remove the `test.fixme(true, '...')` line at the top of the describe block. Then run:
```
npx playwright test --config debug/playwright.config.mjs --grep phase27
```

**Expected:**
- `phase27-roundtrip.spec.mjs` — should pass. YDocProvider is mounted, IndexeddbPersistence is wired, the single-user round-trip was manually confirmed by the user (drew a pen-stroke on Page 6, refreshed, stroke reappeared).
- `phase27-storage-banner.spec.mjs` — should pass for the "banner mounts, document still opens" assertion. Note: the copy the scenario checks (`'Local saving is offline'`) is the confirmed heading per 27-UI-SPEC.md. The `addInitScript` IDB stub may behave differently in Playwright's Chromium vs production — verify the `onerror` path fires correctly.
- `phase27-leader-handoff.spec.mjs` — depends on `window.__test_getLockRole` hook in the production code. The plan's scenario uses this hook but it was never confirmed to be wired into `ydocLifecycle.js`. If the hook is absent, this scenario needs a gap-closure plan to add the test-hook export.
- `phase27-rehydrate-no-wipe.spec.mjs` — depends on `window.__test_inflightEdit` and `window.__test_simulateServerSnapshot` hooks. Same concern as above.
- `phase27-two-tab-no-dup.spec.mjs` — depends on `window.__test_openPdf`, `window.__test_createAnnotation`, and IndexedDB introspection. Playwright's chromium supports Web Locks; multi-context scenarios should work.

**Why human:** All 5 scenarios contain Playwright scripted actions against the running dev server. The fixme markers prevent automated CI from running them. Whether they pass against the live app requires actually removing the markers and running interactively. Some scenarios depend on `window.__test_*` hooks that may not be wired into production code, which would require a follow-up plan.

---

### Gaps Summary

The phase's functional goal is fully achieved in code: the Y.Doc registry, lifecycle layer, storage detection, kill switch, schema migration, license gate, and React surface are all present, substantive, and wired together correctly. The single-user round-trip was manually confirmed live by the user (pen-stroke → reload → reappeared). AUTH-03 is schema-level enforced. The applyUpdate-only invariant is green.

The one open item is the 5 Playwright scenarios with stale `test.fixme` markers. The plan's must_have truth requires them to "flip from test.fixme to runnable (and pass when run interactively)". The SUMMARY acknowledges the deferral explicitly and documents it as intentional because two of the multi-tab scenarios depend on Phase 29 bindings and some scenarios depend on `window.__test_*` hooks that may not be wired. A human must determine which scenarios can be un-fixme'd immediately and which require a follow-up plan.

This is classified `human_needed` rather than `gaps_found` because: (1) the functional code is verified present and wired; (2) the manual UAT confirmed the core goal (persistence round-trip); (3) the prompt instructions explicitly accept the banner test coverage gap; (4) the only outstanding item is the Playwright scenario fixme-removal which is interactive-only work.

---

_Verified: 2026-04-27T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
