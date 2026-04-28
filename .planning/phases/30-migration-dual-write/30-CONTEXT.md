# Phase 30: Migration Phase A — Dual-Write Era - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Every new annotation written by a v2.4 client persists to BOTH the legacy `document_annotations` row AND the new CRDT update path. v2.3 clients still in the wild keep reading the legacy column; v2.4 clients read the CRDT column. Reads never bleed across paths. An idempotent backfill keyed by `client_anno_id` runs once per (user, document) on the first v2.4 open of a document with pre-existing v2.3 annotations.

This phase ships:
- Dual-write logic landing inside `src/services/annotationCloudSync.js` under a narrow per-phase waiver — every new-annotation save fans out to legacy + CRDT, never reconciles by deletion.
- A new `src/lib/collab/crdtBackfill.js` module that performs the per-document, per-user idempotent backfill from legacy → CRDT on first v2.4 open. Keyed by `client_anno_id`; same key + deep-equal value = skip; advisory-locked so two tabs of the same user racing the backfill don't double-import.
- A retry queue / surface for half-failed dual-writes so a transient error on one side never permanently diverges the two stores. Reuses Phase 27's `StorageFailureBanner` pattern for the visible stuck-queue case.
- Reuses Phase 27's existing CRDT kill switch (`crdtFeatureFlag.isCRDTEnabled()`) — no separate flag for dual-write. When the master CRDT switch is off, dual-write is also off; the legacy-only path that v2.3 has always used is the fallback.
- Highlights are excluded from dual-write entirely. They stay on the legacy sync path through v2.4 (folded into v2.5 per the Excel-sync risk in `.planning/research/SUMMARY.md`).
- The PDF and the SVG / Fabric layers do not learn about migration in this phase. Migration sits at the React-state ↔ persistence boundary, beneath the display and edit layers.

The cutover seal (legacy → read-only, source-of-truth flips to Y.Doc) lands in Phase 31. Activity-log surfacing of the migration entry lands in Phase 33. Decommissioning the legacy code paths (`useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`) lands in Phase 34.

**Requirement mapping:** MIGRATE-01 (existing v2.3 annotations appear correctly in v2.4 with no data loss; original creation user becomes recorded author with "before-v2.4" device tag).

</domain>

<decisions>
## Implementation Decisions

### First-open import feel

- **Silent migration.** When a v2.4 user opens a document that has pre-existing v2.3 annotations, the copy from legacy → CRDT runs silently in the background. No banner, no spinner, no "moving your work over" text. The annotations just appear like normal. Pattern reference (user-named): Linear, Figma, Notion silent migration.
- **No edit-blocking.** The user can draw, edit, drag, and erase normally while the backfill runs underneath. New edits go through the dual-write path; the backfill catches up the older annotations in parallel. Per-annotation idempotency (keyed by `client_anno_id`) handles the brief race window.
- **Silent retry on partial failure.** If the backfill fails partway through (network blip, transient error), the next v2.4 open of the same document silently retries. Already-imported annotations are skipped by `client_anno_id`; only the missing ones get re-attempted. No error UI fires.
- **No completion confirmation.** Once the backfill finishes there is no toast, no chip, no marker. Migrated documents are indistinguishable from native v2.4 documents.
- **Size-independent.** Even for documents with hundreds of pre-v2.4 annotations, the silent feel still holds — no progress bar, no size-based threshold UI.
- **Offline first-open works.** If a user opens a v2.3 document on v2.4 with no network, the document still renders the legacy annotations from the local cache normally. The backfill simply waits until network returns and runs at that point.
- **Trigger condition.** Any collaborator with edit access running v2.4 triggers the backfill on their first open. No "owner-only" restriction. The backfill is idempotent so concurrent runs across collaborators are harmless.
- **Read source during the copy window.** While the backfill is in flight, the v2.4 read path renders from the legacy data, then flips to the CRDT store atomically once the copy completes. The user never sees a half-imported state — no missing annotations, no flicker, no progressive fill-in.

### Half-failed save (one of the two writes lands, the other doesn't)

- **Default: silent retry queue.** Every new annotation lands locally first (IndexedDB via Y.Doc). The two outbound writes (legacy `document_annotations` insert + CRDT update sync) each have their own retry path. If one fails, the other still succeeds; the failed side queues and retries silently in the background. Pattern reference: standard offline-first dual-write.
- **30-second silence threshold.** The queue retries silently for roughly 30 seconds. If it's still stuck after that, a banner surfaces explaining that some saves are catching up. Matches the Linear / Notion silent-retry feel.
- **Stuck-queue banner reuses existing pattern.** The banner is the same shape, locked CSS variables, role=alert, sticky positioning, and 2 type weights as Phase 27's `StorageFailureBanner` and Phase 28's transport / kicked / login-expiry banners. Copy variant only: "Some changes haven't saved yet — try refreshing or check your connection."
- **Editing stays fully unblocked.** While the retry queue drains, the user can keep drawing, editing, and erasing without restriction. New edits go into the same queue and ride along. Same offline/online behavior the app already has.
- **Queue survives app close.** Pending queue entries persist to local storage and replay automatically when the app re-opens. The user does not lose work if they close the tab / restart the desktop app while the queue is stuck.
- **Re-edit while queued: latest version wins.** If the user modifies an annotation that already has an earlier save sitting in the queue, the queued entry is replaced with the newest state. The queue holds only the most recent version of each annotation (no stale-write replay, no out-of-order writes).
- **Quarantine after ~10 retries.** If a specific annotation cannot sync after roughly 10 attempts (server keeps rejecting it, persistent error), it gets a small inline marker on the annotation that reads **"didn't save, please try redrawing"** and stops retrying. The rest of the queue keeps moving — one bad item never blocks the whole queue.
- **Document tile signal.** When a document has a stuck queue, the document list / sidebar tile shows a small "unsaved changes" icon BEFORE the user opens the document, so they know to check it. Combines with the in-doc banner once they open it.

### Old-author tag wording (MIGRATE-01 surfaces)

- **Device tag string: "Before v2.4".** Pre-v2.4 annotations get `meta.deviceId = "before-v2.4"` in storage; the user-visible string in tooltips, properties, and (later) the activity log reads literally "Before v2.4". Version-explicit, matches the data, lets support correlate with release notes.
- **Original creator stays as author.** The legacy `created_by` user becomes `meta.authorId` exactly as MIGRATE-01 requires. No relabeling, no "Imported by" override.
- **Visually identical rendering.** Imported annotations render exactly like fresh v2.4 annotations on the page. No dotted outlines, no "imported" pills, no hover hints. Only the metadata records the migration; the visual layer is untouched.
- **Properties date row: original creation date only.** When the user opens an annotation's properties panel later, the date/time row shows when the annotation was originally drawn (preserves `meta.createdAt`). No "migrated on..." secondary row.
- **Activity log entry: one "Migrated" row per document on import day.** When the activity log ships in Phase 33, the migration surfaces as a single row per document — "Document migrated to collaborative version" with the import-day timestamp. Not one row per annotation. Phase 30 only needs the data path so Phase 33 can render that single row; the actual UI lands later.

### Kill switch / rollout safety

- **Default state: on for everyone.** Dual-write ships enabled on the first deploy. The flag exists to turn it off if production gets unhappy, not to gate it behind a soak.
- **Reuses the existing Phase 27 CRDT kill switch.** No new flag specifically for dual-write. The single `crdtFeatureFlag.isCRDTEnabled()` (Phase 27 Plan 27-04: localStorage `CRDT_LAYER_DISABLED='1'` > `VITE_CRDT_LAYER_DISABLED='1'` > default ON) is the only switch. When CRDT is off, dual-write is automatically off and the legacy-only path runs. Single source of truth.
- **Live-flippable.** The flag is read from a place that can be changed without a re-deploy (env / localStorage override / remote config). Worst-case rollback time: seconds, not a build cycle.
- **Mid-session flip: takes effect on next document open.** Active editing sessions keep their current dual-write behavior until the user navigates away or refreshes. Protects in-flight writes; no mid-session surprise where the second write suddenly stops happening.

### No "diff = delete" logic anywhere (architectural — locked by roadmap)

- The dual-write code paths must NEVER delete from one store to "match" the other. If the two stores diverge transiently (one save landed, the other didn't), the only allowed remediation is retrying the missing-side write. Code review + a lint rule confirm the pattern is banned by construction. Defends Pitfall 5 (the simple-sync killer).

### Backfill idempotency contract (architectural — locked by roadmap)

- Idempotency key is `client_anno_id` (stable UUID set on annotation creation, carried through legacy + CRDT). Same key + deep-equal value = skip silently. Same key + different value = treat as remote update; bridge through the existing per-property LWW semantics from Phase 29 (`meta.updatedAt` tiebreak). The backfill never overwrites a CRDT row that already has a more recent value.
- Re-running the backfill on the same (user, document) is harmless. Verified by Playwright: run the backfill twice, assert zero duplicates and zero corrupted state.

### Highlights skipped (architectural — locked by roadmap)

- The dual-write fan-out filters by `annotation_type`: highlights take the legacy-only path. Backfill skips them too. v2.5 owns the highlight migration with its own Excel-sync resolution. The `useLegacyHighlightSync` and related Excel-sync code paths stay protected.

### Claude's Discretion

- Exact retry interval and backoff curve for the silent retry queue. Planner picks based on Phase 28's existing retry/reconnect machinery.
- Exact threshold for the "queue stuck" detection (~30 seconds is the user-visible surface time; the underlying retry cadence is implementation detail).
- Exact copy wording for the stuck-queue banner. Mirror Phase 27's banner copy structure.
- Exact threshold for the per-annotation quarantine (~10 retries is the rough ceiling; planner can tune).
- Exact icon shape, size, and position for the document tile "unsaved changes" indicator. Match the existing document list visual language.
- Whether the document tile indicator is per-user (only the user with the stuck queue sees it) or per-document (visible to all collaborators with view access). Likely per-user since the queue is local; planner confirms.
- Web (non-Electron) `device_id` fallback for any annotation in the legacy data without a hostname. Default to `"before-v2.4"` regardless of platform if the legacy data has no device info.
- Exact wording of the Phase 33 "Document migrated to collaborative version" log entry — copy pass during Phase 33.
- Whether the backfill runs synchronously inline with document open or kicks off as a deferred task. Likely deferred so the document renders immediately; planner confirms based on benchmarks.
- Whether to ship a Playwright test that exercises the "edit during backfill" race window, or rely on unit tests around the per-annotation idempotency contract. Likely both; planner picks the surfaces.
- The exact lint rule shape that bans "diff = delete" patterns in migration code. Could be a custom ESLint rule, a `git grep` CI gate, or a code-review checklist callout. Planner picks.

</decisions>

## Acceptance Criteria

- **Given** a v2.4 user creates a brand-new annotation in a document, **when** the save completes, **then** the row appears in both `document_annotations` (legacy) and the CRDT update path (`doc_yjs_updates`), and a v2.3 client opening the same document via the legacy path sees it, and a v2.4 client opening via the CRDT path also sees it.
- **Given** a document contains pre-existing v2.3 annotations, **when** a v2.4 user opens the document for the first time, **then** the page renders immediately with the existing annotations visible, the backfill from legacy → CRDT runs silently in the background with no banner / spinner / completion toast, and the user can draw, drag, and edit normally while it runs.
- **Given** the per-document backfill has run once on a v2.4 client, **when** the same backfill is run again (re-open, second collaborator's first open, or test-driven re-run), **then** zero duplicate annotations are created and no existing CRDT data is overwritten — verified in Playwright.
- **Given** the migration code paths are reviewed, **when** any reconciliation logic is searched for, **then** no code path deletes from one store to match the other; the lint rule (or equivalent CI gate) blocks the pattern by construction.
- **Given** an annotation was created by a v2.3 user named Alice on a Tuesday, **when** that annotation is migrated to v2.4, **then** `meta.authorId` equals Alice's user id, `meta.deviceId` equals the literal string `"before-v2.4"`, and `meta.createdAt` equals the original Tuesday timestamp from the legacy row.
- **Given** a v2.4 user opens an old annotation's properties panel after migration, **when** they look at the device row, **then** it reads "Before v2.4" — and the date row shows the original creation date with no secondary "migrated on..." line.
- **Given** an old (pre-v2.4) annotation and a freshly drawn v2.4 annotation sit on the same page, **when** the user looks at them, **then** they render visually identical — no dotted outline, no hover pill, no "imported" badge differentiates them.
- **Given** a v2.4 user creates an annotation, **when** the legacy write succeeds but the CRDT write fails (or vice versa), **then** the annotation is still visible locally with no error UI, the failed-side write enters a silent retry queue, and the queue continues retrying until success.
- **Given** the silent retry queue is still stuck after roughly 30 seconds, **when** the threshold is crossed, **then** a banner appears at the top of the document matching the existing storage-failure banner shape (sticky, role=alert, locked CSS variables, 2 type weights), reading approximately "Some changes haven't saved yet — try refreshing or check your connection."
- **Given** the user closes the app while a retry queue is still stuck, **when** they reopen the app, **then** the queue persists and resumes automatically — no work is lost.
- **Given** the user re-edits an annotation that has an earlier queued save still pending, **when** the new edit fires, **then** the queue replaces the older queued state with the latest state — the older state is discarded, no out-of-order replays.
- **Given** a specific annotation cannot sync after roughly 10 retry attempts, **when** the quarantine threshold is reached, **then** that annotation gets an inline marker reading **"didn't save, please try redrawing"**, retries stop for that annotation only, and the rest of the queue continues processing other items.
- **Given** a document has at least one stuck queue entry, **when** the user looks at the document list / sidebar without opening the document, **then** a small "unsaved changes" icon is visible on that document's tile so they know to check it.
- **Given** a v2.4 user is offline when they first open a v2.3 document, **when** the document renders, **then** the existing legacy annotations show normally from the local cache, the user can edit, and the backfill defers until the network returns and then runs silently.
- **Given** the existing CRDT kill switch (`crdtFeatureFlag.isCRDTEnabled()`) is set to OFF at runtime, **when** any v2.4 client checks the flag, **then** dual-write is also off automatically and the client reverts to the legacy-only path — no separate dual-write flag exists.
- **Given** an admin or developer flips the kill switch off mid-session, **when** the change propagates, **then** any active editing session continues with its current dual-write behavior until the user navigates away or refreshes; only fresh document opens see the new (off) behavior.
- **Given** the kill switch is flipped via the live-flippable config surface (env / localStorage / remote config), **when** the change is made, **then** no application re-deploy is required — the next document open picks up the new flag value.
- **Given** a v2.4 user creates a highlight annotation, **when** the save fans out, **then** the highlight goes only to the legacy `document_annotations` path — the CRDT path is bypassed entirely (Excel-sync carve-out, folded into v2.5).
- **Given** the activity log ships in Phase 33, **when** it renders the migration history for a document, **then** there is exactly one "Document migrated to collaborative version" row per migrated document with the import-day timestamp — never one row per annotation.

## DO NOT CHANGE

Always-Protected default list (carry forward from project-wide rules):

- `src/App.jsx` — **DO NOT CHANGE.** Phase 30 has no App.jsx surface; the dual-write path runs entirely beneath the document-open boundary already established by Phase 27.
- `src/components/PageAnnotationLayer.jsx` — **DO NOT CHANGE.** PAL stays untouched. Per-roadmap explicit boundary note.
- `src/components/FabricDrawingCanvas.jsx` — **DO NOT CHANGE.** Pen drawing still flows through the existing Phase 11 commit pipeline; Phase 30 hooks at the React-state / persistence boundary, not inside FDC.
- `src/components/FabricEraserCanvas.jsx` — **DO NOT CHANGE.**
- `src/components/FabricEditCanvas.jsx` — **DO NOT CHANGE.** Phase 29's narrow waiver was scoped to that phase only and does not carry forward.
- `src/components/SVGAnnotationLayer.jsx` — **DO NOT CHANGE.** SVG layer continues to read from React state (now derived from Y.Doc via Phase 29's `useAnnotationsCRDT`) and never learns about migration.
- `package.json` — **DO NOT CHANGE.** Phase 30 adds zero new dependencies. The dual-write logic uses existing Supabase client + Yjs trio installed in Phase 27.
- `vite.config.js` — **DO NOT CHANGE.**
- `src/services/annotationCloudSync.js` — **NARROW WAIVER GRANTED for this phase** for the dual-write fan-out logic. Every new-annotation save fans out to legacy + CRDT; the file gains the dual-write entry point and the highlight-skip filter. Surgical only — preserve existing legacy-write behavior unchanged when the kill switch is off.
- Phase 27 ships (`src/lib/collab/ydocLifecycle.js`, `src/lib/collab/crdtFeatureFlag.js`, `src/lib/collab/storageFailureDetector.js`, `src/components/collab/YDocProvider.jsx`, `src/hooks/useYDoc.js`, `src/components/collab/StorageFailureBanner.jsx`, `src/components/collab/StorageFailureBanner.css`) — **protected as an extension surface.** The stuck-queue banner reuses `StorageFailureBanner`'s structure with new copy variants; the existing component is not rewritten. The kill switch reuses `crdtFeatureFlag` directly.
- Phase 27 schema (`doc_yjs_updates`, `doc_yjs_state`, `activity_log`) — **column shape protected.** Phase 30 reads / writes through the existing Phase 27 + 28 plumbing; no schema changes.
- Phase 28 ships (transport provider, server validator, RLS policies, auth handshake, `permission_revoked` channel) — **protected.** Phase 30 consumes them via the established context boundaries.
- Phase 29 ships (`src/lib/collab/crdtAnnotationBridge.js`, `src/lib/collab/crdtUndoManager.js`, `src/hooks/useAnnotationsCRDT.js`, the per-mount registry, the per-user undo manager, the "Removed by [name] — Restore?" toast extension) — **protected.** Phase 30's dual-write hooks into the bridge's commit path; it does not modify the bridge or undo manager.
- Legacy highlight sync code (`useLegacyHighlightSync` and related Excel-sync paths) — **protected.** Highlights stay on legacy through v2.4. Phase 30's dual-write skips highlights entirely.
- Legacy `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue` paths — **protected** through Phase 30. Decommission is Phase 34. Phase 30 extends the cloud-sync code path with dual-write but does not rewrite the legacy path or remove the code.
- v2.3 phase directories (`.planning/phases/14-*` through `.planning/phases/19-*`) — out of scope.
- v3.0 PDF-Native phase directories (`.planning/phases/20-*` through `.planning/phases/26-*`) — parallel milestone, out of scope.
- Other v2.4 phase directories (`.planning/phases/27-*`, `.planning/phases/28-*`, `.planning/phases/29-*`, `.planning/phases/31-*` through `.planning/phases/34-*`) — out of scope; concerns explicitly deferred above or already shipped.

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.4 research (already loaded for Phases 27 + 28 + 29 — re-read SUMMARY + ARCHITECTURE + PITFALLS focus on 1, 5)
- `.planning/research/SUMMARY.md` — single decision document; migration dual-write era + cutover seal sequencing called out explicitly. Pitfall 1 (migration partial-state) defended by Phases 30 + 31.
- `.planning/research/PITFALLS.md` — 22 pitfalls; Phase 30 defends Pitfall 1 (migration partial-state — old clients keep writing legacy rows during rollout) and Pitfall 5 (1-second verify-wipe regression — no diff-equals-delete logic anywhere).
- `.planning/research/ARCHITECTURE.md` — SVG-display + Fabric-edit immutable; CRDT layer wraps under React state; migration sits at the React-state ↔ persistence boundary. Highlights stay on legacy through v2.4.
- `.planning/research/STACK.md` — Yjs trio versions; Supabase client; no new dependencies in Phase 30.

### Phase 27 + 28 + 29 foundation (read before planning)
- `.planning/phases/27-crdt-foundation/27-CONTEXT.md` — applyUpdate-only invariant (Phase 30 honors on every CRDT-side write); storage-failure banner pattern (canonical reference for the stuck-queue banner); highlights-stay-on-legacy carve-out.
- `.planning/phases/27-crdt-foundation/27-04-PLAN.md` — `crdtFeatureFlag.isCRDTEnabled()` three-tier read order. Phase 30's kill switch reuses this directly.
- `.planning/phases/27-crdt-foundation/27-05-PLAN.md` — `<YDocProvider docId>` mount pattern. Phase 30's backfill module runs inside this provider boundary.
- `.planning/phases/27-crdt-foundation/27-UI-SPEC.md` — banner pattern Phase 30's stuck-queue banner reuses verbatim with new copy variant.
- `.planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md` — transaction-origin payload (Phase 30 dual-write transactions carry the same payload via the Phase 29 bridge); transport-failure banner pattern; `permission_revoked` channel (Phase 30 dual-write skips when revoked).
- `.planning/phases/28-transport-spike-auth-validator/28-RECONCILIATION.md` — locked transport choice (custom Supabase Realtime adapter); RLS policies on `doc_yjs_updates` + `doc_yjs_state`.
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-CONTEXT.md` — Fabric ↔ Y.Map bridge contract; `applyFabricCommit` is the entry point Phase 30's dual-write fan-out hooks alongside the legacy write.
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-RECONCILIATION.md` — Phase 29 closure; identifies that the bridge does NOT include legacy-side writes (Phase 30 owns that fan-out).

### Project-level (load-bearing)
- `CLAUDE.md` — Always-Protected file list; per-phase narrow-waiver pattern; phase discipline (Acceptance Criteria + DO NOT CHANGE + RECONCILIATION.md). Container-aware sizing rule, single-name `fontFamily` rule, and `zoomGeneration` signal preservation rule all stay honored — Phase 30 has no canvas-sizing surface but should not regress them.
- `.planning/PROJECT.md` — current milestone overview, v2.4 goal + scope.
- `.planning/REQUIREMENTS.md` — MIGRATE-01 (Phase 30's binding requirement); MIGRATE-02 (Phase 31's, but referenced for sequencing); traceability table.
- `.planning/ROADMAP.md` — Phase 30 detailed section: success criteria 1-5, boundary notes (`annotationCloudSync.js` narrow waiver, `crdtBackfill.js` new), expected new files. Phase 31 detail (cutover seal) referenced for what comes next.

### Existing app code (scout findings — confirm during research step)
- `src/services/annotationCloudSync.js` (~445 LOC) — current legacy-write path. Phase 30 lands the dual-write fan-out here under narrow waiver. Surgical: preserve existing legacy behavior, add the fan-out + highlight-skip filter.
- `src/lib/collab/crdtFeatureFlag.js` — existing kill switch. Phase 30 imports `isCRDTEnabled()` and gates the dual-write path on it.
- `src/lib/collab/crdtAnnotationBridge.js` — Phase 29's bridge. The CRDT-side write in dual-write fan-out goes through this module's `applyFabricCommit` entry point.
- `src/lib/collab/SupabaseYjsProvider.js` — Phase 28's transport. Phase 30's CRDT-side writes ride this provider.
- `src/components/collab/StorageFailureBanner.jsx` + `.css` — base component the stuck-queue banner extends with new copy variant.
- `src/components/collab/YDocProvider.jsx` — Phase 30's backfill module mounts inside this provider boundary so it has access to the per-document Y.Doc.

### Yjs library docs (researcher loads in Phase 30 research step)
- `Y.Map` semantics — property-level merge, idempotency on re-applying the same key+value (`client_anno_id`-keyed backfill).
- Yjs transactions and origins — backfill writes carry an explicit `{ source: 'crdt-backfill', userId, deviceId: 'before-v2.4', sessionId, clientID, serverTs }` origin so they're distinguishable from live edits in the activity log later.
- Web Locks API — advisory lock for the per-(user, document) backfill to prevent two tabs racing.

### Supabase docs
- Supabase Realtime + RLS — Phase 28's plumbing; Phase 30 consumes without modification.
- Supabase Postgres — `client_anno_id` indexing on `document_annotations` for fast idempotency lookups during backfill.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/services/annotationCloudSync.js`** — current legacy-write entry point. Phase 30 lands the dual-write fan-out here under narrow waiver. ~445 LOC; the file already understands the annotation lifecycle and the cloud-sync queue. Surgical extension, not a rewrite.
- **`src/lib/collab/crdtFeatureFlag.js`** — Phase 27's kill switch with three-tier read order. Phase 30 reuses directly via `isCRDTEnabled()`. No new flag.
- **`src/lib/collab/crdtAnnotationBridge.js`** — Phase 29's `applyFabricCommit(yMap, fabricObject, originPayload)` entry point. Phase 30's dual-write CRDT-side writes flow through this. The legacy-side writes flow through the existing `annotationCloudSync` queue.
- **`src/lib/collab/SupabaseYjsProvider.js`** — Phase 28's transport provider. Phase 30's CRDT writes ride this provider; no new transport plumbing.
- **`src/components/collab/StorageFailureBanner.jsx` + `.css`** — base banner component for the stuck-queue surface. New copy variant only; structure / styling / behavior reused verbatim.
- **`src/components/collab/YDocProvider.jsx`** — React context. Phase 30's backfill module mounts inside this provider boundary so it has scoped access to the per-document Y.Doc.
- **`src/lib/collab/ydocLifecycle.js`** + `applyUpdate`-only invariant grep test — Phase 30's backfill writes go through `applyUpdate` semantics, never wholesale state replacement.
- **Existing Supabase client setup** — same auth session, same client instance reused for the legacy + CRDT side writes. Auth refresh from Phase 28 covers both paths.
- **Phase 28 transaction-origin payload** `{ userId, deviceId, sessionId, clientID, serverTs }` — Phase 30's backfill extends with `source: 'crdt-backfill'`; live edits use the Phase 29 `source: 'local-fabric'`.

### Established Patterns
- **Per-phase narrow-lane waivers for Always-Protected files.** Phase 30 needs one: `src/services/annotationCloudSync.js`. App.jsx + the FabricEditCanvas + FabricDrawingCanvas + FabricEraserCanvas + SVG / PAL stay untouched.
- **Banner / toast shape via `StorageFailureBanner` extension.** Every CRDT-layer surface (Phase 27 storage failure, Phase 28 transport / kicked / login expiry, Phase 29 "Restore?" toast, Phase 30 stuck-queue) follows the same shape with new copy + action variants.
- **Origin-tagged transactions.** Every `ydoc.transact(fn, origin)` call carries the full payload. Phase 30's backfill carries `source: 'crdt-backfill'` so Phase 33's activity log can render a distinct "Migrated" entry.
- **`applyUpdate`-only invariant.** No code path replaces a Y.Doc wholesale. Phase 30's backfill follows this on every per-annotation write.
- **Identity-by-stable-uuid (`client_anno_id`).** Annotations carry stable UUIDs that legacy rows + CRDT rows + Fabric objects all key by. Backfill idempotency rides this UUID directly.
- **Honesty-over-silent-fallback for failure modes.** Carries forward from Phases 27, 28: silent fallback is forbidden when something is genuinely broken. Stuck-queue surfaces a banner; quarantined annotations get a per-annotation marker. Transient blips stay silent.

### Integration Points
- **`src/lib/collab/crdtBackfill.js` (NEW)** — pure module. Per-document, per-user idempotent backfill from legacy → CRDT. Web Locks-arbitrated against same-user-same-doc tab races. Consumed by `<YDocProvider docId>` on first v2.4 open.
- **`src/services/annotationCloudSync.js`** — narrow waiver: dual-write fan-out logic + highlight-skip filter. Surgical: preserve existing legacy behavior unchanged when the kill switch is off.
- **Stuck-queue banner copy variant** — extends `StorageFailureBanner` with new `code: 'sync_queue_stuck'` (or similar; planner picks). Shipping path: a copy file or a switch on the existing `code` enum, not a new component.
- **Document tile "unsaved changes" icon** — extends the existing document list / sidebar component (planner identifies which file owns it; likely sits inside the existing dashboard UI). Reads queue state from the same source the in-doc banner reads from.
- **`src/components/collab/YDocProvider.jsx`** — Phase 30's backfill module hooks here on document mount. The provider already exists; Phase 30 adds the backfill trigger inside without modifying provider behavior.
- **Per-annotation "didn't save" marker** — small inline visual on the annotation itself when quarantined. Renders inside the SVG layer's existing per-annotation slot — the SVG layer reads a flag from React state without learning about migration internals.

</code_context>

<specifics>
## Specific Ideas

- **"Linear / Figma / Notion silent migration" — explicit user reference for first-open feel.** No banner, no spinner, no completion toast. Modern apps handle this transparently and so should we.
- **"didn't save, please try redrawing" — exact copy on the per-annotation quarantine marker.** User-refined wording. Tells the user what happened AND what to do, instead of a generic error.
- **"Before v2.4" — exact device tag string.** Version-explicit, matches the data field, lets support correlate with release notes.
- **One activity log entry per migrated document, not per annotation.** Keeps the log clean. Phase 33's job to render this.
- **Reuse the existing CRDT kill switch** — single source of truth, no new flag for dual-write specifically. Whatever turns the collab layer off also turns dual-write off.
- **Document tile shows "unsaved changes" icon BEFORE open** — user knows even before opening the document. Combines with the in-doc banner once they open it.
- **Tab tile signal is per-user** (likely; planner confirms) — the queue is local to the user's session, so only the affected user sees the indicator.

</specifics>

<deferred>
## Deferred Ideas

- **Cutover seal (`migrated_at` flag, legacy-table read-only enforcement, v2.3 "please update" gate)** — Phase 31 (MIGRATE-02). Phase 30 stops at dual-write era; Phase 31 flips the source-of-truth.
- **Activity log surface for the "Document migrated" row** — Phase 33. Phase 30 ships the data path (`source: 'crdt-backfill'` origin tag); Phase 33 renders the row.
- **Right-click "Tags" + properties three-dot "Tags" surface for the device row** — Phase 33. Phase 30 ships the `meta.deviceId = "before-v2.4"` data; the UI surface lands later.
- **Highlight migration** — v2.5. Folded out of v2.4 due to Excel-sync risk. Phase 30 explicitly skips highlights; the legacy highlight sync path stays untouched.
- **Decommission of legacy `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`** — Phase 34. Phase 30 extends these paths with dual-write; removal is the final v2.4 phase.
- **Periodic Y.Doc compaction job, BroadcastChannel cross-tab sync, two-tab Playwright stress** — Phase 32.
- **Sharing UX + 4-role permission UI** — Phase 34.
- **Custom ESLint rule (or equivalent) banning "diff = delete" patterns** — implementation detail; planner picks the surface (custom rule, CI grep, or code-review checklist).
- **Owner-only backfill restriction** — explicitly rejected. Any collaborator with edit access triggers the backfill; idempotency makes concurrent runs harmless.
- **Visual "imported" marker on pre-v2.4 annotations** — explicitly rejected. Migrated annotations render identically to native ones.
- **"Migrated on..." secondary date row in properties** — explicitly rejected. Properties show original creation date only.
- **Separate dual-write feature flag** — explicitly rejected. Reuses the existing CRDT kill switch as the single source of truth.
- **Mid-session kill-switch flip taking effect immediately** — explicitly rejected. Active sessions keep current behavior; only fresh document opens see the new flag value.
- **Per-annotation queue replay (every edit gets its own queue entry)** — explicitly rejected. Latest version wins; the queue holds only the most recent state of each annotation.
- **Retry-forever for permanently-failing annotations** — explicitly rejected. Quarantine after ~10 attempts with an inline "didn't save, please try redrawing" marker.

</deferred>

---

*Phase: 30-migration-dual-write*
*Context gathered: 2026-04-28*
