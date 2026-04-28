# Phase 28 Transport Decision

> This document is filled in by Plan 28-04. Wave 0 ships the skeleton.

## Status: draft

Lifecycle: `draft` → `in-progress` (Plan 28-04 active) → `locked` (Phase 28 close)

## Speed Bar

The decision criteria locked by 28-CONTEXT.md (user-set bar, "Figma / Google Docs feel"):

- **Concurrent peers:** 4 to 5 (dedicated test bot accounts in the real Supabase project — one-time exception per 2026-04-27 decision)
- **Action mix:** simultaneous rapid pen scribbling + dragging existing shapes + typing in text annotations (worst-case all three at once)
- **Latency target:** every remote edit must appear on every other peer's screen in under 500ms end-to-end (p95)
- **Network conditions:** the bar must pass on normal home/office shared wifi (NOT clean lab wifi). Approximated via Chrome DevTools Protocol throttling at 5 Mbps download / 1 Mbps upload / 50ms RTT / 5% packet loss
- **Reference UX pattern:** "Figma / Google Docs feel — collaboration that reads as alive"

Both prototypes must be measured under the SAME load and SAME throttled network for the comparison to be meaningful.

## Prototype A: Custom Supabase Realtime Adapter

**Owner:** Plan 28-02
**File:** `src/lib/collab/SupabaseYjsProvider.js`
**Approach:** y-protocols sync v1 frames carried over Supabase Realtime Broadcast. Reuses the existing Supabase client + auth session — no new infrastructure.

### Build Status

> Plan 28-04 updates this section after running the harness against the Plan 28-02 deliverable.

- [ ] `connect(documentId, ydoc, options)` factory exported
- [ ] `disconnect()` teardown clean (no leaked channels, no zombie subscribers)
- [ ] Echo-loop guard verified (REMOTE_REALTIME_ORIGIN short-circuit)
- [ ] Token refresh end-to-end (TOKEN_REFRESHED → realtime.setAuth → channel keeps flowing)
- [ ] base64 ↔ Uint8Array round-trip preserves every byte (sync v1 frames over Realtime are strings, not bytes)

### Benchmark Results

> Plan 28-04 fills in. Run `node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=5 --duration=60 --network=throttled` and paste the JSON output here.

| Metric                      | Value | Pass / Fail |
| --------------------------- | ----- | ----------- |
| Peers                       | TBD   | -           |
| Duration (s)                | TBD   | -           |
| Network profile             | TBD   | -           |
| p50 latency (ms)            | TBD   | -           |
| p95 latency (ms)            | TBD   | < 500ms ?   |
| p99 latency (ms)            | TBD   | -           |
| Messages / sec              | TBD   | -           |
| Errors                      | TBD   | 0 ?         |
| Samples count               | TBD   | -           |
| Frame stability (no jank)   | TBD   | -           |

### Pros / Cons

> Plan 28-04 fills in based on observed behavior.

**Pros:**

- Zero new infrastructure — rides existing Supabase client + auth + RLS
- Single-vendor billing (no third-party transport split)
- ~150-300 LOC custom adapter; small surface area to maintain
- JWT carried natively via `realtime.setAuth()`

**Cons:**

- Custom code means custom bugs (the Hocuspocus mainline has more eyes on it)
- Supabase Realtime Broadcast has documented payload-size and rate limits
- TBD: actual p95 under shared-wifi load

## Prototype B: Hocuspocus

**Owner:** Plan 28-03
**File:** `src/lib/collab/HocuspocusYjsProvider.js`
**Approach:** Off-the-shelf MIT WebSocket Yjs server. Requires a self-hosted Node service, but the wire protocol and the provider are both battle-tested at scale.

### Build Status

> Plan 28-04 updates this section after running the harness against the Plan 28-03 deliverable.

- [ ] `connect(documentId, ydoc, options)` factory exported with the SAME shape as SupabaseYjsProvider
- [ ] `disconnect()` calls `provider.destroy()` exactly once
- [ ] Token thunk passes `() => Promise<string>` (fresh JWT every reconnect)
- [ ] Hocuspocus server stood up in a test environment
- [ ] WebSocket reconnect on token expiry verified

### Benchmark Results

> Plan 28-04 fills in.

| Metric                      | Value | Pass / Fail |
| --------------------------- | ----- | ----------- |
| Peers                       | TBD   | -           |
| Duration (s)                | TBD   | -           |
| Network profile             | TBD   | -           |
| p50 latency (ms)            | TBD   | -           |
| p95 latency (ms)            | TBD   | < 500ms ?   |
| p99 latency (ms)            | TBD   | -           |
| Messages / sec              | TBD   | -           |
| Errors                      | TBD   | 0 ?         |
| Samples count               | TBD   | -           |
| Frame stability (no jank)   | TBD   | -           |

### Pros / Cons

> Plan 28-04 fills in based on observed behavior.

**Pros:**

- Mature, widely-deployed open-source server
- Well-documented Yjs binding (standard `@hocuspocus/provider` API)
- Easier to scale horizontally (independent WebSocket service)

**Cons:**

- New deployment surface (must host + monitor + secure the Hocuspocus server)
- Billing splits (Supabase + Hocuspocus host = two bills, two operational channels)
- Requires a `package.json` waiver to add `@hocuspocus/provider` (28-CONTEXT.md notes this is conditional)
- More moving parts means more failure modes

## Tiebreaker Rules

Locked by 28-CONTEXT.md. Plan 28-04 applies these in order:

1. **Both pass the speed bar** → the simpler one wins. The custom Supabase Realtime adapter wins because it reuses existing Supabase plumbing (no new service to deploy/host/monitor, billing stays in one place, ~150-300 LOC vs adopting a Node WebSocket service).
2. **Neither passes the speed bar** → STOP and rethink at the end of the week. Joint review of benchmark data. Decide whether to extend the timebox, lower the bar, or change approach. **No sunk-cost auto-pick** of "the closer one."
3. **Clear winner emerges early (e.g. day 3)** → run the FULL one-week timebox anyway. Finish both prototypes properly so the comparison is honest. The timebox is a ceiling, not a forced cut-short.

## Decision: pending

> Plan 28-04 sets this to one of:
> - `supabase` — custom Realtime adapter wins (default expected outcome)
> - `hocuspocus` — fallback adopted (only if the custom adapter fails the speed bar AND Hocuspocus passes)
> - `stop-and-rethink` — neither passed; week-end joint review

## Rationale

> Plan 28-04 fills in: a paragraph explaining why the chosen prototype was selected based on benchmark numbers and tiebreaker rules. Cite specific p95 measurements.

## Lock-in Statement

> Plan 28-04 fills in at Phase 28 close:
>
> "Phase 28 closes with `<chosen-transport>` locked as the v2.4 transport. Per 28-CONTEXT.md tiebreaker rule #4, this choice is NOT revisited during v2.4. If production data warrants a change, we revisit in v2.5. Reason: swapping transport mid-milestone is a multi-month detour with cascading risk."
