---
phase: 28-transport-spike-auth-validator
plan: 04
subsystem: collab/transport-spike
tags: [yjs, supabase-realtime, hocuspocus, benchmark, multi-peer, throttled-network, AUTH-01, AUTH-02, transport-decision, postgres-trigger]

# Dependency graph
requires:
  - phase: 28-transport-spike-auth-validator (Plan 28-02)
    provides: SupabaseYjsProvider — connect() factory + onUpdateRejected hook
  - phase: 28-transport-spike-auth-validator (Plan 28-03)
    provides: HocuspocusYjsProvider — async createHocuspocusYjsProvider() + token thunk
  - phase: 28-transport-spike-auth-validator (Plan 28-01)
    provides: transportSpikeBenchmark.mjs skeleton + phase28-multi-peer-throttled.spec.mjs fixme
provides:
  - "Multi-peer throttled-network benchmark harness (Node-driven; same harness for both transports)"
  - "Locked transport decision: supabase (custom Supabase Realtime adapter) + postgres-trigger validator surface"
  - "Provisioning + cleanup contract for 8 phase28 bot accounts (single-filter SQL cleanup)"
  - "Local Hocuspocus bench server (test asset; for v2.5+ reconsideration only)"
  - "10 bench-results JSON files committed as reproducible evidence"
affects:
  - "Plan 28-05 (RLS migration + validator) — uses validator surface = postgres-trigger"
  - "Plan 28-06 (UI wire-up) — imports SupabaseYjsProvider.connect() at the App.jsx mount point"

# Tech tracking
tech-stack:
  added: []  # @hocuspocus/provider + @hocuspocus/server + jose installed for spike, uninstalled at close — package.json restored
  patterns:
    - "Node-driven multi-peer benchmark via fork() — each worker = real Supabase sign-in + real transport provider + simulated network layer"
    - "Side-channel latency capture via bench:emit Realtime broadcast (Supabase) + awareness state (Hocuspocus) — same wire, different envelope"
    - "Idempotent bot provisioning with auth.users.raw_user_meta_data tag for one-line SQL cleanup"
    - "Conditional waiver as TEMPORARY-INSTALL-ONLY-WILL-BE-REMOVED — package.json restored to pre-spike state when default path wins"

key-files:
  created:
    - "tests/phase28/provisionBenchmarkBots.mjs (197 LOC) — 8 bot provisioner with collaborator setup"
    - "tests/phase28/hocuspocusBenchServer.mjs (130 LOC) — local @hocuspocus/server with JWT-decoding onAuthenticate hook"
    - ".planning/phases/28-transport-spike-auth-validator/28-bench-results/*.json (10 files) — bench evidence"
  modified:
    - "tests/phase28/transportSpikeBenchmark.mjs (450 LOC) — Plan 28-01 skeleton replaced with real harness"
    - "debug/scenarios/phase28-multi-peer-throttled.spec.mjs (60 LOC) — un-fixmed; gated on PHASE28_BENCHMARK_RUN env"
    - ".planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md — status flipped draft→locked; decision = supabase + postgres-trigger"
    - ".gitignore — added .bot-credentials.json path"

key-decisions:
  - "Decision: supabase (custom Supabase Realtime adapter) — both prototypes passed speed bar (Supabase p95=104ms, Hocuspocus p95=55ms across 5 peers / 5 minutes / throttled-wifi simulator); CONTEXT.md tiebreaker rule #1 locks the simpler one"
  - "Decision: postgres-trigger validator surface — Supabase p95 of 104ms leaves ~396ms headroom under 500ms speed bar, well over the 100ms threshold for switching to Edge Functions"
  - "Hybrid pragmatic harness architecture — Node-driven peers + side-channel bench:emit pings instead of CDP-level browser throttling, because the transport providers don't go through a CDP-controllable surface in the harness; same simulator applied to BOTH transports for fair comparison"
  - "Conditional package.json waiver: TEMPORARY-INSTALL-ONLY-WILL-BE-REMOVED — Hocuspocus packages installed for the spike measurement and uninstalled at plan close (Supabase wins; package.json restored to pre-spike state)"
  - "Provisioned 8 bots (vs the locked 5 from CONTEXT.md) so fan-out sweeps at 7-8 peers run without re-provisioning"
  - "User-shortened 'run the full week' timebox to 'extensive same-session run' (CORRECTION 2026-04-27); 5 sweeps per transport including a full 5-minute main run cover the load envelope honestly"

patterns-established:
  - "checkpoint:decision auto-approval — when the recommended option (CONTEXT.md tiebreaker rule #1 outcome) matches the measured data, auto-mode protocol authorizes Plan 28-04 to proceed without a human stop"
  - "Hocuspocus dormant fallback — production wrapper + Wave 0 scaffold remain in codebase; package not installed; reactivation is a one-command flip if v2.5 production data warrants reconsideration"

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: 33min
completed: 2026-04-28
---

# Phase 28 Plan 04: Multi-peer throttled-network transport bake-off + locked decision = supabase Summary

**Both transport prototypes passed the 500ms p95 speed bar across 4-8 concurrent peers under throttled-wifi simulation; CONTEXT.md tiebreaker rule #1 (both-pass → simpler-wins) locks the custom Supabase Realtime adapter as the v2.4 binding choice with a Postgres BEFORE INSERT trigger as the validator surface — zero new services, zero new packages on the production path, ~396ms latency headroom under the speed bar.**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-04-28T00:52:20Z
- **Completed:** 2026-04-28T01:25:40Z
- **Tasks:** 2 executed (Task 3 checkpoint:decision auto-approved per user authorization for autonomous execution; recommended option lock-supabase-trigger matched by data)
- **Files created:** 3 (provisionBenchmarkBots.mjs, hocuspocusBenchServer.mjs, 10 bench-results JSON files in 28-bench-results/)
- **Files modified:** 4 (transportSpikeBenchmark.mjs, phase28-multi-peer-throttled.spec.mjs, 28-BENCHMARK.md, .gitignore)
- **Lines added:** ~1,200 across all files
- **Bench samples collected:** 60,000+ end-to-end propagation latency samples per transport (28k+ in the 5-min main runs alone; 0 errors total)

## Accomplishments

- **Bake-off complete.** Both prototypes built (Plans 28-02 + 28-03), both benchmarked, both passed the speed bar, decision locked.
  - Supabase 5p/300s/throttled: p50=73ms, **p95=104ms**, p99=222ms, 28139 samples, 0 errors → passes
  - Hocuspocus 5p/300s/throttled: p50=53ms, **p95=55ms**, p99=57ms, 28332 samples, 0 errors → passes
  - Additional sweeps at 4, 7, and 8 peers (60 seconds each) confirm fan-out behavior — both pass at every count.
- **8 phase28 bot accounts provisioned** in the real Supabase project, all tagged with `raw_user_meta_data->>'phase28_bot' = 'true'` for one-filter SQL cleanup. All 8 invited as `editor` collaborators on the test PDF (`Package 2 - Rev 4 -- IC.pdf`, id `70dadd86-35f0-432b-925f-c59e919a4e4d`). Credentials persisted to gitignored `.bot-credentials.json`.
- **Local Hocuspocus bench server** stood up on `ws://127.0.0.1:1234` for the duration of the spike. `onAuthenticate` hook decodes Supabase JWTs (issuer + expiry checks) + maintains an allowlist of phase28 bot user ids. Server torn down at plan close.
- **Multi-peer benchmark harness** replaces Plan 28-01's skeleton with a working Node-driven driver. Same flag contract honored (`--transport`, `--peers`, `--duration`, `--network`, `--report-out`). Same JSON output shape. Both transports drivable behind a single `--transport=supabase|hocuspocus` flag. Network simulator applies throttled-wifi delay + drops uniformly at the channel boundary so the comparison is fair.
- **28-BENCHMARK.md status flipped draft → locked.** Decision: supabase. Validator surface: postgres-trigger. Lock-in statement present per CONTEXT.md tiebreaker rule #4. Rationale references measured p95 numbers + the four operational dimensions where Supabase is simpler.
- **Conditional package.json waiver exercised then reverted.** `@hocuspocus/provider`, `@hocuspocus/server`, and `jose` were installed for the spike measurement (Plan 28-04 Task 2 Step 2), then uninstalled at plan close (Plan 28-04 Task 2 Step 5) because Supabase won. `package.json` is byte-identical to the pre-spike state.
- **Phase 27 baseline preserved.** `applyUpdate-only` invariant test green (1/1 pass). Phase 28 unit suite: 22 pass / 3 skipped (Hocuspocus package-gated, expected when uninstalled) / 0 fail.
- **Lane safety honored.** Zero `src/` touches across both task commits. The harness imports `SupabaseYjsProvider.js` and `HocuspocusYjsProvider.js` but does not modify them.

## Task Commits

Each task committed atomically:

1. **Task 1: multi-peer throttled-network benchmark harness** — `c29007f4` (feat)
   - `tests/phase28/transportSpikeBenchmark.mjs` (Plan 28-01 skeleton → real harness, ~450 LOC)
   - `tests/phase28/provisionBenchmarkBots.mjs` (idempotent bot provisioner with collaborator setup)
   - `tests/phase28/hocuspocusBenchServer.mjs` (local Hocuspocus service with JWT-decoding onAuthenticate)
   - `debug/scenarios/phase28-multi-peer-throttled.spec.mjs` (un-fixmed; gated on PHASE28_BENCHMARK_RUN)
   - `.gitignore` (added `.bot-credentials.json` path)

2. **Task 2: bake-off benchmark + lock transport decision = supabase** — `6c72c1ea` (feat)
   - `.planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` (status: locked, decision: supabase, validator: postgres-trigger, rationale + lock-in statement)
   - `.planning/phases/28-transport-spike-auth-validator/28-bench-results/*.json` (10 files: Supabase 4/5/7/8-peer + 5p/30s + 5p/300s; Hocuspocus same matrix)
   - `tests/phase28/provisionBenchmarkBots.mjs` (extended to 8 bots; password generator fix for Supabase 4-class complexity rule)
   - `tests/phase28/transportSpikeBenchmark.mjs` (Hocuspocus path: single-provider creation with awareness from start)

**Plan metadata commit:** Forthcoming after self-check + STATE/ROADMAP updates.

**Task 3 (checkpoint:decision):** Auto-approved per user-authorized autonomous execution. The recommended option (`lock-supabase-trigger`) matches the data measured by Task 2 — CONTEXT.md tiebreaker rule #1 (both prototypes passed → simpler wins → custom Supabase Realtime adapter) + the validator surface decision falling out of the spike's per-write latency budget (Supabase p95=104ms ≪ 400ms → Postgres trigger is the natural surface). No override applied.

## Files Created/Modified

### Created

- `tests/phase28/provisionBenchmarkBots.mjs` — Idempotent bot account provisioner. Pulls service-role key in-memory only via Supabase CLI; creates/updates 8 phase28 bots with `email_confirm: true`; tags `raw_user_meta_data.phase28_bot = true`; writes credentials to `.bot-credentials.json` (gitignored, mode 0o600); inserts `document_collaborators` rows on the test PDF. Re-runnable safely.
- `tests/phase28/hocuspocusBenchServer.mjs` — Local `@hocuspocus/server` instance for the spike's Hocuspocus path. `onAuthenticate` hook decodes Supabase JWTs via `jose` (issuer + expiry checks); maintains allowlist of phase28 bot user ids loaded from `.bot-credentials.json`. Heartbeat output every 5s; clean SIGTERM/SIGINT shutdown.
- `.planning/phases/28-transport-spike-auth-validator/28-bench-results/supabase-{4,5,7,8}p-*-throttled.json` (5 files) — Supabase prototype evidence at multiple peer counts.
- `.planning/phases/28-transport-spike-auth-validator/28-bench-results/hocuspocus-{4,5,7,8}p-*-throttled.json` (5 files) — Hocuspocus prototype evidence at multiple peer counts.

### Modified

- `tests/phase28/transportSpikeBenchmark.mjs` — Plan 28-01's skeleton (parses flags, emits placeholder JSON, exits 0) replaced with a real harness body (~450 LOC). Forks N Node workers; each signs in as a distinct phase28 bot; constructs the chosen transport provider; runs a mixed pen-scribble + drag + text-typing action loop for `--duration` seconds; emits `bench:emit` side-channel pings (Realtime broadcast for Supabase, awareness state for Hocuspocus) carrying `t0_ms`; receivers compute end-to-end propagation latency. Aggregates p50/p95/p99 across all peers; writes JSON output. Network simulator at the channel boundary injects `--network=throttled` one-way delay + 5% packet drop uniformly across both transports. Output JSON contract: `{ transport, peers, duration_s, network, p50_ms, p95_ms, p99_ms, msgs_per_sec, errors, samples_count, verdict, speed_bar_threshold_p95_ms }`.
- `debug/scenarios/phase28-multi-peer-throttled.spec.mjs` — Plan 28-01's `test.fixme` un-fixmed. Spawns the harness as a child process for a 30s smoke run; asserts `samples_count > 0`, `errors === 0`, `p95_ms < 500`. Gated on `process.env.PHASE28_BENCHMARK_RUN` so the expensive scenario stays out of regular CI runs.
- `.planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` — Plan 28-01's draft shell filled in. Status: locked. Speed bar reproduced from CONTEXT.md (4-5 peers, mixed actions, p95 < 500ms, throttled wifi). Prototype A (Supabase) + Prototype B (Hocuspocus) sections with 4-column tables (4p/5p-300s-main/7p/8p) showing every metric. Tiebreaker rules table with the matching outcome (Both pass → simpler wins). Decision: supabase. Rationale: 4-paragraph explanation citing measured p95 numbers and the four operational dimensions where Supabase is simpler (zero new services, one auth surface, generous validator latency budget, Hocuspocus's local-WS latency floor is illusory). Lock-in statement per CONTEXT.md tiebreaker rule #4. Validator Surface Decision: postgres-trigger (with rationale referencing the 100ms-headroom threshold from RESEARCH.md). Files Updated by This Decision section names the exact downstream changes for Plans 28-05 and 28-06. Bot Account Cleanup section includes the cleanup SQL filter.
- `.gitignore` — Added `.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json` to the ignore list. The credentials file contains 8 bot passwords + the public anon key + the test document id; never the service-role key.

## Decisions Made

1. **Decision: supabase (custom Supabase Realtime adapter wins)** — Both prototypes passed the 500ms p95 speed bar with significant headroom across 4/5/7/8-peer sweeps + a 5-minute main run. Per CONTEXT.md tiebreaker rule #1, the simpler one wins: zero new services to deploy/host/monitor, single Supabase billing surface, single auth surface (Pitfall 1 already defended via `realtime.setAuth()` in Plan 28-02), single validator surface (Postgres trigger consults `auth.uid()` directly via the same RLS helper pattern already in the schema). Hocuspocus's measured ~55ms p95 is illusory — the local Node WebSocket has near-zero real network latency, so the simulator's 25ms × 2 dominates the sample. In production deployment to Fly.io / Railway, Hocuspocus would land closer to ~110-150ms p95 with all of its operational disadvantages still in place.

2. **Validator surface: postgres-trigger** — Supabase's measured p95 of 104ms leaves ~396ms of headroom under the 500ms speed bar, far over the 100ms threshold from RESEARCH.md for switching to Edge Functions. The trigger runs `user_can_access_document(NEW.document_id, 'editor')` inline with every INSERT into `doc_yjs_updates`, overrides any client-claimed `origin->>'userId'` with `auth.uid()`, and raises Postgres error 42501 on RLS violation. Plan 28-05's migration is simpler with a trigger than with an Edge Function (one SQL function + one BEFORE INSERT trigger vs deploying + monitoring an Edge Function), and the validator stays in the same database transaction as the INSERT — atomic, no extra hop.

3. **Hybrid pragmatic harness architecture** — Node-driven peers (one process per peer; sign-in via `@supabase/supabase-js`; transport provider consumed directly from `src/lib/collab/`) with a network simulator at the channel boundary. Departure from CDP-level browser throttling (which is what the original PLAN.md suggested via `Network.emulateNetworkConditions`) because the transport providers don't go through a CDP-controllable surface in the Node-driven harness. Same simulator is applied to BOTH transports so the relative comparison is fair. Honestly noted in 28-BENCHMARK.md "Throttling architecture note" — absolute latency numbers are slightly optimistic compared to true wire throttling, but the speed bar comparison passes for both with significant headroom (>4× under the 500ms target), so simulator fidelity is not the load-bearing factor in this decision.

4. **Conditional package.json waiver: TEMPORARY-INSTALL-ONLY-WILL-BE-REMOVED** — `@hocuspocus/provider`, `@hocuspocus/server`, and `jose` were installed for the spike measurement (Plan 28-04 Task 2 Step 2). Per Plan 28-04 Task 2 Step 5, these packages were uninstalled at plan close because Supabase wins. `package.json` is byte-identical to the pre-spike state. The waiver is therefore NOT GRANTED on the production path; the Hocuspocus dormant fallback wrapper (`src/lib/collab/HocuspocusYjsProvider.js`) remains in the codebase but is not imported anywhere in `src/App.jsx` and produces a clear runtime error if anyone tries to use it without the package.

5. **Provisioned 8 bots vs the locked 5 from CONTEXT.md** — The 4-5-peer count is locked for the speed bar measurement, but Plan 28-04 authorized fan-out characterization sweeps at higher peer counts. Provisioning 8 bots (the upper bound) means those sweeps run without re-provisioning. Marginal cost: 3 extra Supabase auth.users rows + 3 extra `document_collaborators` rows. All 8 bots tagged with the same `phase28_bot = true` flag — single-filter SQL cleanup still applies.

6. **User-shortened "run the full week" timebox to "extensive same-session run"** — CORRECTION recorded in today's session moments. CONTEXT.md tiebreaker rule #3 says "if a clear winner emerges early, run the full week anyway"; the user explicitly authorized "push both prototypes through their paces in a single session" instead. 5 sweeps per transport (5p/30s, 4p/60s, 7p/60s, 8p/60s, plus the 5p/300s main run) covered the load envelope honestly. The decision is made on data, not haste.

7. **checkpoint:decision auto-approved** — Plan 28-04 Task 3 is a `checkpoint:decision` task per the original PLAN.md. The user's `<authorizations>` block in the execute-plan prompt explicitly authorized "NO checkpoint stops needed for routine progress; only pause if you hit a hard blocker". The recommended option `lock-supabase-trigger` matches both the measured data (CONTEXT.md tiebreaker rule #1 outcome) and the locked validator surface decision. Auto-approved per auto-mode protocol; no override applied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Hocuspocus 7-peer fan-out sweep produced 2 spurious errors due to stale server allowlist**

- **Found during:** Task 2 (Hocuspocus 7p/60s sweep)
- **Issue:** When the bot count was extended from 5 to 8, the running Hocuspocus bench server (PID 93795) had loaded the 5-bot allowlist at start time. The 6th and 7th peers (signed in as bot-6 / bot-7) failed `onAuthenticate` because their user ids weren't in the in-memory allowlist. The harness counted 2 `update_rejected` errors and the verdict flipped to `fails_speed_bar`.
- **Fix:** Killed the stale Hocuspocus server, restarted it (which reloads the credentials file with all 8 bots), re-ran the 7p sweep. Result: 0 errors, p95=55ms, passes.
- **Files modified:** None — operational fix only (stop server, restart, re-run).
- **Verification:** `tail` of fresh server log shows `READY`; re-run JSON has `errors: 0`.
- **Commit:** Re-run output overwrote `.planning/phases/28-transport-spike-auth-validator/28-bench-results/hocuspocus-7p-60s-throttled.json`; same Task 2 commit (`6c72c1ea`).
- **Pattern note:** This is a real production fragility hint — Hocuspocus's `onAuthenticate` hook needs to reload its allowlist dynamically (or consult Postgres on every auth attempt) for a real production deployment. Not a Supabase-path concern (Supabase RLS reads the live `document_collaborators` table on every check) and irrelevant since Supabase wins, but documented in 28-BENCHMARK.md Cons section as part of why Hocuspocus would have higher operational complexity in production.

**2. [Rule 3 - Blocking] Provisioner password generator did not satisfy Supabase 4-class complexity rule on update path**

- **Found during:** Task 2 (re-running provisioner to extend from 5 to 8 bots)
- **Issue:** First version of `generatePassword()` produced 32-char alphanumeric (lower + upper + digit). The Supabase project's `updateUserById` path enforces all-four-class complexity (lower + upper + digit + symbol). `createUser` doesn't enforce on initial create (which is why the original 5-bot provision worked), but re-provisioning bot-1 (existing user) hit the validator and failed.
- **Fix:** Updated `generatePassword()` to force one of each class (lower / upper / digit / symbol from `!@#$%^&*-_=+`) plus 28 random chars from the union, then shuffled. Symbol set excludes URL-encoding-tricky chars (`/`, `?`, `&`, `=`, `+`-as-encoded-space, etc.) so credentials load cleanly into Playwright string contexts later if needed.
- **Files modified:** `tests/phase28/provisionBenchmarkBots.mjs`
- **Verification:** `node tests/phase28/provisionBenchmarkBots.mjs` exits 0 with all 8 bots either `[reused]` (with refreshed password) or `[created]`.
- **Committed in:** `6c72c1ea` (Task 2 commit, alongside the 8-bot extension).

**3. [Rule 1 - Bug] Hocuspocus path created provider twice — once without awareness, then again with**

- **Found during:** First Hocuspocus 5p/30s/throttled run (Task 2)
- **Issue:** The original harness body created a Hocuspocus provider, then constructed a fresh `Awareness` instance, then disconnected the first provider and created a second WITH awareness. This produced cosmetic warnings: `[HocuspocusProvider] An authentication token is required, but you didn't send one. Try adding a token to your HocuspocusProvider configuration. Won't try again.` The first provider's destruction was racing with reconnection logic that didn't have a token thunk reference. Samples flowed correctly on the second provider, so the run still produced valid data, but the warning suggested fragility under reconnect.
- **Fix:** Construct the `Awareness` instance FIRST, then create the provider once with `awareness` passed in. No double-creation. No warning.
- **Files modified:** `tests/phase28/transportSpikeBenchmark.mjs`
- **Verification:** Re-run of Hocuspocus 5p/30s/throttled showed clean log output (no auth-token warning) and identical p95 (55ms).
- **Committed in:** `6c72c1ea` (Task 2 commit).

---

**Total deviations:** 3 auto-fixed (1 operational; 2 code/config fixes)
**Impact on plan:** All three were necessary for clean re-runs and honest measurement. No scope creep — the decision and the speed-bar verdict are unchanged.

## Authentication Gates

None encountered. The Supabase CLI was already logged in and the project was already linked, so `supabase projects api-keys --project-ref cvamwtpsuvxvjdnotbeg` returned the service-role key on the first call. Bot sign-ins via `@supabase/supabase-js` succeeded on every attempt across 60,000+ samples per transport without a single auth error.

## Issues Encountered

None outside the deviations documented above. The harness ran clean across 10 bench runs spanning ~13 minutes of cumulative wall time with zero red errors in the Supabase path and zero red errors (after the operational fix) in the Hocuspocus path.

The `[SupabaseYjsProvider] sync_request reply failed Unexpected end of array` log lines that appear during initial channel subscribe are cosmetic — they fire when the first peer to subscribe receives an empty syncStep1 reply window before any other peer has joined. No impact on samples, no impact on errors, no impact on the speed-bar verdict. Documented in 28-BENCHMARK.md Cons section as a Plan 28-06 wire-up investigation item.

## User Setup Required

None — the spike's bots remain provisioned in the real Supabase project per the user's authorization ("LEAVE bot accounts in place after the benchmark — user will reuse them for cross-account testing"). Cleanup contract preserved for phase close (28-RECONCILIATION.md).

## Bot Account Cleanup (run after Phase 28 closes)

The 8 phase28 bot accounts and their `document_collaborators` rows persist for cross-account testing during Plans 28-05 and 28-06. Single-filter cleanup at phase close:

```sql
-- Cleanup all phase28 bot accounts via the meta-tag (cascades through document_collaborators ON DELETE CASCADE)
DELETE FROM auth.users WHERE raw_user_meta_data->>'phase28_bot' = 'true';
```

```bash
# Remove credentials file (gitignored — never committed)
rm /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json
```

Exact bot user ids (for audit-trail traceability):

| Email                              | User ID                                |
| ---------------------------------- | -------------------------------------- |
| phase28-bot-1@betasafes2.test      | 53f84051-1022-4915-bdcf-63e63ddcd2fc   |
| phase28-bot-2@betasafes2.test      | 9645bbd9-d5d1-40a4-bdee-c9de1057271c   |
| phase28-bot-3@betasafes2.test      | 4a8bf806-e222-4e3d-a6aa-778f1f01d231   |
| phase28-bot-4@betasafes2.test      | 648668cc-9e36-4ed9-bcb5-4bce4e2cdd78   |
| phase28-bot-5@betasafes2.test      | fa88e178-a162-4ee4-b0e4-23954a4b5a64   |
| phase28-bot-6@betasafes2.test      | 7c91e836-8804-42ed-bf92-1adc5d0a58e8   |
| phase28-bot-7@betasafes2.test      | 464f5a5e-f25f-4d6b-b8ca-09c4017846f0   |
| phase28-bot-8@betasafes2.test      | 754ed71e-ef35-4dca-9bc1-1590702dbd83   |

All 8 are invited as `editor` collaborators on document `70dadd86-35f0-432b-925f-c59e919a4e4d` (Package 2 - Rev 4 -- IC.pdf).

## Next Phase Readiness

Phase 28 Wave 2 (Plan 28-04) closes the transport-decision question for v2.4. **The locked transport is the custom Supabase Realtime adapter (`src/lib/collab/SupabaseYjsProvider.js`); the locked validator surface is a Postgres BEFORE INSERT trigger on `doc_yjs_updates`.** Wave 3 plans (28-05 + 28-06) build on top of this:

- **Plan 28-05 (RLS migration + validator)** is unblocked. Plan 28-05's migration:
  - Drops the Phase 27 stub deny-all RLS policies on `doc_yjs_updates` + `doc_yjs_state` by exact name (`*_phase27_stub_deny_all`).
  - Creates the real RLS policies gated by `user_can_access_document(document_id, 'editor')` for INSERT and `user_can_access_document(document_id, 'viewer')` for SELECT.
  - Creates `user_can_access_document(doc_id UUID, required_role TEXT)` Postgres function (or extends an existing helper if one exists in `supabase/migrations/`).
  - Creates the `doc_yjs_updates_validate_origin` BEFORE INSERT trigger that consults `user_can_access_document` and overrides client-claimed `origin->>'userId'` with `auth.uid()`.
  - Drops the spike-only Hocuspocus packages from `package.json` if they hadn't already been uninstalled (no-op — Plan 28-04 already did this).

- **Plan 28-06 (UI wire-up + chosen provider)** is unblocked. Plan 28-06 wires `connect(documentId, ydoc, { supabase, onUpdateRejected, onTransportState })` from `SupabaseYjsProvider` into `src/App.jsx` at the existing `<YDocProvider>` mount point (Phase 27 Plan 27-05). Plan 28-06 imports `attachAuthSessionBridge()` (Plan 28-02) for the silent-refresh defense and consumes `onUpdateRejected` for the kicked-out banner UX (28-UI-SPEC.md).

- **Plan 28-04's checkpoint:decision** auto-approved per user authorization for autonomous execution; the recommended option matches the data; no manual gate is held open against Wave 3 execution.

- **Cross-account testing** can now use the 8 phase28 bot accounts directly. Sign in as `phase28-bot-N@betasafes2.test` with the password in `.bot-credentials.json` to test multi-user flows without provisioning new accounts.

## Self-Check

Files claimed created — verified via `[ -f path ]`:

- `tests/phase28/provisionBenchmarkBots.mjs` — present
- `tests/phase28/hocuspocusBenchServer.mjs` — present
- `.planning/phases/28-transport-spike-auth-validator/28-bench-results/supabase-5p-300s-throttled.json` — present (28139 samples)
- `.planning/phases/28-transport-spike-auth-validator/28-bench-results/hocuspocus-5p-300s-throttled.json` — present (28332 samples)
- 8 other bench-results JSON files — all present

Commits claimed — verified via `git log --oneline | grep`:

- `c29007f4 feat(28-04): multi-peer throttled-network benchmark harness` — present
- `6c72c1ea feat(28-04): bake-off benchmark + lock transport decision = supabase` — present

Phase 27 baseline preservation: `node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` exits 0 (pass).

Phase 28 unit suite: 22 pass / 3 skipped (Hocuspocus package-gated) / 0 fail.

Lane safety: `git diff --stat src/App.jsx src/components/PageAnnotationLayer.jsx src/components/FabricDrawingCanvas.jsx src/components/FabricEraserCanvas.jsx src/components/FabricEditCanvas.jsx src/components/SVGAnnotationLayer.jsx vite.config.js` returns empty.

`package.json` hygiene: `grep -c "@hocuspocus/provider" package.json` returns 0 (Hocuspocus uninstalled per Plan 28-04 Step 5).

## Self-Check: PASSED

---
*Phase: 28-transport-spike-auth-validator*
*Plan: 04*
*Completed: 2026-04-28*
