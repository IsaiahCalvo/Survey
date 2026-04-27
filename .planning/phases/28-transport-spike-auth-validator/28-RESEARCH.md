# Phase 28: Transport Spike + Auth + Server Validator — Research

**Researched:** 2026-04-27
**Domain:** Real-time transport for Yjs CRDT updates (Supabase Realtime Broadcast vs self-hosted Hocuspocus), Supabase JWT-gated auth handshake, server-side update validator, RLS activation, user+device origin attribution
**Confidence:** HIGH on Yjs / y-protocols / Supabase Realtime mechanics (verified against official docs + project STACK / ARCHITECTURE / PITFALLS); HIGH on auth pitfalls (verified via Supabase issue tracker — token refresh and Realtime channel reconnection have known sharp edges); MEDIUM on Hocuspocus + Supabase Auth integration (one well-documented blog, no first-party doc); MEDIUM on server-side validator surface choice (Postgres trigger + custom claim is a known pattern but Phase 28 must benchmark)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Speed bar — what counts as transport "passing":**
- Test load: **4 to 5 concurrent peers** all editing the same document at once.
- Worst-case action mix: **all three at the same time** — rapid pen scribbling, dragging existing shapes, and typing in text annotations across the peer set simultaneously.
- Latency target: every remote edit must appear on every other peer's screen in **under half a second**, end to end.
- Network conditions: the bar must pass on **normal home/office shared wifi**, not just clean lab wifi.
- Pattern reference (user-named): "Figma / Google Docs feel — collaboration that reads as alive."

**Kicked-out collaborator UX:**
- **Banner across the top** of the document explains the access has been removed by the owner. Same shape and pattern as the Phase 27 storage-failure banner — sticky, role=alert, dismiss button, locked CSS variables.
- The collaborator's **in-flight edit is dropped with an explicit reason** ("This change wasn't saved because your access was removed.") — never silently discarded.
- After the kick, the **document stays open in read-only mode**. The user closes it themselves. Do NOT auto-bounce to the dashboard.
- The kick lands **within a few seconds** of the owner clicking remove — the server pushes `permission_revoked` down the live channel right away.
- Anti-pattern explicitly rejected: silent freeze.

**Login expiry / token refresh UX:**
- Background token refresh is **fully invisible** — no chip, no banner, no UI change. Pattern reference: Linear, Notion, Figma silent refresh.
- During the refresh, edits **keep flowing** — they queue locally and flush when the refresh lands. The Phase 27 IndexedDB local cache already handles this; no new offline machinery needed.
- If the silent refresh **fails**, a **top banner** appears: "Your sign-in expired — click here to sign in again." Same banner shape as the storage-failure and kicked-out banners.
- The re-sign-in form pops **inline on the document page**. After re-sign-in the user is still on the same page where they left off.

**Transport tiebreakers (spike outcome rules):**
- **If both prototypes pass the speed bar:** the **simpler one wins** — the custom Supabase Realtime adapter (no new service to deploy/host/monitor, billing stays in one place, ~150-300 LOC vs adopting a Node WebSocket service).
- **If neither prototype passes:** **stop and rethink** at the end of the week.
- **If a clear winner emerges early:** **run the full week anyway** — clean, comparable benchmark is worth more than a few saved days.
- **Lock-in:** once the choice is made, it is **locked for v2.4**. We do not revisit transport during this milestone.

**Auth handshake (architectural — locked by phase requirements):**
- Supabase JWT is carried on the Realtime channel subscribe call AND on every `doc_yjs_updates` insert. The validator reads the JWT, runs `user_can_access_document(doc_id, 'editor')`, and rejects on `false`.
- Token refresh is mandatory and seamless. Token expiry mid-session must NOT break the channel.

**Server-side update validator:**
- Every incoming CRDT update is run through current RLS state at write-time.
- Rejected updates emit an `update_rejected` event back to the originating client over the live channel.
- Validator latency budget: must not push end-to-end propagation past the 500ms speed bar.

**Transaction-origin attribution:**
- Every `ydoc.transact(fn, origin)` carries `{ userId, deviceId, sessionId, clientID, serverTs }`.
- `userId` from the Supabase auth session.
- `deviceId` defaults to **OS hostname** via Electron `os.hostname()` on desktop.
- `sessionId` is per-Y.Doc-mount; resets on document re-open.
- `clientID` is the Yjs client id.
- `serverTs` lands in `doc_yjs_updates.server_ts` via the Phase 27 schema (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`) — the client doesn't fabricate timestamps.

**Phase 27 stub policy drop:**
- The Phase 27 stub deny-all RLS policies (named `<table>_phase27_stub_deny_all`) are dropped by exact name in the same migration that creates the real policies — defends Pitfall 1.

### Claude's Discretion

- Server-side validator surface — Postgres function (trigger on insert) vs Supabase Edge Function. Planner picks based on which path the chosen transport produces and on validator latency.
- Web (non-Electron) fallback for `deviceId` when `os.hostname()` is unavailable.
- Token refresh cadence and exact strategy (single timer per Y.Doc, refresh window before expiry, retry policy on transient network failure).
- Benchmark harness shape — Playwright multi-tab, scripted multi-Y.Doc replay, headless puppeteer fan-out, etc.
- Inline re-sign-in modal visual design — size, placement, dismissibility on document page. Reuse existing auth components if possible.
- The exact banner copy for kick + login-expiry banners — design pass during planning, mirroring the Phase 27 storage-failure copy structure.
- Whether the benchmark harness becomes a permanent test asset or stays as throwaway scaffolding. Likely keep the multi-peer load harness for Phase 32 hardening.

### Deferred Ideas (OUT OF SCOPE)

- **AUTH-04 / AUTH-05 right-click "Tags" + properties three-dot "Tags" surface** — Phase 33.
- **AUTH-06 device label rename in account settings** — Phase 33. Data path supports it; UI is later.
- **Live cursors / presence pill** — Phase 33 (`Y.Awareness` channel). The transport this phase ships will carry awareness updates; the UI lands in Phase 33.
- **Per-user undo (`Y.UndoManager` with `trackedOrigins`)** — Phase 29. Phase 28 produces the origin payload that Phase 29's UndoManager consumes.
- **Activity log writes** — Phase 33.
- **Sharing UX + 4-role permission UI + decommission of legacy `useAnnotationCloudSync`** — Phase 34.
- **Periodic Y.Doc compaction job** — Phase 32.
- **Two-tab Playwright stress tests for Web Locks + transport** — Phase 32.
- **CSV export of activity log + sync state in title bar** — v2.4.x post-launch.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | Every annotation creation, edit, and deletion records the user account that performed it. | Carried on Yjs transaction `origin` payload `{ userId, ... }`. Section 3 (Origin attribution pattern) + Section 4 (validator extracts `userId` from JWT and stores in `doc_yjs_updates.origin` JSONB column already present from Phase 27 schema). |
| AUTH-02 | Every annotation creation, edit, and deletion records the device it was performed on (Mac, Windows, future iPhone, future Android), with a default name from the OS hostname. | Carried on Yjs transaction `origin` payload `{ deviceId, ... }`. Section 3.3 (`deviceId` derivation: Electron `os.hostname()` via IPC; web fallback = stable per-browser-install id). Stored in `doc_yjs_updates.origin.deviceId`. |
</phase_requirements>

---

## Summary

The custom Supabase Realtime Broadcast adapter is the recommended default transport — it's the documented STACK.md choice, reuses existing auth/billing/RLS, adds zero new services, and the v2.4 SUMMARY says explicitly: "if both prototypes pass, the simpler one wins." Hocuspocus is the credible fallback only if the spike measures the Supabase path failing the 500ms / 4-5-peer / shared-wifi bar. Both must be built honestly to the same harness over the full one-week timebox per the user's CONTEXT decision.

The two structural risks in this phase are both **auth-related, not transport-related**:

1. **Supabase Realtime channels do NOT auto-pick-up refreshed access tokens.** This is a documented bug class (`supabase/realtime-js#274`, `supabase/supabase-js#1732`) that has bitten many Yjs-on-Supabase implementations. Token refresh requires explicit `supabase.realtime.setAuth(freshToken)` after every `TOKEN_REFRESHED` event from `onAuthStateChange`. **The channel survives only if you wire this manually.** This must be a first-class invariant of the custom adapter or it WILL break the user's "Linear / Notion / Figma silent refresh" decision the moment a session crosses the JWT-expiry boundary mid-edit (default 1h).

2. **The server-side validator is the strongest structural argument for Hocuspocus** and the single hardest part of the custom-Supabase path. The recommended approach: **Postgres BEFORE INSERT trigger on `doc_yjs_updates` that calls `user_can_access_document(NEW.document_id, 'editor')`** with the JWT-derived `auth.uid()` from the connection. RLS already gates the INSERT, but RLS rejection alone returns a generic 403 to the client without a `permission_revoked` channel event. The trigger pattern lets us surface the rejection cleanly and emit `update_rejected` via Realtime Broadcast in the same DB round-trip. Edge Function is the alternative — it sits in front of every write, runs in Deno, has its own latency surface (~50-200ms cold start, ~10-50ms warm), and concentrates JWT verification into one place but adds a hop to every write. **Recommendation: Postgres trigger primary, Edge Function as fallback if the trigger pattern proves unworkable for emitting `update_rejected` cleanly.**

**Primary recommendation:** Spike both prototypes against an identical Playwright-driven 5-tab harness simulating mixed pen-scribble + drag + text-typing on throttled wifi. Default to the custom Supabase Realtime adapter winning. Land Postgres trigger + JWT-claim helper-function validator. Wire `supabase.realtime.setAuth(freshToken)` on every `TOKEN_REFRESHED` event as a non-negotiable invariant. Origin payload `{ userId, deviceId, sessionId, clientID, serverTs }` flows through the Phase 27 `ydoc.transact(fn, origin)` pattern unchanged — server stamps `serverTs` via the existing `server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` column.

---

## Standard Stack

### Core (no new packages on the recommended default path)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yjs` | `^13.6.30` (already installed Phase 27) | CRDT engine | Locked by STACK.md / Phase 27. No upgrade. |
| `y-protocols` | `^1.0.7` (already installed Phase 27) | Sync v1 binary frame encoding (`syncStep1` / `syncStep2` / `syncUpdate`) + Awareness | The format the custom Supabase adapter encodes/decodes through Realtime Broadcast. Already in the dep tree from Phase 27. |
| `@supabase/supabase-js` | `^2.81.1` (already installed) | Realtime channel + Auth session + Postgres client | Reuses existing client. No new auth setup. |
| `lib0` | (transitive of yjs) | Binary encoding (`encoding.createEncoder`, `encoding.toUint8Array`) | y-protocols depends on it. Available without adding a direct dep. |

**No new packages required for the recommended (custom Supabase Realtime adapter) path.** The Phase 28 prototype is hand-written code under `src/lib/collab/SupabaseYjsProvider.js`.

### Fallback (only if Hocuspocus wins the spike)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@hocuspocus/provider` | `^2.13.6` (verify at install time) | Browser-side Yjs ↔ Hocuspocus WebSocket client | MIT, requires conditional `package.json` waiver per CONTEXT. |
| `@hocuspocus/server` | `^2.13.6` | Self-hosted Node WebSocket service | Out-of-tree on a new Node host. NOT in this app's npm tree — runs as a separate service. |

**Version verification:** Before writing the Standard Stack table for the planner, the planner MUST verify these still match registry HEAD:
```bash
npm view @hocuspocus/provider version
npm view @hocuspocus/server version
```

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Custom Supabase Realtime adapter | `AlexDunmow/y-supabase` package | STACK.md anti-recommendation. Author flags as "not for production." Known broadcast-storm bug (`y-supabase: Too many message events`). Use as reference only. |
| Custom Supabase Realtime adapter | Liveblocks Yjs | STACK.md anti-recommendation. Third-party billing on top of Supabase + Stripe. Splits source of truth. |
| Custom Supabase Realtime adapter | y-sweet (Jamsocket) | STACK.md anti-recommendation. S3-backed Yjs server. Would add a second blob store alongside Postgres. |
| Hocuspocus (fallback) | `y-websocket` reference server | STACK.md anti-recommendation. Bare-bones, no auth/persistence hooks; you'd rebuild Hocuspocus's missing pieces yourself. |
| Postgres trigger validator | Supabase Edge Function (Deno) | Edge Function adds a network hop on every write. Postgres trigger runs inline with the INSERT. Use Edge Function only if trigger can't cleanly emit `update_rejected`. |

**Installation (recommended path):**
```bash
# No installs. Custom adapter is hand-written.
```

**Installation (Hocuspocus fallback path — package.json conditional waiver):**
```bash
npm install @hocuspocus/provider@^2.13.6
# @hocuspocus/server installs out-of-tree on whatever Node host hosts the WS service.
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/lib/collab/
├── ydocRegistry.js              # EXISTING (Phase 27)
├── ydocLifecycle.js             # EXISTING (Phase 27) — extend onStorageState channel with transport_offline + update_rejected codes
├── storageFailureDetector.js    # EXISTING (Phase 27)
├── crdtFeatureFlag.js           # EXISTING (Phase 27)
├── SupabaseYjsProvider.js       # NEW — default-path custom Realtime Broadcast adapter
├── HocuspocusYjsProvider.js     # NEW — fallback-path Hocuspocus wrapper
├── transportSpikeBenchmark.js   # NEW — bake-off harness (may survive past spike for Phase 32)
├── deviceId.js                  # NEW — Electron os.hostname() + web fallback
├── authSessionBridge.js         # NEW — Supabase auth.onAuthStateChange → realtime.setAuth wiring
└── __tests__/
    ├── SupabaseYjsProvider.test.mjs
    ├── HocuspocusYjsProvider.test.mjs
    ├── deviceId.test.mjs
    └── authSessionBridge.test.mjs

src/components/collab/
├── YDocProvider.jsx             # EXISTING (Phase 27) — extend to mount the chosen transport provider
├── StorageFailureBanner.jsx     # EXISTING (Phase 27) — REUSE structure with new copy variants
├── KickedOutBanner.jsx          # NEW — uses StorageFailureBanner shape verbatim, new copy
├── LoginExpiredBanner.jsx       # NEW — uses StorageFailureBanner shape verbatim, new copy
└── ReSignInModal.jsx            # NEW — inline re-sign-in form on document page (or extension of existing AuthModal)

supabase/migrations/
└── 20260504000000_phase28_transport_auth_validator.sql  # NEW
    # - DROP POLICY <table>_phase27_stub_deny_all (3 tables) by exact name
    # - CREATE OR REPLACE FUNCTION user_can_access_document(doc_id UUID, role TEXT) RETURNS BOOLEAN
    # - CREATE POLICY ... ON doc_yjs_updates / doc_yjs_state (real role-gated)
    # - CREATE TRIGGER doc_yjs_updates_validate BEFORE INSERT ON doc_yjs_updates ...
    # - CREATE FUNCTION + TRIGGER that emits update_rejected via pg_notify or Realtime broadcast on rejection

supabase/rollbacks/
└── 20260504000000_phase28_transport_auth_validator.down.sql

src/App.jsx                      # NARROW WAIVER — single import + provider wrap if needed
```

### Pattern 1: Custom Supabase Realtime Yjs Provider — wire frame

The provider implements the Yjs y-protocols sync v1 message exchange over Supabase Realtime Broadcast events. There are exactly four message types to encode/decode:

| Message | y-protocols frame type | When sent |
|---------|------------------------|-----------|
| **syncStep1** | `messageSync` + state vector | New peer joins; sends its state vector to ask "what am I missing?" |
| **syncStep2** | `messageSync` + update bytes | Reply containing all updates the peer doesn't have |
| **syncUpdate** | `messageSync` + incremental update | Local Y.Doc fired an `update` event; broadcast it |
| **awarenessUpdate** | `messageAwareness` + awareness state | Cursor / presence (Phase 33 consumer; transport carries it from Phase 28) |

**Source pattern** ([y-protocols/sync.js](https://github.com/yjs/y-protocols/blob/master/sync.js)):
```js
// Pure-pattern reference. Adapt under src/lib/collab/SupabaseYjsProvider.js.
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// --- ENCODE: build a Uint8Array sync v1 frame for one update ---
function encodeUpdate(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder); // Uint8Array
}

// --- DECODE: parse incoming frame, dispatch by type ---
function decodeAndApply(ydoc, awareness, bytes, origin) {
  const decoder = decoding.createDecoder(bytes);
  const messageType = decoding.readVarUint(decoder);
  if (messageType === MESSAGE_SYNC) {
    syncProtocol.readSyncMessage(decoder, /* encoder for reply */ encoding.createEncoder(), ydoc, origin);
  } else if (messageType === MESSAGE_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), origin);
  }
}
```

**Supabase Broadcast wire-up:**
- Supabase Realtime broadcasts JSON payloads, NOT raw binary frames natively. **Yjs `Uint8Array` updates MUST be base64-encoded for the broadcast payload** ([Supabase Realtime Broadcast docs](https://supabase.com/docs/guides/realtime/broadcast)).
- Encode at send: `payload: { update: btoa(String.fromCharCode(...new Uint8Array(update))) }` (or use a `Uint8Array → base64` lib0 helper).
- Decode at receive: `Uint8Array.from(atob(payload.update), c => c.charCodeAt(0))`.
- This is a ~33% overhead on the wire vs raw bytes. For typical annotation updates (100-500 bytes per edit), this is 130-650 bytes per broadcast — well under the **1 MB per-message Supabase Realtime limit** verified at [supabase.com/docs/guides/realtime/limits](https://supabase.com/docs/guides/realtime/limits).
- Supabase Realtime supports binary WebSocket frames at the transport level per [supabase.com/docs/guides/realtime/protocol](https://supabase.com/docs/guides/realtime/protocol), but the Broadcast event API surfaces JSON-shaped payloads. Base64 inside the JSON is the standard pattern.

**Channel topology (one channel per document):**
```
Channel: `yjs:${documentId}`
  ├─ event 'sync'         payload: { update: base64, originClientId, encodingVersion }
  ├─ event 'awareness'    payload: { awareness: base64, originClientId }
  ├─ event 'sync_request' payload: { stateVector: base64, fromClientId } (new peer asks for catch-up)
  └─ event 'update_rejected' payload: { reason: 'permission_revoked'|'invalid_origin'|..., originSeq }
```

### Pattern 2: Hocuspocus Fallback Provider — wire frame

```js
// Pure-pattern reference. Adapt under src/lib/collab/HocuspocusYjsProvider.js.
import { HocuspocusProvider } from '@hocuspocus/provider';

const provider = new HocuspocusProvider({
  url: 'wss://collab.your-domain.example',
  name: documentId,
  document: ydoc,
  token: () => supabase.auth.getSession().then(r => r.data.session?.access_token), // JWT
  onAuthenticationFailed: ({ reason }) => {
    // Server's onAuthenticate hook rejected. Surface as `update_rejected` event.
  },
});
```

Server-side (out-of-tree on Fly.io / Railway / a Node host):
```js
// hocuspocus-server/src/index.js (NOT in this app's npm tree)
import { Server } from '@hocuspocus/server';

Server.configure({
  port: 1234,
  async onAuthenticate({ token, documentName }) {
    // 1. Verify token signature against Supabase JWKS
    // 2. Decode auth.uid() from sub claim
    // 3. Run user_can_access_document(documentName, 'editor') against Postgres
    // 4. throw if not allowed
  },
  async onStoreDocument({ documentName, document }) {
    // Persist Y.Doc binary to doc_yjs_state via service-role Supabase client
  },
}).listen();
```

Pattern reference: [emergence-engineering.com/blog/hocuspocus-with-supabase](https://emergence-engineering.com/blog/hocuspocus-with-supabase) — only well-documented Hocuspocus + Supabase Auth integration guide. The pattern works but requires a new Node service deployment that does not exist today.

### Pattern 3: Origin Attribution at Every Transaction

Every `ydoc.transact(fn, origin)` carries the locked payload shape:

```js
// src/lib/collab/originBuilder.js (NEW — small helper module)
export function buildOrigin({ userId, deviceId, sessionId, clientID }) {
  return Object.freeze({
    source: 'local',          // distinguishes local writes from REMOTE_BC_ORIGIN (Phase 27) and remote-realtime
    userId,                    // Supabase auth.uid()
    deviceId,                  // os.hostname() on Electron, stable per-browser-install id on web
    sessionId,                 // per-Y.Doc-mount; resets on document re-open
    clientID,                  // ydoc.clientID
    // serverTs is NOT set client-side. Postgres column server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW() owns it.
  });
}
```

**Server-side enrichment:**
- `serverTs` is stamped by Postgres `DEFAULT NOW()` on insert into `doc_yjs_updates` (already present in Phase 27 schema, locked by 27-03-PLAN.md).
- `userId` is also stamped server-side from JWT `auth.uid()` for non-repudiation — a malicious client could claim a different userId in the origin payload, but the validator rejects insert if `origin.userId != auth.uid()`. Defends Pitfall 8 (audit-trail forgery).

### Pattern 4: Token Refresh Wiring (THE critical invariant)

**Failure mode (verified in Supabase issue tracker):** `supabase-js` automatically refreshes the access token via `onAuthStateChange` → `TOKEN_REFRESHED` event, BUT Realtime channels do NOT pick up the new token automatically. Channels created before the refresh continue using the stale token. After ~1h (default JWT expiry), the channel disconnects with no recovery unless the channel is removed and re-created. ([supabase/realtime-js#274](https://github.com/supabase/realtime-js/issues/274), [supabase/supabase-js#1732](https://github.com/supabase/supabase-js/issues/1732))

**Required wiring:**
```js
// src/lib/collab/authSessionBridge.js (NEW)
const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' && session?.access_token) {
    // Documented bug-class fix: realtime.setAuth(freshToken) MUST fire on every refresh.
    supabase.realtime.setAuth(session.access_token);
  }
  if (event === 'SIGNED_OUT') {
    // Silent refresh failed — tear down the provider and surface the LoginExpiredBanner.
    detachTransport();
    showLoginExpiredBanner();
  }
});
```

This is non-negotiable. Without it, every user session that crosses the JWT-expiry boundary (default 1h) silently breaks the live channel. The user's "Linear / Notion / Figma silent refresh" decision becomes a silent **freeze**, which is the explicitly-rejected anti-pattern.

**Refresh cadence:** No app-level timer needed. `supabase-js` auto-refreshes ~5 minutes before JWT expiry by default (configurable via `auth: { autoRefreshToken: true }` already on by default). The app-level timer trap (Pitfall 18-class issue per [supabase/supabase-js#2126](https://github.com/supabase/supabase-js/issues/2126) — TOKEN_REFRESHED loop on init with ECC P-256 keys) means **do NOT add custom refresh timers**. Trust the auto-refresh and hook only on the event.

### Pattern 5: Server-Side Validator — Postgres Trigger (RECOMMENDED)

```sql
-- supabase/migrations/20260504000000_phase28_transport_auth_validator.sql (excerpt)

-- 1. Helper function: does the JWT-current user have role X on this doc?
CREATE OR REPLACE FUNCTION user_can_access_document(doc_id UUID, required_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER  -- runs as the JWT's role, NOT as superuser. RLS on document_collaborators applies.
STABLE
AS $$
DECLARE
  user_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  -- Owner of documents.user_id always has full access.
  IF EXISTS (SELECT 1 FROM documents WHERE id = doc_id AND user_id = auth.uid()) THEN
    RETURN TRUE;
  END IF;
  -- Collaborator role lookup (Phase 34 ships the document_collaborators table; for Phase 28 this is the future hook).
  SELECT role INTO user_role
  FROM document_collaborators
  WHERE document_id = doc_id AND user_id = auth.uid();
  IF user_role IS NULL THEN RETURN FALSE; END IF;
  -- Role hierarchy: owner > editor > commenter > viewer
  RETURN CASE required_role
    WHEN 'viewer'    THEN user_role IN ('viewer', 'commenter', 'editor', 'owner')
    WHEN 'commenter' THEN user_role IN ('commenter', 'editor', 'owner')
    WHEN 'editor'    THEN user_role IN ('editor', 'owner')
    WHEN 'owner'     THEN user_role = 'owner'
    ELSE FALSE
  END;
END;
$$;

-- 2. Real RLS policies — replace the Phase 27 stubs.
DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all ON doc_yjs_updates;
DROP POLICY IF EXISTS doc_yjs_state_phase27_stub_deny_all   ON doc_yjs_state;
DROP POLICY IF EXISTS activity_log_phase27_stub_deny_all    ON activity_log;

CREATE POLICY doc_yjs_updates_select_viewer ON doc_yjs_updates
  FOR SELECT USING (user_can_access_document(document_id, 'viewer'));
CREATE POLICY doc_yjs_updates_insert_editor ON doc_yjs_updates
  FOR INSERT WITH CHECK (user_can_access_document(document_id, 'editor'));
-- doc_yjs_updates is append-only — no UPDATE/DELETE policies.

CREATE POLICY doc_yjs_state_select_viewer ON doc_yjs_state
  FOR SELECT USING (user_can_access_document(document_id, 'viewer'));
CREATE POLICY doc_yjs_state_upsert_editor ON doc_yjs_state
  FOR ALL USING (user_can_access_document(document_id, 'editor'))
  WITH CHECK (user_can_access_document(document_id, 'editor'));

-- 3. BEFORE INSERT trigger: validate origin.userId matches JWT auth.uid()
CREATE OR REPLACE FUNCTION doc_yjs_updates_validate_origin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Stamp authoritative userId from JWT, overriding any client-claimed origin.userId.
  NEW.origin = jsonb_set(
    COALESCE(NEW.origin, '{}'::jsonb),
    '{userId}',
    to_jsonb(auth.uid()::text)
  );
  -- server_ts is already DEFAULT NOW() on the column.
  RETURN NEW;
END;
$$;

CREATE TRIGGER doc_yjs_updates_validate_origin_trigger
  BEFORE INSERT ON doc_yjs_updates
  FOR EACH ROW EXECUTE FUNCTION doc_yjs_updates_validate_origin();
```

**Key insights:**
- `SECURITY INVOKER` means the helper function runs as the JWT's role, not as superuser. Other RLS policies (e.g. on `document_collaborators` if Phase 34 has shipped it) still apply — defends [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) recommendation against `SECURITY DEFINER` for user-context functions.
- `STABLE` lets the planner cache the function result within a single query — important for hot insert paths.
- The trigger overrides client-claimed `origin.userId` with the JWT's `auth.uid()`. A malicious client cannot forge attribution. (If `auth.uid() IS NULL`, the RLS WITH CHECK rejects the insert before the trigger fires.)
- The role hierarchy (`owner > editor > commenter > viewer`) is the locked v2.4 model from FEATURES.md and matches Figma's documented 4-role pattern.

**Why NOT Edge Function as primary:**
- Adds a network hop on every write (~10-50ms warm, ~50-200ms cold start).
- Concentrates JWT verification — a benefit only if the trigger pattern proves unworkable.
- Recommended fallback only if (a) the trigger can't cleanly emit `update_rejected` over Realtime, OR (b) the spike measures trigger latency pushing the 500ms speed bar.

### Pattern 6: `update_rejected` Event Surface

When the validator rejects a write, the originating client must learn about it within seconds so the kicked-out banner UX fires cleanly.

**Recommended (custom Supabase path):** RAISE NOTICE → Postgres NOTIFY → Supabase Realtime Postgres Changes channel listener that the client already subscribes to OR a server-side function in the Edge Function fallback that broadcasts directly to the `yjs:${documentId}` channel.

**Simpler shape (recommended for Phase 28 spike):** The trigger raises an exception with a structured message; the client catches the Supabase JS error code and emits an `update_rejected` event INTERNALLY (no server round-trip). This works because:
- The client knows EVERY insert it sent (it owns the local `seq`).
- A failed insert returns a Postgres error to the client immediately (~50-100ms in the same TLS connection).
- The client's local handler converts the error into the kicked-out banner UX.

```js
// SupabaseYjsProvider.js excerpt — error path on insert
try {
  const { error } = await supabase.from('doc_yjs_updates').insert({
    document_id: documentId,
    client_id: ydoc.clientID,
    seq: nextSeq++,
    update: updateBytes,
    origin: buildOrigin({ userId, deviceId, sessionId, clientID: ydoc.clientID }),
    client_ts: new Date().toISOString(),
  });
  if (error) {
    // Supabase returns 42501 (RLS violation) or a custom code from the trigger
    if (error.code === '42501' || error.message.includes('permission')) {
      onUpdateRejected({ reason: 'permission_revoked', originalUpdate: updateBytes });
    }
  }
} catch (err) {
  // Network failure — distinct from permission failure. transport_offline.
  onTransportOffline({ reason: err.message });
}
```

The locally-emitted `update_rejected` is enough to fire the kicked-out banner. The "owner clicks remove → kick lands within a few seconds" requirement is satisfied because:
1. Owner clicks remove → DELETE row from `document_collaborators` (Phase 34 UI) → Realtime Postgres-changes channel fires `DELETE` event on `document_collaborators`.
2. Client subscribed to its own collaborator row sees the DELETE → emits `permission_revoked` locally → kicked-out banner mounts.
3. **Belt-and-suspenders:** The very next write attempt will also fail with RLS violation, firing `update_rejected` locally. So even if the Postgres-changes channel misses (Realtime DROP_BC events are documented as best-effort), the in-flight edit cannot bypass.

### Anti-Patterns to Avoid

- **Storing JWT tokens in localStorage outside the Supabase managed client.** Defeats `onAuthStateChange` event flow. Always read tokens via `supabase.auth.getSession()`.
- **Re-creating the Realtime channel on every token refresh.** Causes connection thrash; the user perceives flicker. Use `supabase.realtime.setAuth(freshToken)` to update auth on the existing channel.
- **Custom refresh timers running alongside Supabase's `autoRefreshToken: true`.** Causes the documented `TOKEN_REFRESHED` loop ([supabase/supabase-js#2126](https://github.com/supabase/supabase-js/issues/2126)).
- **Trusting client-claimed `origin.userId` in the trigger.** Always overwrite with `auth.uid()` server-side.
- **Putting cursor/awareness state through `doc_yjs_updates`.** Defends Pitfall 11. Awareness goes through Realtime Broadcast `awareness` event ONLY; it never lands in Postgres.
- **Replacing the Y.Doc on `permission_revoked`.** Defends Pitfall 5 (applyUpdate-only). The kicked client just stops sending writes and the document stays open in read-only mode — the user closes it themselves per CONTEXT.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| y-protocols sync v1 frame encoding | Custom binary message format | `y-protocols/sync` `writeUpdate` / `readSyncMessage` | Wire format is defined and stable. Mistakes silently corrupt. |
| Awareness merge / TTL | Custom presence broadcast | `y-protocols/awareness` `applyAwarenessUpdate` | 30s heartbeat + offline detection built in. |
| JWT verification on the server | DIY public-key parsing | Postgres `auth.uid()` (RLS native) OR Hocuspocus's `onAuthenticate` with Supabase JWKS endpoint | Edge cases: signing key rotation, alg confusion, expiry skew. |
| Token refresh / `realtime.setAuth` plumbing | Custom timer | `supabase.auth.onAuthStateChange` event hook | App-level timers cause the documented `TOKEN_REFRESHED` loop. |
| Permission revocation propagation | Polling / manual broadcast | Supabase Realtime `postgres_changes` on `document_collaborators` DELETE | Sub-second delivery, cluster-distributed. |
| RLS policy at the row level | Application-layer permission checks | Postgres RLS `USING / WITH CHECK` | Bypass-proof; defends Pitfall 3. |
| Origin authenticity (audit forgery resistance) | Trust client-supplied origin | BEFORE INSERT trigger that overwrites `origin.userId = auth.uid()` | Defends Pitfall 8. |
| Reconnection state machine | Custom WS retry | Supabase JS / Hocuspocus built-in retry | Both ship retry-with-backoff that handles network blips correctly. |

**Key insight:** The Yjs ecosystem and Supabase already solve every primitive Phase 28 needs. The phase's job is **wire-up**, not invention. Custom code is limited to: SupabaseYjsProvider (~200 LOC), origin builder (~30 LOC), authSessionBridge (~30 LOC), deviceId helper (~20 LOC), and the validator migration SQL. Total new app-code surface ≈ 300-500 LOC.

---

## Common Pitfalls

### Pitfall 1: Realtime channel does not pick up refreshed JWT (CRITICAL — defends user's "Linear silent refresh" requirement)

**What goes wrong:** Default `supabase-js` auto-refreshes the JWT every ~55 minutes via `onAuthStateChange`. Realtime channels created before the refresh continue using the stale token. After expiry, the channel disconnects with `WebSocket close 1000` and **does not auto-reconnect with the new token** unless `supabase.realtime.setAuth(newToken)` is called explicitly.

**Why it happens:** `supabase-js` auto-refresh updates the auth client's internal token but does not propagate it to the Realtime client. Documented bug class: [supabase/realtime-js#274](https://github.com/supabase/realtime-js/issues/274), [supabase/supabase-js#1732](https://github.com/supabase/supabase-js/issues/1732), [supabase community discussion #37002](https://github.com/orgs/supabase/discussions/37002).

**How to avoid:** Hook `onAuthStateChange` and call `supabase.realtime.setAuth(session.access_token)` on every `TOKEN_REFRESHED` event. NEVER add custom refresh timers (causes the [TOKEN_REFRESHED loop](https://github.com/supabase/supabase-js/issues/2126)).

**Warning signs:**
- Channel disconnects exactly ~1 hour after page load.
- `permission_revoked` events fire spuriously after long idle sessions.
- Mobile/standby returning peers fail to receive any updates.

### Pitfall 2: Base64-in-JSON broadcast inflates payload past spike speed bar

**What goes wrong:** Yjs binary updates encoded as base64 inside Supabase Realtime Broadcast JSON payloads are ~33% larger on the wire than raw bytes. For pen-stroke commits (200-1500 bytes raw), this is fine. For an initial `syncStep2` with a fresh peer joining a busy doc (~50KB-2MB), the inflated 1.3x payload approaches the **1MB Supabase Realtime per-message limit** ([supabase.com/docs/guides/realtime/limits](https://supabase.com/docs/guides/realtime/limits)).

**Why it happens:** Realtime Broadcast event payloads are JSON. Binary bytes need text encoding. Base64 is the standard.

**How to avoid:**
- **Cold-load via Postgres SELECT, not Broadcast.** New peers fetch `doc_yjs_state` snapshot directly via Supabase SQL (binary `bytea` column round-trip — no base64) and only `doc_yjs_updates` after the snapshot's `through_seq`. The Broadcast channel is for INCREMENTAL updates only.
- **Soft cap broadcast payloads at 600KB pre-base64** (~800KB on wire). If a single update is bigger (rare for annotations — would mean a 600KB pen stroke), split or signal compaction.
- **Phase 32 owns compaction.** Phase 28 just needs the spike's harness to verify steady-state updates fit the budget.

**Warning signs:**
- Realtime "payload too large" errors on a fresh-peer-joins-busy-doc test.
- Spike harness shows latency cliffs at certain doc sizes — that's the per-message limit kicking in.

### Pitfall 3: Trigger overhead on hot insert path

**What goes wrong:** A BEFORE INSERT trigger that calls `user_can_access_document` on every insert adds latency to the hottest write path. With a multi-peer doc generating 30-100 inserts/second across all peers, this is the dominant write cost.

**Why it happens:** Each trigger invocation is a function call + RLS subquery on `document_collaborators`. Without indexes, this is a Seq Scan per insert.

**How to avoid:**
- **Index `document_collaborators (user_id, document_id)`** — RLS subquery becomes index-only.
- **Index `documents (user_id)`** — owner check becomes index-only.
- **Mark function `STABLE`** so the planner can cache within a query.
- **Run `EXPLAIN ANALYZE` on the insert hot path** as a Phase 28 acceptance test. Target: <5ms p99 trigger overhead on a synthetic 100-collaborator dataset.
- Defends Pitfall 16 from the milestone-level PITFALLS.md.

### Pitfall 4: `permission_revoked` fires too late (delivered via owner's UI sequence, not channel push)

**What goes wrong:** Owner clicks "remove collaborator" in Phase 34 UI → row deleted from `document_collaborators` → ... but if the client is not subscribed to its own collaborator row's DELETE event, the kick lands only on the next attempted write (which fails RLS). Worst case: idle user keeps the doc open for 5 minutes and never sees the kick because they're just reading.

**How to avoid:**
- **Subscribe to `postgres_changes` on `document_collaborators` filtered by `user_id=auth.uid()` AND `document_id={current}` from the moment the doc opens.** This is the canonical "kick within seconds" path.
- **Belt-and-suspenders:** When the client receives a Postgres-changes DELETE on its own row, emit `permission_revoked` immediately. Also catch on the next write's RLS-violation error.
- **Test path:** Owner removes collaborator → idle peer sees banner within 3 seconds. Fail this test = ship as bug.

### Pitfall 5: Spike harness measures lab wifi, not shared wifi (CONTEXT requirement)

**What goes wrong:** Most Playwright runs assume same-machine localhost or stable corporate wifi. The user's locked decision is "normal home/office shared wifi, not just clean lab wifi." A harness that measures localhost passes the speed bar trivially and falsely greenlights a transport that fails in production.

**How to avoid:**
- **Use Chromium DevTools Protocol network throttling** to simulate shared wifi: 5 Mbps down, 1 Mbps up, 50ms RTT, 5% packet loss.
- **Run the harness against a real Supabase project (not local emulator)** so the actual cluster's RTT is in play. Lab Supabase emulator latency is ~5ms; production is 30-150ms depending on region.
- **Run from a network with realistic upstream** (researcher's home wifi, not corporate ethernet) for at least one calibration run.

### Pitfall 6: `clientID` collision across browser instances (Phase 27 risk recurring)

**What goes wrong:** Yjs `Y.Doc.clientID` is a random integer assigned at Y.Doc construction. Two clients colliding on `clientID` produces silent operation duplication (Yjs's CRDT depends on `(clientID, clock)` uniqueness for identity). Probability is low but non-zero across many clients.

**How to avoid:**
- Phase 27 already has `Y.Doc({ guid: documentId, autoLoad: false })` — no `clientID` override, so Yjs uses its random default. Defaults are 32-bit, ~2^32 keyspace. Birthday-collision probability with 100 concurrent peers per doc is negligible (~10^-7).
- **Don't try to override `clientID` to a stable per-user-device id.** The whole point of `clientID` is uniqueness per Y.Doc lifecycle; stable ids break offline-reconnect merge semantics.
- For attribution, use `origin.userId` + `origin.deviceId` — `clientID` is purely for Yjs internal causality.

### Pitfall 7: Web (non-Electron) `deviceId` is unstable across cache clears

**What goes wrong:** Web browsers don't expose `os.hostname()`. The fallback is a random id stored in `localStorage`. Cache clear → new id → activity log shows the same user as "Mac (browser-A)" then "Mac (browser-B)" with no relation. Forensic value degrades.

**How to avoid:**
- **Tier 1 (Electron):** `os.hostname()` via IPC from main process to renderer. Truly stable.
- **Tier 2 (web, modern):** Stable per-browser-install id from `localStorage['device_id']`. If missing, generate UUID v4 and store. Format the label as "Web — {browser} on {os}" via UA parser.
- **Tier 3 (web, ephemeral / private):** Per-tab fallback id. Acknowledged-degraded; surfaced in Phase 33 device label rename UI as "Web (private — temporary device)".
- AUTH-06 (Phase 33) lets users rename device labels freely, so even imperfect default labels are recoverable.

### Pitfall 8: Validator emits `update_rejected` but client has already optimistically applied locally (drift)

**What goes wrong:** Local Y.Doc transaction → client optimistically renders → server rejects insert. The CRDT layer's local Y.Doc has the change; the server cluster does not. Other peers never see it. The originating client now drifts permanently from the server consensus.

**How to avoid:**
- **On `update_rejected`, surface the kicked-out banner AND drop the in-flight edit with explicit reason** ("This change wasn't saved because your access was removed.") per CONTEXT decision.
- **Do NOT roll back the local Y.Doc** — that violates the applyUpdate-only invariant from Phase 27 (Pitfall 5 from milestone PITFALLS.md). The doc stays open in read-only mode; the user closes it.
- The drift is acceptable because the doc is read-only post-kick; no further writes can happen, and the page reload (when the user closes it) clears the local Y.Doc state on the next load via the registry's `_evictForTest`-like cleanup hook (Phase 28 should add a `permission_revoked` cleanup path on registry release).

---

## Code Examples

Verified patterns from official sources.

### Y-protocols sync v1 message construction

```js
// Source: https://github.com/yjs/y-protocols/blob/master/sync.js
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

// Construct a sync message for an update bytes payload
function buildSyncMessage(updateBytes) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync
  syncProtocol.writeUpdate(encoder, updateBytes);
  return encoding.toUint8Array(encoder);
}

// Read an inbound message into the doc
function readSyncMessage(bytes, ydoc, origin) {
  const decoder = decoding.createDecoder(bytes);
  const messageType = decoding.readVarUint(decoder);
  if (messageType === 0) {
    const replyEncoder = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, replyEncoder, ydoc, origin);
    if (encoding.length(replyEncoder) > 1) {
      // The protocol wants us to send back a reply (e.g. syncStep2 in response to syncStep1)
      return encoding.toUint8Array(replyEncoder);
    }
  }
  return null;
}
```

### Supabase Realtime channel with broadcast events

```js
// Source: https://supabase.com/docs/guides/realtime/broadcast
const channel = supabase.channel(`yjs:${documentId}`, {
  config: { broadcast: { ack: false, self: false } },
});

channel
  .on('broadcast', { event: 'sync' }, ({ payload }) => {
    const bytes = base64ToUint8Array(payload.update);
    Y.applyUpdate(ydoc, bytes, REMOTE_REALTIME_ORIGIN);
  })
  .on('broadcast', { event: 'awareness' }, ({ payload }) => {
    const bytes = base64ToUint8Array(payload.awareness);
    awarenessProtocol.applyAwarenessUpdate(awareness, bytes, REMOTE_REALTIME_ORIGIN);
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      // Send syncStep1 to ask peers + server snapshot for any updates we don't have
      const stateVector = Y.encodeStateVector(ydoc);
      await channel.send({
        type: 'broadcast', event: 'sync_request',
        payload: { stateVector: uint8ArrayToBase64(stateVector), fromClientId: ydoc.clientID },
      });
    }
  });

// Local Y.Doc update fan-out to channel (echo-loop guarded via origin)
const REMOTE_REALTIME_ORIGIN = Object.freeze({ source: 'remote-realtime' });
ydoc.on('update', (update, origin) => {
  if (origin === REMOTE_REALTIME_ORIGIN) return; // do not re-broadcast inbound updates
  if (origin?.source === 'remote-bc') return;     // do not re-broadcast cross-tab updates (Phase 27 origin)
  channel.send({
    type: 'broadcast', event: 'sync',
    payload: { update: uint8ArrayToBase64(update), originClientId: ydoc.clientID },
  });
});
```

### Supabase auth.onAuthStateChange wiring (THE critical pattern)

```js
// Source: https://supabase.com/docs/reference/javascript/auth-onauthstatechange
// AND: https://github.com/supabase/realtime-js/issues/274 (the fix for the documented bug)
const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' && session?.access_token) {
    // CRITICAL: Realtime does NOT auto-pick-up refreshed token. Wire it manually.
    supabase.realtime.setAuth(session.access_token);
  }
  if (event === 'SIGNED_OUT') {
    // Refresh failed (revoked / password changed). Surface LoginExpiredBanner.
    showLoginExpiredBanner();
    detachAllProviders();
  }
});

// Cleanup on unmount
return () => subscription.subscription.unsubscribe();
```

### Postgres helper function for RLS (server-side validator core)

```sql
-- Source: https://supabase.com/docs/guides/database/postgres/row-level-security
-- Pattern: SECURITY INVOKER + STABLE for hot RLS subqueries.
CREATE OR REPLACE FUNCTION user_can_access_document(doc_id UUID, required_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE id = doc_id AND user_id = auth.uid()) THEN
    RETURN TRUE;
  END IF;
  -- (See Pattern 5 above for full role hierarchy.)
  RETURN EXISTS (
    SELECT 1 FROM document_collaborators
    WHERE document_id = doc_id AND user_id = auth.uid() AND role IN ('editor','owner')
  );
END;
$$;
```

### Hocuspocus + Supabase Auth onAuthenticate (fallback path)

```js
// Source: https://emergence-engineering.com/blog/hocuspocus-with-supabase
// Server-side, runs on the Hocuspocus Node host (NOT in this repo).
import { Server } from '@hocuspocus/server';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Server.configure({
  port: 1234,
  async onAuthenticate({ token, documentName }) {
    // Verify token signature against Supabase JWT secret (or JWKS for asymmetric keys).
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);
    const userId = decoded.sub;
    // Run user_can_access_document via service-role client (bypasses RLS for the lookup itself).
    const { data, error } = await supabaseAdmin.rpc('user_can_access_document', {
      doc_id: documentName,
      required_role: 'editor',
    }, { headers: { Authorization: `Bearer ${token}` } });
    if (error || !data) throw new Error('not authorized');
    return { user: { id: userId } };
  },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Supabase-js v1 implicit token-on-channel | v2.x explicit `realtime.setAuth(token)` after refresh | supabase-js 2.x ongoing — bug class persists 2024-2026 | Must wire manually, no auto-fix expected |
| Postgres `SECURITY DEFINER` RLS helpers | `SECURITY INVOKER` + `STABLE` | 2023+ Supabase RLS guide | DEFINER is dangerous (escalation); INVOKER + index is the correct hot path |
| Custom JWT verification in middleware | Postgres `auth.uid()` (RLS native) | Supabase Auth maturity 2023+ | Eliminates an entire class of bypass bug |
| `y-websocket` reference server | Hocuspocus (auth + persistence hooks) | 2022+ | Don't roll your own server |
| Client-side realtime token refresh timer | `onAuthStateChange` + `realtime.setAuth` | supabase-js 2.x | App-level timers cause [TOKEN_REFRESHED loop](https://github.com/supabase/supabase-js/issues/2126) |

**Deprecated/outdated:**
- `AlexDunmow/y-supabase` package: STACK.md anti-recommendation, not maintained, broadcast storm bug.
- `@y/websocket@4.0.0-0` pre-release: avoid pre-releases.
- v1 supabase-js token attachment: replaced by v2 session model.

---

## Open Questions

1. **Single Realtime channel for both sync + awareness, or two channels?**
   - What we know: y-protocols separates `messageSync` (type 0) and `messageAwareness` (type 1) at the encoder level, so one channel with two events works fine. Awareness is high-frequency (~30Hz cursor moves); sync is low-frequency (per-edit-commit).
   - What's unclear: whether co-locating high-frequency awareness + low-frequency sync on one channel hits Supabase's per-channel message rate cap during multi-peer drag sessions.
   - Recommendation: **Start with one channel, two event types.** Phase 28 spike measures rate. If awareness saturates, split to `yjs:${docId}:awareness` as a Phase 28 hardening; awareness has different lifecycle (ephemeral, no persistence) so the split is clean.

2. **Should the Postgres trigger emit `update_rejected` via NOTIFY/Realtime, or rely on client-side error catch?**
   - What we know: Both work. Server-side broadcast is more "correct" (the client knows even if its own request errored ambiguously). Client-side error catch is simpler.
   - What's unclear: Whether the trigger CAN cleanly call `pg_notify` for Realtime to pick up — Realtime Postgres-changes channels are bound to specific tables, not arbitrary NOTIFY.
   - Recommendation: **Use client-side error catch as primary** (works regardless of trigger NOTIFY ability). If the spike's owner-revokes-collaborator test shows a >5s gap between revoke and banner-fires, escalate to server-side broadcast via Edge Function or `pg_notify`+listener.

3. **Token refresh window — refresh proactively or wait for `TOKEN_REFRESHED` event?**
   - What we know: Supabase auto-refresh fires ~5 minutes before JWT expiry (default ~55min in to a 60min token). `TOKEN_REFRESHED` event arrives after the refresh.
   - What's unclear: Whether app-level "anticipate refresh" timers help or hurt.
   - Recommendation: **No app-level timers.** Trust auto-refresh. Hook `TOKEN_REFRESHED` and call `realtime.setAuth`. App-level timers cause the documented [TOKEN_REFRESHED loop](https://github.com/supabase/supabase-js/issues/2126).

4. **Hocuspocus deployment shape if it wins the spike (Fly.io, Railway, Vercel-incompatible, Supabase Edge Function in long-poll mode)?**
   - What we know: Hocuspocus is a stateful Node WebSocket server. Vercel doesn't support stateful WS. Cloudflare Workers Durable Objects could host it but adds another vendor.
   - What's unclear: Cost / complexity of a 1-2 instance Fly.io or Railway deployment. Realistic monthly cost: $20-50.
   - Recommendation: **Fly.io with sticky sessions** if Hocuspocus wins the spike. Document during the spike's ops-cost discussion.

5. **Web `deviceId` storage location — `localStorage` or `IndexedDB`?**
   - What we know: `localStorage` is synchronous, 5-10MB cap, present everywhere. `IndexedDB` is async, much larger, present everywhere modern.
   - What's unclear: Whether we want the deviceId to be more durable than localStorage (which clears on cache-clear).
   - Recommendation: **`localStorage` for the deviceId.** Cache clears are user-intentional acts that signal "I want to start fresh"; treating them as device boundaries is correct.

6. **Spike harness — Playwright multi-tab vs headless puppeteer fan-out vs scripted multi-Y.Doc replay?**
   - What we know: Playwright multi-tab simulates real-browser network; multi-Y.Doc replay isolates the CRDT layer from the network; puppeteer is similar to Playwright.
   - What's unclear: Whether 5 Playwright tabs on one machine produces realistic "5 peers on shared wifi."
   - Recommendation: **Hybrid.** (a) Playwright multi-tab as the primary user-facing acceptance path (the 4-5-peers test). (b) Scripted multi-Y.Doc replay (no DOM; just provider + Y.Doc) for high-rate stress (1000 ops/sec) to find the per-channel rate cap. Both runs against the same throttled-network Chromium profile.

7. **Should the spike also test Capacitor 8 (mobile) on the same harness?**
   - What we know: STACK.md says Yjs + y-indexeddb work on Capacitor identically. Supabase Realtime works in WKWebView.
   - What's unclear: Mobile JS engine is slower than desktop Chromium; CRDT computation may exceed budget on iOS Safari WebView.
   - Recommendation: **Out of scope for Phase 28.** Mobile is not in the v2.4 launch matrix per ROADMAP.md. Phase 32 hardening can add mobile if real customer demand emerges.

---

## Validation Architecture

> Phase 28 validates **transport latency, auth handshake correctness, validator rejection, RLS gating, and origin attribution**. The validation framework reuses Phase 27's existing `node --test` runner + Playwright debug harness. New work: a multi-peer load harness (Playwright + Supabase real cluster) plus pgTAP SQL tests for RLS.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node --test` (Node test runner, builtin) for unit + integration; `@playwright/test` `^1.58.2` for browser/multi-peer |
| Config file | `package.json` script `"test": "node --test 'tests/**/*.test.mjs'"` (existing); Playwright at `debug/playwright.config.mjs` |
| Quick run command | `npm test 2>&1 \| tail -20` |
| Full suite command | `npm test && npx playwright test --config debug/playwright.config.mjs` |
| Spike harness command | `node tests/phase28/transportSpikeBenchmark.mjs --transport=supabase --peers=5 --network=throttled` (NEW; planner finalizes) |
| RLS test command | `psql $SUPABASE_TEST_URL -f tests/phase28/rls/01_doc_yjs_updates_rls.sql` (NEW) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Origin payload includes `userId` from Supabase auth on every transaction | unit | `node --test tests/phase28/originBuilder.test.mjs` | ❌ Wave 0 |
| AUTH-01 | Server overrides client-claimed `origin.userId` with `auth.uid()` (forgery resistance) | integration (pgTAP) | `psql $SUPABASE_TEST_URL -f tests/phase28/rls/02_origin_userId_override.sql` | ❌ Wave 0 |
| AUTH-02 | `deviceId` derived from `os.hostname()` on Electron via IPC | unit | `node --test tests/phase28/deviceId.test.mjs` (mocks IPC) | ❌ Wave 0 |
| AUTH-02 | Web fallback: stable per-browser-install id stored in `localStorage` | unit | `node --test tests/phase28/deviceId.test.mjs` (web branch) | ❌ Wave 0 |
| AUTH-02 | `deviceId` lands in `doc_yjs_updates.origin->>'deviceId'` on insert | integration | Playwright e2e drawing → SQL assert | ❌ Wave 0 |
| Speed bar | 4-5 concurrent peers, mixed pen+drag+text, end-to-end <500ms p95, throttled wifi | spike harness | `node tests/phase28/transportSpikeBenchmark.mjs --peers=5 --network=throttled` | ❌ Wave 0 |
| Auth handshake | JWT carried on Realtime subscribe AND on every INSERT | unit + integration | Playwright + network HAR inspection | ❌ Wave 0 |
| Token refresh | Refresh mid-session does not break channel | integration | Playwright with mock-auth that fires `TOKEN_REFRESHED` mid-test | ❌ Wave 0 |
| Validator rejection | Non-collaborator JWT INSERT into `doc_yjs_updates` rejected | integration (pgTAP) | `psql -f tests/phase28/rls/03_non_collaborator_insert_rejected.sql` | ❌ Wave 0 |
| Validator rejection | Revoked collaborator's in-flight write triggers `update_rejected` event | Playwright | `npx playwright test debug/scenarios/phase28-revoke-flow.spec.mjs` | ❌ Wave 0 |
| RLS gating | SELECT on `doc_yjs_updates` from non-collaborator JWT returns zero rows | integration (pgTAP) | `psql -f tests/phase28/rls/04_select_gated_viewer.sql` | ❌ Wave 0 |
| Stub policy drop | Phase 27 stub policies dropped by exact name in Phase 28 migration | integration | `grep -c 'phase27_stub_deny_all' supabase/migrations/20260504*.sql` | ❌ Wave 0 |
| Banner UX (kicked-out) | Banner mounts with role=alert within 3s of revoke | Playwright | `npx playwright test debug/scenarios/phase28-kicked-out-banner.spec.mjs` | ❌ Wave 0 |
| Banner UX (login expired) | Banner appears on `SIGNED_OUT` after refresh failure | Playwright | `npx playwright test debug/scenarios/phase28-login-expired.spec.mjs` | ❌ Wave 0 |
| Read-only post-kick | Document stays open in read-only mode; not auto-bounced | Playwright | same as kicked-out scenario, additional assertions | ❌ Wave 0 |
| applyUpdate-only invariant (carried forward from Phase 27) | No `new Y.Doc(` outside `src/lib/collab/ydocRegistry.js` | unit | `node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` (existing — must stay green) | ✅ |

### Sampling Rate

- **Per task commit:** `npm test 2>&1 | tail -20` (must show baseline preserved + new Phase 28 unit tests pass, applyUpdate-only invariant green)
- **Per wave merge:** `npm test && npx playwright test --config debug/playwright.config.mjs --grep phase28` (full suite incl. multi-peer scenarios)
- **Phase gate (before `/gsd:verify-work 28`):**
  1. `npm test` green (no regressions)
  2. RLS pgTAP suite green: `psql $SUPABASE_TEST_URL -f tests/phase28/rls/run-all.sql`
  3. Spike harness benchmark report committed to `.planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` with per-prototype p50/p95/p99 latency, per-peer message rate, and the locked decision rationale
  4. Playwright phase28 scenarios green
  5. Manual UAT: actual user opens a doc as a collaborator, owner revokes, banner fires within 3 seconds, document goes read-only

### Wave 0 Gaps

- [ ] `tests/phase28/originBuilder.test.mjs` — covers AUTH-01 origin shape contract
- [ ] `tests/phase28/deviceId.test.mjs` — covers AUTH-02 Electron + web branches
- [ ] `tests/phase28/SupabaseYjsProvider.test.mjs` — unit tests for the custom adapter (encode/decode, echo guard, channel lifecycle)
- [ ] `tests/phase28/HocuspocusYjsProvider.test.mjs` — unit tests for the fallback adapter
- [ ] `tests/phase28/authSessionBridge.test.mjs` — covers `TOKEN_REFRESHED` → `realtime.setAuth` wiring + `SIGNED_OUT` detach
- [ ] `tests/phase28/transportSpikeBenchmark.mjs` — multi-peer harness driver
- [ ] `tests/phase28/rls/01_doc_yjs_updates_rls.sql` — pgTAP SELECT/INSERT gated on `user_can_access_document`
- [ ] `tests/phase28/rls/02_origin_userId_override.sql` — pgTAP trigger overwrites client-claimed userId
- [ ] `tests/phase28/rls/03_non_collaborator_insert_rejected.sql` — pgTAP non-collab JWT INSERT denied
- [ ] `tests/phase28/rls/04_select_gated_viewer.sql` — pgTAP SELECT denied for non-viewer JWT
- [ ] `tests/phase28/rls/run-all.sql` — pgTAP suite runner
- [ ] `debug/scenarios/phase28-revoke-flow.spec.mjs` — Playwright owner-revokes-collaborator flow
- [ ] `debug/scenarios/phase28-kicked-out-banner.spec.mjs` — Playwright banner UX
- [ ] `debug/scenarios/phase28-login-expired.spec.mjs` — Playwright login-expired UX
- [ ] `debug/scenarios/phase28-multi-peer-throttled.spec.mjs` — Playwright 5-peer throttled-wifi harness
- [ ] pgTAP install/setup if not present in `tests/` infra: `npm install --save-dev pgtap-supabase` (or use psql-only assertion pattern matching existing project conventions)
- [ ] `.planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md` (deliverable, written during the spike, committed to repo)

---

## Sources

### Primary (HIGH confidence)
- [Supabase Realtime Limits — 1MB payload limit verified](https://supabase.com/docs/guides/realtime/limits)
- [Supabase Realtime Broadcast docs — JSON payload + base64-binary pattern](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase Realtime Protocol — binary frame support at transport layer](https://supabase.com/docs/guides/realtime/protocol)
- [supabase/realtime — Phoenix Elixir cluster, channel architecture](https://github.com/supabase/realtime)
- [Supabase Auth onAuthStateChange — TOKEN_REFRESHED + SIGNED_OUT events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase Auth Advanced Guide — server-side JWT verification](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Supabase RLS — auth.uid() + user_can_access pattern + SECURITY INVOKER guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS Performance Best Practices — STABLE functions + indexed RLS subqueries](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [y-protocols PROTOCOL.md — sync v1 message types + lib0 encoding](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)
- [y-protocols sync.js source — writeUpdate / readSyncMessage canonical](https://github.com/yjs/y-protocols/blob/master/sync.js)
- [Yjs Fundamentals: Sync & Awareness — SyncStep1 / SyncStep2 walkthrough](https://medium.com/dovetail-engineering/yjs-fundamentals-part-2-sync-awareness-73b8fabc2233)
- [Hocuspocus Server Examples](https://tiptap.dev/docs/hocuspocus/server/examples)
- Project canonical references (HIGH — verbatim source of truth):
  - `.planning/research/SUMMARY.md`
  - `.planning/research/STACK.md`
  - `.planning/research/ARCHITECTURE.md`
  - `.planning/research/PITFALLS.md`
  - `.planning/research/FEATURES.md`
  - `.planning/phases/27-crdt-foundation/27-CONTEXT.md`
  - `.planning/phases/27-crdt-foundation/27-RECONCILIATION.md`
  - `.planning/phases/27-crdt-foundation/27-UI-SPEC.md`
  - `.planning/phases/27-crdt-foundation/27-02-PLAN.md` / `27-03-PLAN.md` / `27-04-PLAN.md`
  - `.planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md`
  - `CLAUDE.md` (Always-Protected list, gotchas)

### Secondary (MEDIUM confidence — issue tracker findings, blog posts)
- [supabase/realtime-js#274 — Realtime channel does not pick up refreshed token](https://github.com/supabase/realtime-js/issues/274) — defends Pitfall 1, the single most important auth bug class
- [supabase/supabase-js#1732 — Same bug class restated](https://github.com/supabase/supabase-js/issues/1732)
- [supabase/supabase-js#2126 — TOKEN_REFRESHED loop with ECC P-256 keys](https://github.com/supabase/supabase-js/issues/2126) — defends "no app-level refresh timers" rule
- [Emergence Engineering — Hocuspocus + Supabase Auth integration guide](https://emergence-engineering.com/blog/hocuspocus-with-supabase) — only well-documented Hocuspocus + Supabase pattern
- [supabase community discussion #37002 — Manual realtime token refresh](https://github.com/orgs/supabase/discussions/37002)
- [Sync Protocol DeepWiki](https://deepwiki.com/yjs/y-protocols/2.1-sync-protocol) — secondary corroboration of sync v1 frame structure

### Tertiary (LOW confidence — community references, flagged for caution)
- [AlexDunmow/y-supabase — reference implementation only, not for production](https://github.com/AlexDunmow/y-supabase) — STACK.md anti-recommendation
- [Discuss.yjs.dev — y-supabase: Too many message events bug thread](https://discuss.yjs.dev/t/y-supabase-too-many-message-events/2447) — informs spike's broadcast-storm test
- [PostgREST Authentication docs](https://docs.postgrest.org/en/v12/references/auth.html) — corroborates `auth.uid()` semantics

---

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — all dep choices locked by Phase 27 + STACK.md; no new packages on the recommended path. Hocuspocus version pinned at the spike's install time.
- **Architecture (custom Supabase adapter pattern):** HIGH — y-protocols sync v1 + base64-in-JSON-broadcast is the documented standard pattern. Channel topology mirrors the existing `useAnnotationCloudSync` Realtime channel-per-document shape.
- **Architecture (Hocuspocus fallback):** MEDIUM-HIGH — pattern is well-documented; only the deployment shape (Fly.io vs Railway vs other) is open.
- **Auth pitfalls:** HIGH — verified against Supabase issue tracker. The Realtime-doesn't-auto-refresh bug is well-documented across multiple issues 2024-2026.
- **Server-side validator:** MEDIUM — Postgres trigger pattern is canonical Supabase RLS guidance, but the specific shape (override `origin.userId`, emit `update_rejected`) is novel for this app and must be benchmarked during the spike.
- **Origin attribution:** HIGH — pattern derived from Phase 27's existing `REMOTE_BC_ORIGIN` precedent; the locked payload shape was specified verbatim in CONTEXT.md.
- **Validation architecture:** HIGH — reuses Phase 27's existing test framework (`node --test` + Playwright); only new test files are needed, no framework install.

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days — Yjs/Supabase Realtime/Postgres are stable; supabase-js 2.x token-refresh bug class is well-documented but unfixed at the time of research; if Phase 28 implementation slips past 2026-05-27, re-verify the supabase-js / @hocuspocus/provider versions and re-check the open issue tracker for any new auto-fix to the realtime-token-refresh bug class — that single fix would simplify Pattern 4 substantially)
