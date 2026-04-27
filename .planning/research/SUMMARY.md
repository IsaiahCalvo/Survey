# Research Summary — v2.4 Multi-User Collaboration (CRDT Rebuild)

_Synthesizes STACK.md / FEATURES.md / ARCHITECTURE.md / PITFALLS.md into a single decision document for the roadmapper._

## Executive Summary

Adopt Yjs (`yjs@^13.6.30` + `y-protocols@^1.0.7` + `y-indexeddb@^9.0.12`) as the CRDT engine, store binary updates in Supabase Postgres (`bytea`), use `Y.Awareness` for ephemeral presence, ship per-user `Y.UndoManager` with `trackedOrigins` scoping. Every user-stated requirement (per-annotation authorship + device, per-user undo that never erases collaborator work, real concurrent collaborators, same-user-multi-device parallel/sequential, offline-first with auto-merge, "pick up where you left off") maps directly onto documented Yjs primitives plus a thin layer of app glue. The four research dimensions converge unusually cleanly — STACK/FEATURES/ARCHITECTURE/PITFALLS all point at the same shape of system. The disagreement is narrow.

The single highest-risk decision is the transport layer: a custom Supabase Realtime Broadcast adapter (~150-300 LOC, reuses existing infra, billing stays Supabase + Stripe) versus self-hosted Hocuspocus (battle-tested, MIT, but adds a Node WebSocket service to deploy/scale/monitor). STACK explicitly recommends the custom adapter as the default; ARCHITECTURE agrees but frames it as "Option B" of three; PITFALLS calls the choice itself the multi-month-detour-either-way risk and demands a 1-week prototype spike before commitment. Server-side update validation (RLS-vs-CRDT mismatch) is the strongest structural argument for Hocuspocus and is unresolved on the Supabase-custom path — the spike must answer whether a Postgres function or Edge Function can gate `INSERT INTO doc_yjs_updates` against current RLS state.

The risk profile is dominated by one fact: the previous simple-sync system bled data through six well-documented failure modes, and the new CRDT layer must defend against those failure modes by construction, not by convention. PITFALLS catalogs 22 distinct pitfalls — five CRITICAL (migration partial-state, multi-tab corruption via `yjs/y-indexeddb#25`, RLS-vs-CRDT mismatch, echo loop, 1-second verify-wipe regression). Mitigations are known. The roadmap must be sequenced so each critical pitfall has an explicit phase that owns its prevention, with Playwright assertions baked into acceptance criteria — not bolt-on at the end. Phase 3 (the Yjs ↔ Fabric binding) carries 4 critical/high pitfalls converging in one place; that phase needs the heaviest planning load.

## Convergence (where all four dimensions agree — high-confidence path)

1. **Yjs is the CRDT engine** — all four files; no viable alternative for v2.4.
2. **Per-user undo via `Y.UndoManager` with `trackedOrigins`** — Figma pattern, native Yjs primitive.
3. **`Y.Awareness` for presence; never put cursors/selections in Y.Doc**.
4. **One Y.Doc per PDF, registry-keyed by document_id**, mounted at document-open boundary not App root.
5. **`y-indexeddb` replaces `localStorage` as offline-first cache**.
6. **Persist updates as `bytea` in Postgres** — never TEXT/JSONB.
7. **Highlights stay on legacy path through v2.4** — only non-highlight annotations enter the Y.Doc (Excel-sync risk).
8. **Silent merge on reconnect; no conflict modals**.
9. **Authorship hover, not persistent color halos** — construction markup colors carry semantic meaning.
10. **Device attribution as first-class differentiator** — no major collab tool ships this.

## Open Questions (where research dimensions diverge)

1. **Transport layer**: custom Supabase adapter vs Hocuspocus — must be decided in Phase 2 with a hard 1-week timebox spike.
2. **Initial-sync mechanism**: encoded state-as-update + delta sync vs append-only update log replay from `seq`. Both work; compaction strategy must be picked in Phase 1.
3. **Migration sequencing**: ARCHITECTURE proposes "advisory-locked first-open backfill"; PITFALLS demands two-phase dual-write era + sealed cutover. Roadmap needs Phase 4 (dual-write) AND Phase 5 (cutover seal) as distinct phases.
4. **Activity log location**: Postgres, not Y.Doc. Schema in Phase 1; consumption in Phase 7.
5. **Server-side update validator**: strongest structural argument for Hocuspocus. Phase 2 spike must answer whether Postgres function / Edge Function can gate `INSERT` on current RLS state.
6. **Multi-tab safety**: Web Locks API election required in Phase 1, not deferred.

## Recommended Stack

Yjs core (`yjs` + `y-protocols` + `y-indexeddb`), MIT, ~15kB total gzipped, drop-in compatible with React 18 / Vite 5 / Electron 25 / Fabric 5.5.2. Yjs lives at the data layer, Fabric/SVG at rendering — the existing v2.0+ JSON shape (`annotationsByPage`, `callouts`) becomes a derived view of Y.Doc state. Transport layer contested between custom Supabase adapter (~150-300 LOC) and Hocuspocus self-hosted; Phase 2 spike decides. Persistence: new tables `doc_yjs_updates (bytea)` (append-only log) + `doc_yjs_state (bytea)` (compacted snapshots) + `activity_log` (server-authoritative). Existing `document_annotations` table preserved during cutover, deprecated for non-highlights post-v2.4. **Anti-recommendations**: AlexDunmow/y-supabase (broken), Fabric 6.x upgrade (out of scope), Excel-style whole-annotation LWW, custom OT, Liveblocks/Tiptap Cloud/y-sweet (third-party billing, splits source-of-truth).

## Expected Features

**Must have (v2.4.0 launch):** per-annotation authorship + timestamp data model, authorship hover tooltip, per-user undo (Figma pattern via `trackedOrigins`), silent merge on reconnect (LWW per property), offline editing with auto-resync, activity log + filterable sidebar, 4-role permissions (Owner/Editor/Commenter/Viewer), mutation queue with idempotency keys.

**Differentiators (also v2.4.0 launch):** device attribution on every edit (no major collab tool ships this — first-class differentiator for same-user-multi-device), "Where am I picking up?" cross-device resume banner (almost free given activity log), sync-state toast.

**Defer to v2.4.x:** CSV export of activity log, per-annotation right-click "show history," renameable device labels, sync state in title bar.

**Anti-features (ship as explicit non-goals):** live cursors, conflict resolution modals, per-annotation locks, per-user color halos, comment threads, branching/suggestion mode, real-time character-level merge in text annotations.

## Architecture Approach

Wrap the CRDT around the existing display layer; do not rewrite it. The v2.0+ architecture (SVG renders from JSON, Fabric mounts only during edit, `zoomGeneration` signal contract) is treated as load-bearing and immutable. The CRDT layer sits *under* `App.jsx`'s state setters: `useAnnotationsCRDT` produces the same `{ annotationsByPage, callouts }` shape, derived from Y.Doc via `useSyncExternalStore` over `observeDeep`. Setters become `ydoc.transact(() => yMap.set(...), origin)` calls. SVG and Fabric never learn about Yjs.

**Major components:** `<YDocProvider docId>`, `useAnnotationsCRDT`, `crdtAnnotationBridge.js`, `crdtUndoManager.js`, custom Supabase Yjs provider (or Hocuspocus pending Phase 2 spike), `Y.Awareness` channel, Postgres tables `doc_yjs_updates` + `doc_yjs_state` + `activity_log`, migration utilities `crdtBackfill.js`.

## Critical Pitfalls (top 5 — any one causes data loss or security breach)

1. **Migration partial-state** — clients on old code-path keep writing legacy rows during rollout. Fix: two-phase dual-write era with `migrated_at` seal flag; idempotent backfill keyed by `client_anno_id`. **No "diff between cloud and local means delete" anywhere — that was the simple-sync killer.**
2. **y-indexeddb multi-tab corruption** (`yjs/y-indexeddb#25`) — two tabs on same Y.Doc duplicate updates. Fix: Web Locks API election before `IndexeddbPersistence`.
3. **Y.Doc vs RLS mismatch** — RLS protects rows, CRDTs protect convergence; orthogonal. Removed collaborator's local Y.Doc keeps accepting edits silently rejected on flush. Fix: server-side update validator + `permission_revoked` event + forced local Y.Doc destroy + IndexedDB wipe.
4. **Echo loop** — local Fabric event → Y.Map → observer fires → applies to Fabric → fires `object:modified` → loop. Fix: mandatory transaction-origin pattern, all observers short-circuit on `event.transaction.origin?.source === 'local-fabric'`, plus `applyingRemote` flag mute.
5. **1-second verify-wipe regression** — naive "rehydrate from server snapshot" replaces local Y.Doc state, wiping in-flight edits. Simple-sync failure in CRDT clothing. Fix: always `Y.applyUpdate(doc, update)`, never replace.

## Roadmap Implications

Eight phases. Phase 3 carries the heaviest planning load.

**Phase 1: CRDT Foundation** — schema, registry, snapshot architecture, applyUpdate-only rule, license CI gate. Defends pitfalls 1, 2, 5, 10, 12, 15, 17, 20, 21, 22.

**Phase 2: Transport + Auth + Server Validator (TIMEBOX SPIKE)** — 1-week prototype spike (custom Supabase adapter vs Hocuspocus), server-side update validator, RLS on new tables. Defends pitfalls 3, 14, 15, 16.

**Phase 3: Yjs ↔ Fabric Binding + Per-User Undo (HIGHEST RISK)** — origin tags, applyingRemote guard, per-user UndoManager, registry-based annoId↔Fabric lookup. Defends pitfalls 4, 6, 7, 8.

**Phase 4: Migration Phase A — Dual-Write Era** — new annotations write BOTH legacy row AND CRDT update; old clients read legacy column; new clients read CRDT column.

**Phase 5: Migration Phase B — Cutover Seal** — `migrated_at` flag on `documents`, DB trigger / RLS makes legacy read-only post-seal.

**Phase 6: Multi-tab + Persistence Hardening** — Web Locks stress-test, periodic Y.Doc compaction, IndexedDB-quota UX.

**Phase 7: Activity Log + Awareness** — server-side `update` listener writes `activity_log`, sidebar UI, "Where am I picking up?" cross-device resume banner, `Y.Awareness` channel.

**Phase 8: Sharing UX + Permission Revocation** — 4-role UI, `permission_revoked` realtime handler, decommission legacy `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`.

**Phase ordering rationale:** Phases 1 → 2 → 3 strictly sequential. Phases 4 and 5 must be distinct. Phases 6 and 7 can run in parallel if capacity allows; otherwise 7 first (user-visible wins), 6 next (production hardening). Phase 8 last — depends on activity log (Phase 7) and seal flag (Phase 5).

**Research flags:**
- Phase 1: Web Locks in Electron; y-indexeddb compaction specifics.
- Phase 2: **MANDATORY 1-week prototype spike** with go/no-go criteria.
- Phase 3: Fabric.js 5.5.2 event-firing matrix during programmatic `set()`.
- Phase 6: Observed IndexedDB quota in this app's Electron 25 build.
- Skip research: Phases 4, 5, 7, 8 (standard patterns).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Yjs trio verified; current versions, MIT, ~15kB, ESM. MEDIUM on transport (Phase 2 spike validates). |
| Features | MEDIUM-HIGH | Vendor docs and engineering blogs. Live-cursor UX is community-feedback grade. |
| Architecture | MEDIUM-HIGH | Yjs ecosystem patterns HIGH. SVG/Fabric integration MEDIUM, validated against source tree. `useSyncExternalStore` + `observeDeep` performance unmeasured. |
| Pitfalls | HIGH | Yjs/Supabase/IndexedDB mechanics verified. MEDIUM on app-specific integration assumptions. |

**Overall confidence: HIGH on the path.** Single open architectural decision: transport layer (Phase 2 spike). Everything else well-mapped.

## Gaps to Address

1. Transport-layer prototype unbuilt — Phase 2 must include hard 1-week timebox.
2. Server-side update validator not architected for Supabase path.
3. Migration advisory-lock failure modes unaddressed — Phase 4 needs lock TTL / heartbeat.
4. `useSyncExternalStore` + `observeDeep` performance on 500+ annotation docs — Phase 1 acceptance must include synthetic benchmark.
5. Fabric 5.5.2 event-firing matrix during programmatic `set()` incompletely characterized — Phase 3 must produce exact matrix.
6. No precedent UX for device-attribution-on-every-edit — Phase 7 must produce its own UI design (default OS hostname, user-renameable).
7. `document_yjs_updates` compaction cadence and triggering mechanism not yet decided.

## Sources

See STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md for full URL list. Primary sources include Yjs official docs (Awareness, UndoManager, Y.Map, Document Updates, Releases), y-indexeddb GitHub + issue #25, y-protocols, Supabase Realtime Protocol + Limits, Hocuspocus GitHub, Figma multiplayer engineering blog, Notion offline blog, Linear sync engine, Bluebeam Studio Sessions activity reports, Drawboard offline markup. Secondary: discuss.yjs.dev community threads (echo loops, capturing authors, GC and snapshotting, Supabase for yjs), PowerSync Postgres+Yjs CRDT pattern, Hocuspocus + Supabase Auth integration guide. Tertiary (reference only): AlexDunmow/y-supabase (flagged not-for-production by maintainer).
