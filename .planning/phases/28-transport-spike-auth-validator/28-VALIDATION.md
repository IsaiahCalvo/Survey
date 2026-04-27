---
phase: 28
slug: transport-spike-auth-validator
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-27
revised: 2026-04-27
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source of truth: 28-RESEARCH.md "Validation Architecture" section (line 792). This file fills the per-task command map and Wave 0 enumeration that the research doc designed; both must agree.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node test runner, builtin) for unit + integration. NOT vitest, NOT jest — project precedent is `node --test` from Phase 27 (`tests/phase27/*.test.mjs`). Playwright `^1.58.2` for browser/multi-peer scenarios under `debug/scenarios/`. |
| **Config file** | `package.json` script `"test": "node --test 'tests/**/*.test.mjs'"` (already exists). Playwright at `debug/playwright.config.mjs` (already exists). |
| **Quick run command** | `npm test 2>&1 \| tail -20` |
| **Full suite command** | `npm test && npx playwright test --config debug/playwright.config.mjs` |
| **Spike harness command** | `node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=5 --network=throttled` (Wave 0 ships skeleton; Plan 28-04 fills body) |
| **RLS test command** | `psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql` (Wave 0 ships skeleton; Plan 28-05's migration must be applied before suite runs green) |
| **Estimated runtime** | ~12 seconds for Phase 27+28 unit tests (`npm test`); ~30 seconds for Playwright fixme baseline; ~5 minutes per spike harness run (Plan 28-04 only) |

---

## Sampling Rate

- **After every task commit:** Run `npm test 2>&1 | tail -20` (must show baseline preserved + new Phase 28 unit tests pass; the applyUpdate-only invariant from Phase 27 must stay green)
- **After every plan wave:** Run `npm test && npx playwright test --config debug/playwright.config.mjs --grep phase28`
- **Before `/gsd:verify-work` (phase gate):**
  1. `npm test` green (no regressions)
  2. RLS pgTAP suite green: `psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql`
  3. Spike harness benchmark report committed to `.planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` with per-prototype p50/p95/p99 latency, per-peer message rate, and the locked decision rationale
  4. Playwright phase28 scenarios green
  5. Manual UAT (Plan 28-06 Task 5): owner revokes → banner fires within 3 seconds → document goes read-only
- **Max feedback latency:** ~12 seconds (the `npm test` quick run)

---

## Per-Task Verification Map

Every task in Phase 28's 6 plans has an `<automated>` verify command — none rely on manual-only checks except the explicit `checkpoint:human-verify` task at Plan 28-06 Task 5 (the manual UAT) and the `checkpoint:decision` task at Plan 28-04 Task 3 (transport lock-in). Both checkpoints have automated supporting verifies via `npm test` + RLS suite + benchmark JSON.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 28-01-01 | 01 | 0 | AUTH-01, AUTH-02 | unit (scaffold) | `node --test tests/phase28/originBuilder.test.mjs tests/phase28/deviceId.test.mjs tests/phase28/authSessionBridge.test.mjs tests/phase28/SupabaseYjsProvider.test.mjs tests/phase28/HocuspocusYjsProvider.test.mjs 2>&1 \| tail -30` | ❌ W0 creates | ⬜ pending |
| 28-01-02 | 01 | 0 | AUTH-01 | integration scaffold (SQL) | `test -f tests/phase28/rls/01_doc_yjs_updates_rls.sql && test -f tests/phase28/rls/02_origin_userId_override.sql && test -f tests/phase28/rls/03_non_collaborator_insert_rejected.sql && test -f tests/phase28/rls/04_select_gated_viewer.sql && test -f tests/phase28/rls/run-all.sql && test -f tests/phase28/rls/README.md` | ❌ W0 creates | ⬜ pending |
| 28-01-03 | 01 | 0 | AUTH-01, AUTH-02, Speed bar | scaffold (Playwright fixme + harness skeleton) | `test -f debug/scenarios/phase28-revoke-flow.spec.mjs && test -f debug/scenarios/phase28-kicked-out-banner.spec.mjs && test -f debug/scenarios/phase28-login-expired.spec.mjs && test -f debug/scenarios/phase28-multi-peer-throttled.spec.mjs && test -f tests/phase28/transportSpikeBenchmark.mjs && test -f .planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md && grep -c "test.fixme" debug/scenarios/phase28-*.spec.mjs && node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=5 --network=fast 2>&1 \| grep -q '"status": "skeleton"' && node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=5 --network=fast 2>&1 \| grep -q '"samples_count":'` | ❌ W0 creates | ⬜ pending |
| 28-02-01 | 02 | 1 | AUTH-01, AUTH-02 | unit | `node --test tests/phase28/originBuilder.test.mjs tests/phase28/deviceId.test.mjs 2>&1 \| tail -20` | ❌ Plan 28-02 creates | ⬜ pending |
| 28-02-02 | 02 | 1 | Auth handshake (Pitfall 1) | unit | `node --test tests/phase28/authSessionBridge.test.mjs 2>&1 \| tail -15` | ❌ Plan 28-02 creates | ⬜ pending |
| 28-02-03 | 02 | 1 | Speed bar prep, Auth handshake | unit + invariant | `node --test tests/phase28/SupabaseYjsProvider.test.mjs 2>&1 \| tail -15 && node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs 2>&1 \| tail -5` | ❌ Plan 28-02 creates | ⬜ pending |
| 28-03-01 | 03 | 1 | Speed bar prep (fallback path), Auth handshake | unit + invariant | `node --test tests/phase28/HocuspocusYjsProvider.test.mjs 2>&1 \| tail -15 && node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs 2>&1 \| tail -5` | ❌ Plan 28-03 creates | ⬜ pending |
| 28-04-01 | 04 | 2 | Speed bar | spike harness smoke | `node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=2 --duration=5 --network=fast --report-out=/tmp/phase28-smoke.json 2>&1 \| tail -5 && test -f /tmp/phase28-smoke.json && node -e "const r = JSON.parse(require('fs').readFileSync('/tmp/phase28-smoke.json','utf8')); if (typeof r.p95_ms !== 'number' && r.p95_ms !== null) throw new Error('p95_ms not in output'); console.log('OK shape:', Object.keys(r).join(','))"` | ❌ Plan 28-04 fills | ⬜ pending |
| 28-04-02 | 04 | 2 | Acceptance Criterion #2 (decision doc) | doc check (no `\|\| echo` masking — Blocker 4 fix) | `test -f .planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md && grep -c "## Status: locked" .planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md && grep -c "## Lock-in Statement" .planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md && grep -E "## Decision: (supabase\|hocuspocus\|stop-and-rethink)" .planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` | ❌ Plan 28-04 fills | ⬜ pending |
| 28-04-03 | 04 | 2 | Acceptance Criterion #2 + #3 + #5 (lock-in) | checkpoint:decision (manual gate, automated supporting verify) | `echo "Manual decision checkpoint — executor pauses here for user confirmation"` (the gate's `<done>` is automated against 28-BENCHMARK.md content via Task 28-04-02's verify) | n/a (gate) | ⬜ pending |
| 28-05-01 | 05 | 3 | RLS gating, Validator surface, Pitfall 8 | migration syntax check | `test -f supabase/migrations/20260504000000_phase28_transport_auth_validator.sql && bash -c 'grep -c "DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all" supabase/migrations/20260504000000_phase28_transport_auth_validator.sql'` | ❌ Plan 28-05 creates | ⬜ pending |
| 28-05-02 | 05 | 3 | Rollback symmetry | rollback file structure check (Warning 10 fix — 4 policies covered) | `test -f supabase/rollbacks/20260504000000_phase28_transport_auth_validator.down.sql && bash -c 'count=$(grep -cE "DROP POLICY IF EXISTS (doc_yjs_updates_select_viewer\|doc_yjs_updates_insert_editor\|doc_yjs_state_select_viewer\|doc_yjs_state_upsert_editor)" supabase/rollbacks/20260504000000_phase28_transport_auth_validator.down.sql); test "$count" = "4" \|\| (echo "FAIL: expected 4 DROP POLICY entries, got $count" && exit 1)'` | ❌ Plan 28-05 creates | ⬜ pending |
| 28-06-01 | 06 | 3 | Banner UX (kicked-out, login expired, transport offline) | syntax check + behavioral dismiss-gate (Warning 6 fix) | `node --check src/components/collab/StorageFailureBanner.jsx 2>&1 \|\| npx eslint src/components/collab/StorageFailureBanner.jsx 2>&1 \| tail -10` | ✅ exists | ⬜ pending |
| 28-06-02 | 06 | 3 | Login expiry UX | syntax check | `node --check src/components/collab/ReSignInModal.jsx 2>&1 \|\| npx eslint src/components/collab/ReSignInModal.jsx 2>&1 \| tail -10 && test -f src/components/collab/ReSignInModal.css` | ❌ Plan 28-06 creates | ⬜ pending |
| 28-06-03 | 06 | 3 | Transport state, AccessRevoked, login expired | syntax + integration grep | `node --check src/components/collab/YDocProvider.jsx 2>&1 \|\| npx eslint src/components/collab/YDocProvider.jsx 2>&1 \| tail -10 && grep -c "createTransportProvider\\\|createSupabaseYjsProvider\\\|createHocuspocusYjsProvider" src/components/collab/YDocProvider.jsx` | ✅ exists | ⬜ pending |
| 28-06-04 | 06 | 3 | Read-only mode, App.jsx scope (Blocker 1 fix) | syntax + integration | `node --check src/components/collab/ReadOnlyGate.jsx 2>&1 \|\| npx eslint src/components/collab/ReadOnlyGate.jsx 2>&1 \| tail -10 && test -f src/components/collab/ReadOnlyGate.css && grep -c "ReadOnlyGate" src/components/collab/YDocProvider.jsx` | ❌ Plan 28-06 creates | ⬜ pending |
| 28-06-05 | 06 | 3 | All Phase 28 user-facing acceptance criteria | checkpoint:human-verify (manual UAT — supported by `npm test` + RLS suite + Playwright) | `echo "Manual UAT — executor pauses here for human verification of multi-peer + kick + login-expiry + silent refresh scenarios"` plus the supporting `npm test && node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` baseline | n/a (gate) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Sampling Continuity Check

Inspected via the table above — no 3 consecutive tasks lack an `<automated>` verify. Both checkpoint tasks (28-04-03 transport-lock and 28-06-05 manual UAT) are bracketed on both sides by tasks with full automated verification, and each checkpoint has automated supporting verifies (28-04-02 BENCHMARK content check; `npm test` + RLS suite + Playwright baseline for the UAT).

---

## Wave 0 Requirements

Wave 0 (Plan 28-01) creates 16 scaffold files. Every Plan 28-XX-YY task that follows depends on a Wave 0 scaffold being present. The scaffolds use the `existsSync` skip-guard pattern from Phase 27's Plan 27-01 so they auto-flip skip→green as later plans land production code.

**Unit test scaffolds (5 files):**
- [ ] `tests/phase28/originBuilder.test.mjs` — 5 tests covering AUTH-01 origin payload shape contract; target = `src/lib/collab/originBuilder.js` (Plan 28-02)
- [ ] `tests/phase28/deviceId.test.mjs` — 5 tests covering AUTH-02 4-tier device-id derivation (Electron / web stable / web first-visit / SSR); target = `src/lib/collab/deviceId.js` (Plan 28-02)
- [ ] `tests/phase28/authSessionBridge.test.mjs` — 5 tests covering Pitfall 1 defense (TOKEN_REFRESHED → realtime.setAuth + SIGNED_OUT → onSignedOut + zero app-level timers); target = `src/lib/collab/authSessionBridge.js` (Plan 28-02)
- [ ] `tests/phase28/SupabaseYjsProvider.test.mjs` — 5 tests covering y-protocols sync v1 frame round-trip, base64 helpers, factory + disconnect contract, echo-loop guard via REMOTE_REALTIME_ORIGIN; target = `src/lib/collab/SupabaseYjsProvider.js` (Plan 28-02)
- [ ] `tests/phase28/HocuspocusYjsProvider.test.mjs` — 5 tests with HAS_HOCUSPOCUS guard; target = `src/lib/collab/HocuspocusYjsProvider.js` (Plan 28-03)

**RLS pgTAP-style SQL test suite (5 files + README):**
- [ ] `tests/phase28/rls/01_doc_yjs_updates_rls.sql` — owner / editor / viewer / non-collab SELECT + INSERT gating (target = `user_can_access_document` from Plan 28-05)
- [ ] `tests/phase28/rls/02_origin_userId_override.sql` — BEFORE INSERT trigger overrides client-claimed `origin.userId` with `auth.uid()` (target = `doc_yjs_updates_validate_origin()` from Plan 28-05)
- [ ] `tests/phase28/rls/03_non_collaborator_insert_rejected.sql` — non-collaborator INSERT raises 42501 (RLS violation)
- [ ] `tests/phase28/rls/04_select_gated_viewer.sql` — non-viewer SELECT returns zero rows
- [ ] `tests/phase28/rls/run-all.sql` — psql aggregator that includes all 4 numbered files
- [ ] `tests/phase28/rls/README.md` — explains env var setup + run command + status (Plan 28-05 lands the migration that turns the suite green)

**Playwright spec scaffolds (4 files, all `test.fixme` until Plans 28-04/28-06 wire production):**
- [ ] `debug/scenarios/phase28-revoke-flow.spec.mjs` — Plan 28-06 un-fixmes
- [ ] `debug/scenarios/phase28-kicked-out-banner.spec.mjs` — Plan 28-06 un-fixmes
- [ ] `debug/scenarios/phase28-login-expired.spec.mjs` — Plan 28-06 un-fixmes
- [ ] `debug/scenarios/phase28-multi-peer-throttled.spec.mjs` — Plan 28-04 un-fixmes (gated by `PHASE28_BENCHMARK_RUN=1` env so it doesn't fire on every CI run)

**Spike harness skeleton + benchmark report (2 files):**
- [ ] `tests/phase28/transportSpikeBenchmark.mjs` — node script accepting `--transport`, `--peers`, `--duration`, `--network=throttled\|fast`, `--report-out`. Skeleton emits JSON with strict superset of fields Plan 28-04 asserts on: `{ status, transport, peers, duration_s, network, p50_ms, p95_ms, p99_ms, msgs_per_sec, errors, samples_count, note }` (Blocker 3 fix — `samples_count` and `--network=fast` both included so Plan 28-04's smoke verify works against the skeleton).
- [ ] `.planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` — skeleton with all 6 section headers (Speed Bar, Prototype A, Prototype B, Tiebreaker Rules, Decision: pending, Lock-in Statement). Plan 28-04 fills in numbers + locks the decision.

**Framework install:** None — `node --test` is built into Node, Playwright is already in `package.json`, psql is the OS-level tool used by Supabase migrations. No new test-framework install.

**Wave 0 contract:** Zero `src/` touches. Every scaffold lives under `tests/phase28/`, `debug/scenarios/`, or `.planning/phases/28-*/`.

---

## Manual-Only Verifications

Two checkpoints in Phase 28 are explicitly manual (non-automatable user gates):

| Behavior | Requirement | Plan | Why Manual | Automated Supporting Verify | Test Instructions |
|----------|-------------|------|------------|----------------------------|-------------------|
| Lock the transport choice + validator surface for v2.4 | Acceptance Criterion #2, #3, #5 (CONTEXT.md tiebreaker rules) | 28-04 Task 3 | User judgment on tiebreaker outcome (simpler-wins-if-both-pass / stop-and-rethink-if-neither-passes / run-full-week-anyway). Cannot be automated — the decision is what the project commits to for v2.4. | 28-BENCHMARK.md content check (Plan 28-04 Task 2 verify) — confirms decision is recorded with rationale + lock-in statement before user is asked to confirm. | User reviews 28-BENCHMARK.md → types "approved" OR specifies an override option (lock-supabase-trigger / lock-supabase-edgefunction / lock-hocuspocus / stop-and-rethink). |
| 7-test UAT — multi-peer round-trip + kick UX + silent refresh + login-expiry banner + transport-offline + Phase 27 baseline | Acceptance Criteria 1, 6, 7, 8, 9, 10, 11, 13 | 28-06 Task 5 | Multi-peer real-time perception ("Figma feel"), kick UX latency (within 3s), inline modal placement (not fullscreen), document-stays-open in read-only mode — these are visual + interaction-feel gates that automation cannot validate as user-acceptance. | `npm test && node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs && psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql` — full code-level baseline must be green BEFORE the human runs the UAT. | 7 tests in Plan 28-06 Task 5's `<how-to-verify>` block — single-user round-trip, multi-peer p95 < 500ms, silent refresh, failed refresh banner + ReSignInModal, kick UX read-only, transport-offline, full Phase 27 baseline. Document blocked tests if Phase 34's `document_collaborators` table is not yet present. |

Both checkpoints are `gate="blocking"` — they pause execution until the user confirms.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — verified against the per-task command map above
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — both checkpoints are bracketed by automated tasks
- [x] Wave 0 covers all MISSING references — all 16 scaffold files enumerated above match Plan 28-01's `files_modified` and the test scaffolds listed in 28-RESEARCH.md "Wave 0 Gaps" section
- [x] No watch-mode flags — all commands are one-shot (`node --test`, `psql -f`, `npx playwright test`)
- [x] Feedback latency < 12 seconds for the quick run (`npm test 2>&1 | tail -20`)
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Blockers 1-4 + Warnings 6, 8, 10 from the checker pass addressed in the corresponding plans (verified by re-reading the plan files post-revision)

**Approval:** ready
