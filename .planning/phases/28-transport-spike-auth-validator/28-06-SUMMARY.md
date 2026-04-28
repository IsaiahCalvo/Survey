---
phase: 28-transport-spike-auth-validator
plan: 06
subsystem: collab/ui
tags: [crdt, yjs, supabase-realtime, ui, banner, modal, readonly, kick-ux, login-expiry, AUTH-01, AUTH-02, blocker-1-fix]
dependency_graph:
  requires:
    - 27-05-PLAN.md (Phase 27 banner + YDocProvider mount — extension surface)
    - 28-02-PLAN.md (SupabaseYjsProvider + authSessionBridge + originBuilder + deviceId)
    - 28-04-PLAN.md (transport decision locked = supabase per BENCHMARK)
    - 28-05-PLAN.md (RLS migration + postgres-trigger validator — provides update_rejected wire signal consumed by Task 3 onUpdateRejected hook)
  provides:
    - "StorageFailureBanner extended with 3 new copy variants (transport_offline, permission_revoked, login_expiry_failure) — same component, byte-frozen CSS"
    - "ReSignInModal.jsx + .css — only new component this phase; inline re-sign-in form on document page (no fullscreen takeover)"
    - "ReadOnlyGate.jsx + .css — read-only mode dispatcher; renders null, body[data-readonly] attribute + window-capture-phase keydown listener"
    - "YDocProvider context surface extended (accessRevoked / transportState / loginExpired / reSignInModalOpen + setter / setLoginExpired / closeDocument / getOriginContext)"
    - "Locked transport (SupabaseYjsProvider) + authSessionBridge (Pitfall 1 defense) mounted inside YDocProvider's existing useEffect"
  affects:
    - "Phase 29 (Fabric ↔ Yjs binding) — getOriginContext factory consumed by every ydoc.transact() call site"
    - "Phase 33 (Tags / activity log / sync chip) — accessRevoked + transportState + loginExpired surface available; sync-chip can read transportState directly"
    - "Phase 34 (sharing UX + 4-role permission UI) — UAT cross-account portion deferred here lands at Phase 34 close"
tech-stack:
  added: []
  patterns:
    - "Body-attribute-driven read-only mode (body[data-readonly='true'] + descendant CSS selectors) — keeps protected canvas/SVG components unaware of read-only state"
    - "Window-capture-phase keydown listener for mutation-keystroke suppression — runs before bubble-phase handlers regardless of where they're attached, so read-only gating works without editing Always-Protected canvas/SVG components"
    - "Cmd+S explicit pass-through in read-only mode (preserves commit 477fe90e UX patch — saving is not a mutation)"
    - "Per-variant heading + secondary maps on banner (HEADING_BY_CODE / SECONDARY_BY_CODE) — replaces Phase 27's shared HEADING/SECONDARY constants while preserving Phase 27 codes verbatim"
    - "Inline modal placement (position: absolute inside document scroll container) — preserves user's visual context with the document; the 'don't make them lose their place' decision made physical"
    - "ESC + click-outside as deliberate no-ops on ReSignInModal — modal is non-dismissible by design (only ways out: successful sign-in or 'Sign in with a different account')"
key-files:
  created:
    - "src/components/collab/ReSignInModal.jsx (~210 LOC)"
    - "src/components/collab/ReSignInModal.css (~210 LOC)"
    - "src/components/collab/ReadOnlyGate.jsx (~140 LOC)"
    - "src/components/collab/ReadOnlyGate.css (~55 LOC)"
  modified:
    - "src/components/collab/StorageFailureBanner.jsx (+128 / -28 LOC — extended COPY map + per-variant heading/secondary maps + dismiss-button gate for permission_revoked)"
    - "src/components/collab/YDocProvider.jsx (+~250 / -21 LOC — transport mount + bridge mount + extended context + banner action wiring + ReSignInModal mount + ReadOnlyGate mount)"
    - "src/lib/collab/ydocLifecycle.js (header doc-only — channel-extension contract recorded, no behavioral change)"
decisions:
  - "Plan 28-06 Blocker 1 fix executed verbatim: authSessionBridge mount + readonly gate moved out of App.jsx into YDocProvider + new ReadOnlyGate.jsx child component. App.jsx ends Phase 28 with ZERO new lines (git diff --stat empty). The 28-CONTEXT.md narrow waiver was NOT exercised."
  - "ReadOnlyGate ships as the read-only mode dispatcher: renders null, sets body[data-readonly] attribute when accessRevoked=true, window-capture-phase keydown listener suppresses Cmd+Z / Cmd+Shift+Z / Delete / Backspace while preserving Cmd+S pass-through (commit 477fe90e UX patch)."
  - "Backspace explicitly passes through inside editable inputs (input/textarea/contenteditable) so the ReSignInModal password field still works while read-only is active — bug-class defense, NOT a UX exception."
  - "ReadOnlyGate.css uses a 3-shape selector matrix (.tool-toolbar, .tool-toolbar__button, .toolbar-button) targeting the project's historical toolbar class names. .readonly-allowed escape-hatch class reserved for any future surface (sync chip, save buttons) that needs to remain interactive."
  - "Phase 27's shared HEADING / SECONDARY constants in StorageFailureBanner replaced with HEADING_BY_CODE / SECONDARY_BY_CODE maps. All 4 Phase 27 codes still resolve to 'Local saving is offline' — visible Phase 27 surface is unchanged. The 3 new Phase 28 codes get their own honest headings per UI-SPEC."
  - "permission_revoked has NO dismiss button — render-gated (showDismiss = code !== 'permission_revoked'). Banner stays until user closes the document on their own terms. Implements CONTEXT.md 'don't make them close the door behind them' decision."
  - "ReSignInModal does NOT extend AuthModal — fullscreen position:fixed at z-index:10000 would cover the document and defeat the 'don't make them lose their place' CONTEXT decision. New focused component shares useAuth().signIn hook (no parallel auth wiring)."
  - "ESC + click-outside on ReSignInModal are deliberate no-ops. Modal is non-dismissible because clicking ESC would loop the user back to the login_expiry_failure banner — fake escape. Only ways out are successful sign-in or 'Sign in with a different account'."
  - "getOriginContext factory exposed on YDocProvider context value — Phase 29's Fabric ↔ Y.Map binding consumes this in ydoc.transact(fn, origin). serverTs intentionally absent from client (Postgres column DEFAULT NOW() owns it; AUTH-03)."
  - "Provider construction failure (network down at boot, missing env, etc.) is caught and surfaced as transport_offline storage state — user sees the offline banner rather than a silent freeze. Honest-over-silent principle from Phase 27 carries forward."
  - "ydocLifecycle.js Phase 28 extension is documentation-only — the existing onStorageState callback signature already accepts arbitrary code strings, so no behavioral change is required. The header records the new channel codes (transport_offline, transport_online, permission_revoked, login_expiry_failure) so future readers see the full set flowing through one callback rather than parallel surfaces."
  - "DEFERRED UAT — User explicitly deferred Tests 2/3/4/5/6 (cross-account + single-context UAT) to Phase 34 close. Blocker discovered: the document dashboard query filters by user_id = auth.uid() only, so shared docs don't appear in collaborator file lists, AND Supabase Storage RLS scopes the PDF binary to the OWNER's user_id prefix path so non-owner collaborators cannot fetch the binary. User declined the temporary-relax-storage-RLS + direct-link workaround. Bot accounts + .bot-credentials.json LEFT IN PLACE for the deferred UAT."
metrics:
  duration_minutes: 32
  tasks: 5
  tasks_complete_autonomous: 4
  tasks_deferred: 1
  commits: 5
  files_created: 4
  files_modified: 3
  lines_added: ~1140
  lines_removed: ~49
  completed: 2026-04-28
---

# Phase 28 Plan 06: Wire transport + extend banner + ship ReSignInModal + ReadOnlyGate Summary

Phase 28's user-facing surface wired end-to-end. Locked transport (custom Supabase Realtime adapter per 28-BENCHMARK.md) plus `authSessionBridge` (Pitfall 1 silent-refresh defense) both mount inside `YDocProvider`, the only existing CRDT-layer mount point in `App.jsx`. The Phase 27 `StorageFailureBanner` extends in place with three new copy variants (`transport_offline`, `permission_revoked`, `login_expiry_failure`); two new tiny child components ship (`ReSignInModal` for inline re-sign-in, `ReadOnlyGate` for the kicked-collaborator state). Plan 28-06 Blocker 1 fix executed verbatim — `App.jsx` ends Phase 28 with **zero new lines** (`git diff --stat src/App.jsx` is empty). All four Phase 28-06 autonomous tasks shipped as atomic commits; Task 5 (manual UAT) was deferred to Phase 34 close per user instruction (sharing-UX gap blocks live cross-account testing tonight).

## Files Created

| File | LOC | Purpose |
| ---- | --- | ------- |
| `src/components/collab/ReSignInModal.jsx` | ~210 | Inline re-sign-in form on document page (only new component this phase). `useAuth().signIn` reused, no parallel auth wiring. ESC + click-outside deliberate no-ops; modal is non-dismissible. |
| `src/components/collab/ReSignInModal.css` | ~210 | Locked CSS variables, z-index 200 (above banner / below AuthModal), 220ms cubic-bezier(0,0,0.2,1) opacity-fade mount animation, no scrim layer. |
| `src/components/collab/ReadOnlyGate.jsx` | ~140 | Read-only mode dispatcher. Renders `null`. Sets `body[data-readonly="true"]` + window-capture-phase keydown listener when `accessRevoked` is true. Cmd+S explicit pass-through (commit 477fe90e UX patch preserved). |
| `src/components/collab/ReadOnlyGate.css` | ~55 | 3-shape selector matrix (`.tool-toolbar` / `.tool-toolbar__button` / `.toolbar-button`) dims toolbar via `body[data-readonly="true"]` descendant rules. `.readonly-allowed` escape-hatch class documented for future Phase 32/33 surfaces. |

## Files Modified

| File | Delta | Purpose |
| ---- | ----- | ------- |
| `src/components/collab/StorageFailureBanner.jsx` | +128 / -28 | Extended COPY map with 3 new variants; replaced Phase 27's shared HEADING / SECONDARY constants with per-variant `HEADING_BY_CODE` / `SECONDARY_BY_CODE` maps; gated dismiss button render off when `code === 'permission_revoked'`. |
| `src/components/collab/YDocProvider.jsx` | +~250 / -21 | Locked transport mount via `createSupabaseYjsProvider` (one-line swap target if v2.5+ flips to Hocuspocus). `attachAuthSessionBridge` mounted inside the same `useEffect` (Blocker 1 fix moved out of App.jsx). Context surface extended with `accessRevoked` / `transportState` / `loginExpired` / `reSignInModalOpen` + setter / `setLoginExpired` / `closeDocument` / `getOriginContext`. Banner action wiring per UI-SPEC: `transport_offline` → reload, `permission_revoked` → `closeDocument()`, `login_expiry_failure` → opens `<ReSignInModal>`. `<ReSignInModal>` and `<ReadOnlyGate />` mounted as banner siblings. |
| `src/lib/collab/ydocLifecycle.js` | header doc-only | Phase 28 extension contract documented in module header — the new channel codes (`transport_offline`, `transport_online`, `permission_revoked`, `login_expiry_failure`) plumb through the existing `onStorageState` callback unchanged. No behavioral change; documentation-only pass. |

## App.jsx Waiver Status

**NOT EXERCISED.** The 28-CONTEXT.md narrow waiver permitted a single import + a single provider wrap inside the existing `<YDocProvider docId>` boundary. Plan 28-06 Blocker 1 fix moved both candidate touches (the `authSessionBridge` mount and the read-only gate) out of `App.jsx` and into `YDocProvider.jsx` + the new `ReadOnlyGate.jsx` child component. The Phase 27 Plan 27-05 `<YDocProvider docId>` mount line in `App.jsx` is the **only** Phase 27/28 footprint at end-of-phase. Verified by:

```bash
git diff --stat src/App.jsx
# (empty — zero diff)
```

Hard-asserted at plan close. Blocker 1 fix successful.

## StorageFailureBanner Extension Confirmation

- **3 new variants** added to `COPY` map: `transport_offline`, `permission_revoked`, `login_expiry_failure`. All copy strings come **verbatim** from 28-UI-SPEC.md Component Inventory section 1.
- **CSS byte-frozen.** `git diff --stat src/components/collab/StorageFailureBanner.css` is empty. Same `.storage-banner__*` classes serve all 7 codes.
- **Per-variant heading + secondary maps.** Phase 27's shared `HEADING` / `SECONDARY` constants replaced with `HEADING_BY_CODE` / `SECONDARY_BY_CODE`. All 4 Phase 27 codes still resolve to 'Local saving is offline' — visible Phase 27 surface unchanged.
- **Dismiss-button gate for `permission_revoked`.** `showDismiss = code !== 'permission_revoked'` renders the dismiss button only for dismissable codes. Kicked-out is a permanent state for the session per CONTEXT.md decision.
- **Behavioral check (Warning 6 fix).** Verified by inspection: when `code === 'permission_revoked'`, the `{showDismiss && <button>}` block does not render — no dismiss button reaches the DOM, no keyboard tab order includes a dismiss affordance, no screen reader announces dismiss.

## ReSignInModal Contract Confirmation

- **Only new component this phase.** `src/components/collab/ReSignInModal.jsx` + `.css`.
- **Inline placement.** `position: absolute` inside document scroll container; `top: 32px`; `left: 50%; transform: translateX(-50%)`; `width: min(400px, 90vw)`. Document remains visible behind the modal — no scrim, no backdrop.
- **`useAuth().signIn` reused.** No parallel auth wiring; the same hook that drives `AuthModal.jsx`.
- **ESC = no-op.** `useEffect` adds a `window` keydown listener that calls `e.preventDefault()` on Escape and never closes the modal.
- **Click-outside = no-op.** No backdrop layer; click-outside has nothing to bind to.
- **Error mapping.** `bad_password` / `network` / `account_locked` error codes map to UI-SPEC verbatim copy strings.
- **Loading state.** CTA label switches to `Signing in…` (single glyph U+2026 ellipsis) while submitting; inputs disabled with `opacity: 0.6 + cursor: not-allowed`.
- **Mount animation.** `opacity 0→1 + translateY(-8px)→0` over 220ms `cubic-bezier(0, 0, 0.2, 1)` — same easing as Phase 27 banner hydration.
- **z-index 200.** Above the banner (z-index 100), below `AuthModal` (z-index 10000).

## ReadOnlyGate Contract Confirmation

- **Renders `null`.** All side effects are `body` attribute + window keydown listener; no DOM tree change propagates through React.
- **`body[data-readonly="true"]` attribute.** Set when `useYDoc().accessRevoked` is true; removed on cleanup. CSS in `ReadOnlyGate.css` dims `.tool-toolbar` / `.tool-toolbar__button` / `.toolbar-button` via descendant selectors.
- **Window-capture-phase keydown listener.** Third arg to `addEventListener('keydown', ..., true)` — runs before bubble-phase handlers regardless of where they're attached. This is how read-only gating works without editing Always-Protected canvas/SVG components.
- **Cmd+S pass-through preserved.** Commit 477fe90e UX patch is load-bearing; the gate explicitly returns early on Cmd+S / Ctrl+S so save still works in read-only mode.
- **Backspace pass-through inside editable inputs.** `tag === 'input' || tag === 'textarea' || isContentEditable` → return early. The ReSignInModal password field still works.
- **Cleanup is symmetric.** `removeEventListener` + `removeAttribute('data-readonly')` on either `accessRevoked` flipping false or component unmount.
- **Best-effort `phase28:readonly-activated` event dispatch.** Forward-looking signal for App.jsx / PDFViewer to clear active tool selection; Phase 28 doesn't require any listener (`pointer-events: none` on the toolbar already prevents tool selection).

## YDocProvider Context Surface Delta

| Field | Type | Source | Phase 28 New? |
| ----- | ---- | ------ | ------------- |
| `ydoc` | `Y.Doc \| null` | `getOrCreateYDoc(docId)` | (Phase 27) |
| `isHydrating` | `boolean` | `attachLifecycle` synced event | (Phase 27) |
| `storageState` | `{code, role, error?} \| null` | `attachLifecycle` + provider callbacks + bridge `onSignedOut` | (Phase 27 — extended) |
| `role` | `'leader'\|'loser'\|'unknown'` | `attachLifecycle` Web Locks role | (Phase 27) |
| `isCRDTEnabled` | `boolean` | `crdtFeatureFlag.isCRDTEnabled()` | (Phase 27) |
| `dismissBanner` | `() => void` | local state setter | (Phase 27) |
| `accessRevoked` | `boolean` | provider's `onUpdateRejected` callback (`'permission_revoked'` or `^authentication_failed`) | **NEW** |
| `transportState` | `'online' \| 'offline' \| null` | provider's `onTransportState` callback | **NEW** |
| `loginExpired` | `boolean` | bridge `onSignedOut` | **NEW** |
| `reSignInModalOpen` | `boolean` | local state | **NEW** |
| `setReSignInModalOpen` | `(boolean) => void` | local state setter | **NEW** |
| `setLoginExpired` | `(boolean) => void` | local state setter | **NEW** |
| `closeDocument` | `() => void` | caller-provided prop, defaults to `window.history.back()` | **NEW** |
| `getOriginContext` | `() => Origin` | factory built from `buildOrigin({ userId, deviceId, sessionId, clientID })` | **NEW** (Phase 29 consumer) |

`sessionId` resets on document re-open per `useMemo` keyed on `docId`.

## Transport Provider Wired

Per 28-BENCHMARK.md decision (locked 2026-04-28): **custom Supabase Realtime adapter** wins (tiebreaker rule #1 — both prototypes pass speed bar; simpler one wins). `YDocProvider.jsx` imports `createSupabaseYjsProvider as createTransportProvider` so the call site is transport-agnostic — if v2.5+ ever flips to Hocuspocus, the change is one line.

The provider's callbacks wire to the new channel codes:

- `onTransportState('offline')` → `setTransportState('offline')` + `setStorageState({ code: 'transport_offline', ...})` → banner appears
- `onTransportState('online')` → `setTransportState('online')` + clears `transport_offline` storageState if currently set (does NOT stomp on persistence-side codes)
- `onUpdateRejected('permission_revoked' | /^authentication_failed/)` → `setAccessRevoked(true)` + `setStorageState({ code: 'permission_revoked', ...})` → banner appears, ReadOnlyGate activates

The Hocuspocus path remains as dormant v2.5+ fallback — `src/lib/collab/HocuspocusYjsProvider.js` stays in the codebase (no imports anywhere on the production path; package.json clean).

## authSessionBridge Mount Confirmation

**Pitfall 1 defense ACTIVE.** `attachAuthSessionBridge({ supabase, onSignedOut: ... })` is called inside `YDocProvider.jsx`'s existing `useEffect`, alongside `attachLifecycle` and the transport provider mount. On `TOKEN_REFRESHED` → `supabase.realtime.setAuth(token)` (the Pitfall 1 defense single line in `authSessionBridge.js:58`). On `SIGNED_OUT` → `setLoginExpired(true)` + `setStorageState({ code: 'login_expiry_failure', ...})` → banner appears, action opens `<ReSignInModal>`.

Mounted **inside** YDocProvider rather than App.jsx so Plan 28-06 Blocker 1 fix is honored — App.jsx zero diff.

## Read-Only Mode Gate Confirmation

**Gate lives in `ReadOnlyGate.jsx`, NOT `App.jsx`.** Verified:

```bash
grep -c "data-readonly\|accessRevoked" src/App.jsx
# 0 (zero matches in App.jsx)
grep -c "data-readonly" src/components/collab/ReadOnlyGate.jsx
# 7 matches (correct location)
```

The original Plan 28-06 Task 4 added 5 surface changes to App.jsx (2 imports + 1 useEffect + 1 dispatchEvent + 1 prop + readonly-toolbar gate); the revised Task 4 lands all of that surgically in YDocProvider + ReadOnlyGate. **Blocker 1 fix complete.**

## UAT Results — DEFERRED to Phase 34

Per user instruction: "we'll test everything at the end."

### What was attempted

User attempted live two-account UAT with one of the phase28 bot accounts. Hit a **sharing-UX gap** that blocks the cross-account portion:

1. **Document dashboard scope.** The dashboard's document list query filters by `user_id = auth.uid()` only. Shared documents (where the user is a `document_collaborators` editor) don't appear in the bot's file list, so the bot can't open the shared PDF from the UI.
2. **Supabase Storage RLS.** PDF binaries are stored under the OWNER's `user_id` prefix path (`170d915c-.../general/...pdf`). Storage RLS scopes the bucket so only the owner's path is readable — non-owner collaborators cannot fetch the PDF binary even when correctly listed as collaborators.

User declined the temporary workaround (relax storage RLS + use direct doc URL) tonight. The cross-account testing depends on the **Phase 34** sharing UX (sharing modal + 4-role permission UI + collaborator-aware document list query + collaborator-aware storage RLS).

### What DID land verifiable evidence

| Test | Status | Evidence |
| ---- | ------ | -------- |
| Test 1 — Single-user round-trip preservation | DEFERRED (single-context but not exercised tonight) | Phase 27 baseline regression test green; ydocLifecycle integration test green |
| Test 2 partial — Multi-peer transport propagation | **WIRE-LEVEL VERIFIED** | Plan 28-04 5-peer / 5-min / throttled benchmark across 8 bot accounts: p95 = 104 ms, 0 errors, 28,139 samples (`28-bench-results/supabase-5p-300s-throttled.json`) |
| Test 2 UI portion — multi-peer cross-account UI | DEFERRED (Phase 34 sharing UX dependency) | — |
| Test 3 — Silent token refresh anti-UI contract | DEFERRED | Pitfall 1 defense single-line wire verified by `tests/phase28/authSessionBridge.test.mjs` (5/5 green); UI verification deferred |
| Test 4 — Failed silent refresh → login_expiry_failure banner | DEFERRED | bridge.onSignedOut → setLoginExpired wire verified by code path inspection; UI verification deferred |
| Test 5 — Permission revocation kick UX | DEFERRED (Phase 34 sharing UX dependency) | RLS rejection wire verified by Plan 28-05 SQL test suite (`tests/phase28/rls/run-all.sql`); UI verification deferred |
| Test 6 — Network outage transport_offline | DEFERRED | provider.onTransportState wire verified by `tests/phase28/SupabaseYjsProvider.test.mjs` (5/5 green); UI verification deferred |
| **Test 7 — No regressions** | **GREEN** | Phase 27 + Phase 28 unit suites: 33 tests / 30 pass / 3 skipped (pre-existing skip-guards) / 0 fail. applyUpdate-only invariant green. License-CI gate green. |

### Bot accounts and credentials — LEFT IN PLACE

The 8 phase28 bot accounts in the real Supabase project (`cvamwtpsuvxvjdnotbeg`) are **not cleaned up** at Phase 28 close. Cleanup contract is documented in 28-04-SUMMARY.md and 28-BENCHMARK.md but explicitly **NOT run yet** so the deferred UAT can use them.

```sql
-- DEFERRED — to be run AFTER Phase 34 UAT closes
DELETE FROM auth.users WHERE raw_user_meta_data->>'phase28_bot' = 'true';
```

```bash
# DEFERRED — to be run AFTER Phase 34 UAT closes
rm /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json
```

### How to re-run the deferred UAT (Phase 34 close)

After Phase 34 ships sharing UX:

1. Confirm `supabase/migrations/20260504000000_phase28_transport_auth_validator.sql` (Plan 28-05) is still applied to the test project.
2. `npm run dev` — open `http://localhost:5173/` and the test PDF (`Package 2 - Rev 4 -- IC.pdf`).
3. Open second browser context (Chrome incognito or second profile); sign in as one of the phase28 bot accounts (credentials in `.bot-credentials.json`).
4. From the OWNER's account, share the document with the bot using the new Phase 34 sharing modal as an editor.
5. From the BOT's account, the document should now appear in the dashboard list (Phase 34 collaborator-aware query).
6. Run through the full 7-test UAT sequence in `28-06-PLAN.md` Task 5 `<how-to-verify>` section.
7. Reply with `approved` (or specific issues) to land the final Phase 28 reconciliation entry.

## Phase 28 Acceptance Criteria Status

From 28-CONTEXT.md (14 total):

| # | Criterion | Status |
| - | --------- | ------ |
| 1 | 4-5 peers under 500ms p95 on shared wifi | **CLOSED** by Plan 28-04 benchmark (104ms p95) |
| 2 | Written transport decision document | **CLOSED** by 28-BENCHMARK.md status:locked |
| 3 | Both pass speed bar → simpler wins | **CLOSED** by 28-BENCHMARK.md decision:supabase |
| 4 | Neither passes → joint review | n/a (both passed) |
| 5 | Clear winner day 3 → run full week anyway | **CLOSED** — full sweep run; both prototypes measured |
| 6 | JWT carried on Realtime + every Postgres write | **CLOSED** by Plan 28-02 authSessionBridge + Plan 28-05 trigger |
| 7 | Silent refresh — zero UI | **WIRE READY** (UI deferred to Phase 34 UAT) |
| 8 | Failed refresh → login_expiry_failure banner + inline modal | **WIRE READY** (UI deferred) |
| 9 | Kick → banner + read-only mode within seconds | **WIRE READY** (UI deferred to Phase 34 UAT) |
| 10 | RLS-violation → update_rejected event | **CLOSED** by Plan 28-05 trigger + provider.onUpdateRejected wire |
| 11 | Non-collaborator JWT rejected by RLS | **CLOSED** by Plan 28-05 RLS suite |
| 12 | Locked through v2.4 close | **CLOSED** by 28-BENCHMARK.md lock-in statement |
| 13 | origin payload {userId, deviceId, sessionId, clientID, serverTs} | **CLOSED** by Plan 28-02 buildOrigin + getOriginContext exposure on YDocProvider context |
| 14 | Phase 27 stub deny-all policies dropped by exact name | **CLOSED** by Plan 28-05 migration |

10 of 14 hard-closed; 3 wire-ready (UAT deferred to Phase 34); 1 n/a.

## Phase 27 Baseline Preservation Report

| Surface | Status | Evidence |
| ------- | ------ | -------- |
| applyUpdate-only invariant | **GREEN** | `tests/phase27/applyUpdateOnlyInvariant.test.mjs` passes |
| License CI gate | **GREEN** | (project policy preserved; no new packages added on Supabase path) |
| Single-user round-trip | **PRESERVED** | Phase 27 ydocLifecycle + storageFailureDetector tests all green; YDocProvider extension is additive (no Phase 27 code path removed) |
| Cmd+S UX patch (commit 477fe90e) | **PRESERVED** | ReadOnlyGate.jsx explicitly passes Cmd+S through; no other changes touch the Cmd+S handler |
| Always-Protected files | **UNTOUCHED** | `git diff --stat` empty for App.jsx, PageAnnotationLayer, FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, SVGAnnotationLayer, vite.config.js, package.json |
| Phase 27 banner codes (4) | **UNCHANGED** | Same surface; just folded into HEADING_BY_CODE / SECONDARY_BY_CODE maps. Visible behavior identical. |
| Plan 27-05 App.jsx mount line | **PRESERVED** | The single existing `<YDocProvider docId>` mount remains the only Phase 27/28 footprint in App.jsx |

## Phase Reconciliation Prep Notes (for `28-RECONCILIATION.md`)

When Phase 28 closes, the reconciliation should record:

- **Status: DONE_WITH_CONCERNS** — manual UAT (Tests 2-6 UI portions) explicitly deferred to Phase 34 close per user instruction. Wire-level evidence + benchmark numbers cover acceptance criteria 1, 6, 10, 11, 13, 14 hard. Criteria 7, 8, 9 are wire-ready, UAT-pending.
- **Boundaries Honored** — App.jsx zero diff (Plan 28-06 Blocker 1 fix). All Always-Protected files untouched. package.json restored to pre-spike state per Plan 28-04 Step 5 (Hocuspocus packages uninstalled when Supabase won).
- **Deferred items**:
  - Manual UAT cross-account portion → Phase 34 close
  - phase28 bot accounts cleanup → after Phase 34 UAT
  - `.bot-credentials.json` removal → after Phase 34 UAT
  - Active-tool clear listener for `phase28:readonly-activated` event → optional, Phase 33 if needed
  - Soft `reconnect()` method on the provider (current Retry-now action does a full page reload) → Phase 32 hardening
- **Lessons / Carry-forward**:
  - Body-attribute-driven read-only mode is a clean pattern for gating Always-Protected components; reuse for any future read-only / view-only / preview-mode features.
  - Window-capture-phase keydown listener pattern preserves Cmd+S explicit pass-through cleanly; document the pattern as a reusable template for the project.
  - Backspace-inside-editable-input exception is a class of bug; future keyboard-suppression gates should default to checking `tagName` + `isContentEditable` before swallowing.
  - The plan's checker correctly identified Blocker 1 (App.jsx scope creep) before code landed; the revised structure is materially safer than the original. Plan-checker-as-gate-not-rubber-stamp is working.

## Self-Check: PASSED

**Created files exist:**
- `src/components/collab/ReSignInModal.jsx` — FOUND
- `src/components/collab/ReSignInModal.css` — FOUND
- `src/components/collab/ReadOnlyGate.jsx` — FOUND
- `src/components/collab/ReadOnlyGate.css` — FOUND

**Commits exist:**
- `00620643` (StorageFailureBanner extension) — FOUND
- `e87458ad` (ReSignInModal) — FOUND
- `f1fb8ac4` (transport + bridge wire-up) — FOUND
- `d777e915` (ReadOnlyGate) — FOUND
- `32ec959d` (STATE.md progress through checkpoint) — FOUND

**Hard contracts:**
- `git diff --stat src/App.jsx` returns EMPTY — VERIFIED
- All Always-Protected files untouched — VERIFIED
- applyUpdate-only invariant green — VERIFIED
- Phase 27 + Phase 28 unit suites green (33 / 30 pass / 3 skipped / 0 fail) — VERIFIED
