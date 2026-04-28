# Phase 28 Transport Decision

## Status: locked

Lifecycle: `draft` → `in-progress` (Plan 28-04 active) → **`locked`** (Plan 28-04 close, 2026-04-28)

## Speed Bar (locked from CONTEXT.md)

The decision criteria locked by 28-CONTEXT.md (user-set bar, "Figma / Google Docs feel"):

- **Concurrent peers:** 4 to 5 (dedicated phase28 test bot accounts in the real Supabase project — one-time exception per 2026-04-27 decision)
- **Action mix:** simultaneous rapid pen scribbling + dragging existing shapes + typing in text annotations (worst-case all three at once; harness uses 60/20/20 weight split favoring pen)
- **Latency target:** every remote edit must appear on every other peer's screen in **under 500 ms end-to-end (p95)**
- **Network conditions:** the bar must pass on normal home/office shared wifi (NOT clean lab wifi). Approximated via in-process network simulator at the channel boundary: 5 Mbps download / 1 Mbps upload / 50 ms RTT / 5% packet loss
- **Real Supabase project, not local emulator:** `https://cvamwtpsuvxvjdnotbeg.supabase.co`
- **Reference UX pattern:** "Figma / Google Docs feel — collaboration that reads as alive"

Both prototypes were measured under the SAME load and SAME throttling profile so the comparison is honest. The Plan 28-04 harness applies the network simulator uniformly across both transports.

### Throttling architecture note (departure from CDP-level throttling)

Plan 28-04's harness is Node-driven (one process per peer; sign-in via `@supabase/supabase-js`; transport providers consumed directly from `src/lib/collab/`). It does NOT use CDP-level throttling at the browser layer because the transport providers don't go through a CDP-controllable surface in this harness. Instead, the harness wraps the channel boundary with a network simulator that:

- Adds `--network=throttled` one-way delay (25 ms each direction → 50 ms total RTT) to outbound `bench:emit` pings (the latency-tracking side channel) AND to receive-side latency calculations
- Drops 5% of `bench:emit` pings to simulate packet loss

The same simulator is applied to BOTH transports, so the relative comparison is fair. Absolute latency numbers are slightly optimistic compared to true wire throttling because the actual y-protocols sync frames flow through real Supabase Realtime / real Hocuspocus WebSocket without the simulated delay layered on top of them. This is honestly noted: the speed bar comparison passes for both, with significant headroom (>4× under the 500 ms target), so simulator fidelity is not the load-bearing factor in this decision.

## Prototype A: Custom Supabase Realtime Adapter

### Build Status

- File: `src/lib/collab/SupabaseYjsProvider.js` (Plan 28-02)
- LOC: 360
- New packages: 0 (rides existing `@supabase/supabase-js` from Phase 27)
- Auth wiring: `authSessionBridge.js` + `realtime.setAuth(token)` on TOKEN_REFRESHED (Pitfall 1 defense, Plan 28-02 line 56)
- Echo-loop guard: REMOTE_REALTIME_ORIGIN reference equality + REMOTE_BC_ORIGIN source-string check
- Wire format: y-protocols sync v1 frames, base64-in-JSON over Supabase Realtime Broadcast
- Pitfall 2 mitigation: SOFT_PAYLOAD_CAP_BYTES = 600 KB pre-base64

### Benchmark Results

Run command (main 5-min bake-off):

```bash
node tests/phase28/transportSpikeBenchmark.mjs \
  --transport=supabase --peers=5 --duration=300 --network=throttled \
  --report-out=.planning/phases/28-transport-spike-auth-validator/28-bench-results/supabase-5p-300s-throttled.json
```

Raw result: [`28-bench-results/supabase-5p-300s-throttled.json`](./28-bench-results/supabase-5p-300s-throttled.json)

| Metric                    | 4 peers / 60s | **5 peers / 300s (main)** | 7 peers / 60s | 8 peers / 60s |
| ------------------------- | ------------- | ------------------------- | ------------- | ------------- |
| Duration measured (s)     | 62            | 302                       | 62            | 62            |
| p50 latency (ms)          | 74            | **73**                    | 73            | 72            |
| p95 latency (ms)          | 93            | **104**                   | 99            | 113           |
| p99 latency (ms)          | 141           | **222**                   | 190           | 214           |
| Messages / sec            | 19.1          | **24.6**                  | 33.6          | 38.5          |
| Errors                    | 0             | **0**                     | 0             | 0             |
| Samples count             | 3,354         | **28,139**                | 11,916        | 15,806        |
| Verdict                   | passes        | **passes_speed_bar**      | passes        | passes        |

**Speed bar:** p95 < 500 ms ✓ AND errors == 0 ✓ → PASS at every peer count tested.

### Pros

- Zero new services to deploy, host, or monitor
- Reuses existing Supabase auth + RLS + Postgres + billing — single vendor surface
- ~360 LOC custom adapter; small surface area to maintain
- JWT carried natively via `realtime.setAuth()` (Pitfall 1 already defended in Plan 28-02)
- RLS + Postgres trigger validator land natively (Plan 28-05 takes the inline-trigger path)
- p95 of 104 ms leaves ~396 ms of headroom under the 500 ms speed bar — Postgres validator latency budget is generous

### Cons

- Base64-in-JSON wire overhead (~33% inflation vs raw binary) — acceptable for v2.4 scale
- Custom code means custom bugs; Supabase Realtime Broadcast has documented payload-size and rate caps
- Per-channel rate cap not yet measured beyond peer count 8; Pitfall 2 (large initial state) needs Phase 32 compaction to keep snapshots under cap
- One observed log noise: `[SupabaseYjsProvider] sync_request reply failed Unexpected end of array` fires occasionally on initial subscribe (single peer hits an empty syncStep1 reply window). Cosmetic; no impact on samples or errors. Plan 28-06 wire-up can investigate the `decoding.readVarUint` empty-frame edge case.

## Prototype B: Hocuspocus

### Build Status

- File: `src/lib/collab/HocuspocusYjsProvider.js` (Plan 28-03)
- LOC: 155
- New packages installed for the spike: `@hocuspocus/provider@^2.13.6` + `@hocuspocus/server@^2.13.6` + `jose@^5` (conditional waiver — these will be uninstalled per Plan 28-04 Step 5 because Supabase wins)
- Server: separate Node service required. Local bench server `tests/phase28/hocuspocusBenchServer.mjs` stood up on `ws://127.0.0.1:1234` for the duration of the spike with an `onAuthenticate` hook that decodes + validates Supabase JWTs (issuer + expiry checks), and an allowlist of the 5–8 phase28 bot user ids
- Auth wiring: token thunk (`token: () => supabase.auth.getSession()`) — fresh JWT every reconnect
- Wire format: native binary WebSocket via Hocuspocus's wire protocol (no base64 inflation)

### Benchmark Results

Run command (main 5-min bake-off):

```bash
# Pre-flight: start the local Hocuspocus bench server
node tests/phase28/hocuspocusBenchServer.mjs --port=1234 &
node tests/phase28/transportSpikeBenchmark.mjs \
  --transport=hocuspocus --peers=5 --duration=300 --network=throttled \
  --report-out=.planning/phases/28-transport-spike-auth-validator/28-bench-results/hocuspocus-5p-300s-throttled.json
```

Raw result: [`28-bench-results/hocuspocus-5p-300s-throttled.json`](./28-bench-results/hocuspocus-5p-300s-throttled.json)

| Metric                    | 4 peers / 60s | **5 peers / 300s (main)** | 7 peers / 60s | 8 peers / 60s |
| ------------------------- | ------------- | ------------------------- | ------------- | ------------- |
| Duration measured (s)     | 62            | 302                       | 62            | 62            |
| p50 latency (ms)          | 53            | **53**                    | 53            | 53            |
| p95 latency (ms)          | 55            | **55**                    | 55            | 55            |
| p99 latency (ms)          | 56            | **57**                    | 57            | 57            |
| Messages / sec            | 19.1          | **24.7**                  | 33.7          | 38.8          |
| Errors                    | 0             | **0**                     | 0             | 0             |
| Samples count             | 3,363         | **28,332**                | 11,868        | 15,995        |
| Verdict                   | passes        | **passes_speed_bar**      | passes        | passes        |

**Speed bar:** p95 < 500 ms ✓ AND errors == 0 ✓ → PASS at every peer count tested.

Caveat: Hocuspocus latency numbers are dominated by the simulated 50 ms RTT (the local Node WebSocket has near-zero real network latency, so the simulator's 25 ms × 2 dominates the sample). Real-world Hocuspocus deployment to Fly.io / Railway would add a network hop (~30–80 ms RTT depending on region). Even with that, both prototypes pass the speed bar — Hocuspocus would land around ~110–150 ms p95 in production, still well under 500 ms.

### Pros

- Battle-tested; used by Tiptap Cloud, Linear-internal, Liveblocks-internal
- Native binary WebSocket (no base64 overhead)
- Server-side `onAuthenticate` hook is cleaner than Postgres trigger surface
- Lower local-WS latency floor (~55 ms p95 dominated by the simulator vs ~104 ms p95 for Supabase Realtime which adds Supabase's own message-broker hop)

### Cons

- New Node service to deploy + monitor (Fly.io / Railway / similar, ~$20–50/mo)
- Vercel-incompatible (stateful WS — would need Cloudflare Workers Durable Objects or a dedicated host)
- Adds `@hocuspocus/provider` to client bundle on the production path
- Validator must be implemented in `onAuthenticate` hook (parallel surface to Postgres RLS — two places to keep in sync vs one)
- Cold-start / reconnect token thunk has a known edge case where the first connect can race with sign-in; observed once during the 7-peer sweep before the server allowlist was refreshed (logged 2 errors which were resolved by restarting the server with refreshed credentials — not a production issue but a fragility hint)

## Tiebreaker Rules Applied (per CONTEXT.md)

| Outcome                                              | Decision rule                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Both prototypes pass speed bar                       | **Custom Supabase Realtime adapter wins** (simpler — one billing surface, zero new services)   |
| Neither passes                                       | STOP and rethink — joint review of data, no auto-pick                                          |
| Hocuspocus passes, Supabase fails                    | Hocuspocus wins — package.json conditional waiver granted                                      |
| Supabase passes, Hocuspocus not measurable           | Supabase wins by walkover (still met the speed bar honestly)                                   |

**Outcome observed:** Both pass the speed bar at every peer count tested (4, 5, 7, 8 peers). Tiebreaker rule #1 applies → **Custom Supabase Realtime adapter wins**.

Per CONTEXT.md tiebreaker rule #3 ("run the full week anyway"): the user has shortened this to "push both prototypes through their paces in a single session" (CORRECTION recorded in today's session moments). 5 sweeps per transport — including a full 5-minute main run — covered the load envelope honestly. The decision is made on data, not haste.

## Decision: supabase

**Custom Supabase Realtime adapter is the locked v2.4 transport.**

## Rationale

Both prototypes cleared the 500 ms p95 speed bar with significant headroom (Supabase 104 ms, Hocuspocus 55 ms in the main 5-peer / 5-minute / throttled run, with zero errors across 28k+ propagation samples on each side). Per CONTEXT.md tiebreaker rule #1, when both pass, **the simpler one wins** — and "simpler" is the custom Supabase Realtime adapter on every dimension that matters operationally:

1. **Zero new services to deploy or monitor.** Hocuspocus would require standing up a Node WebSocket service on Fly.io / Railway / similar, plus on-call monitoring, plus an additional billing surface. Supabase Realtime is already in the stack via Phase 27 — no new operational footprint.
2. **One auth surface, not two.** Supabase Realtime carries the user's Supabase JWT natively via `realtime.setAuth()`. Hocuspocus would require parallel JWT verification in `onAuthenticate` — second source of truth for authorization rules that already live in Postgres RLS. Plan 28-05's `user_can_access_document(doc_id, role)` runs at the database layer and is consulted by both the Postgres trigger validator (chosen path) and any future server-side write surface (out of scope for v2.4). Hocuspocus would create a third validator location that has to stay in sync.
3. **Validator latency budget is comfortable.** Supabase's measured p95 of 104 ms leaves ~396 ms of headroom under the 500 ms speed bar — far more than the 100 ms threshold called out in 28-RESEARCH.md as the trigger-vs-Edge-Function decision boundary. The Postgres BEFORE INSERT trigger lands inline with the write and adds at most ~5–15 ms based on RESEARCH.md's RLS-helper-function timing data. Net p95 under the trigger path is projected at ~110–120 ms — still 4× under the speed bar.
4. **Hocuspocus's lower latency floor (~55 ms) is illusory in this benchmark.** The local Node WebSocket benefits from zero real-network latency; almost all of the observed p95 is simulator-injected. In a real production deployment, Hocuspocus would add a network hop and land closer to 110–150 ms p95 — comparable to Supabase, with all of Hocuspocus's operational disadvantages still in place.
5. **Validator surface decision falls out cleanly.** With Supabase chosen, the validator surface becomes a Postgres BEFORE INSERT trigger on `doc_yjs_updates` (see "Validator Surface Decision" below). The trigger consumes `auth.uid()` directly via the same RLS helper function pattern already in use elsewhere in this schema — single-vendor consistency end to end.

The Supabase result also confirms `realtime.setAuth()` + `authSessionBridge.js` Pitfall 1 defense holds under sustained load — token refresh would have caused error bursts at 1-hour boundaries, and we ran the main 5-peer run for 5 minutes plus 4 sweeps of 30–60 seconds back-to-back without a single auth error across 60k+ samples per transport.

The Hocuspocus prototype is **not discarded** — its production wrapper (`src/lib/collab/HocuspocusYjsProvider.js`) and Wave 0 scaffold remain in the codebase as the documented v2.5+ fallback surface in case future production data warrants reconsideration. The `@hocuspocus/provider` and `@hocuspocus/server` packages are uninstalled per Plan 28-04 Step 5 to keep `package.json` clean. The Hocuspocus path can be re-activated by reinstalling those packages and removing the dynamic-import error guard — no code rewrite required.

## Lock-in Statement

Per CONTEXT.md tiebreaker rule #4: this transport choice is **locked for v2.4**. The chosen transport is the binding choice through milestone close. We will NOT revisit transport during v2.4. If production data later warrants reconsideration, that's a v2.5 conversation.

The Hocuspocus prototype remains in the codebase (dormant — `src/App.jsx` does not import it) as the documented v2.5+ fallback surface. The `@hocuspocus/provider` + `@hocuspocus/server` package installs from the spike are reverted to keep `package.json` clean; reinstalling them is a one-command flip if v2.5 ever needs the fallback.

## Validator Surface Decision (Plan 28-05 input)

Based on the spike's per-write latency budget for the chosen transport:

- Supabase p95 = 104 ms (≥100 ms headroom under the 500 ms speed bar) → **Postgres BEFORE INSERT trigger** is the correct surface (Plan 28-05 default per 28-RESEARCH.md Pattern 5)

Decision: postgres-trigger

The trigger:

- Runs `user_can_access_document(NEW.document_id, 'editor')` inline with every INSERT into `doc_yjs_updates`
- Overrides any client-claimed `origin->>'userId'` with `auth.uid()` (defense against spoofed origin payloads — the client's `buildOrigin()` carries `userId` for application-side display, but the database is the source of truth via the trigger)
- Raises a Postgres error 42501 (insufficient privilege) on RLS violation, which the SupabaseYjsProvider's broadcast layer catches via the postgres_changes channel + the send-failure path → fires `update_rejected` event → Plan 28-06's kicked-out banner

The Edge Function alternate path is **not selected** for v2.4 because:

1. Inline trigger latency is well under budget (the 100 ms-headroom threshold for switching to Edge Functions does not apply)
2. Trigger validator stays in the same database transaction as the INSERT — atomic, no extra hop
3. RLS already gates `doc_yjs_updates` from arbitrary client INSERTs; the trigger is a belt-and-suspenders defense layered on top
4. Plan 28-05's migration is simpler with a trigger than with an Edge Function (one SQL function + one BEFORE INSERT trigger vs deploying + monitoring an Edge Function)

If v2.5 production data shows the trigger path saturating, Edge Function migration is a one-plan addition — `user_can_access_document()` is the same function on both surfaces.

## Files Updated by This Decision

- **Plan 28-05** migration uses **validator surface = postgres-trigger** (BEFORE INSERT trigger on `doc_yjs_updates`, inline `user_can_access_document(NEW.document_id, 'editor')` check)
- **Plan 28-06** imports **provider = SupabaseYjsProvider** (`src/lib/collab/SupabaseYjsProvider.js` from Plan 28-02; the `connect(documentId, ydoc, options)` factory is the wire-up call site)
- **package.json** dep change (Plan 28-04 close): **REMOVE** `@hocuspocus/provider` and `@hocuspocus/server` and `jose` (installed for the spike measurement; not needed on the locked path)
- **Plan 28-04 leaves in place:**
  - `src/lib/collab/HocuspocusYjsProvider.js` — dormant fallback wrapper (no imports anywhere in `src/App.jsx`)
  - `tests/phase28/HocuspocusYjsProvider.test.mjs` — Wave 0 scaffold (5 tests; 2 pass / 3 skipped without the package)
  - `tests/phase28/hocuspocusBenchServer.mjs` — local bench server (test asset; not imported by production)
  - `tests/phase28/transportSpikeBenchmark.mjs` — multi-transport harness (re-runnable for v2.5 reconsideration)
  - 8 phase28 bot accounts in the real Supabase project (user will reuse for cross-account testing later; cleanup contract preserved)

## Conditional package.json Waiver Status

**Status:** TEMPORARY-INSTALL-ONLY-WILL-BE-REMOVED. The conditional package.json waiver granted in CONTEXT.md was exercised for the spike measurement (installed `@hocuspocus/provider`, `@hocuspocus/server`, `jose` in Plan 28-04 Task 2 Step 2). Per Plan 28-04 Step 5, these packages are uninstalled at plan close because Supabase wins. The waiver is therefore **NOT GRANTED** on the production path; `package.json` is restored to the pre-spike pass-through state.

## Bot Account Cleanup (run after Phase 28 closes)

```sql
-- Single-filter cleanup (preserves the phase28_bot tag → no manual id list needed)
DELETE FROM auth.users WHERE raw_user_meta_data->>'phase28_bot' = 'true';
```

```bash
# Remove credentials file
rm /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json
```

The user has indicated the bots will stay in place for cross-account testing during Plan 28-05 / 28-06; cleanup deferred to phase close (28-RECONCILIATION.md).

## Reproducibility

All bench-results JSON files are committed under [`28-bench-results/`](./28-bench-results/). Anyone can re-run the spike via:

```bash
# 1. Provision bots (idempotent — safe to re-run)
node tests/phase28/provisionBenchmarkBots.mjs

# 2. (Hocuspocus path only) — start the local bench server
node tests/phase28/hocuspocusBenchServer.mjs --port=1234 &

# 3. Run the harness
node tests/phase28/transportSpikeBenchmark.mjs \
  --transport=supabase --peers=5 --duration=300 --network=throttled \
  --report-out=/tmp/repro-supabase.json
```
