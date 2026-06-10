# Plan Review Log: KAL-257 — Re-enable the skipped persistence tests
Started 2026-06-10, overnight-autonomous loop session. MAX_ROUNDS=5.
PLAN_FILE=PLAN-KAL257.md (scoped — root PLAN.md is the governing Excel-sync contract and is untouched).
Human gate #2 (implement-on-approval) pre-authorized by Isaiah's overnight loop charter: "have Codex adversarially review the plan until approved; build gated on npx vite build + node scripts/run-node-tests.mjs".

## Round 1 — aborted (Codex hang), plan revised before verdict
Codex exec (CLI 0.130.0, default model from config.toml) produced no rollout file, no thread.started event, and no verdict for 20+ minutes; processes killed. Retrying with stderr visible.
Meanwhile the plan changed materially before any verdict:
- Isaiah's directive (mid-flight): NO Docker — use cloud Supabase via the CLI. Local-stack approach abandoned; Docker Desktop quit; repo state restored.
- Created dedicated cloud test project survey-test (zgdkyslxbkusexmkfvgd); bootstrapped schema via Management API (stub documents + phase27 DDL verbatim + introspection view); smoke-verified via PostgREST.
- Discovered the migration chain cannot replay on a blank DB (documents table predates the chain; replay fails at 20241223000002) — filed as a ticket finding; bootstrap script becomes a committed artifact.
- Corrected the stale baseline: 1326 tests / 1320 pass / 6 skip / 0 fail (readiness doc said 905/899/6/0).
PLAN-KAL257.md rewritten accordingly (Round 1 draft).

## Round 1 — Codex (thread 019eb042-6db7-7792-bd42-c5d14f0ac21d)
(Tooling note: round 1 needed three launches — codex exec hangs without stdin redirected from /dev/null in background shells, then the CLI's rotated refresh token killed the session; worked around by stamping auth.json last_refresh so the still-valid access token is used. A duplicate parallel session was killed before it could clobber the verdict file.)

Findings (verbatim):
- Prod/test guard missing. run-node-tests.mjs inherits SUPABASE_TEST_URL; unit baseline can change and typo can hit prod. Fix: require SUPABASE_INTEGRATION=1 plus allowlist project ref zgdkyslxbkusexmkfvgd.
- Service key fallback contradicts plan: tests use SERVICE_KEY || ANON_KEY. Fix: require service key only; no anon fallback.
- byteaRoundTrip race/leak: fixed doc id + Date.now() seq + no finally cleanup. Fix: randomUUID() doc id, seq=1, cleanup parent in finally.
- Manual cloud state is a trust gap: plan says survey-test already mutated before bootstrap is committed. Fix: guarded idempotent bootstrap wrapper, pinned to test ref, re-run from clean state.
- ?testPdf claim is wrong/too broad: repo says route skips auth/dashboard/Supabase services; current spec uses nonexistent window.__test_* helpers. Fix: rewrite around /?testPdf=... + real UI + assert zero REST writes, or update fixme and remove dead helper path.
- KAL-255 gate is prod-backed by default (roundtrip-save-reopen live doc). Charter forbids prod DB access. Fix: do not rerun it; cite historical only or repoint to survey-test.
- Public test_schema_columns view is safe only if never run on prod. Fix: execute bootstrap only through ref-guarded script/API, not raw generic SQL.
- Observability weak: "3 pass" does not prove no leakage. Fix: log masked project ref, before/after row counts, and zero leftover synthetic rows.
VERDICT: REVISE

### Claude's response (Round 2 revision)
Accepted all 8; #5 partially:
1. ACCEPTED — new shared guard tests/phase27/integrationEnv.mjs: SUPABASE_INTEGRATION=1 + hardcoded test-ref allowlist + service-key-required. npm test structurally cannot run them; prod ref structurally excluded.
2. ACCEPTED — anon fallback removed.
3. ACCEPTED — randomUUID doc id, seq=1, finally-cleanup with post-cleanup zero-leftover verification.
4. ACCEPTED — scripts/bootstrap-test-db.mjs wrapper (Management API, allowlist-guarded, --reset, masked-ref logging); will re-run --reset against survey-test to prove the committed artifact derives the cloud state.
5. PARTIAL — fixme stays (rewriting around ?testPdf= would assert local persistence, not the SC1 Y.Doc roundtrip: ink hydration is still flat-table until KAL-270; verified via annotationInitialHydrationSource.test.mjs + main.jsx testPdf bypass). Dead window.__test_* helper steps DELETED from the spec; fixme reason corrected; survey-test-backed Playwright env named as the unblocking follow-up. This is the "update fixme and remove dead helper path" arm of Codex's own either/or.
6. ACCEPTED — KAL-255 gate cited as historical only; not run overnight.
7. ACCEPTED — folded into #4 (view creation only via guarded wrapper).
8. ACCEPTED — masked ref + cleanup-verification logging in wrapper and bytea test; gate evidence includes the guard-proof run (env present, flag absent → still 1326/1320/6/0).

## Round 2 — Codex (same thread)
Findings (verbatim):
- Bytea wire format still missing. Current test sends Uint8Array / decodes base64, but repo bytea code uses PostgREST \x... hex (annotationDocSync.js). Fix: add bytesToPgHex / pgHexToBytes; insert hex, decode hex.
- Guard-proof gate is misstated. node scripts/run-node-tests.mjs never loads .env.test, so ".env.test present-but-no-SUPABASE_INTEGRATION" proves nothing. Fix: verify with node --env-file-if-exists=.env.test scripts/run-node-tests.mjs or exported SUPABASE_TEST_URL.
- Bootstrap wrapper auth source vague. Fix: require SUPABASE_ACCESS_TOKEN, fail if absent, never store/log it.
- Cleanup leak check can silently pass after failed parent insert. Fix: track parentInserted / inserted.id; cleanup both by id and document_id, then assert only when doc id was allocated.
VERDICT: REVISE

### Claude's response (Round 3 revision)
Accepted all 4: (1) test now mirrors the app's \x-hex bytea transport — stronger contract fidelity than the original; (2) guard-proof gate re-specified to actually load .env.test into the unit runner; (3) wrapper auth = SUPABASE_ACCESS_TOKEN env only, fail-fast, never logged; (4) cleanup state-tracking + leak assertion gated on allocation.

## Round 3 — Codex (same thread)
"No material blockers found. Round-3 plan now covers prior failures: explicit survey-test guard, no anon fallback, hex bytea contract matching annotationDocSync.js, real .env.test guard proof, SUPABASE_ACCESS_TOKEN-only bootstrap auth, and allocation-gated cleanup. Debug spec handling is honest: keep fixme, remove dead helper path, no prod Playwright run. Only residual: cloud-side 'survey-test already bootstrapped' still can't be repo-verified, so implementation evidence must include wrapper --reset output + 3-pass integration run."
VERDICT: APPROVED (3 rounds)

### Build begins (human gate #2 pre-authorized by overnight charter)
Evidence obligations carried into the build: wrapper --reset output + 3-pass integration run + both unit-baseline guard proofs.

## Round 4 — Codex post-build review of the staged diff
Findings (verbatim):
- Medium: scripts/bootstrap-test-db.mjs logs row counts but still prints "verified OK" when counts are nonzero. Fix: fail if reset verification row counts are not all 0.
- Medium: byteaRoundTrip.test.mjs ignores cleanup delete/select errors, so leakage checks can false-pass on Supabase errors. Fix: assert !error for every cleanup delete and verification select.
- "No staged secrets found; .env.test is untracked; prod/high-risk-file constraints look respected."
VERDICT: REVISE

### Claude's response (round 5)
Both accepted and fixed: wrapper exits nonzero on nonzero --reset row counts; every cleanup delete + leak-check select asserts !error before the zero-leftover assertions. Gates re-run: --reset bootstrap verified (5/5 objects, counts 0), integration 3/3 pass (735ms), unit 1326/1320/6/0, vite build clean.

## Round 5 — Codex final verdict on staged diff
"No blocking findings. Prior issues fixed: --reset now fails on nonzero row counts, and byteaRoundTrip cleanup now asserts delete/select errors before leak checks. Staged diff still keeps prod excluded, service-key-only integration guard, no committed secrets, no high-risk src/ edits, and debug spec remains honestly fixme."
VERDICT: APPROVED — converged (plan rounds 1–3, result rounds 4–5).
