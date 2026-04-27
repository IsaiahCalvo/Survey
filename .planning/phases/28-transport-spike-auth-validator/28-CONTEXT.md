# Phase 28: Transport Spike + Auth + Server Validator - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Decide the transport layer that pushes live CRDT updates between collaborators by building both candidates as throwaway prototypes against the Phase 27 Y.Doc foundation, benchmarking them under a defined load, and locking the winner. Land the auth handshake (Supabase JWT carried on every Realtime subscription + every Postgres write, with seamless background token refresh) and the server-side update validator that enforces RLS state on every CRDT update at write-time. Activate RLS policies on `doc_yjs_updates` + `doc_yjs_state`. Carry user + device attribution at every transaction origin.

This phase ships:
- Two transport prototypes side-by-side: a custom Supabase Realtime Yjs provider (default candidate, ~150-300 LOC, reuses existing Supabase plumbing) AND a self-hosted Hocuspocus Yjs provider (fallback candidate, off-the-shelf MIT, requires a Node WebSocket service). Both built against the Phase 27 Y.Doc registry — neither touches the SVG/Fabric layers.
- A benchmark harness that drives the bake-off load against both prototypes and produces measurable go/no-go evidence (frame stability, peer fan-out, end-to-end propagation latency).
- A written transport decision document with benchmark numbers, the locked choice, and the rationale.
- Auth handshake: Supabase JWT carried on the Realtime channel and on every `doc_yjs_updates` insert. Background token refresh that does not interrupt edits or break the live channel. Inline re-sign-in flow on the document page if the silent refresh fails.
- Server-side update validator: every incoming CRDT update is run through `user_can_access_document(doc_id, 'editor')` at write-time (Postgres function or Edge Function — researcher/planner picks the surface). Updates from a revoked collaborator are rejected and an `update_rejected` event is pushed back to the client over the live channel.
- RLS policies on `doc_yjs_updates` (INSERT gated on `'editor'`, SELECT gated on `'viewer'`) and `doc_yjs_state` (same shape). The Phase 27 stub deny-all policies are dropped by exact name.
- Transaction-origin payload `{ userId, deviceId, sessionId, clientID, serverTs }` carried on every `ydoc.transact(fn, origin)`. `deviceId` defaults to OS hostname via Electron `os.hostname()` (data path only — the rename UI is Phase 33).
- Kicked-out collaborator UX: when the server pushes the kick, a top banner appears, the in-flight edit is dropped with an explicit reason, the document stays open in read-only mode (the user closes it themselves), and the kick lands within a few seconds of the owner clicking remove.

The Fabric ↔ Y.Map binding stays in Phase 29. The display and edit components (`PageAnnotationLayer`, `FabricDrawingCanvas`, `FabricEraserCanvas`, `FabricEditCanvas`, `SVGAnnotationLayer`) do not learn about transport, auth, or attribution in this phase.

**Requirement mapping:** AUTH-01 (user attribution at transaction origin — data path), AUTH-02 (device attribution at transaction origin — data path; default to OS hostname).

</domain>

<decisions>
## Implementation Decisions

### Speed bar — what counts as transport "passing"
- Test load: **4 to 5 concurrent peers** all editing the same document at once.
- Worst-case action mix: **all three at the same time** — rapid pen scribbling, dragging existing shapes, and typing in text annotations across the peer set simultaneously.
- Latency target: every remote edit must appear on every other peer's screen in **under half a second**, end to end.
- Network conditions: the bar must pass on **normal home/office shared wifi**, not just clean lab wifi. This is the actual user environment.
- Pattern reference (user-named): "Figma / Google Docs feel — collaboration that reads as alive."

### Kicked-out collaborator UX
- **Banner across the top** of the document explains the access has been removed by the owner. Same shape and pattern as the Phase 27 storage-failure banner — sticky, role=alert, dismiss button, locked CSS variables.
- The collaborator's **in-flight edit is dropped with an explicit reason** ("This change wasn't saved because your access was removed.") — never silently discarded.
- After the kick, the **document stays open in read-only mode**. The user closes it themselves. Do NOT auto-bounce to the dashboard. (User decision — overrides the recommended bounce-to-dashboard option. Reason: closing a document the user was just working in is jarring; let them close it on their terms.)
- The kick lands **within a few seconds** of the owner clicking remove — the server pushes `permission_revoked` down the live channel right away, not on the user's next save attempt.
- Anti-pattern explicitly rejected: silent freeze (edits stop working with no explanation). Mirrors the Phase 27 honesty-over-silent-fallback principle.

### Login expiry / token refresh UX
- Background token refresh is **fully invisible** — no chip, no banner, no UI change. The user keeps working with no signal that anything happened. Pattern reference (user-named): Linear, Notion, Figma silent refresh.
- During the refresh (a couple of seconds), edits **keep flowing** — they queue locally and flush when the refresh lands. The Phase 27 IndexedDB local cache already handles this; no new offline machinery needed.
- If the silent refresh **fails** (password changed elsewhere, account locked, refresh token revoked), a **top banner** appears: "Your sign-in expired — click here to sign in again." Same banner shape as the storage-failure and kicked-out banners. The user stays on the document page until they re-sign in.
- The re-sign-in form pops **inline on the document page** (small modal sign-in box on top of the document). After re-sign-in the user is still on the same page where they left off — they don't get bounced back to the dashboard or login screen. Reason: don't make them lose their place.

### Transport tiebreakers (spike outcome rules)
- **If both prototypes pass the speed bar:** the **simpler one wins** — the custom Supabase Realtime adapter that reuses existing Supabase plumbing (no new service to deploy/host/monitor, billing stays in one place, ~150-300 LOC vs adopting a Node WebSocket service). Matches the v2.4 research recommendation in `.planning/research/SUMMARY.md`.
- **If neither prototype passes:** **stop and rethink** at the end of the week. Look at the benchmark data together. Decide jointly whether to extend the timebox, lower the bar, or change approach. No sunk-cost auto-pick of "the closer one."
- **If a clear winner emerges early (e.g. day 3):** **run the full week anyway**. Finish both prototypes properly so the comparison is honest. The timebox is a ceiling, not a forced cut-short. (User decision — overrides the recommended cut-short option. Reason: a clean, comparable benchmark is worth more than a few saved days.)
- **Lock-in:** once the choice is made, it is **locked for v2.4**. We do not revisit transport during this milestone. If production shows weakness later, we revisit in v2.5. Reason: swapping transport mid-milestone is a multi-month detour with cascading risk.

### Auth handshake (architectural — locked by phase requirements)
- Supabase JWT is carried on the Realtime channel subscribe call AND on every `doc_yjs_updates` insert. The validator reads the JWT, runs `user_can_access_document(doc_id, 'editor')`, and rejects on `false`.
- Token refresh is mandatory and seamless. Token expiry mid-session must NOT break the channel (close + reopen + re-subscribe + re-handshake handled internally by the provider).
- Renewal cadence and refresh strategy: planner decides (likely 1-2 minutes before expiry, on a single timer per Y.Doc).

### Server-side update validator
- Every incoming CRDT update is run through current RLS state at write-time. Whether this lands as a Postgres function (trigger on `doc_yjs_updates` INSERT) or as an Edge Function gating writes is **claude's discretion** — the planner picks the surface based on the spike's findings about which one cleanly intercepts every write path the chosen transport produces.
- Rejected updates emit an `update_rejected` event back to the originating client over the live channel. This event is what fires the "kicked out" banner UX defined above.
- Validator latency budget: must not push end-to-end propagation past the 500ms speed bar.

### Transaction-origin attribution
- Every `ydoc.transact(fn, origin)` carries `{ userId, deviceId, sessionId, clientID, serverTs }`.
- `userId` from the Supabase auth session.
- `deviceId` defaults to **OS hostname** via Electron `os.hostname()` on desktop. Web fallback strategy is claude's discretion (likely a stable per-browser-install random id stored in localStorage with a "Web — Chrome" label, since browsers don't expose a hostname).
- `sessionId` is per-Y.Doc-mount; resets on document re-open.
- `clientID` is the Yjs client id.
- `serverTs` lands in `doc_yjs_updates.server_ts` via the Phase 27 schema (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`) — the client doesn't fabricate timestamps.

### Phase 27 stub policy drop
- The Phase 27 stub deny-all RLS policies (named `<table>_phase27_stub_deny_all`) are dropped by exact name in the same migration that creates the real policies. This was Phase 27's deliberate setup so that Phase 28 has unambiguous DROP POLICY targets — defends Pitfall 1.

### Claude's Discretion
- Server-side validator surface — Postgres function (trigger on insert) vs Supabase Edge Function. Planner picks based on which path the chosen transport produces and on validator latency.
- Web (non-Electron) fallback for `deviceId` when `os.hostname()` is unavailable.
- Token refresh cadence and exact strategy (single timer per Y.Doc, refresh window before expiry, retry policy on transient network failure).
- Benchmark harness shape — how the spike loads the prototypes (Playwright-driven multi-tab, scripted multi-Y.Doc replay, headless puppeteer fan-out, etc.).
- Inline re-sign-in modal visual design — size, placement, dismissibility on document page. Reuse existing auth components if possible.
- The exact banner copy for kick + login-expiry banners — design pass during planning, mirroring the Phase 27 storage-failure copy structure.
- Whether the benchmark harness becomes a permanent test asset or stays as throwaway scaffolding. Likely keep the multi-peer load harness for Phase 32 hardening.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.4 research (already loaded for Phase 27 — re-read SUMMARY + ARCHITECTURE + PITFALLS)
- `.planning/research/SUMMARY.md` — single decision document. Transport-layer is called out as the open architectural decision; the spike's mandate is here.
- `.planning/research/STACK.md` — locked Yjs trio + version pins. The custom-Supabase-adapter recommendation lives here. Anti-recommendations: AlexDunmow/y-supabase (broken), Liveblocks / Tiptap Cloud / y-sweet (third-party billing splits source-of-truth).
- `.planning/research/ARCHITECTURE.md` — SVG-display + Fabric-edit layers immutable; CRDT layer wraps under React state; transport is "Option B" of three documented options.
- `.planning/research/PITFALLS.md` — 22 pitfalls; this phase defends pitfalls **3 (Y.Doc vs RLS mismatch — server-side validator), 14, 15 (transport choice itself = multi-month-detour-either-way), 16**. Spike timebox of 1 week is mandated here.
- `.planning/research/FEATURES.md` — feature breakdown; device attribution as a first-class differentiator (no major collab tool ships this) is documented here.

### Phase 27 foundation (read before planning)
- `.planning/phases/27-crdt-foundation/27-CONTEXT.md` — Phase 27 decisions: applyUpdate-only invariant, Web Locks election, IndexedDB persistence, storage-failure banner pattern (the canonical reference for Phase 28's banner UX), multi-instance behavior, highlights-stay-on-legacy carve-out.
- `.planning/phases/27-crdt-foundation/27-RESEARCH.md` — Yjs primary docs already digested.
- `.planning/phases/27-crdt-foundation/27-RECONCILIATION.md` — Phase 27 closure status; what landed vs what deferred.
- `.planning/phases/27-crdt-foundation/27-UI-SPEC.md` — banner pattern that Phase 28 banners (kick UX, login-expiry-failure) reuse verbatim.
- `.planning/phases/27-crdt-foundation/27-03-PLAN.md` — `doc_yjs_updates` + `doc_yjs_state` schema (bytea, server_ts, encoding_version, FK ON DELETE CASCADE). Phase 28 drops the stub deny-all policies and lands the real ones.
- `.planning/phases/27-crdt-foundation/27-02-PLAN.md` — Y.Doc registry + applyUpdate-only invariant. Phase 28 transport providers consume this registry without breaking the invariant.
- `.planning/phases/27-crdt-foundation/27-04-PLAN.md` — `ydocLifecycle` storage-failure detector + crdt feature flag + onStorageState channel. Phase 28 extends the channel with `transport_offline` codes.

### Project-level (load-bearing)
- `CLAUDE.md` — Always-Protected file list (`src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/FabricEditCanvas.jsx`, `src/components/SVGAnnotationLayer.jsx`, `package.json`, `vite.config.js`). Per-phase narrow waivers are the pattern.
- `.planning/PROJECT.md` — current milestone overview, v2.4 goal + scope.
- `.planning/REQUIREMENTS.md` — AUTH-01, AUTH-02 (this phase's data-path scope), AUTH-03 (already complete in Phase 27), traceability table.
- `.planning/ROADMAP.md` — Phase 28 detailed section: success criteria 1-5, boundary notes (App.jsx narrow waiver, package.json conditional waiver if Hocuspocus wins), expected new files, sequencing 28 → 29 strict.

### Yjs + transport docs (researcher will load in Phase 28 research step)
- Yjs official docs: `Y.Doc`, Document Updates encoding, Awareness, transactions and origins.
- `y-protocols` README + `awareness` + `sync` binary frame format — the format the custom Supabase adapter must encode/decode through Realtime Broadcast.
- Hocuspocus GitHub README + `@hocuspocus/provider` API — the off-the-shelf candidate.
- Hocuspocus + Supabase Auth integration guide — for the Hocuspocus-wins path.

### Supabase docs (researcher loads)
- Supabase Realtime Protocol + Limits — message rate caps, payload size, broadcast vs presence vs postgres_changes channels. The custom adapter targets Broadcast.
- Supabase Auth — JWT shape, refresh token flow, `onAuthStateChange` event surface, server-side JWT verification.
- Supabase RLS — `auth.uid()`, custom claims, helper-function RLS pattern. The validator's `user_can_access_document(doc_id, role)` Postgres function lands here.
- Supabase Edge Functions — runtime model, latency profile, Realtime integration. The Edge-Function-validator alternative path.

### Browser + Electron API references
- WebSocket close codes + reconnection patterns (MDN) — for the transport provider's reconnection state machine.
- Electron `os.hostname()` — `deviceId` default source.
- IndexedDB error modes (MDN) — storage-failure banner shape carries forward to transport-failure banner.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/collab/ydocLifecycle.js` (Phase 27 Plan 27-02 + 27-04) — Y.Doc registry + storage-failure detector + onStorageState channel. The transport providers consume the registry to subscribe to the right Y.Doc; the channel is extended with `transport_offline` / `update_rejected` codes.
- `src/components/collab/StorageFailureBanner.jsx` + `.css` (Phase 27 Plan 27-05) — banner shape, locked CSS variables, role=alert, aria-live=polite, dismiss button, sticky positioning. Phase 28's three new banners (transport-offline, kick, login-expiry-failure) reuse this component's structure verbatim with new copy variants.
- `src/components/collab/YDocProvider.jsx` (Phase 27 Plan 27-05) — React context provider; the transport provider is wired in via the same context boundary so the entire viewer subtree sees one connected Y.Doc.
- Existing Supabase client setup (`useDatabase.js` and friends) — same auth session, same client instance is reused for the custom Realtime adapter. No new auth setup.
- `auth.uid()` + RLS helper-function pattern already in use elsewhere in the schema. `user_can_access_document(doc_id, role)` slots into the existing pattern.

### Established Patterns
- The Phase 27 `onStorageState` channel (`'available' | 'quota_exceeded' | 'invalid_state' | 'version_mismatch'`) is the precedent for cross-cutting CRDT-layer state. Phase 28 extends this surface with transport-side codes rather than inventing a parallel channel.
- The Phase 27 banner pattern (sticky top, role=alert, locked CSS variables, 2 type weights only, accent-color underline links) is the canonical reference for every CRDT-layer banner. New banners must match it byte-for-byte except for copy.
- Per-phase narrow-lane waivers for Always-Protected files. This phase needs `src/App.jsx` waiver IF auth/transport context wires through App-level state (likely a single import + provider wrap, mirroring Phase 27 Plan 27-05's mount), AND a conditional `package.json` waiver IF the Hocuspocus path wins (adds `@hocuspocus/provider` only).
- The Phase 27 applyUpdate-only invariant (`'a Y.Doc directly'` self-documenting comment + grep test) — Phase 28 transport providers must continue to honor it. Server snapshots arrive as updates that get `Y.applyUpdate`'d, never replaced wholesale.

### Integration Points
- `package.json` — conditional waiver: `@hocuspocus/provider` lands ONLY if Hocuspocus wins the spike. Custom-Supabase-adapter path adds zero new packages (Supabase client + Yjs are already installed in Phase 27).
- `src/App.jsx` — narrow waiver: auth/transport context wire-up if needed. Best-case is a single new context provider wrap inside the existing `<YDocProvider docId>` boundary; Phase 27's mount-only pattern is the precedent.
- `src/lib/collab/SupabaseYjsProvider.js` (NEW) — default-path custom adapter built on `y-protocols` sync + Supabase Realtime Broadcast.
- `src/lib/collab/HocuspocusYjsProvider.js` (NEW) — fallback-path Hocuspocus provider wrapper.
- `src/lib/collab/transportSpikeBenchmark.js` (NEW) — the bake-off harness; may survive past the spike as a Phase 32 hardening asset.
- Supabase migrations — drop Phase 27 stub deny-all policies by name, create real RLS policies on `doc_yjs_updates` + `doc_yjs_state`, create `user_can_access_document(doc_id, role)` Postgres function (or extend an existing helper if one exists), create the validator surface (Postgres trigger or Edge Function).
- `permission_revoked` event surface — landed on the same Realtime channel the transport uses, consumed by the kick-UX banner.

</code_context>

<specifics>
## Specific Ideas

- "Figma / Google Docs feel" was the explicit bar set by the user for the speed test — under half a second end-to-end, on normal shared wifi, with 4-5 people doing mixed drawing/dragging/typing all at once.
- "Don't make them close the door behind them" — when access is revoked, the document stays open in read-only mode. The user closes it themselves. Overrides the recommended auto-bounce-to-dashboard pattern.
- "Run the full week anyway, even if there's a clear winner" — the timebox isn't a forced cut-short; a clean comparable benchmark is worth more than a few saved days. Overrides the recommended cut-short pattern.
- "Linear / Notion / Figma silent refresh" — token refresh should be fully invisible. No chip, no banner, no UI change.
- "Don't make them lose their place" — re-sign-in after a failed silent refresh pops inline on the document page, never bounces them to the main login screen or dashboard.
- Honesty-over-silent-fallback principle carries forward from Phase 27 — every CRDT-layer failure mode shows the user what's broken, what's at risk, and how to fix it. Banner-shape pattern is the canonical surface.

</specifics>

<deferred>
## Deferred Ideas

- **AUTH-04 / AUTH-05 right-click "Tags" + properties three-dot "Tags" surface** — Phase 33 (Activity Log + Awareness + Resume). Phase 28 ships the data path only; the UI lands later.
- **AUTH-06 device label rename in account settings** — Phase 33. Data path supports it (the `device_id` is independent from the display label); UI is later.
- **Live cursors / presence pill** — Phase 33 (`Y.Awareness` channel). The transport this phase ships will carry awareness updates; the UI lands in Phase 33.
- **Per-user undo (`Y.UndoManager` with `trackedOrigins`)** — Phase 29 (Fabric ↔ Yjs Binding + Per-User Undo). Phase 28 produces the origin payload `{ userId, deviceId, sessionId, clientID, serverTs }` that Phase 29's UndoManager consumes.
- **Activity log writes** — Phase 33. The validator this phase ships could be extended to write activity rows, but the consumption UI is Phase 33; defer the write side too to keep Phase 28 surgical.
- **Sharing UX + 4-role permission UI + decommission of legacy `useAnnotationCloudSync`** — Phase 34. Phase 28's RLS + validator support the role distinctions but the UI surface is the final phase.
- **Periodic Y.Doc compaction job** — Phase 32 (Multi-tab + Persistence Hardening). Phase 28 lands snapshots-on-demand; the periodic job is later.
- **Two-tab Playwright stress tests for Web Locks + transport** — Phase 32. Phase 28 covers single-tab + multi-peer scenarios.
- **CSV export of activity log + sync state in title bar** — v2.4.x post-launch.

</deferred>

## Acceptance Criteria

- **Given** the bake-off prototypes are built and running, **when** 4-5 concurrent peers all edit the same document simultaneously with mixed pen-scribbling + shape-dragging + text-typing on normal home/office shared wifi, **then** every remote edit appears on every other peer's screen in under 500 ms end-to-end.
- **Given** the bake-off has run its full one-week timebox, **when** a transport choice is locked, **then** a written transport decision document exists with benchmark numbers for both prototypes, the chosen transport, and the rationale — and that decision is committed to the repo as the binding choice for v2.4.
- **Given** both prototypes pass the speed bar, **when** the transport choice is made, **then** the simpler one wins (the custom Supabase Realtime adapter that reuses existing infrastructure).
- **Given** neither prototype passes the speed bar at the end of the timebox, **when** the week ends, **then** the milestone pauses for a joint review of benchmark data — no auto-pick of the closer-but-still-failing option.
- **Given** the speed bar is clearly being met by one prototype on day 3, **when** the team considers cutting the spike short, **then** the spike runs the full one-week timebox anyway so the comparison is honest.
- **Given** an authenticated user opens a document, **when** the Realtime channel is subscribed and a CRDT update is written to `doc_yjs_updates`, **then** both calls carry the user's Supabase JWT and the validator runs `user_can_access_document(doc_id, 'editor')` on every write.
- **Given** the user's Supabase JWT is approaching expiry mid-session, **when** the silent background refresh runs, **then** the user sees no UI change at all — no chip, no banner, no flicker — and edits continue to flow through the live channel without interruption.
- **Given** the silent refresh fails (password changed elsewhere, account locked, refresh token revoked), **when** the next live-channel write or read happens, **then** a top banner appears matching the Phase 27 banner pattern saying "Your sign-in expired — click here to sign in again", and the inline re-sign-in form pops on the document page so the user stays on the same page after re-auth.
- **Given** a collaborator's access is revoked by the document owner, **when** the server pushes the `permission_revoked` event on the live channel, **then** within a few seconds the collaborator sees a top banner explaining their access was removed, their in-flight edit is dropped with an explicit reason, and the document stays open in read-only mode (NOT auto-bounced to the dashboard).
- **Given** a revoked collaborator's client still attempts to write a CRDT update, **when** the validator checks RLS state at write-time, **then** the update is rejected and an `update_rejected` event is pushed back to the originating client over the live channel.
- **Given** a non-collaborator JWT, **when** that JWT is used to SELECT or INSERT into `doc_yjs_updates` or `doc_yjs_state`, **then** Postgres rejects the operation via RLS — verified by SQL test executed under the non-collaborator JWT.
- **Given** the transport chosen for v2.4 is committed, **when** any transport-related concern surfaces during v2.4, **then** the choice is NOT revisited — the team accepts the locked decision through milestone close and revisits in v2.5 only if production data warrants.
- **Given** every Y.Doc transaction in this phase, **when** `ydoc.transact(fn, origin)` is called, **then** the origin payload includes `{ userId, deviceId, sessionId, clientID, serverTs }` — `deviceId` defaulting to `os.hostname()` on Electron.
- **Given** the Phase 27 stub deny-all RLS policies on `doc_yjs_updates` and `doc_yjs_state`, **when** Phase 28's migration runs, **then** those policies are dropped by exact name (`<table>_phase27_stub_deny_all`) and the real role-gated policies are created in their place — idempotently.

## DO NOT CHANGE

Always-Protected default list (carry forward from project-wide rules):

- `src/App.jsx` — **NARROW WAIVER GRANTED for this phase** if and only if auth/transport context wires through App-level state. The waiver is scoped to a single import + a single provider wrap inside the existing `<YDocProvider docId>` boundary, mirroring Phase 27 Plan 27-05's mount-only pattern. Any other touches still need explicit approval.
- `src/components/PageAnnotationLayer.jsx` — protected; PAL does not learn about transport, auth, or attribution in this phase.
- `src/components/FabricDrawingCanvas.jsx` — protected.
- `src/components/FabricEraserCanvas.jsx` — protected.
- `src/components/FabricEditCanvas.jsx` — protected.
- `src/components/SVGAnnotationLayer.jsx` — protected; the SVG layer reads from React state, not transport, in this phase.
- `package.json` — **CONDITIONAL NARROW WAIVER** for installing `@hocuspocus/provider` ONLY IF the Hocuspocus prototype wins the spike. The custom Supabase Realtime adapter path adds zero new packages and requires no waiver. No other dep changes regardless of which path wins.
- `vite.config.js` — protected.
- Phase 27 ships (`src/lib/collab/ydocLifecycle.js`, `src/components/collab/YDocProvider.jsx`, `src/hooks/useYDoc.js`, `src/components/collab/StorageFailureBanner.jsx`, `src/components/collab/StorageFailureBanner.css`) — protected as an extension surface. New banners reuse the StorageFailureBanner component's structure with new copy variants; the existing component is not rewritten.
- Phase 27 schema (`doc_yjs_updates`, `doc_yjs_state`, `activity_log`) — column shape protected (no schema rework). The only allowed change is dropping the stub deny-all RLS policies by exact name and creating the real ones.
- Legacy highlight sync code (`useLegacyHighlightSync` and related Excel-sync paths) — protected; highlights stay on legacy through v2.4. Phase 28's transport carries non-highlight CRDT updates only.
- v2.3 phase directories (`.planning/phases/14-*` through `.planning/phases/18-*`) — out of scope.
- v3.0 PDF-Native phase directories (`.planning/phases/20-*` through `.planning/phases/26-*`) — parallel milestone, out of scope.
- Other v2.4 phase directories (`.planning/phases/29-*` through `.planning/phases/34-*`) — out of scope; their concerns are explicitly deferred above.

---

*Phase: 28-transport-spike-auth-validator*
*Context gathered: 2026-04-27*
