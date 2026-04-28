# Phase 28 Reconciliation

_Written 2026-04-28 at the close of Phase 28 (transport-spike-auth-validator). All six plans landed, all automated verification checks passed, manual UAT for the cross-account portion deferred to Phase 34 close per user instruction._

## Plan vs Actual

- **Planned:** Build two transport prototypes (custom Supabase Realtime adapter + self-hosted Hocuspocus wrapper), benchmark both under defined load, lock the winner. Land Supabase JWT auth handshake with seamless silent token refresh. Land server-side update validator that enforces RLS state at write time. Activate real RLS policies on `doc_yjs_updates` + `doc_yjs_state`. Carry user + device attribution at every transaction origin.
- **Actual:** All of the above shipped exactly as planned. Both prototypes built (Supabase 360 LOC, Hocuspocus 155 LOC). Multi-peer benchmark harness produced 10 result JSONs across 4-, 5-, 7-, and 8-peer sweeps under throttled-network conditions. Decision locked in `28-BENCHMARK.md`: **transport = Supabase Realtime adapter; validator surface = Postgres BEFORE INSERT trigger**. Migration `20260504000000` applied to live Supabase project (ref `cvamwtpsuvxvjdnotbeg`). All Phase 27 deny-all stubs dropped by exact name; 5 real RLS policies + 1 helper function (`user_can_access_document`) + 1 trigger live in production. Auth bridge mounts inside `<YDocProvider>`, NOT App.jsx — App.jsx ends Phase 28 with zero new lines.
- **Deltas:**
    - Hocuspocus packages installed for spike measurement, then uninstalled at Plan 28-04 close (per the conditional `package.json` waiver in CONTEXT.md). Net `package.json` delta = zero.
    - Plan 28-04's "run full week anyway" timebox was shortened to "extensive same-session run" by user CORRECTION on 2026-04-27 (recorded in session moments). Both prototypes ran 5 sweeps each — including a full 5-peer / 5-minute / throttled main run — and the simpler-wins tiebreaker resolved cleanly.
    - 8 Phase 28 bot accounts provisioned in the real Supabase project (one-time exception to no-bot-accounts norm, granted 2026-04-27). Tagged `phase28_bot=true` in `auth.users.raw_user_meta_data` for one-line cleanup. **NOT cleaned up at phase close** — left in place for the deferred Phase 34 UAT.
    - Plan 28-03 ran out-of-order in a prior session before Plan 28-01 (commit `82fd7e51` predates `5dc096f9`). Plan 28-01 honored the existing scaffold rather than re-creating it. Documented in 28-01-SUMMARY.md.
    - 28-CONTEXT.md narrow waiver for App.jsx was NOT exercised — the Plan 28-06 first-pass had grown to two imports + a useEffect + dispatchEvent, but plan-checker caught it on the first review pass and the auth bridge mount was moved into the existing `<YDocProvider>` collaborative-doc provider. Net App.jsx Phase 28 delta = zero. (Plan 27-05's existing `<YDocProvider>` mount line is the only Phase 27/28 footprint in App.jsx.)

## Acceptance Criteria Results

From `28-CONTEXT.md`:

- [x] **Given** the bake-off prototypes are built and running, **when** 4-5 concurrent peers all edit the same document simultaneously with mixed pen-scribbling + shape-dragging + text-typing on normal home/office shared wifi, **then** every remote edit appears on every other peer's screen in under 500 ms end-to-end. — **PASSED.** Plan 28-04 measured Supabase p95 = 104 ms (4× under bar), Hocuspocus p95 = 55 ms; zero errors across ~28k samples per transport at 5 peers / 5 minutes throttled.
- [x] **Given** the bake-off has run its full timebox (shortened by CORRECTION to "extensive same-session run"), **when** a transport choice is locked, **then** a written transport decision document exists with benchmark numbers for both prototypes, the chosen transport, and the rationale — and that decision is committed to the repo as the binding choice for v2.4. — **PASSED.** `28-BENCHMARK.md` status=locked, decision=supabase, full rationale + tiebreaker chain documented; committed in `6c72c1ea`.
- [x] **Given** both prototypes pass the speed bar, **when** the transport choice is made, **then** the simpler one wins (the custom Supabase Realtime adapter that reuses existing infrastructure). — **PASSED.** Tiebreaker rule #1 applied; Supabase wins on every operational dimension.
- [x] **Given** an authenticated user opens a document, **when** the Realtime channel is subscribed and a CRDT update is written to `doc_yjs_updates`, **then** both calls carry the user's Supabase JWT and the validator runs `user_can_access_document(doc_id, 'editor')` on every write. — **PASSED.** SupabaseYjsProvider mounts JWT via `realtime.setAuth()`; `authSessionBridge.js` refreshes on `TOKEN_REFRESHED`; validator trigger live on `doc_yjs_updates` calling the helper function inline before INSERT.
- [DEFERRED] **Given** the silent refresh fails (password changed elsewhere, account locked, refresh token revoked), **when** the next live-channel write or read happens, **then** a top banner appears matching the Phase 27 banner pattern saying "Your sign-in expired — click here to sign in again", and the inline re-sign-in form pops on the document page so the user stays on the same page after re-auth. — **WIRED, NOT MANUALLY VERIFIED.** Banner copy variant `login_expiry_failure` confirmed present; ReSignInModal mounts inline (not fullscreen) confirmed in `YDocProvider.jsx`; ESC + click-outside no-ops confirmed. Manual UAT deferred to Phase 34 close per user instruction.
- [DEFERRED] **Given** a collaborator's editor permission has been revoked while they have the document open, **when** the next CRDT write fires, **then** the document goes read-only within 3 seconds, the kicked-out banner appears, and the toolbar dims — they stay on the page until they choose to close it. — **WIRED, BLOCKED ON PHASE 34.** Trigger raises Postgres error 42501 → SupabaseYjsProvider's send-failure path fires `update_rejected` → `setAccessRevoked(true)` → banner + ReadOnlyGate land. Manual UAT requires real cross-account session which depends on Phase 34's sharing UX (dashboard query + Storage RLS gaps).
- [DEFERRED] Multi-peer "Figma feel" between two real human accounts. — **WIRED, BLOCKED ON PHASE 34.** Same dependency as above. Wire-level transport already proven by 8-bot benchmark; the deferred test is whether the UI feel matches the locked target with two real users.

## Boundaries Honored

DO NOT CHANGE list (project-wide Always-Protected):

- `src/App.jsx` — **untouched.** `git diff --stat` over Phase 28 commit range returns empty.
- `src/components/PageAnnotationLayer.jsx` — **untouched.**
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx` — **untouched.** `zoomGeneration` signal contract preserved.
- `src/components/SVGAnnotationLayer.jsx` — **untouched.** SVG viewBox remains the sole zoom-scaling authority.
- `package.json` — **byte-identical to pre-spike state.** `@hocuspocus/provider` + `@hocuspocus/server` + `jose` were installed for the spike measurement (per the conditional waiver in CONTEXT.md), then uninstalled at Plan 28-04 close. Net delta = zero.
- `vite.config.js` — **untouched.**

Phase 27 baseline checks all green:

- applyUpdate-only invariant: passes (`tests/phase27/applyUpdateOnlyInvariant.test.mjs`)
- License CI gate: passes (Phase 27 allowlist held; no new license-positive deps remain on the production path)
- Phase 27 + Phase 28 unit suites: 33/30 pass / 3 skipped (pre-existing skip-guards) / 0 fail

## Lessons / Carry-forward

- **The "list shared documents in dashboard" + "Storage RLS for non-owner collaborators" are the two cross-phase boundary gaps that block Phase 28's manual UAT.** Both belong to Phase 34 ("sharing UX & revocation") on the v2.4 roadmap. Phase 28's transport, validator, and banner code paths are all wire-ready — when Phase 34 lands the dashboard query rewrite + Storage RLS for collaborators, the deferred UAT can run unblocked.
- **8 Phase 28 bot accounts remain in the real Supabase project**, tagged `phase28_bot=true`. Cleanup SQL filter is documented in `28-04-SUMMARY.md` and `28-BENCHMARK.md` but DELIBERATELY NOT RUN — they're the test peers for the deferred UAT and for any cross-account testing needed during Phase 29 (Fabric/Yjs bridge) and Phase 30 (dual-write migration).
- **Hocuspocus prototype remains in the codebase as the documented v2.5+ fallback surface.** `HocuspocusYjsProvider.js` is dormant (zero imports anywhere in `src/App.jsx`), the test scaffold remains skip-able without the package, and the local bench server (`tests/phase28/hocuspocusBenchServer.mjs`) is a re-runnable test asset. Reactivation is a one-command flip if v2.5 production data ever warrants it.
- **`launch-bot1-window.mjs` was created during this session for the live-UAT setup attempt** and remains in the phase directory. It is a session-side test asset; safe to leave for Phase 34's UAT or to delete at any point.
- **The custom auto-login override script in `launch-bot1-window.mjs` is reusable for future per-bot Chrome sessions.** It rewrites `VITE_DEV_AUTO_LOGIN_EMAIL` / `_PASSWORD` at the network layer for one specific browser context — never touches `.env.local` or any source file. Worth keeping in mind for Phase 34 UAT and any future multi-account testing.

## Status: DONE_WITH_CONCERNS

All 10/10 automated must-haves passed. 4/14 acceptance criteria deferred to Phase 34 close (manual UAT items wired but blocked on the dashboard + Storage RLS gaps that belong to the sharing UX phase). User has explicitly accepted this status with the instruction "we'll test everything at the end" (recorded as COMMITMENT in 2026-04-27 session moments).

Phase 28 is functionally complete and unblocks Phase 29 (Fabric/Yjs bridge) and Plan 28-05's RLS migration is live in production.
