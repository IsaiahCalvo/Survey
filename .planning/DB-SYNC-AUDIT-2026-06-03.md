<!--
Generated 2026-06-03 by the `db-sync-full-audit` workflow (run wf_4c2585c4-664):
10 read-only subsystem mappers + 5 web researchers (Figma / Google Docs / tldraw / Drawboard / Supabase+Yjs) + 1 synthesis agent.
Source of truth for the database-communication audit. Optimization work tracks against §6.
-->

# PDF-Annotation App ↔ Database Communication Audit & Optimization Plan

*Lead architect's report — Survey BetaSafeS2 · 2026-06-03*

---

## 1. Executive Summary

The app is functionally correct but **structurally over-chatty**: it pays for the same data many times per document open, runs two parallel realtime transports where one is dead weight, and never realizes the headline win its own fast-open snapshot was built to deliver. The eight highest-leverage findings:

1. **The fast-open snapshot masks latency but never eliminates it.** `readByPageSnapshot` (`snapshotStore.js:87`) paints in ~1 read, then the code *unconditionally* runs the full durable keyset sweep — ~25 sequential Postgres round-trips, ~15–25s on the worst docs — in *both* the sealed branch (`useAnnotationCloudSync.js:1165`) and the cold branch (`:1488`). The snapshot reader selects only `state, encoding_version`, so it *cannot* compare freshness and skip the heavy read. **The single biggest backend win is wiring a version watermark so the durable read is skipped when the snapshot is provably current.**

2. **A document is read end-to-end TWICE on cold open.** The hydrate keyset sweep (lean `ANNOTATION_READ_COLUMNS`, `annotationCloudSync.js:69`) and `crdtBackfill` both read all of `document_annotations` — and backfill uses `select('*')` (`crdtBackfill.js:476`), the heavy projection the keyset path deliberately avoided. The two readers even use different pagination (keyset on `id` vs OFFSET `.range()` on `page_number`), a divergence surface as well as a cost.

3. **The durable hydrate is two sequential keyset loops, not one.** `loadAllTypesOwnedRowsForDocument` (`annotationCloudSync.js:115-138`) runs a non-surveyMarker sweep *and* a legacy-fabric-surveyMarker sweep over the same `(document_id,id)` range, each `ceil(rows/1000)+1` trips. These disjoint `annotation_type IN (...)` filters can be a single OR-filtered sweep, roughly halving the trip count.

4. **Document metadata is fetched many times per open by uncoordinated hooks.** `documents.cutover_completed_at` is read by three independent single-row queries (`useAnnotationCloudSync.js:1032`, `YDocProvider.jsx:993`, `crdtBackfill.js:237`). `documents`, `document_collaborators`, and `user_subscriptions` are each fetched by multiple hooks with no shared cache — the source of the handoff's *"documents 19x / collaborators 7x / subscriptions 7x"* tallies. None of these is one duplicated call; they are many independent fetchers.

5. **Presence is O(N²) and polls forever.** The `document_presence` realtime handler discards the WAL payload and re-SELECTs the *entire* roster on every event (`documentAnnotationService.js:655`), with `event:'*'` (no echo filter), so each page-flip by one of N viewers fans out N full re-SELECTs. A 30s backup poll runs forever per viewer even when idle/alone (`useDocumentPresenceList.js:54`), and every refresh re-renders the App-shell left rail because the roster is a new array reference.

6. **Two realtime channels per document, only one of which drives the UI.** The Supabase Realtime *Broadcast* channel `yjs:<docId>` (`SupabaseYjsProvider.js`) and the *postgres_changes* channel `all-annotations:<docId>` (`annotationCloudSync.js:480`) both fire on every edit, but **only postgres_changes drives the rendered state**. The Yjs broadcast drops any frame >600KB (`SOFT_PAYLOAD_CAP_BYTES`), carries no awareness, and is reshaped away by the durable read — it is largely wasted load. The Hocuspocus provider is dead code (uninstalled dependency).

7. **The Y.Doc is durably homeless and can be incomplete.** `doc_yjs_state` holds a gzipped JSON byPage snapshot, *not* a Yjs binary; `doc_yjs_updates` has no client writer/reader. There is **no server-side CRDT persistence**. A known cutover bug sealed some docs with a partial Y.Doc (~3k of 22k marks); the in-app mitigation is to `clear()` + re-fan-out the entire durable set into the Y.Doc on *every* open (`useAnnotationCloudSync.js:1228`) — large CPU/update churn implicated in the 30s-open / 41MB-broadcast incidents.

8. **History writes are unbatched and self-defeating.** `recordDocumentHistoryEvent` fires one upsert *per logical edit* with a wasted `.select().maybeSingle()` RETURNING round-trip (`documentHistoryService.js:246`); a bulk operation on Package 2 (24,450 marks) is tens of thousands of write round-trips. `RevisionsPanel` polls `kal48_list_revisions` + 200 history rows every 10s for a panel that is usually hidden (`RevisionsPanel.jsx:224`), and `document_history_events` is realtime-published with **zero subscribers**.

**Release-blocking flags found in the working tree:** `snapshotFeatureFlag.js:47` (`return true`) and the snapshot default-ON behavior are explicitly marked *"REVERT to false before any real release."* These must be flipped consciously before GA.

---

## 2. Complete Backend Communication Inventory

De-duplicated and reconciled across all ten maps. "Blocks UI" = on the critical render/interaction path (awaited before first paint or before the user can continue).

### 2.1 Auth & Session

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| App boot | `createClient` (auth block only customized; realtime/headers default) | supabase-js singleton | auth | once/page load | no |
| AuthProvider mount | `getSession()` rehydrate from localStorage | `auth.getSession` (local) | auth | once/mount | yes (first paint) |
| AuthProvider mount | `onAuthStateChange` listener | `auth` | auth | 1/mount (+1 per open doc via authSessionBridge) | no |
| Sign-in / OAuth / SSO / sign-up | `signInWithPassword` / `signInWithOAuth` / `signInWithSSO` / `signUp` | GoTrue | auth | per action (DEV auto-login on boot) | yes |
| Successful auth + focus + 5-min poll | `SELECT tier,status FROM user_subscriptions .single()` | `user_subscriptions` | select | **every auth event, every window focus, every 5 min** | **yes (gates `loading\|\|loadingTier`)** |
| JWT auto-refresh (~55 min) | `realtime.setAuth(new token)` | realtime socket | realtime | per refresh; **only while a CRDT doc is open** | no |
| Refresh fail / revoke | `SIGNED_OUT` → ReSignInModal banner | authSessionBridge | auth | on failure | no |
| Invite visit `/invite/:token` | `rpc kal31_accept_document_invite` | RPC + `document_invites` | rpc | per accept; re-runs on `user.id` change | yes (invite page) |
| First PDFViewer render | `auth.updateUser({data:{names}})` fire-and-forget | user_metadata | update | once/user change | no |
| Password reset / sign-out | `resetPasswordForEmail` / `updateUser` / `signOut`+reload | GoTrue | auth | per action | yes |

### 2.2 Open / Hydrate a Document

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| Hydrate effect, snapshot-first paint | read gzipped byPage snapshot | `doc_yjs_state` (`readByPageSnapshot`) | select | 1/open (flag ON) | **yes (awaited)** |
| Cutover branch probe | read `documents.cutover_completed_at` | `documents` | select | **2+/open** (effect re-runs on Y.Doc identity) | **yes** |
| Sealed heal gate | full keyset sweep, all non-surveyMarker + legacy-fabric | `document_annotations` | select | **~25 sequential trips/open** (two loops) | **yes** |
| Cold/legacy path | full keyset sweep (`loadCloudWithEmptyVerify`) | `document_annotations` | select | ~25 trips/open | **yes** |
| Cold open, CRDT seed | **SECOND** full read `select('*') .range()` | `document_annotations` | select | 1/(user,doc) cold | no (concurrent) |
| Empty-cloud verify | re-run entire sweep after 1000ms | `document_annotations` | select | only if first read empty + localHasData | sometimes |
| After durable read | refresh snapshot (gzip upsert) | `doc_yjs_state` (`writeByPageSnapshot`) | upsert | 1/open if non-empty | no (fire-and-forget) |
| Sealed open | `clear()` Y.Doc + re-fan-out full durable set | Y.Doc maps | (local) | 1/open | partial CPU |
| YDocProvider cleanup audit | read `documents.user_id, cutover_completed_at` | `documents` | select | 1/open (3rd read of same row) | no |
| Document list hydration | `documents` ×2 + `document_collaborators` ×1 | `documents`, `document_collaborators` | select | per user/projectId change | yes (list) |
| One-time migration | local→cloud upsert (reuses cloud read) | `document_annotations` | upsert | once/(user,doc) cold | no |

### 2.3 Live Viewing Session / Presence

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| Document open | upsert own presence row (doubles as RLS probe) | `document_presence` | upsert | 1/open | no |
| Page change | upsert presence `currentPage` (written, never read) | `document_presence` | upsert | **1/page navigation, no debounce** | no |
| Leave / cleanup | delete own presence row | `document_presence` | delete | 1/close (no beforeunload) | no |
| Presence hook mount | `SELECT * WHERE last_seen>=now-2min` | `document_presence` | select | 1/open | no |
| **Any presence WAL event** | **discard payload, full roster re-SELECT** | `document_presence` (`event:'*'`) | realtime | **1 SELECT/event × N viewers = O(N²)** | re-render |
| 30s backup timer | full roster SELECT | `document_presence` | select | **every 30s/viewer forever** | re-render |
| Document open | subscribe postgres_changes (INSERT/UPDATE/DELETE) | `all-annotations:<docId>` | realtime | 1/open | no |
| Document open | subscribe Yjs broadcast | `yjs:<docId>` | realtime-broadcast | 1/open | no |

### 2.4 Create / Edit / Resize / Move a Mark

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| Commit gesture (debounced 800ms; deferred to pointerup) | delta upsert of changed objects (1 row for 1 resize) | `document_annotations` | upsert | 1/debounce window, batched 250/req | no |
| Same commit, after Supabase OK | dual-write each change into Y.Doc (sequential await loop) | Y.Doc annotations map | (local + broadcast) | per changed annotation | no |
| Callout commit | delete removed + upsert changed (NOT 250-chunked) | `document_annotations` + Y.Doc callouts | upsert | 1/debounce window | no |
| Push failure | enqueue to `cloudSyncQueue_{doc}` + `crdtDualWriteQueue` | localStorage | upsert | on failure; drain 1Hz | no |
| Manual save / unmount | whole-document upsert (`lastByPageRef`, not delta) | `document_annotations` | upsert | per manual save | no |
| Survey marker edit | diff-delete + `buildSurveyMarkerRow` upsert (legacy pipeline) | `document_annotations` | upsert | ~2s debounce | no |

### 2.5 Delete

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| Delete/eraser/move-off-page | delete rows by `annotation_id`, fired BEFORE upsert | `document_annotations` | delete | 1/debounce, chunked 200/`.in()` | no |
| Delete success | Y.Map tombstone per id (sequential await loop) | Y.Doc | (local + broadcast) | per deleted id | no |
| Realtime DELETE w/ empty `payload.old` | **full document refetch** (`onDeleteFallback`) | `document_annotations` | select | per empty-payload delete (skipped on sealed) | no |

### 2.6 Sharing / Permissions / Locking / Revisions / History

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| Copy link | insert link-only invite + re-select | `document_invites` | insert | per click | no |
| Send N invites | N inserts + N `send-email` edge calls (Promise.all) | `document_invites` + edge | insert/edge | per send, unbatched | no |
| AccessManagementModal open + every mutation | `getDocumentCollaborators` + `listDocumentInvites` | both tables | select | **2 selects per single-row mutation** | yes (modal) |
| Role change / remove | update/delete + email + full refresh | `document_collaborators` + edge | update/delete | per action | no |
| Revoke / resend invite | `kal31_revoke/resend` RPC + (resend) re-select + email + refresh | RPC + table | rpc | per action | no |
| Invite accept | `kal31_accept_document_invite` | RPC | rpc | per accept; re-runs on sign-in | yes |
| Lock/unlock | `kal49_lock/unlock_document` + **full `refetchDocuments()`** | RPC + `documents` | rpc | per toggle | no |
| Lock banner mount | read lock columns (no realtime) | `documents` | select | 1/documentId change | no |
| RevisionsPanel (embedded, always mounted) | `kal48_list_revisions` + `listDocumentHistoryEvents(200)` | RPC + `document_history_events` | rpc/select | **on open, 900ms-debounced event, AND every 10s forever** | no |
| Save version / restore | `kal48_create/restore_revision` (full JSONB snapshot, row-by-row reinsert) | `document_revisions` + annotations | rpc | per action | yes |
| **Per logical edit** | **upsert one history row + wasted `.select()`** | `document_history_events` | upsert | **1/edit, unbatched** | no |
| Any history insert | realtime broadcast to publication | supabase_realtime | realtime | per insert | **no consumer** |

### 2.7 Excel / Survey-Marker Sync

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| **Every Graph op** (`ensureFreshToken`) | re-SELECT full `connected_services` row | `connected_services` | select | **before every Excel check/sync/download** | yes |
| 10-min interval + login + restore | refresh MS token, upsert back | `connected_services` + MS endpoint | upsert/auth | every 10 min while connected | no |
| Template/link change | `getFileById` existence check; auto-clear on 404 | Graph | edge-fn | 1/template change | yes (gates menu) |
| Template open | compare mtimes; auto-import if Excel newer | Graph + full download | edge-fn | 1/open | **yes (can auto-download+parse)** |
| Sync-from-Excel / file-watch / poll | **full workbook download + parse every sheet** | Graph | edge-fn | per sync/change (no delta) | yes |
| Push (save/manual/live 5s debounce) | **rebuild ENTIRE workbook**, PUT or per-sheet PATCH | Graph | edge-fn | per change | yes |
| Live-sync poll (business) | `getWorksheets` + N×`getUsedRange` | Graph | edge-fn | **every 5s while open** | no |
| Live-sync poll (personal) | `getFileETag` | Graph | edge-fn | every 5s | no |
| Survey marker edit | diff-delete + upsert (legacy ~2s debounce) | `document_annotations` | upsert | ~2s/batch | no |

### 2.8 Billing / Edge Functions

| Trigger | Operation | Target | Method | Frequency | Blocks UI |
|---|---|---|---|---|---|
| Subscribe click | `create-checkout-session` (Stripe customer + session) | edge → `user_subscriptions` + Stripe | edge-fn | per click | yes (button) |
| Manage Billing | `create-portal-session` | edge → `user_subscriptions` + Stripe | edge-fn | per click | yes |
| Profile change | `send-profile-change-notification` (Resend) | edge → Resend | edge-fn | per save | no |
| Invite/role/removal | `send-email` (Resend) | edge → Resend | edge-fn | per action (invite path **awaits** it) | partial |
| Stripe webhook | verify sig, upsert subscription, `handle_downgrade_to_free`, email | edge (service role) → `user_subscriptions` | edge-fn | per Stripe event | n/a (server) |

---

## 3. The Document-Open Hot Path

### 3.1 Ordered round-trip count for opening one document

For a **populated, cutover-sealed** doc with snapshot flag ON (current default), one open executes the hydrate effect body at least twice (it re-runs on `phase30Ydoc` identity change, dep array `useAnnotationCloudSync.js:1655`):

| # | Round-trip | Target | Redundant? |
|---|---|---|---|
| 1 | `getSession()` (local) | localStorage | no |
| 2 | `user_subscriptions` tier SELECT (gates first paint) | `user_subscriptions` | **partially — gates `loading`; could not block** |
| 3 | `readByPageSnapshot` (awaited, blocks paint) | `doc_yjs_state` | no (this IS the fast paint) |
| 4 | `cutover_completed_at` (hydrate effect) | `documents` | **dup of #6, #7** |
| 5–~29 | **durable keyset sweep, two loops, ~25 sequential trips** | `document_annotations` | **REDUNDANT when snapshot is current — this is the prize** |
| 30 | `cutover_completed_at` (YDocProvider cleanup audit) | `documents` | **dup of #4** |
| 31 | `cutover_completed_at` (crdtBackfill probe) | `documents` | **dup of #4** (cold only) |
| 32 | presence upsert (RLS probe) | `document_presence` | no |
| 33 | presence list SELECT | `document_presence` | no |
| 34 | `writeByPageSnapshot` (fire-and-forget) | `doc_yjs_state` | **redundant if nothing changed** |
| + | document list ×2, collaborators ×1, subscriptions ×N (uncoordinated hooks) | various | **REDUNDANT** |
| + | (cold only) **SECOND full read** `select('*') .range()` for backfill | `document_annotations` | **REDUNDANT** |

**Net:** a warm sealed open shows annotations within ~1 read (the snapshot) but the backend still pays **~25 sequential trips** before settling. A cold open reads the whole table **twice** plus the metadata storm.

### 3.2 Which trips are skippable when a current snapshot exists

Skippable **without correctness loss once a freshness watermark exists**:

- Trips **5–~29** (the full durable sweep) — *if* the snapshot is provably current.
- Trip **30, 31** — collapse the three `cutover_completed_at` reads into one shared resolver.
- The duplicate **document/collaborator/subscription** fetches — one shared cache.
- The second **`crdtBackfill` full read** — reuse the hydrate keyset rows.
- The duplicate hydrate-effect pass — wait for Y.Doc readiness via a ref/flag instead of an effect re-run.

### 3.3 How to skip the heavy durable re-read WITHOUT regressing the wrong-page heal

The durable read currently does three jobs the snapshot does not: (a) it is the **source-of-truth wrong-page heal**, (b) it brings **real callouts** (CLI-built snapshots write `callouts:[]`), and (c) the durable result **wins** over the Y.Doc/snapshot at `useAnnotationCloudSync.js:1211-1266`. To skip it safely:

1. **Add a watermark to the snapshot write.** On `writeByPageSnapshot`, populate the *already-existing* `doc_yjs_state.through_seq` (currently hardcoded 0) or rely on `updated_at`, stamped from `max(document_annotations.updated_at)` of the durable result that produced the snapshot. Store the source row count too.

2. **Read the watermark on open.** Change `readByPageSnapshot` (`snapshotStore.js:92`) to also select `updated_at` / `through_seq`. This is the exact freshness check the offline `agent-cli sweep` already does (`latestRowUpdatedAt`, `agent-cli/index.mjs:242`): *snapshot.updated_at ≥ latest row change → snapshot is current → skip rebuild.*

3. **Cheap heal probe replaces the ~25-trip sweep.** Instead of the full sweep, issue **one** lightweight query: `SELECT max(updated_at), count(*) FROM document_annotations WHERE document_id=$1` (1 trip, index-served). If it matches the snapshot watermark **and** row count, set `hydratedRef=true` and **return without the durable sweep**. The wrong-page heal is preserved because the snapshot is row-sourced and carries correct `page_number` (per `snapshotStore.js` docstring) — a matching watermark *proves* it reflects the same healed rows.

4. **Preserve the three degeneracy guards verbatim** (see §7): the `queuedLocalWrites.hasPending` guard (don't overwrite unpushed edits), the `<80%` Y.Map degeneracy guard, and the empty-everything legacy probe. The skip only fires when watermark matches AND no local writes are queued; otherwise fall through to today's full sweep.

5. **Callout caveat:** because CLI snapshots omit callouts, gate the skip on app-written snapshots only (e.g. a `callouts_complete` flag in the snapshot meta), or always run the much cheaper *callouts-only* read when skipping the annotations sweep.

This converts the headline read from **~25 trips → 1 trip** on the warm path while keeping the heal correct.

---

## 4. Realtime Collaboration & CRDT Health

### 4.1 Current model

- **Durable source of truth:** `document_annotations` rows (one row per annotation, full Fabric JSON in `annotation_data.fabricObject`).
- **Live cross-user path that users actually see:** Supabase **postgres_changes** on `all-annotations:<docId>`. A remote upsert → WAL → peer applies into `annotationsByPage` React state.
- **Y.Doc:** an in-memory CRDT cache per tab, persisted to IndexedDB under a Web-Locks leader tab, with loser tabs fed via `BroadcastChannel`.
- **Yjs transport:** Supabase **Broadcast** channel `yjs:<docId>` carrying y-protocol frames.

### 4.2 Active vs dead transport

| Transport | Status | Evidence |
|---|---|---|
| postgres_changes `all-annotations:<docId>` | **ACTIVE — the real render path** | `annotationCloudSync.js:480` |
| Yjs Broadcast `yjs:<docId>` | **Live but largely redundant** — not the display source post-reshape, drops frames >600KB (`SOFT_PAYLOAD_CAP_BYTES`), never passed an awareness instance (dead awareness branch) | `SupabaseYjsProvider.js:206` |
| Hocuspocus provider | **DEAD CODE** — `@hocuspocus/provider` not installed; YDocProvider hard-imports only the Supabase provider | `HocuspocusYjsProvider.js` |
| `doc_yjs_updates` (server CRDT log) | **NO client writer/reader** — there is no server-side CRDT persistence | schema only |
| Awareness / presence cursors | **100% DORMANT** — no awareness arg passed; `useRemoteEditors` always returns empty Map | `YDocProvider.jsx:1474 editors={[]}` |

### 4.3 Dual-write divergence risk

Each edit writes **Supabase first, then Y.Doc** — two independent try/catch arms, **no transaction** (`annotationCloudSync.js:721-785`). Failure modes:
- Supabase OK + CRDT throws → durable row written, CRDT mirror queued or (after 10 attempts) **quarantined and abandoned**.
- Delete-before-upsert is non-atomic: delete OK + upsert fail → partially-updated row set.
- **Two echo-suppression systems must agree:** postgres_changes suppresses by `lastByPageRef` sync-set; Yjs suppresses by origin reference equality. An edit landing in both channels can apply twice if either misses; convergence relies on idempotent `insertOrUpdateOnPage` + LWW.

### 4.4 The incomplete-Y.Doc problem

The cutover seal gate only required `yMapAnnotations.size >= imported`, but pre-2026-05-03 the legacy SELECT was capped at PostgREST's 1000-row `max_rows`, so `imported` itself was truncated. Result: some docs were **sealed with ~3k of 22k marks in the Y.Doc** while `document_annotations` rows were complete. This breaks: Y.Doc-sourced reads, loser-tab/IndexedDB-only reads, and the Yjs broadcast mesh — all under-paint. The **in-app mitigation** is to always run the durable read and `clear()` + re-fan-out the *entire* set into the Y.Doc on every open (`useAnnotationCloudSync.js:1228`), which is itself the §2 write-amplification problem (22k CRDT commits per open → 41MB broadcast / 30s-open incidents).

### 4.5 What "correct" looks like

Per the Supabase+Yjs ideal and Figma/tldraw lessons:
- **One live transport, chosen deliberately.** Either (A) make Yjs-over-Broadcast the single live path with Postgres as durable log + snapshot store, retiring postgres_changes for annotations; or (B) keep postgres_changes as the live path and retire the Yjs broadcast mesh entirely. **Running both is the defect.**
- **Granular CRDT nodes:** one `Y.Map` per annotation keyed by id (never one opaque blob), so concurrent edits to different marks are true parallelism and same-mark edits resolve field-by-field.
- **Server-side CRDT persistence:** write the Yjs update log / snapshot to Postgres (`doc_yjs_updates` + a real binary `doc_yjs_state`) with compaction, so the Y.Doc has a durable home and the per-open `clear()`+rebuild disappears.
- **Backfill correctness:** seal only against a *paginated* full count, and stop the per-open rebuild once the Y.Doc is trusted complete.
- **Presence on a separate ephemeral channel** (Awareness over Broadcast, or Supabase Presence for the roster) — never in the document store.

---

## 5. Gap Analysis vs the Pros

| Dimension | Figma | Google Docs | tldraw | Drawboard/Bluebeam/Adobe | Supabase+Yjs ideal | **US — today** | **Recommended for us** |
|---|---|---|---|---|---|---|---|
| **Sync model** | Server-auth per-property LWW | OT (Jupiter) | Server-auth LWW-per-record + optimistic rebase | Per-object LWW / single-writer ownership | Yjs CRDT (commutative + idempotent) | **Hybrid mess:** durable rows + Yjs CRDT dual-write, two live channels | **Pick one live path:** Yjs CRDT for live + Postgres as durable log/snapshot; OR Postgres-LWW live + retire Yjs mesh |
| **Conflict resolution** | Per-property, server order | Transform + rebase | Whole-record LWW | Per-object single-writer (no merge) | Field-level CRDT merge | Idempotent LWW per annotation; dual-write can diverge silently | Granular `Y.Map`/annotation; creator-as-de-facto-writer for geometry; CRDT merge for free-text fields only |
| **Presence/awareness** | Separate ephemeral broadcast | Separate LWW pub/sub | Separate non-persisted store | Drawboard live cursors (separate); Adobe none | Awareness over Broadcast, <30s heartbeat, never persisted | **DB-row CRUD + 30s poll, O(N²) refetch, currentPage written-never-read, awareness 100% dormant** | Supabase Presence roster + (optional) Awareness cursors over Broadcast; drop the table-based presence churn |
| **Offline** | Download latest + replay edits | IndexedDB op queue + base_revision | unsentChanges + rebase | Pending-upload queue, per-object safe | y-indexeddb, state-vector delta reconnect | localStorage retry queues + IndexedDB Y.Doc; reconnect = full refetch sweeps | state-vector delta on reconnect (keyset since-clock), not full sweeps |
| **Persistence/snapshot** | In-mem + 0.5s journal + S3 checkpoint | snapshot + op-tail (WAL+checkpoint) | RoomSnapshot + clock + bounded tombstones | Immutable PDF + separate annotation store + explicit flatten | snapshot + per-update rows + serializable compaction | **doc_yjs_state = gzip JSON snapshot, no version watermark read; no CRDT log persisted; durable re-read masks it** | snapshot **+ watermark** so reader skips durable read; eventually a real append delta log + compaction |
| **Round-trip economy** | 1 socket/doc, in-mem authority | snapshot + tail on load | hibernating DO, since-clock delta | real-time push vs polling floor | render from IndexedDB, ONE state-vector exchange, async durable append | **~25 trips/open + double cold read + metadata storm + O(N²) presence + 10s history poll + 5s Excel poll** | 1-trip warm open, deduped metadata, delta presence, gated polls |

---

## 6. Ranked Optimization Plan

Ordered by impact-to-effort. Quick wins first.

---

**#1 — Skip the durable re-read when the snapshot is current** — ✅ IMPLEMENTED + VERIFIED 2026-06-03 (incl. the marker fix)
- **Status:** Shipped (code uncommitted on main; **migration APPLIED to prod** `20260603130000_db_sync_annotations_changed_at`). Two-tier freshness check, both serving a synthetic durable result from the painted snapshot (provably identical row set) and skipping `loadCloudWithEmptyVerify` in BOTH the sealed and cold branches, with all guards preserved verbatim:
  - **Preferred — change marker (any doc size, delete-safe):** new `documents.annotations_changed_at`, bumped to `now()` by a SECURITY DEFINER statement-level trigger on `document_annotations` INSERT/UPDATE/DELETE (transition tables; lock order annotations→documents so no deadlock; definer so a collaborator's RLS can't leave it stale). Snapshot meta now carries `changedAt` (read once per open BEFORE the durable read — conservative, no TOCTOU); skip iff `meta.changedAt === live marker`. Probe = ONE ~105ms single-row read.
  - **Fallback — bounded count probe:** for snapshots written before the marker, the `(rowCount, maxUpdatedAt)` probe runs only when `sourceRowCount ≤ 5000` (`WATERMARK_PROBE_MAX_ROWS`); larger docs fall through to the durable read (no regression) until their next open re-stamps a `changedAt` snapshot.
- **Why the marker:** the original exact-COUNT probe scans every owned row under RLS and **timed out (57014) on the 22k-mark doc** (~3.7s; would have made the biggest docs slower). Measured under real RLS: marker read **105ms / 1 trip** vs count **3.7s / timeout**; `max(updated_at)` alone is cheap but NOT delete-safe (a fresh open's realtime sub won't replay a past delete), hence the marker.
- **Proof:** trigger verified on a throwaway doc (marker set on INSERT, bumped on UPDATE + DELETE, doc cleaned up); column backfilled from `max(updated_at)`; migration dry-run showed only this file, applied clean. New unit suite `snapshotStore.watermark.test.mjs` (9 tests). Build clean, `npm test` 856/0/6.
- **Rollout:** self-healing — first open after deploy still does the durable read + re-stamps the snapshot with `changedAt`; the NEXT open uses the 105ms marker path and skips. Caveat: this is a BACKEND-LOAD win (the snapshot already makes opens visually instant), not a visible-speed win.
- **Problem:** ~25 sequential keyset trips run on *every* open even when the snapshot/Y.Doc already painted complete state (`useAnnotationCloudSync.js:1165`, `:1488`). Snapshot only hides latency.
- **Fix:** Stamp a watermark on `writeByPageSnapshot` (`through_seq` or `updated_at` = `max(document_annotations.updated_at)` + row count). Read it in `readByPageSnapshot` (`snapshotStore.js:92`). On open, run **one** `SELECT max(updated_at), count(*) … WHERE document_id=$1`; if it matches, set `hydratedRef=true` and return without the sweep. Lift the exact logic from `agent-cli/index.mjs:242` (`latestRowUpdatedAt`).
- **Impact:** **~25 trips → 1 trip** on the warm path; ~15–25s tail eliminated. Largest single backend + latency win.
- **Must NOT regress:** wrong-page heal, `queuedLocalWrites.hasPending` guard, `<80%` degeneracy guard, empty-everything legacy probe, callout completeness (gate skip on app-written snapshots or run callouts-only read).
- **Effort:** M · **Deps:** watermark column populated (trivial; columns already exist).

---

**#2 — Merge the two keyset loops into one OR-filtered sweep**
- **Problem:** `loadAllTypesOwnedRowsForDocument` runs a non-surveyMarker sweep *and* a legacy-fabric-surveyMarker sweep over the same `(document_id,id)` range (`annotationCloudSync.js:115-138`), doubling trips and re-scanning the same range twice.
- **Fix:** One keyset sweep with `annotation_type IN (non-marker types) OR (annotation_type IN (marker) AND annotation_data->'fabricObject' IS NOT NULL)`, partition client-side. Consider a `(document_id, annotation_type, id)` composite index so the type filter isn't a heap filter.
- **Impact:** ~2× fewer trips on every cold/un-skipped open; complements #1 (the fallback sweep is now half-cost too).
- **Must NOT regress:** the surveyMarker carve-out; verify the combined predicate uses the keyset index.
- **Effort:** S · **Deps:** none (index is optional follow-up).

---

**#3 — De-duplicate the documents / collaborators / subscriptions / cutover fetches**
- **Problem:** `cutover_completed_at` read 3× per open (`useAnnotationCloudSync.js:1032`, `YDocProvider.jsx:993`, `crdtBackfill.js:237`); `documents`/`document_collaborators`/`user_subscriptions` fetched by many uncoordinated hooks — the *19x/7x/7x* tallies.
- **Fix:** A small per-open document-metadata cache (resolve `cutover_completed_at`, owner, lock state once and share via context/ref). A shared subscription-tier cache (one source for AuthContext, `useSubscriptionLimits`, `getUserSubscriptionTier`). Switch tier read to `.maybeSingle()` to stop logging the free-tier no-row as an error (`AuthContext.jsx:137`).
- **Impact:** Removes a steady stream of redundant single-row reads on every navigation/mount; cuts the *19x/7x/7x* counts toward 1–2.
- **Must NOT regress:** RLS scoping; cache invalidation on actual mutation (lock toggle, role change).
- **Effort:** M · **Deps:** none.

---

**#4 — Throttle/replace presence polling and kill the O(N²) refetch**
- **Problem:** Realtime handler discards payload and re-SELECTs the full roster on every event (`documentAnnotationService.js:655`), `event:'*'` with no echo filter, 30s poll forever, new-array-ref re-renders the left rail.
- **Fix (incremental):** Apply `payload.new`/`payload.old` directly instead of refetching; add a `clientSessionId` echo filter like the annotation channel; gate the 30s poll on visibility + >1 viewer; shallow-equal the roster before `setPresence` to stop ref churn. **Fix (structural):** migrate to **Supabase Realtime Presence** (`track`/`presenceState`) — eliminates the page-change write, the poll, the heartbeat/stale-row problem, and the N² refetch in one move.
- **Impact:** Presence load drops from O(events × N) to O(events); removes ~120 idle SELECTs/hr/viewer and a re-render per event.
- **Must NOT regress:** the presence-upsert-as-RLS-probe behavior (`documentSyncEnabled` flip) — preserve a separate entitlement check if moving off the table.
- **Effort:** S (incremental) / M (Presence migration) · **Deps:** none.

---

**#5 — Batch + de-noise history writes; stop the 10s RevisionsPanel poll**
- **Problem:** One history upsert per logical edit with a wasted `.select()` RETURNING (`documentHistoryService.js:246`); bulk ops on 24,450 marks = tens of thousands of writes. `RevisionsPanel` polls every 10s even when hidden (`RevisionsPanel.jsx:224`). `document_history_events` is realtime-published with no subscriber.
- **Fix:** Drop the `.select().maybeSingle()` (caller uses `void`). Batch/debounce history events through a flush queue (every N ms or on idle). Fix the interval guard so a hidden embedded panel stops polling, or replace the poll with the already-existing realtime publication (subscribe instead of poll). If no subscriber is wanted, remove the table from the publication to kill server-side WAL fan-out.
- **Impact:** Removes ~6 RPC/min/open-doc idle load and tens of thousands of write round-trips on bulk edits.
- **Must NOT regress:** history dedup (`onConflict document_id,client_event_id`); the localStorage offline mirror.
- **Effort:** M · **Deps:** none.

---

**#6 — Reuse the hydrate read for backfill; eliminate the double cold-open read**
- **Problem:** Cold open reads `document_annotations` twice — hydrate keyset (lean) + `crdtBackfill` `select('*') .range()` (`crdtBackfill.js:476`).
- **Fix:** Pass the hydrate keyset rows to backfill (or have backfill consume the already-resolved durable result) and drop its independent `select('*')` OFFSET sweep. Standardize both on keyset + lean projection.
- **Impact:** Halves cold-open read volume; removes the OFFSET-vs-keyset divergence surface; stops pulling ~15 unused heavy columns.
- **Must NOT regress:** backfill idempotency; seal-count gate must still see the full count.
- **Effort:** M · **Deps:** #1/#2 (shared read result) helpful but not required.

---

**#7 — Excel: cache MS token in memory; replace the 5s Graph poll; delta uploads**
- **Problem:** `ensureFreshToken` re-SELECTs `connected_services` before every Graph op (`MSGraphContext.jsx:436`); business live-sync makes `1 + N` Graph calls every 5s (`PDFViewer.jsx:14582`); every push rebuilds the entire workbook.
- **Fix:** Use in-memory token state; only re-SELECT on refresh. Replace the 5s poll with Graph delta-query / change-notifications if available for the account type; otherwise back off the cadence and skip during idle. Push only changed sheets/ranges instead of full-workbook regeneration.
- **Impact:** Removes a Supabase read per Excel op and sustained `12×(1+K)` Graph requests/min per open live-synced doc.
- **Must NOT regress:** dual-store reconciliation (timestamp direction logic); name-based marker matching deletes.
- **Effort:** L · **Deps:** confirm Graph delta/webhook availability (open question).

---

**#8 — De-block first paint: don't gate `loading` on the tier SELECT**
- **Problem:** First paint waits on `loading || loadingTier`; `loadingTier` is a network `user_subscriptions` SELECT (`AuthContext.jsx:439`).
- **Fix:** Render the shell on `loading` alone; resolve tier asynchronously and degrade gracefully (assume free, upgrade UI when tier lands). Add a short cache so focus/5-min refetches don't re-block.
- **Impact:** Removes a network round-trip from the critical boot path on cold connections.
- **Must NOT regress:** feature gating (advisory only — real limits are RLS-enforced server-side).
- **Effort:** S · **Deps:** #3 (shared tier cache).

---

**#9 — Reduce realtime payload: REPLICA IDENTITY FULL → default**
- **Problem:** `document_annotations` ships the entire old+new row (large `annotation_data` JSONB) on every WAL event (`20260426000000`); a single ink-stroke edit broadcasts many KB to every peer.
- **Fix:** If postgres_changes remains the live path, evaluate `REPLICA IDENTITY DEFAULT` (PK only) and have peers fetch changed rows by id, or move live fan-out to lean Broadcast frames. Same for `document_presence` (which is re-fetched anyway, so FULL is pure overhead).
- **Impact:** Cuts realtime/WAL bandwidth and per-event RLS-filter cost from payload-size-scaled to edit-count-scaled.
- **Must NOT regress:** DELETE handling (empty `payload.old` already triggers `onDeleteFallback`); the echo filter relies on `clientSessionId` in `annotation_data`.
- **Effort:** M · **Deps:** transport decision (#11).

---

**#10 — Stop the per-open Y.Doc clear()+rebuild on big docs**
- **Problem:** Sealed open always `clear()`s and re-fans the full durable set into the Y.Doc (`useAnnotationCloudSync.js:1228`) — 22k CRDT commits/open, implicated in the 41MB-broadcast/30s-open incidents.
- **Fix:** Skip the rebuild when the Y.Doc count matches the durable count (trust the sealed Y.Doc once backfill completeness is guaranteed — see #12). Batch any needed fan-out into a single Y.Doc transaction rather than per-annotation awaits.
- **Impact:** Removes the largest open-time CPU/Y.Doc churn on large docs; depends on #12 for correctness.
- **Must NOT regress:** the incomplete-Y.Doc mitigation — only safe once #12 guarantees completeness.
- **Effort:** M · **Deps:** #12.

---

**#11 — Realtime transport decision: retire one of the two live channels (STRUCTURAL)**
- **Problem:** Two live channels per doc; only postgres_changes drives render; the Yjs broadcast is largely wasted (600KB drop, no awareness, reshaped away).
- **Fix:** Decide consciously. **Option A (CRDT-forward, matches north star):** make Yjs-over-Broadcast the single live path, Postgres the durable log + snapshot store, drop the annotation postgres_changes subscription. **Option B (pragmatic):** keep postgres_changes, delete the Yjs broadcast mesh and the dead Hocuspocus provider. Either halves realtime channel count and message volume per open.
- **Impact:** 2× realtime message volume and channel count removed; major cognitive-load reduction.
- **Must NOT regress:** echo suppression must remain single-system; large-edit propagation (>600KB) must work on whichever path survives.
- **Effort:** L · **Deps:** #12 (Option A needs a complete, durably-persisted Y.Doc).

---

**#12 — CRDT completeness & durable persistence (STRUCTURAL)**
- **Problem:** Some docs sealed with a partial Y.Doc; no server-side CRDT persistence (`doc_yjs_updates` unused, `doc_yjs_state` is JSON not binary).
- **Fix:** Re-seal against a *paginated* full count (the 2026-05-03 fix direction); persist the Yjs update log + a real binary snapshot to Postgres with serializable-transaction compaction (the Supabase+Yjs ideal); model each annotation as its own `Y.Map`. Once the Y.Doc is trusted complete, #10 and Option A of #11 unlock.
- **Impact:** Gives the Y.Doc a durable home, removes the per-open rebuild, enables a clean single-transport live path and proper offline state-vector reconnect.
- **Must NOT regress:** durable rows remain the cross-device truth during migration; the dual-write retry/quarantine path.
- **Effort:** L · **Deps:** schema work; sequencing after #1–#6 land the quick wins.

---

**#13 — RLS & index tuning on the hot table (STRUCTURAL)**
- **Problem:** Per-row `user_can_access_document` (2 sub-SELECTs) on every returned annotation row, twice per open; write RLS evaluates 2–3 SECURITY DEFINER calls per row at 250-row batches; `kal49_document_is_locked` is per-row but document-level; redundant `(document_id)` and low-selectivity `(annotation_type)` indexes add write cost; no composite `(document_id,last_seen)` on presence.
- **Fix:** Add `(document_id, annotation_type, id)` and `(document_id, last_seen)` composites; drop the redundant standalone `(document_id)` index; investigate hoisting the lock check out of the per-row predicate; confirm the canonical `user_can_access_document` (user_id-based, not the `created_by` body) is the live function and reconcile the `subscriptions` vs `user_subscriptions` table-name drift.
- **Impact:** Reduces the per-row RLS overhead that drove the historic 57014 timeouts and ongoing read latency; lowers bulk-write amplification.
- **Must NOT regress:** RLS security boundary (it is the *only* row scoping); migration-order fragility (the `created_by`/`user_id` footgun).
- **Effort:** L · **Deps:** live `EXPLAIN ANALYZE` + `\df+` confirmation (§8).

---

## 7. Correctness Invariants Any Optimization Must Preserve

1. **Wrong-page / source-of-truth heal.** The durable read winning over the Y.Doc/snapshot (`useAnnotationCloudSync.js:1211-1266`) is what corrects mispaged marks. Any skip MUST require a watermark match proving the snapshot reflects the same healed rows, and MUST keep: (a) the `<80%` Y.Map degeneracy guard (`:1283`), (b) the `queuedLocalWrites.hasPending` guard (`:1211`), (c) the empty-everything legacy probe (`:1304`).
2. **Echo suppression must stay single-system per channel.** `lastByPageRef.current` is synchronously set inside every `setAnnotationsByPage` updater so the push effect's identity check (`:1667`) skips re-pushing hydrated state. A refactor that paints but forgets the ref-sync echoes the whole document back as a bulk upsert.
3. **Dual-write integrity (best-effort, non-atomic by design).** Delete-before-upsert order, per-side retry queues, and the NO_DIFF_DELETE invariant ("never delete one store to match the other") must survive. Don't introduce a path that deletes durable rows to match a (possibly partial) Y.Doc.
4. **RLS is the only security boundary.** Tier/feature gating and `isOwner` checks are advisory UX. Row scoping, lock enforcement, and entitlement live in `user_can_access_document` / `kal49_document_is_locked` / RLS policies. Optimizations must not move authority client-side.
5. **Snapshot must be row-sourced, never Y.Doc-sourced.** A Y.Doc-sourced snapshot can under-paint (verified ~3k of 22k). Keep the durable-rows source invariant.
6. **Stale-cache-shrink and accidental-delete guards.** The diff-based deleted-id detection plus `shouldSuppressStaleCacheShrink` prevents a stale localStorage cache from cascading real cloud deletes. Any change to the delete path must keep this guard and not widen the unguarded small-shrink window.
7. **Presence-as-RLS-probe.** The presence upsert success flips `documentSyncEnabled`. If presence moves off the table (Supabase Presence), replace this with an explicit entitlement probe so sync enablement isn't silently coupled to a removed write.
8. **TOKEN_REFRESHED → `realtime.setAuth` coverage.** Today this only fires while a CRDT doc is open. Any new long-lived realtime channel created outside that window needs its own re-auth, or it freezes at the ~55-min JWT boundary.

*(Out of scope here per the brief: container-aware canvas sizing, single-name fontFamily, `zoomGeneration` signal, SVG viewBox zoom ownership.)*

---

## 8. Open Questions / Verify With a Live Network Capture

1. **Measure the real per-open multiplicity.** Capture one cold open and one warm sealed open; confirm the *19x documents / 7x collaborators / 7x subscriptions* tallies and the actual keyset trip count. The duplicates are spread across `useDatabase`, `AuthContext`, `useSubscriptionLimits`, `YDocProvider`, presence, and the 3 cutover reads — only a network log pins the exact counts.
2. **Sealed vs cold split.** What fraction of real opens hit the cutover-sealed branch? Determines whether #1 (redundant sweep) or #6 (double cold read) is the dominant cost.
3. **Watermark read cost.** Is `SELECT max(updated_at), count(*)` index-served cheaply, or is a denormalized `documents.annotations_version` counter (maintained by trigger) needed to make #1's heal probe truly 1 cheap trip?
4. **Compressed snapshot sizes.** Does the 12MB compressed cap cover Package 2 (24,450 marks)? If the largest docs silently get no snapshot, they stay slow regardless of #1. Get sizes from `agent-cli sweep --write`.
5. **`doc_yjs_state` RLS.** Does the in-app user-role read actually succeed under current RLS (Phase 27 deny-all stub vs intended `user_can_access_document` gating), or does only the service-role CLI path work? If RLS denies user reads, the snapshot reader returns null for everyone.
6. **Live `user_can_access_document` body.** Run `\df+ user_can_access_document` / `pg_get_functiondef` to confirm the canonical user_id-based body (not the `created_by` KAL-31 body) is the last-applied one.
7. **Subscription table canonical name.** `subscriptions` (invite-accept) vs `user_subscriptions` (eligibility, storage, AuthContext) — confirm which exists in production; the split-brain risks tier mis-gating.
8. **Concurrent viewer count.** Real per-document concurrency determines whether the O(N²) presence refetch (#4) is a priority or negligible at N≤3.
9. **Presence realtime payload usage.** Is the WAL payload ever consumed, or is the channel only a change signal? If only a signal, `REPLICA IDENTITY FULL` on presence is pure overhead (#9).
10. **Server-side validators.** What backs `SupabaseYjsProvider`'s `update_rejected`/`authentication_failed` (Edge Function vs trigger)? Not in `src`. And is any deployed function writing `doc_yjs_updates`/compacting `doc_yjs_state` as binary? None found in repo.
11. **Excel Graph delta/webhook availability** for the account types in use — determines whether #7 can replace the 5s poll with change-notifications.
12. **Stripe env secrets.** Are `STRIPE_PRO_MONTHLY/ANNUAL/ENTERPRISE_PRICE_ID` set in deployed function secrets? If unset, the hardcoded price-ID fallback (`create-checkout-session/index.ts:63`) mischarges and tier resolution collapses to free. And confirm `send-email`'s gateway `verify_jwt` is enabled (it has no in-code auth — the main abuse surface).
