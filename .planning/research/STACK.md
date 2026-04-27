# Stack Research — v2.4 Multi-User Collaboration (CRDT Rebuild)

**Domain:** Real-time collaborative editing layer bolted onto an existing single-user PDF annotation app
**Researched:** 2026-04-26
**Confidence:** HIGH (Yjs core + persistence) / MEDIUM (transport layer — see decision matrix) / HIGH (anti-recommendations)

---

## Executive Recommendation (Read This First)

**Adopt Yjs as the CRDT engine.** Use the standard Yjs ecosystem packages (`yjs`, `y-protocols`, `y-indexeddb`) for the CRDT, awareness, and offline persistence layers — these are not negotiable because they are part of Yjs itself. They are MIT-licensed, mature, actively maintained (yjs `13.6.30` published March 2026), and have zero dependencies that conflict with Fabric 5.5.2 / React 18 / Electron 25 / Vite 5.

**The only real architectural decision is the transport layer.** Three viable shapes, in order of recommendation for this specific stack:

1. **Custom thin Supabase Realtime Broadcast adapter** (RECOMMENDED) — ~150-300 LOC. Carries Yjs binary update payloads over Supabase's existing WebSocket infrastructure as base64-encoded broadcast messages. No new server, reuses existing auth/RLS, billing remains Stripe-only.
2. **Self-hosted Hocuspocus on a small Node service** (FALLBACK) — battle-tested, MIT, but adds an ops surface (Node WebSocket server, scaling, deployment) that the project does not currently have.
3. **Liveblocks Yjs / Tiptap Cloud / y-sweet** (REJECTED for v2.4) — managed services, but adds a third-party billing dependency on top of Stripe + Supabase, splits the source-of-truth, and creates SOC compliance + data-residency complications for a Stripe-billed commercial app.

**Do NOT adopt the existing `AlexDunmow/y-supabase` package as-is** — explicitly marked "not recommended for production" by its author, has known message-flooding bugs, and was last meaningfully updated in 2023. Its design (one realtime channel per Y.Doc, postgres-row-per-update) is a starting reference for what to write ourselves, not something to depend on.

---

## Recommended Stack

### Core CRDT Layer — REQUIRED

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `yjs` | `^13.6.30` | CRDT engine: shared types (Y.Doc, Y.Map, Y.Array, Y.Text), conflict-free merge, binary update encoding, per-user `Y.UndoManager` | Industry standard CRDT for collaborative apps — used by Tiptap, Liveblocks, Atlassian, Jupyter, Notion-likes. MIT. ~10kB gzipped. Mature (since 2015). Actively maintained — `13.6.30` released March 2026. Drop-in compatible with React 18 / Vite 5 / Electron — no native deps, pure ESM. |
| `y-protocols` | `^1.0.7` | Binary encoding protocols for sync, **awareness/presence**, and history. Provides `Awareness` class for cursors/selections/online-status | Required peer of yjs. Awareness protocol (`y-protocols/awareness`) is exactly what the existing partial presence wiring should be migrated to — schemaless JSON state per client with 30s heartbeat-based offline detection built in. MIT. |
| `y-indexeddb` | `^9.0.12` | IndexedDB persistence provider — caches Y.Doc state in the browser/Electron renderer for instant load + offline edits | Replaces the existing `localStorage` offline queue. IndexedDB has effectively unlimited quota in Electron (vs `localStorage`'s 5-10MB) and stores binary Y.js updates natively without base64 inflation. Auto-merges queued offline writes when the doc reconnects. MIT. |

### Transport Layer — CHOOSE ONE

| Option | Status | When to Use |
|--------|--------|-------------|
| **Custom Supabase Realtime Broadcast adapter** (RECOMMENDED) | Build in Phase X, ~150-300 LOC | Default. Reuses existing `@supabase/supabase-js@^2.81.1`. Zero new infra. |
| `@hocuspocus/server` `^2.13.x` + `@hocuspocus/provider` `^2.13.x` | MIT, mature, actively maintained by Tiptap (Ueberdosis) | If we ever need server-side awareness validation, document-level access control beyond RLS, or document size > 100KB where broadcast frame limits hurt. |
| `y-websocket@3.0.0` + custom Node server | Stable, but the bare provider is intentionally minimal | Only if we want full control of the WebSocket protocol and don't need Hocuspocus's auth/persistence hooks. Almost never the right choice over Hocuspocus. |

**Why custom Supabase adapter is the right default:**

- Supabase Realtime v2.0+ supports **binary WebSocket frames** explicitly (per `supabase.com/docs/guides/realtime/protocol`), which means Yjs `Y.encodeStateAsUpdate()` Uint8Array payloads can ride directly without JSON-stringifying them.
- The broadcast channel model (`channel.send({ type: 'broadcast', event: 'yjs-update', payload: { update: base64 } })`) maps cleanly onto Yjs's `provider.on('update', cb)` interface.
- We already have authenticated Supabase clients in every renderer — no new auth tokens, no new CORS setup.
- Document-of-record persistence stays in Postgres (`document_annotations` continues to store the materialized annotation set; a new `document_yjs_updates` append-only log stores the binary patches for cold-start replay).
- One Supabase Realtime channel per `document_id` — model already matches how the app thinks about scope.

**Anti-recommendations (transport):** see "What NOT to Use" table below.

### Persistence-of-Record (Server) — REUSE EXISTING

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@supabase/supabase-js` | `^2.81.1` (existing) | Postgres + Realtime + Auth — unchanged | Already in the stack. v2.4 adds **two** new tables (no breaking schema changes): `document_yjs_updates` (append-only Yjs binary patches with `user_id`, `device_id`, `created_at`, `seq`) and `document_yjs_snapshots` (periodic compacted state for fast cold-load). RLS rules on both tables mirror the existing `document_annotations` policies. |

### Authorship & Activity Log — NEW SUPPORTING TABLES (no new libraries)

The "who did what when on which device" requirement is satisfied by writing alongside the Yjs update log, not by a new library:

- Every Yjs `Y.Doc.transact(fn, origin)` call passes an `origin` object `{ userId, deviceId, sessionId, clientId }`.
- A document `update` listener writes one row per remote-bound update to `document_yjs_updates` with `(user_id, device_id, session_id, encoded_update, created_at)`.
- The activity log UI is just a Postgres query — no separate event-sourcing library, no Kafka, no audit-log service.

### Per-User Undo/Redo — NATIVE TO YJS

`Y.UndoManager` accepts a `trackedOrigins: Set` constructor option. Instantiate one `UndoManager` per local user, wired to track only that user's `clientId`. Each user's Cmd+Z undoes only their own changes — this is a documented Yjs pattern, not custom code.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `vite-plugin-node-polyfills` (already in devDeps `^0.24.0`) | `lib0` (Yjs's encoding lib) occasionally pulls in Node-style imports under certain bundler configs | Already installed. No new config expected — Yjs ships modern ESM and works clean under Vite 5. |
| Existing `ws@^8.18.3` (already in devDeps) | Only matters if we choose the Hocuspocus fallback (Node WS server) | No-op for the Supabase Broadcast adapter path. |

---

## Installation

```bash
# Core CRDT layer — required regardless of transport choice
npm install yjs@^13.6.30 y-protocols@^1.0.7 y-indexeddb@^9.0.12

# Transport — RECOMMENDED PATH (custom Supabase adapter, no new packages):
# (no install — adapter is a hand-written ~200 LOC module under src/lib/collab/SupabaseYjsProvider.js)

# Transport — FALLBACK PATH (only if Phase X discovers Supabase broadcast can't carry the load):
# npm install @hocuspocus/provider@^2.13.6
# (server install happens out-of-tree on whatever node host we deploy to)

# No new dev dependencies needed
```

**Bundle size impact:**
- `yjs` ~10kB gzipped
- `y-protocols` ~3kB gzipped
- `y-indexeddb` ~1.5kB gzipped
- Total cost to ship: **~15kB gzipped**, all tree-shaken under Vite 5.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Yjs | **Automerge 2.x** | If we wanted JSON-Patch-like document semantics and richer historical query without `Y.UndoManager` boilerplate. Rejected because Automerge's bundle (~150-300kB WASM) is 10-20x larger than Yjs and the Y.Map / Y.Array API is a closer match to our existing per-annotation row model. |
| Yjs | **Loro** (Rust CRDT, 2024+) | Newer, faster than Yjs in some benchmarks, supports rich history. Rejected for v2.4 because the JS ecosystem is immature, the WASM bundle is larger, and the docs/community are not at Yjs's level. Re-evaluate in 2027 if Loro reaches Yjs's maturity. |
| Custom Supabase Broadcast adapter | **Hocuspocus self-hosted** | If broadcast payload size becomes a problem (>3MB updates, sustained >50 updates/sec), or we need server-side awareness validation, or document-level ACLs we can't express in Postgres RLS. Hocuspocus is the right second choice — MIT, battle-tested, persistence hooks pluggable. |
| Custom Supabase Broadcast adapter | **Liveblocks Yjs** | If we wanted to outsource collab entirely and accept a third-party billing dependency. Rejected because: (a) we're already paying Supabase + Stripe; (b) Liveblocks would split the source-of-truth between their edge KV and our Postgres; (c) data-residency / SOC concerns for an engineering-firm customer base. |
| Custom Supabase Broadcast adapter | **y-sweet** (Jamsocket) | S3-backed Yjs server, cheap at very large doc counts. Rejected because we already have a Postgres source-of-truth and don't want a second blob store to back up. |
| `y-indexeddb` | **`y-leveldb` in Electron main process** | RxDB recommends running storage in the Electron main process, not the renderer. Considered — but Yjs IndexedDB in the renderer is the standard Yjs pattern, IndexedDB in Chromium has effectively unlimited quota, and pushing storage to main adds IPC latency on every Y.Doc update. y-indexeddb is the right call. |
| Native `Y.UndoManager` | Custom event-log undo | Rejected — `trackedOrigins` is exactly designed for this multi-user case; rebuilding it would replicate ~600 LOC of Yjs internals. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`AlexDunmow/y-supabase`** package | Author's own README says "not recommended for production." Last meaningful commit 2023. Known issue thread "y-supabase: Too many message events" (`discuss.yjs.dev/t/2447`) shows broadcast storm bug. Reuses Postgres rows-per-update model that we'd want to redesign anyway for our snapshot+log shape. | Hand-write a thin ~200 LOC adapter on `@supabase/supabase-js` Realtime Broadcast. Use y-supabase as a *reference*, not a dependency. |
| **Fabric.js 6.x upgrade as part of v2.4** | Explicitly out of scope per CLAUDE.md "Always Protected" + PROJECT.md "Fabric.js: Stay on 5.5.2." No CRDT work requires Fabric 6. | Stay on `fabric@^5.5.2`. Yjs is rendering-engine-agnostic — it doesn't care whether the SVG layer or Fabric edit canvas is the consumer. |
| **`@y/websocket@4.0.0-0`** (the new scoped pre-release) | Pre-release, `-0` suffix, last published a month ago in early-development state. | If we go Hocuspocus, use `@hocuspocus/provider@^2.13.x`. If we go custom, no WS provider package needed. |
| **`y-websocket@3.0.0`** as the production transport | Bare-bones reference provider — no auth, no persistence hooks, you have to wrap a Node server yourself anyway. Last published a year ago. | Either custom Supabase adapter (preferred) or Hocuspocus (which uses `y-websocket` internals but adds the missing pieces). |
| **`localStorage` offline queue** (existing v2.3 implementation) | 5-10MB quota cap, synchronous (blocks main thread on writes), JSON-only (forces base64 inflation of binary Y updates), no transactional semantics. | `y-indexeddb` provider — async, effectively unlimited quota, native binary, transactional, auto-merges on reconnect. Keep `localStorage` only for non-doc UI prefs. |
| **Postgres-row-per-Yjs-update without snapshot compaction** | After a few months of edits a hot document accumulates 10K+ update rows; cold load becomes O(N) update applications. | Append-only `document_yjs_updates` log + periodic `document_yjs_snapshots` compaction job (e.g., every 100 updates or every 24h, take a `Y.encodeStateAsUpdate()` snapshot, then prune updates older than the snapshot). Standard Yjs pattern. |
| **Liveblocks / Tiptap Cloud / y-sweet hosted services** for v2.4 | Adds a third recurring vendor bill on top of Supabase + Stripe. Splits doc state across two systems. Data-residency / SOC-2 audit surface grows. | Self-managed Yjs over Supabase Broadcast. Re-evaluate if we ever cross 100+ concurrent docs per minute or need an SLA we can't carry. |
| **Last-write-wins upserts on `document_annotations` (the existing v2.3 model)** | Cannot represent simultaneous edits to the same annotation by two users. Loses authorship granularity below the row level. Cannot do per-user undo. | Yjs CRDT operations on a Y.Doc per document. Materialize the resulting state into `document_annotations` for read-only consumers (PDF export, search, the existing single-user code paths) but treat the Y.Doc + update log as the source of truth. |
| **Custom OT (Operational Transform)** | OT requires a central authoritative server to sequence ops; Yjs CRDT does not. Building OT in 2026 over an existing CRDT-friendly stack is a 6-12 month rebuild we don't need. | Yjs. Full stop. |

---

## Stack Patterns by Variant

**If we ship Supabase Broadcast adapter (RECOMMENDED — default v2.4 path):**
- `SupabaseYjsProvider` class implements: `connect`, `disconnect`, listens to local `Y.Doc.on('update', (update, origin) => broadcast)`, listens to remote broadcasts and applies via `Y.applyUpdate(doc, update, 'remote')`.
- One Realtime channel per `document_id`. Channel events: `yjs-sync-step-1` (request), `yjs-sync-step-2` (state vector reply), `yjs-update` (incremental), `awareness-update`.
- Cold-load path: query `document_yjs_snapshots` for latest snapshot → `Y.applyUpdate` → query `document_yjs_updates` after snapshot's `seq` → apply each → join broadcast channel.
- Persistence path: every Y.Doc `update` event → write one row to `document_yjs_updates` with origin metadata → broadcast.
- Awareness: separate Realtime channel event (`awareness-update`) carrying `y-protocols/awareness` encoded state.

**If we fall back to Hocuspocus (only if Phase X benchmarks find Broadcast can't carry the load):**
- Run `@hocuspocus/server` on a small Node host (Fly.io / Railway / a Supabase Edge Function in long-poll mode).
- Hocuspocus persistence hook → write through to Supabase Postgres on every doc-update flush.
- Renderer uses `@hocuspocus/provider` instead of the custom Supabase adapter.
- Auth: pass Supabase JWT in the WebSocket connection params; verify in Hocuspocus's `onAuthenticate` hook.

**If document size grows to >3MB or we hit Realtime broadcast frame limits:**
- Periodic snapshot compaction in `document_yjs_snapshots` becomes mandatory rather than optional.
- Consider chunking large updates across multiple broadcast messages with a sequence header. (Yjs `encodeStateAsUpdate` rarely produces >1MB outputs in practice for annotation workloads.)

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `yjs@^13.6.30` | React 18.2 ✓, Vite 5.2 ✓, Electron 25 ✓, Fabric 5.5.2 ✓ | Pure ESM, zero native deps, framework-agnostic. No conflict surface. |
| `y-protocols@^1.0.7` | yjs `^13.6.x` (peer) | Tightly coupled to Yjs major; bumps in lockstep. |
| `y-indexeddb@^9.0.12` | yjs `^13.6.x` (peer), Chromium-based runtimes (Electron 25 = Chromium 114, IndexedDB v3 supported) | Works in Electron renderer. Do not run in Electron main process — use renderer per Yjs convention. |
| `@supabase/supabase-js@^2.81.1` | Realtime broadcast binary frames added in Realtime v2.0 (verified via `supabase.com/docs/guides/realtime/protocol`) | Confirmed binary payload support. JWT auth flows unchanged. |
| `@hocuspocus/provider@^2.13.x` (fallback only) | yjs `^13.6.x`, Y.Doc, browser WebSocket | Fabric 5.5.2 has no interaction with this layer. |
| Capacitor 8 (iOS/Android targets) | yjs ✓, y-indexeddb ✓ (WKWebView IndexedDB), `@supabase/supabase-js` ✓ | Yjs runs identically on Capacitor WebView — same JS engine. y-indexeddb works under WKWebView and Android System WebView. No platform-specific shim needed. |

**Known compatibility risks (verified or flagged):**

- **Vite + lib0 ESM resolution** — Yjs's encoding lib (`lib0`) historically had occasional `vite dev` issues with certain `import.meta` patterns. Current `lib0` versions ship clean ESM and work under Vite 5. Already-installed `vite-plugin-node-polyfills@^0.24.0` is sufficient if any polyfill warnings appear.
- **Electron 25 IndexedDB quota** — Chromium 114 grants effectively unlimited IndexedDB quota for `file://` and packaged-app origins. No quota bumps needed.
- **Capacitor iOS WKWebView IndexedDB** — supported, but capped at ~50MB per origin without special entitlements. For mobile, consider a snapshot-only mode (apply server snapshot + recent updates, skip the long-tail `y-indexeddb` cache) if doc histories grow large.
- **Fabric 5.5.2 ↔ Yjs** — zero direct interaction. Yjs lives at the data layer; Fabric lives at the edit-render layer. The bridge is the existing `annotationsByPage` state shape, which v2.4 will derive from a `Y.Map<page, Y.Map<annotationId, Y.Map<...>>>` instead of from React state.

---

## Integration Points (How This Plugs Into Existing Code)

1. **Replace 800ms-debounced upsert push** (`src/lib/sync/*` per the milestone context) with Y.Doc `update` event handlers that:
   - Write to `y-indexeddb` (instant local persistence)
   - Send via `SupabaseYjsProvider` to the Realtime channel (live broadcast to peers)
   - Append to `document_yjs_updates` Postgres log (durable record, cold-load source)
2. **Replace per-row LWW upsert** with materialized projection — a Postgres trigger or scheduled job re-derives `document_annotations` from the latest `document_yjs_snapshots` for backwards compatibility with the existing single-user read paths (PDF export, search, mini-map).
3. **Per-tab session id** — already exists per the milestone context. Becomes the `sessionId` field of the Yjs transaction `origin` object.
4. **Fabric edit canvas commit path** — instead of `setAnnotationsByPage(...)`, the commit calls `doc.transact(() => { yMapForPage.set(annotationId, encodedAnnotation) }, { userId, deviceId, sessionId })`. The CRDT layer fires the update event, persistence + broadcast happen transparently.
5. **Existing `migration` of stranded local annotations** — runs once per (user, document) on first v2.4 load: reads existing `document_annotations` rows, wraps them in a Y.Doc, encodes the initial state, writes the first `document_yjs_snapshots` row. Migration is idempotent.
6. **Presence indicators** (already partially wired) — switch to `y-protocols/awareness`. Each client sets `awareness.setLocalStateField('user', { id, color, cursor })` and listens on `awareness.on('change', ...)` for remote state changes.

---

## License Compatibility (commercial Stripe-billed app)

| Package | License | Commercial use |
|---------|---------|----------------|
| `yjs` | MIT | ✓ unrestricted, no SaaS clause, no AGPL contamination |
| `y-protocols` | MIT | ✓ |
| `y-indexeddb` | MIT | ✓ |
| `@hocuspocus/server` (fallback) | MIT | ✓ |
| `@hocuspocus/provider` (fallback) | MIT | ✓ |
| `@supabase/supabase-js` | MIT | ✓ already shipped |

Yjs's author asks for a moral sponsorship if you commercialize on top of his work — **this is voluntary, not a license obligation**. Recommend budgeting a small annual sponsor amount (Open Collective tier) as goodwill, similar to how the Fabric.js sponsorship is treated. No legal risk if we don't.

**No copyleft / AGPL packages enter the dependency tree under this stack.** Safe for proprietary commercial distribution and the existing Stripe-billed model.

---

## What Is Explicitly NOT Being Added

To avoid scope creep into adjacent collaboration features:

- **Rich-text editor** (Tiptap, Lexical, Slate) — out of scope. Annotations are not a rich-text document. Yjs is being used as a generic CRDT, not as the substrate for an editor.
- **Operational Transform layer** — superseded by Yjs.
- **Custom WebRTC mesh transport** (`y-webrtc`) — peer-to-peer is incompatible with the auth/persistence-of-record model and impossible behind enterprise NAT. Skip it.
- **Separate audit-log database** — the `document_yjs_updates` append-only Postgres table IS the audit log. No Kafka/Redpanda/event-store needed.
- **Self-hosted Node WebSocket server** — only added if/when Supabase Broadcast adapter cannot carry the load (FALLBACK path).
- **New auth provider** — Supabase Auth + RLS continues to gate every Realtime channel, every Postgres row, every Yjs update.

---

## Sources

### Authoritative (HIGH confidence)
- [yjs on npm — `13.6.30` published 2026-03-14](https://www.npmjs.com/package/yjs)
- [Yjs Releases — GitHub](https://github.com/yjs/yjs/releases)
- [Yjs Docs — License (MIT)](https://docs.yjs.dev/license)
- [Yjs Docs — Awareness & Presence](https://docs.yjs.dev/getting-started/adding-awareness)
- [Yjs Docs — Y.UndoManager (trackedOrigins for per-user undo)](https://docs.yjs.dev/api/undo-manager)
- [Yjs Docs — Offline Editing / y-indexeddb](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [y-indexeddb on GitHub](https://github.com/yjs/y-indexeddb)
- [y-protocols on npm — `1.0.7`](https://www.npmjs.com/package/y-protocols)
- [Supabase Realtime Protocol — binary frame support](https://supabase.com/docs/guides/realtime/protocol)
- [Supabase Realtime Broadcast docs](https://supabase.com/docs/guides/realtime/broadcast)
- [Hocuspocus on GitHub (MIT, MIT-licensed Yjs WS backend)](https://github.com/ueberdosis/hocuspocus)
- [@hocuspocus/server on npm](https://www.npmjs.com/package/@hocuspocus/server)

### Reference (MEDIUM confidence — community / discussion)
- [AlexDunmow/y-supabase — flagged "not recommended for production"](https://github.com/AlexDunmow/y-supabase)
- [Yjs Community — "Supabase for yjs" discussion thread](https://discuss.yjs.dev/t/supabase-for-yjs/1480)
- [Yjs Community — "y-supabase: Too many message events" bug thread](https://discuss.yjs.dev/t/y-supabase-too-many-message-events/2447)
- [Supabase Discussion #27105 — Tiptap/YJS Collaborative Editing with Supabase Realtime](https://github.com/orgs/supabase/discussions/27105)
- [Liveblocks blog — Liveblocks Yjs (managed alternative considered + rejected)](https://liveblocks.io/blog/introducing-liveblocks-yjs)
- [y-sweet-supabase-demo (Jamsocket)](https://github.com/jamsocket/y-sweet-supabase-demo)

### Internal context
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/package.json` — current locked versions verified (`fabric@^5.5.2`, `react@^18.2.0`, `vite@^5.2.0`, `electron@^25.2.1`, `@supabase/supabase-js@^2.81.1`, `@capacitor/*@^8.3.1`)
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/.planning/PROJECT.md` — Fabric 5.5.2 lock, SVG display + Fabric edit-only architecture
- `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/CLAUDE.md` — Always-Protected file list (App.jsx, PageAnnotationLayer.jsx, package.json, vite.config.js)

---

*Stack research for: v2.4 multi-user collaboration on existing PDF annotation app*
*Researched: 2026-04-26*
*Confidence: HIGH on core Yjs trio + persistence; MEDIUM on transport (custom Supabase adapter is RECOMMENDED but unbuilt — Phase X spike will validate); HIGH on anti-recommendations.*
