---
phase: 31-migration-cutover-seal
milestone: v2.4
created: 2026-04-30T22:00:00Z
status: ready-to-plan
opened_by: previous session at user direction (2026-04-30)
---

# Phase 31 — Migration Cutover Seal (LEAN VARIANT)

## Why This Phase Exists

Today every save of a single annotation triggers a full-document bulk
upsert into `document_annotations`. On bloated test PDFs (512+ rows on
SE-011, 21K+ rows on Package 2), the bulk push exceeds Postgres' 60-second
statement timeout and the `sync_queue_stuck` banner flashes red repeatedly.
Phase 30 shipped the dual-write CRDT layer (Y.Doc + IndexedDB +
Realtime broadcast) that scales with **changes**, not document size.
But the legacy bulk-upsert path still fires alongside it on every save —
the new layer never gets to be the only writer. This phase pulls the plug
on the legacy writer and lets the CRDT path own the cloud round-trip.

## Goal

After this phase ships, a single annotation edit on any document — no
matter how many rows it already has — completes a cloud round-trip in
**under one second** and never triggers a 60-second statement timeout.

## Scope (Lean Variant — User-Approved 2026-04-30)

The roadmap version of Phase 31 included production-grade safeguards:
"please update" gates for v2.3 clients, parity-watching windows where
both layers run side-by-side, sealed-doc admin migrations. The user
explicitly de-scoped those for solo testing on disposable test PDFs.
The lean variant ships only what's necessary to flip writes:

1. **Kill the legacy bulk-upsert write path.** `useAnnotationCloudSync.js`
   today calls `upsertAnnotationsByPage` on every debounced save. After
   this phase, that call is gated behind a `LEGACY_BULK_UPSERT_ENABLED`
   feature flag that defaults to `false`. CRDT-side writes (the Phase 30
   `dualWriteFabricCommit` + `dualWriteFabricDelete` fan-out) become
   the sole authoritative writer.
2. **Per-doc one-shot backfill on first open.** When a doc is opened
   post-cutover, if its CRDT state lacks any annotations that exist in
   `document_annotations`, copy them into the Y.Doc once and mark the
   doc as cutover-complete (a flag on the documents row, e.g.
   `cutover_completed_at`). Subsequent opens skip the backfill.
3. **Stable annotation IDs at creation time.** Today annotations get
   their `data.id` only on first cloud upload via
   `serializeFabricObjectToRow`. After the cutover the legacy upload
   path is gone, so IDs must be minted at creation time. Counter
   pointerdown handlers (`App.jsx` overlays #1 and #2), pen commit in
   `FabricDrawingCanvas`, callout creation, text/shape commits — every
   creation site stamps `data.id = crypto.randomUUID()`. This also closes
   the Phase 35 delete-fallback gap that was hardened on 2026-04-30.
4. **Hydrate from CRDT.** When a doc's `cutover_completed_at` is set,
   open the doc by reading from the Y.Doc snapshot (Phase 27 `doc_yjs_state`
   table) instead of querying `document_annotations`. Legacy reads stay
   available for cold-open of un-cutover docs (so existing data still
   loads on the first post-cutover open).

## Out of Scope (Deferred to Phase 31.5 / Phase 32)

- "Please update" version gate for v2.3 clients (no v2.3 clients exist
  in the wild for this app).
- Parallel-write parity verification window (we'll let the kill switch
  be the verification — if something breaks, the user reports it and we
  fix in place).
- Automatic backfill for ALL docs at cutover time (per-doc lazy
  backfill on first post-cutover open is enough).
- Deletion of `document_annotations` rows (preserved for read-back
  during the transition — Phase 32 hardening can drop the table).
- Highlights — they ride the legacy sync path through v2.4 by design.

## Acceptance Criteria

- **Given** a document with 500+ existing annotations stored only in
  `document_annotations`, **when** the user opens the doc after cutover,
  **then** all 500+ annotations render within 3 seconds AND the doc's
  `cutover_completed_at` timestamp is set on the documents row AND the
  Y.Doc snapshot now contains those annotations.
- **Given** a cutover-complete document, **when** the user adds a single
  annotation, **then** the cloud round-trip completes in under 1 second
  AND no row is inserted into `document_annotations` AND the Y.Doc's
  `annotations` Y.Map contains the new entry within 200ms.
- **Given** a cutover-complete document, **when** the user deletes an
  annotation, **then** it disappears within 200ms locally AND the
  Y.Doc's `annotations` Y.Map removes the entry AND no `DELETE` query
  fires against `document_annotations`.
- **Given** an annotation drawn after cutover lands, **when** the row
  is inspected, **then** it carries a stable `data.id` minted at creation
  time (UUID format) AND that id matches the Y.Doc Y.Map key.
- **Given** the legacy bulk-upsert kill switch is off, **when** the user
  performs any annotation save, **then** zero calls fire to
  `upsertAnnotationsByPage` AND the `[CloudSync][push]
  upsertAnnotationsByPage start` log line is absent from the console.
- **Given** any sync failure (cloud unreachable, mid-write disconnect),
  **when** the user reconnects, **then** the queued CRDT updates flush
  cleanly without falling back to the legacy bulk path.
- **Given** the user reloads the page after editing offline, **when**
  the doc opens, **then** all offline edits are present (IndexedDB
  persistence + on-reconnect sync — Phase 27 contract preserved).

## DO NOT CHANGE

- `src/components/PageAnnotationLayer.jsx` — core PAL render loop, fully
  protected.
- `src/components/SVGAnnotationLayer.jsx` — SVG viewBox owns zoom; no JS
  zoom coordination.
- `src/components/FabricDrawingCanvas.jsx`,
  `src/components/FabricEraserCanvas.jsx`,
  `src/components/FabricEditCanvas.jsx` — `zoomGeneration` signal
  contract is load-bearing.
- `src/App.jsx` — narrow waiver allowed ONLY for ID-at-creation stamping
  in the two counter overlay pointerdown handlers (~line 29811 and
  ~line 31158). No other App.jsx edits.
- `package.json`, `vite.config.js` — infra, no touches.
- `src/services/annotationTypeSerializers.js` `generateClientId` helper —
  preserved for backfill use; the live-write path stops calling it but
  the function itself stays for cold-doc backfill.
- The Phase 30 dual-write queue (`crdtDualWriteQueue.js`) and the
  failure-banner code (`StorageFailureBanner.jsx`) — Phase 31 builds on
  top of them; no rewrites.
- Highlights pipeline (`highlightAnnotations` + the upsertHighlights
  paths) — out of scope; rides legacy through v2.4.

## Files in Scope (Where the Diff Will Land)

- `src/hooks/useAnnotationCloudSync.js` — gate the legacy bulk-upsert
  call behind `LEGACY_BULK_UPSERT_ENABLED`. Add the per-doc backfill
  trigger on doc open. Switch the hydrate path to read from Y.Doc when
  `cutover_completed_at` is set.
- `src/services/annotationCloudSync.js` — read the kill switch; no-op
  the bulk path when disabled. Optionally add a backfill helper.
- `src/lib/collab/crdtBackfill.js` — already exists from Phase 30 Plan
  02; extend to handle the doc-open backfill trigger and write the
  `cutover_completed_at` timestamp.
- `src/components/collab/YDocProvider.jsx` — wire the cutover flag check
  into the hydrate flow.
- `src/App.jsx` — narrow ID-at-creation stamping for counter pins
  (overlays #1 and #2) under the existing standing waiver.
- `supabase/migrations/2026XXXXXXXXX_add_cutover_completed_at.sql` —
  new column on `documents`.
- `src/lib/collab/featureFlags.js` (or extend the existing CRDT flag
  module) — `LEGACY_BULK_UPSERT_ENABLED` flag with localStorage override
  for emergency rollback.

## Test Plan

1. **Unit:** `crdtBackfill` handles the new doc-open trigger and writes
   the cutover timestamp. ID-at-creation stamping fires for every
   annotation type. Kill-switch off path produces zero
   `upsertAnnotationsByPage` calls.
2. **Manual UAT (user, 2026-05-01):**
   - Open SE-011 (the 512-row doc). Add a counter pin. Watch save
     complete in under 1 second; no red banner. Confirm
     `cutover_completed_at` set on the doc row.
   - Open Package 2 (the 21K-row doc). Add a callout. Same expectation.
   - Reload page. All annotations still present.
   - Toggle the kill switch via DevTools localStorage; legacy path
     re-engages as a panic rollback.
3. **Regression:** existing Phase 30 tests stay green
   (429p / 8f / 6s baseline). Phase 35 hardening preserved.

## Risk and Rollback

- **Risk:** a doc opens after cutover, the backfill runs, but the
  legacy rows fail to copy into Y.Doc cleanly — user sees half the
  annotations missing.
  **Mitigation:** the backfill is idempotent and the cutover timestamp
  is only set after a verified count match. If the backfill fails, the
  doc stays uncutover-flagged and the next open retries.
- **Risk:** an unrelated edge case in the Phase 30 fan-out path was
  hidden by the legacy bulk-upsert acting as a safety net.
  **Mitigation:** rollback via `LEGACY_BULK_UPSERT_ENABLED=true` in
  localStorage. Single-flag flip, no schema changes to revert.
- **Risk:** annotations created mid-flight (during the cutover effect's
  microtask delay) get half-written.
  **Mitigation:** ID-at-creation stamping ensures every annotation has
  a stable handle from frame one; the dual-write path was already
  idempotent.

## Resumption Note for Next Session

Run `/gsd:plan-phase 31` to decompose this into wave-based plans.
Counter rapid-fire guard + Phase 35 delete hardening landed at session
close on 2026-04-30; both stay in effect. Tests at 429p/8f/6s.
Don't re-test Phase 35 UAT in the same session as the cutover — too
many moving parts at once.

User authorization: lean variant pre-approved 2026-04-30. Ship the
kill switch and the per-doc backfill; production guardrails intentionally
deferred. User explicitly accepts post-cutover regression risk on test
PDFs.
