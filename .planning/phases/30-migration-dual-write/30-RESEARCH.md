# Phase 30: Migration Phase A — Dual-Write Era - Research

**Researched:** 2026-04-28
**Domain:** Idempotent dual-write migration from legacy Fabric-JSON rows to CRDT (Yjs) shared types, with stuck-queue retry and silent first-open backfill
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### First-open import feel

- **Silent migration.** When a v2.4 user opens a document that has pre-existing v2.3 annotations, the copy from legacy → CRDT runs silently in the background. No banner, no spinner, no "moving your work over" text. The annotations just appear like normal. Pattern reference (user-named): Linear, Figma, Notion silent migration.
- **No edit-blocking.** The user can draw, edit, drag, and erase normally while the backfill runs underneath. New edits go through the dual-write path; the backfill catches up the older annotations in parallel. Per-annotation idempotency (keyed by `client_anno_id`) handles the brief race window.
- **Silent retry on partial failure.** If the backfill fails partway through (network blip, transient error), the next v2.4 open of the same document silently retries. Already-imported annotations are skipped by `client_anno_id`; only the missing ones get re-attempted. No error UI fires.
- **No completion confirmation.** Once the backfill finishes there is no toast, no chip, no marker. Migrated documents are indistinguishable from native v2.4 documents.
- **Size-independent.** Even for documents with hundreds of pre-v2.4 annotations, the silent feel still holds — no progress bar, no size-based threshold UI.
- **Offline first-open works.** If a user opens a v2.3 document on v2.4 with no network, the document still renders the legacy annotations from the local cache normally. The backfill simply waits until network returns and runs at that point.
- **Trigger condition.** Any collaborator with edit access running v2.4 triggers the backfill on their first open. No "owner-only" restriction. The backfill is idempotent so concurrent runs across collaborators are harmless.
- **Read source during the copy window.** While the backfill is in flight, the v2.4 read path renders from the legacy data, then flips to the CRDT store atomically once the copy completes. The user never sees a half-imported state.

#### Half-failed save (one of the two writes lands, the other doesn't)

- **Default: silent retry queue.** Every new annotation lands locally first (IndexedDB via Y.Doc). The two outbound writes (legacy `document_annotations` insert + CRDT update sync) each have their own retry path. If one fails, the other still succeeds; the failed side queues and retries silently in the background. Pattern reference: standard offline-first dual-write.
- **30-second silence threshold.** The queue retries silently for roughly 30 seconds. If it's still stuck after that, a banner surfaces explaining that some saves are catching up.
- **Stuck-queue banner reuses existing pattern.** Same shape, locked CSS variables, role=alert, sticky positioning, and 2 type weights as Phase 27's `StorageFailureBanner` and Phase 28's transport / kicked / login-expiry banners. Copy variant only: "Some changes haven't saved yet — try refreshing or check your connection."
- **Editing stays fully unblocked.** While the retry queue drains, the user can keep drawing, editing, and erasing without restriction. New edits go into the same queue and ride along.
- **Queue survives app close.** Pending queue entries persist to local storage and replay automatically when the app re-opens. The user does not lose work if they close the tab / restart the desktop app while the queue is stuck.
- **Re-edit while queued: latest version wins.** If the user modifies an annotation that already has an earlier save sitting in the queue, the queued entry is replaced with the newest state. No stale-write replay, no out-of-order writes.
- **Quarantine after ~10 retries.** If a specific annotation cannot sync after roughly 10 attempts, it gets a small inline marker on the annotation that reads **"didn't save, please try redrawing"** and stops retrying. The rest of the queue keeps moving — one bad item never blocks the whole queue.
- **Document tile signal.** When a document has a stuck queue, the document list / sidebar tile shows a small "unsaved changes" icon BEFORE the user opens the document.

#### Old-author tag wording (MIGRATE-01 surfaces)

- **Device tag string: "Before v2.4".** Pre-v2.4 annotations get `meta.deviceId = "before-v2.4"` in storage; the user-visible string in tooltips, properties, and (later) the activity log reads literally "Before v2.4".
- **Original creator stays as author.** The legacy `created_by` user becomes `meta.authorId` exactly as MIGRATE-01 requires. No relabeling, no "Imported by" override.
- **Visually identical rendering.** Imported annotations render exactly like fresh v2.4 annotations on the page. No dotted outlines, no "imported" pills, no hover hints.
- **Properties date row: original creation date only.** When the user opens an annotation's properties panel later, the date/time row shows when the annotation was originally drawn (preserves `meta.createdAt`). No "migrated on..." secondary row.
- **Activity log entry: one "Migrated" row per document on import day.** When the activity log ships in Phase 33, the migration surfaces as a single row per document — "Document migrated to collaborative version" with the import-day timestamp. Phase 30 only needs the data path so Phase 33 can render that single row.

#### Kill switch / rollout safety

- **Default state: on for everyone.** Dual-write ships enabled on the first deploy.
- **Reuses the existing Phase 27 CRDT kill switch.** No new flag specifically for dual-write. The single `crdtFeatureFlag.isCRDTEnabled()` (Phase 27 Plan 27-04: localStorage `CRDT_LAYER_DISABLED='1'` > `VITE_CRDT_LAYER_DISABLED='1'` > default ON) is the only switch.
- **Live-flippable.** The flag is read from a place that can be changed without a re-deploy.
- **Mid-session flip: takes effect on next document open.** Active editing sessions keep their current dual-write behavior until the user navigates away or refreshes. Protects in-flight writes; no mid-session surprise.

#### No "diff = delete" logic anywhere (architectural — locked by roadmap)

- The dual-write code paths must NEVER delete from one store to "match" the other. If the two stores diverge transiently, the only allowed remediation is retrying the missing-side write. Code review + a lint rule confirm the pattern is banned by construction. Defends Pitfall 5 (the simple-sync killer).

#### Backfill idempotency contract (architectural — locked by roadmap)

- Idempotency key is `client_anno_id` (stable UUID set on annotation creation, carried through legacy + CRDT). Same key + deep-equal value = skip silently. Same key + different value = treat as remote update; bridge through the existing per-property LWW semantics from Phase 29 (`meta.updatedAt` tiebreak). The backfill never overwrites a CRDT row that already has a more recent value.
- Re-running the backfill on the same (user, document) is harmless. Verified by Playwright: run the backfill twice, assert zero duplicates and zero corrupted state.

#### Highlights skipped (architectural — locked by roadmap)

- The dual-write fan-out filters by `annotation_type`: highlights take the legacy-only path. Backfill skips them too. v2.5 owns the highlight migration. The `useLegacyHighlightSync` and related Excel-sync code paths stay protected.

### Claude's Discretion

- Exact retry interval and backoff curve for the silent retry queue. Planner picks based on Phase 28's existing retry/reconnect machinery.
- Exact threshold for the "queue stuck" detection (~30 seconds is the user-visible surface time; the underlying retry cadence is implementation detail).
- Exact copy wording for the stuck-queue banner. Mirror Phase 27's banner copy structure.
- Exact threshold for the per-annotation quarantine (~10 retries is the rough ceiling; planner can tune).
- Exact icon shape, size, and position for the document tile "unsaved changes" indicator. Match the existing document list visual language.
- Whether the document tile indicator is per-user (only the user with the stuck queue sees it) or per-document (visible to all collaborators). Likely per-user since the queue is local; planner confirms.
- Web (non-Electron) `device_id` fallback for any annotation in the legacy data without a hostname. Default to `"before-v2.4"` regardless of platform if the legacy data has no device info.
- Exact wording of the Phase 33 "Document migrated to collaborative version" log entry — copy pass during Phase 33.
- Whether the backfill runs synchronously inline with document open or kicks off as a deferred task. Likely deferred so the document renders immediately; planner confirms based on benchmarks.
- Whether to ship a Playwright test that exercises the "edit during backfill" race window, or rely on unit tests around the per-annotation idempotency contract. Likely both; planner picks the surfaces.
- The exact lint rule shape that bans "diff = delete" patterns in migration code. Could be a custom ESLint rule, a `git grep` CI gate, or a code-review checklist callout. Planner picks.

### Deferred Ideas (OUT OF SCOPE)

- **Cutover seal (`migrated_at` flag, legacy-table read-only enforcement, v2.3 "please update" gate)** — Phase 31 (MIGRATE-02). Phase 30 stops at dual-write era; Phase 31 flips the source-of-truth.
- **Activity log surface for the "Document migrated" row** — Phase 33. Phase 30 ships the data path (`source: 'crdt-backfill'` origin tag); Phase 33 renders the row.
- **Right-click "Tags" + properties three-dot "Tags" surface for the device row** — Phase 33.
- **Highlight migration** — v2.5. Folded out of v2.4 due to Excel-sync risk.
- **Decommission of legacy `useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`** — Phase 34.
- **Periodic Y.Doc compaction job, BroadcastChannel cross-tab sync, two-tab Playwright stress** — Phase 32.
- **Sharing UX + 4-role permission UI** — Phase 34.
- **Custom ESLint rule (or equivalent) banning "diff = delete" patterns** — implementation detail; planner picks.
- **Owner-only backfill restriction** — explicitly rejected. Any collaborator with edit access triggers.
- **Visual "imported" marker on pre-v2.4 annotations** — explicitly rejected.
- **"Migrated on..." secondary date row in properties** — explicitly rejected.
- **Separate dual-write feature flag** — explicitly rejected.
- **Mid-session kill-switch flip taking effect immediately** — explicitly rejected.
- **Per-annotation queue replay (every edit gets its own queue entry)** — explicitly rejected. Latest version wins.
- **Retry-forever for permanently-failing annotations** — explicitly rejected. Quarantine after ~10 attempts.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MIGRATE-01 | Existing annotations created in v2.3 and earlier appear correctly in v2.4 with no data loss; original creation user becomes the recorded author with a "before-v2.4" device tag | (1) Backfill idempotency contract via `client_anno_id` keyed Y.Map writes (this doc §"Backfill: idempotency mechanics"); (2) `meta.authorId` set from legacy `user_id` row, `meta.deviceId = "before-v2.4"`, `meta.createdAt` from legacy row's `created_at` (this doc §"Author/device/timestamp mapping"); (3) Origin-tagged transactions with `source: 'crdt-backfill'` so Phase 33 activity log can render one "Migrated" row per document (this doc §"Origin tagging"); (4) Same-key + deep-equal value re-apply is safe (HIGH confidence per Yjs Y.Map semantics; this doc §"Y.Map idempotency under re-application") |
</phase_requirements>

## Summary

Phase 30 sits at the React-state ↔ persistence boundary, beneath the Fabric/SVG/PAL layers. It introduces two surfaces against an already-stable CRDT foundation (Phases 27–29): (a) a dual-write fan-out inside the existing `src/services/annotationCloudSync.js` (narrow waiver) so every new v2.4 annotation save lands in BOTH the legacy `document_annotations` row AND the new CRDT path via the Phase 29 bridge; (b) a new pure module `src/lib/collab/crdtBackfill.js` that runs once per (user, document) on first v2.4 open, copying legacy rows into the Y.Doc keyed by `client_anno_id`, advisory-locked via the Web Locks API to prevent two tabs of the same user double-importing the same document. The half-failed-save case is handled by a persistent retry queue (one of the two writes lands, the other doesn't) with quarantine-after-N semantics and a banner surface that reuses Phase 27's `StorageFailureBanner` verbatim with a new `code: 'sync_queue_stuck'` copy variant.

Three load-bearing facts make this phase shippable without library churn:

1. **Yjs Y.Map is idempotent under same-key + same-value re-application.** Document updates are commutative and idempotent at the binary-update level (HIGH confidence per official Yjs README + community discussion). Per-property `Y.Map.set(k, v)` with a deep-equal `v` produces no observable state change beyond a small constant-size update entry. The bridge already implements a `shallowEqual` skip in `applyFabricCommit` (line 71-88 of `crdtAnnotationBridge.js`) — backfill reuses this exact bridge entry point so re-runs are no-ops by construction.
2. **Web Locks API is universally supported in this app's runtime.** Baseline since March 2022 (Chrome 69, Firefox 96, Safari 15.4); Electron 25 ships Chromium 114 which has full support; iOS/Capacitor WKWebView supports it; Phase 27 Plan 27-04 already uses `navigator.locks.request` in `ydocLifecycle.js` (working in production today). No polyfill required.
3. **The legacy `highlight_id` column is already the stable per-annotation UUID.** Every legacy non-highlight row carries it (set by `serializeFabricObjectToRow` line 178) and every Fabric annotation in this codebase carries `data.id` / `data.annoId` set to the same UUID (Plan 29-02 contract). The "client_anno_id" key from CONTEXT.md is **already in the data** — Phase 30's idempotency check is one column lookup, not a new ID system.

**Primary recommendation:** Land `crdtBackfill.js` as a pure module mounted inside `<YDocProvider>` (Plan 27-05's existing seam). Reuse `applyFabricCreate` from `crdtAnnotationBridge.js` for the actual write — same code path, different `originPayload` (`source: 'crdt-backfill'` instead of `'local-fabric'`). The dual-write fan-out lands as ~30-50 LOC inside `annotationCloudSync.js` under the narrow waiver — a single new function `dualWriteFabricCommit(...)` that conditionally calls both `upsertFabricAnnotation(...)` (existing) AND the bridge's `applyFabricCommit(...)` based on `isCRDTEnabled()` and a `annotation_type !== 'highlight'` filter.

## Standard Stack

### Core (already installed — Phase 27)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yjs` | `^13.6.30` | Y.Map idempotency for backfill writes; `Y.UndoManager.stopCapturing` boundary if needed | Phase 27 baseline; locked. No new deps for Phase 30. |
| `y-indexeddb` | `^9.0.12` | Backfill writes flow through the existing `IndexeddbPersistence` (Phase 27) — local Y.Doc state survives crashes mid-backfill | Already wired in `ydocLifecycle.js` |
| `@supabase/supabase-js` | `^2.81.1` | Reads legacy rows via `supabase.from('document_annotations').select('*')` (existing `loadAllNonHighlightAnnotations` in `annotationCloudSync.js` is the read path) | Already in stack |

### Browser APIs (no install)

| API | Purpose | Browser Support |
|-----|---------|-----------------|
| `navigator.locks.request(name, {mode:'exclusive'}, cb)` | Per-(user, document) advisory lock so two tabs of the same user don't double-import | Baseline since March 2022 (Chrome 69+, Firefox 96+, Safari 15.4+, Edge 79+). Electron 25 = Chromium 114, full support. iOS/Capacitor WKWebView 15.4+, full support. Already used in `ydocLifecycle.js` Plan 27-04. NO POLYFILL NEEDED. |
| `localStorage.setItem('crdt_dual_write_queue:{userId}', ...)` | Persist retry queue across app close (CONTEXT.md requirement: "queue survives app close") | Universal. Existing app already uses localStorage for cloud-sync queue. |
| `BroadcastChannel('crdt_dual_write:{userId}')` (optional) | Cross-tab queue coordination if multiple tabs of same user have stuck queues | Already used in `ydocLifecycle.js`; no install. Optional — planner decides if needed beyond Web Locks. |

### Reused from prior phases (no new code)

| From Phase | Module | Reused For |
|------------|--------|-----------|
| Phase 27 | `crdtFeatureFlag.isCRDTEnabled()` | Single kill switch — when false, dual-write disables, legacy-only path runs |
| Phase 27 | `<YDocProvider docId>` (`src/components/collab/YDocProvider.jsx`) | Backfill module mounts inside this provider boundary; has access to per-document Y.Doc + sessionId + auth context |
| Phase 27 | `StorageFailureBanner` + `StorageFailureBanner.css` | Stuck-queue banner adds new `code: 'sync_queue_stuck'` to existing `COPY` / `HEADING_BY_CODE` / `SECONDARY_BY_CODE` maps. Same role=alert sticky chrome. |
| Phase 27 | `applyUpdate-only` invariant (`tests/phase27/applyUpdateOnlyInvariant.test.mjs`) | Backfill writes go through `crdtAnnotationBridge.applyFabricCreate` which uses `ydoc.transact(fn, origin)` — never `Y.applyUpdateV2` and never wholesale replace. Grep test passes by construction. |
| Phase 28 | `originBuilder.buildOrigin({...})` (`src/lib/collab/originBuilder.js`) | Backfill builds an origin with `{ source: 'crdt-backfill', userId, deviceId: 'before-v2.4', sessionId, clientID, ... }` |
| Phase 28 | `getDeviceId()` (`src/lib/collab/deviceId.js`) | NOT used for backfill (deviceId is hardcoded `"before-v2.4"`); used for live dual-write origin |
| Phase 28 | RLS policies + `user_can_access_document(doc_id, 'editor')` trigger (migration `20260504000000`) | Backfill writes ride the same Postgres trigger; revoked users get 42501 errors and dual-write skip is automatic via the kill-switch + permission_revoked path |
| Phase 29 | `crdtAnnotationBridge.applyFabricCommit` / `applyFabricCreate` / `applyFabricDelete` | Single bridge entry point — backfill calls `applyFabricCreate(ydoc, yMapAnnotations, fabricSnapshot, originPayload, ctx)` per legacy row. Per-property idempotency falls out of the bridge's existing `shallowEqual` skip (line 250-256 of `crdtAnnotationBridge.js`). |
| Phase 29 | `meta.updatedAt` tiebreak (CONTEXT.md "human display only"; CRDT logical clock determines convergence) | Backfill writes carry their own `updatedAt` so a remote v2.4 edit that landed before backfill ran wins (logical-clock LWW); the backfill's `client_anno_id` lookup checks if the entry already exists and bridges through `meta.updatedAt` only as audit metadata. |
| Phase 29 | Per-mount registry `Map<annoId, FabricObject>` | NOT directly relevant for Phase 30 (backfill writes are pre-Fabric — they happen at the Y.Map level only). Mentioned for completeness; live dual-write goes through registry path. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Web Locks (`navigator.locks`) | `localStorage`-stored "I'm running the backfill" mutex with TTL | Web Locks is auto-released on tab crash by the browser; localStorage mutex requires manual TTL handling and timeout-tuning. Web Locks is also already in production use here (Phase 27). |
| Postgres advisory lock (`pg_try_advisory_lock`) | Server-side mutex via Supabase RPC | Architecture decision recorded in `.planning/research/ARCHITECTURE.md` §11: "Y.Doc encoding is JS-only (yjs is npm, not pgsql)... actually means: the first client that opens the doc grabs an advisory lock... runs the backfill in JS, releases." Web Locks is the JS-side equivalent — same pattern, no Postgres round-trip. Phase 30 picks Web Locks (matches Phase 27 precedent). |
| Custom retry queue | Reuse Phase 28 SupabaseYjsProvider's queue | Phase 28's queue is for Y.Doc updates over Realtime broadcast — it already exists for the CRDT path. Phase 30's queue is for the LEGACY-side write only (since the CRDT-side has Phase 28's queue). Halving the surface: Phase 30 only owns the legacy retry path; the CRDT path is already handled by Phase 28. |
| New ESLint rule banning "diff = delete" | CI grep gate in `.github/workflows/` OR code-review checklist | Custom ESLint rule is the most expressive (AST-level pattern matching); CI grep is cheaper to ship and matches the project's existing `applyUpdate-only` invariant pattern (Plan 27-04 ydocLifecycle uses self-documenting comment to dodge a literal grep). Recommend CI grep + code-review checklist for v2.4; promote to ESLint rule if a real violation slips through. |

**Installation:** No new npm install for Phase 30. Yjs trio already in package.json.

**Version verification:** `npm view yjs version` confirms latest is `13.6.30` (March 14 2026 publish date per STACK.md). All Phase 27 deps locked at the versions installed in Plan 27-02. No bump required.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── services/
│   └── annotationCloudSync.js              # NARROW WAIVER — adds dual-write fan-out
│                                            #   - dualWriteFabricCommit({fabricObj, opts})
│                                            #   - dualWriteFabricDelete(documentId, highlightId)
│                                            #   - skip-highlight filter inline
├── lib/
│   └── collab/
│       ├── crdtBackfill.js                 # NEW (~150 LOC pure module)
│       │   - exports: runBackfill({ydoc, supabase, documentId, userId, ...})
│       │   - Web Locks scoped: y-doc-backfill-${userId}-${documentId}
│       │   - reads legacy via supabase.from('document_annotations').select('*')
│       │     filtering NON_HIGHLIGHT_TYPES (reuse the constant from annotationCloudSync.js)
│       │   - per row: build originPayload {source: 'crdt-backfill', ...}
│       │     and call crdtAnnotationBridge.applyFabricCreate(...)
│       │   - per-row idempotency: skip if Y.Map already has key (already
│       │     by construction in Bridge — applyFabricCreate honors meta.authorId
│       │     existence check on line 226-227 of crdtAnnotationBridge.js)
│       │   - emits onComplete(stats) for the Y.Doc-side observer
│       ├── crdtDualWriteQueue.js           # NEW (~120 LOC pure module)
│       │   - exports: enqueue({side, fabricObj, opts}) / drainQueue({onStuck, onQuarantine})
│       │   - localStorage-backed (key: `crdt_dual_write_queue:${userId}`)
│       │   - latest-version-wins semantics: keyed by client_anno_id, set() replaces
│       │   - retry: exponential backoff (planner picks; 1s, 2s, 4s, 8s, 16s, 30s ceiling)
│       │   - quarantine after 10 attempts: emits onQuarantine({annoId})
│       │   - 30-second silence threshold: emits onStuck() if any entry has been
│       │     pending > 30s without success
│       └── crdtFeatureFlag.js              # EXISTING — reused via isCRDTEnabled()
├── hooks/
│   └── useDualWriteQueue.js                # NEW (~60 LOC) — React hook
│       - subscribes to drainQueue events
│       - exposes { stuckCount, quarantinedAnnoIds } for the banner + tile indicator
│       - mounts inside <YDocProvider>; one queue per user, one queue per document
└── components/
    └── collab/
        ├── StorageFailureBanner.jsx        # EXTEND — add code 'sync_queue_stuck' to maps
        └── YDocProvider.jsx                # EXTEND — mount runBackfill on first open
```

### Pattern 1: Dual-Write Fan-Out (the load-bearing pattern)

**What:** Every new-annotation save fans out to BOTH stores. Each side has its own retry path. Failures on one side don't block the other.

**When to use:** Every Fabric `object:modified` / `object:added` / `object:removed` commit on a non-highlight annotation while `isCRDTEnabled()` is true.

**Example:**

```javascript
// src/services/annotationCloudSync.js — INSIDE NARROW WAIVER
import { applyFabricCommit, applyFabricCreate, applyFabricDelete } from '../lib/collab/crdtAnnotationBridge.js';
import { isCRDTEnabled } from '../lib/collab/crdtFeatureFlag.js';
import { enqueue } from '../lib/collab/crdtDualWriteQueue.js';

const NON_HIGHLIGHT_TYPES = [/* existing constant — line 26 */];

/**
 * Dual-write fan-out for a single annotation commit.
 * Phase 30 narrow-waiver entry point.
 *
 * Behavior:
 *   - If kill switch off → legacy-only (current behavior unchanged, byte-identical)
 *   - If annotation_type === 'highlight' → legacy-only (Excel-sync carve-out)
 *   - Otherwise → fire BOTH sides; each side has its own try/queue path; never
 *     delete from one side to "match" the other
 *
 * NEVER: read legacy state, compare to CRDT state, delete the diff. That is
 * Pitfall 5 (the simple-sync killer). The lint rule / CI grep blocks the pattern.
 */
export async function dualWriteFabricCommit(fabricObj, opts) {
  const annotationType = inferAnnotationType(fabricObj); // existing helper
  const isHighlight = annotationType === 'highlight';

  // Always do legacy write — preserves existing v2.3 behavior verbatim
  // and feeds v2.3 clients still in the wild during dual-write era.
  const legacyResult = await upsertFabricAnnotation(fabricObj, opts).catch((err) => ({ error: err }));
  if (legacyResult.error) {
    // Queue for retry. Latest-version-wins semantics on re-edit (queue
    // replaces older entry for same client_anno_id).
    enqueue({ side: 'legacy', fabricObj, opts, attemptedAt: Date.now() });
  }

  // Skip CRDT side if off OR highlight — same clean skip pattern, no scary fallback.
  if (!isCRDTEnabled() || isHighlight) {
    return { legacy: legacyResult, crdt: null };
  }

  // CRDT-side write goes through the Phase 29 bridge. Origin payload is
  // 'local-fabric' (matches Phase 29 live-edit origin). Reuses the bridge's
  // per-property shallow-equal skip — no-op writes don't hit the wire.
  try {
    applyFabricCommit(opts.ydoc, opts.yMapAnnotations, fabricObj, opts.originPayload, opts.ctx);
    return { legacy: legacyResult, crdt: { ok: true } };
  } catch (err) {
    enqueue({ side: 'crdt', fabricObj, opts, attemptedAt: Date.now(), error: err });
    return { legacy: legacyResult, crdt: { error: err } };
  }
}
```

### Pattern 2: Idempotent Backfill via Web Locks

**What:** First-open import from legacy → CRDT, advisory-locked so concurrent tabs/devices don't double-import.

**When to use:** Mounted inside `<YDocProvider>` after `attachLifecycle` resolves. Runs at most once per (user, document) per app session; idempotent across sessions because the bridge's `applyFabricCreate` checks `meta.authorId` existence as the "already-imported" sentinel.

**Example:**

```javascript
// src/lib/collab/crdtBackfill.js — NEW pure module
import { applyFabricCreate } from './crdtAnnotationBridge.js';
import { deserializeRowToFabricObject } from '../../services/annotationTypeSerializers.js';

const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser',
];

/**
 * Run the legacy → CRDT backfill once per (user, document).
 * Web-Locks-arbitrated against same-user same-doc tab races.
 *
 * Returns immediately on the loser path; the leader path queries Postgres,
 * iterates rows, and calls applyFabricCreate per row through the bridge.
 *
 * The bridge's applyFabricCreate is the per-row write path — it auto-skips
 * already-imported annotations via the meta.authorId existence sentinel
 * (crdtAnnotationBridge.js line 226-227). Same semantics:
 *   "If meta.authorId is already set, this is the EDIT path — do NOT
 *    overwrite create-only meta keys (UNDO-03 invariant)."
 *
 * That sentinel IS the idempotency check: same-key + deep-equal value = bridge
 * sees existingAuthorId !== null, takes the EDIT path, runs shallowEqual on
 * every property, no-ops every property, no Yjs update emitted.
 */
export async function runBackfill({ ydoc, supabase, documentId, userId, sessionId, clientID, originPayloadFactory }) {
  if (!ydoc || !supabase || !documentId || !userId) return { ranAs: 'noop_missing_inputs' };

  const lockName = `y-doc-backfill-${userId}-${documentId}`;

  // Web Locks: only one tab per (user, document) runs this. Loser tabs
  // queue forever (until leader releases) — but leaders release as soon
  // as the per-row import loop finishes, so losers run a no-op in <1s.
  // We scope `mode: 'exclusive'` because two simultaneous backfills of
  // the same (user, document) would emit twice the Yjs updates with no
  // benefit (idempotency would skip them anyway, but that's wasted work).
  return navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
    // After acquiring the lock, double-check whether the backfill is
    // already done — another tab may have completed it while we waited.
    // The check is cheap: if Y.Map.size > 0 AND every annotation has
    // meta.authorId, we're done. Could also be a per-document marker
    // key in the Y.Doc meta map: ydoc.getMap('meta').get('backfill_done')
    // — planner picks. Either way, this guard is the "single-pass" safety.

    const yMapAnnotations = ydoc.getMap('annotations');
    const yMapMeta = ydoc.getMap('meta');
    if (yMapMeta.get(`backfill_done:${userId}`)) {
      return { ranAs: 'already_done', count: 0 };
    }

    // Read legacy rows. Existing helper from annotationCloudSync.js works
    // — same Supabase query, same RLS, same deserialization.
    const { data: rows, error } = await supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .in('annotation_type', NON_HIGHLIGHT_TYPES)
      .order('created_at', { ascending: true });

    if (error) {
      // Don't mark done. Next first-open will retry silently.
      // Don't surface UI — CONTEXT.md "silent retry on partial failure".
      return { ranAs: 'failed', error };
    }

    let imported = 0;
    let skipped = 0;
    for (const row of (rows || [])) {
      try {
        const { fabricObject, pageNumber, highlightId } = deserializeRowToFabricObject(row);
        // Inject the stable annoId where the bridge expects it — Phase 29
        // bridge reads fabricObject.data.id (line 183 of crdtAnnotationBridge.js).
        // Legacy rows already have this in annotation_data.fabricObject.data.id;
        // double-checked here for robustness.
        if (!fabricObject.data) fabricObject.data = {};
        fabricObject.data.id = fabricObject.data.id || highlightId;
        fabricObject.pageNumber = pageNumber;

        // Origin: source = 'crdt-backfill', deviceId = 'before-v2.4',
        // userId = LEGACY ROW'S user_id (NOT the importing user — preserves
        // MIGRATE-01 author attribution).
        const originPayload = originPayloadFactory({
          source: 'crdt-backfill',
          userId: row.user_id,                    // ORIGINAL CREATOR
          deviceId: 'before-v2.4',                // LITERAL CONTEXT.md DECISION
          sessionId,
          clientID,
        });

        const ctx = {
          userId: row.user_id,                    // sets meta.authorId
          deviceId: 'before-v2.4',                // sets meta.deviceId
          sessionId,
          clientID,
          // Phase 30 extension: bridge needs createdAt source for backfill
          // path. The bridge's applyFabricCommit hardcodes Date.now() at
          // line 244 — that's wrong for backfill (we want the legacy row's
          // created_at). Plan must thread createdAt through ctx and the
          // bridge must respect ctx.createdAt when isCreate AND ctx.source
          // === 'crdt-backfill'. SEE Open Questions §1.
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        };

        // The bridge's existing CREATE path checks meta.authorId existence
        // FIRST — same-key re-runs become no-ops by construction. This is
        // the entire idempotency contract.
        applyFabricCreate(ydoc, yMapAnnotations, fabricObject, originPayload, ctx);
        imported++;
      } catch (err) {
        // Skip this row, log to console, keep going. One bad row never
        // blocks the rest. Next first-open retries.
        // eslint-disable-next-line no-console
        console.warn('[crdtBackfill] skipping row', row.highlight_id, err?.message);
        skipped++;
      }
    }

    // Mark done so subsequent backfills early-exit. Stored INSIDE the Y.Doc
    // (via meta map) so it propagates to other devices via normal CRDT sync —
    // a second device opening after the first device finished sees the marker
    // and short-circuits.
    yMapMeta.set(`backfill_done:${userId}`, Date.now());

    return { ranAs: 'leader', imported, skipped };
  });
}
```

### Pattern 3: Latest-Version-Wins Retry Queue

**What:** Persistent queue keyed by `client_anno_id` (legacy `highlight_id`). New edits to a queued annotation REPLACE the queued entry, never append. Retries silently for 30s, then surfaces a banner. Quarantines after 10 attempts.

**When to use:** Every dual-write call site enqueues on failure. Reads from queue on a backoff timer + on app boot.

**Example:**

```javascript
// src/lib/collab/crdtDualWriteQueue.js — NEW pure module (sketch)

const STORAGE_KEY = (userId) => `crdt_dual_write_queue:${userId}`;
const QUARANTINE_THRESHOLD = 10;
const STUCK_THRESHOLD_MS = 30_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]; // 6 retries before quarantine sub-stages

export function enqueue({ userId, annoId, side, payload }) {
  const queue = readQueue(userId);
  // Latest-version-wins: replace existing entry for same annoId.
  // CONTEXT.md: "the queue holds only the most recent state of each annotation"
  queue[annoId] = {
    annoId,
    side,            // 'legacy' or 'crdt' — which side failed
    payload,         // serialized fabricObj + opts (everything to retry the call)
    attempts: queue[annoId]?.attempts ?? 0,
    queuedAt: queue[annoId]?.queuedAt ?? Date.now(),
    lastAttemptAt: null,
    quarantined: false,
  };
  writeQueue(userId, queue);
}

export async function drainQueue({ userId, supabase, ydoc, yMapAnnotations, isStillRevoked, onStuck, onQuarantine }) {
  const queue = readQueue(userId);
  const now = Date.now();
  let stuckCount = 0;

  for (const annoId of Object.keys(queue)) {
    const entry = queue[annoId];
    if (entry.quarantined) continue;

    // Stuck-queue threshold: any entry that's been pending > 30s and not yet quarantined
    if ((now - entry.queuedAt) > STUCK_THRESHOLD_MS) stuckCount++;

    // Backoff: pick the next attempt window from BACKOFF_MS by attempts index
    const backoff = BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length - 1)];
    if (entry.lastAttemptAt && (now - entry.lastAttemptAt) < backoff) continue;

    // Try the missing-side write
    try {
      if (entry.side === 'legacy') {
        await retryLegacyWrite(supabase, entry.payload);
      } else {
        retryCrdtWrite(ydoc, yMapAnnotations, entry.payload);
      }
      delete queue[annoId];
    } catch (err) {
      entry.attempts++;
      entry.lastAttemptAt = now;
      if (entry.attempts >= QUARANTINE_THRESHOLD) {
        entry.quarantined = true;
        onQuarantine?.({ annoId });
      }
    }
  }
  writeQueue(userId, queue);
  if (stuckCount > 0) onStuck?.({ stuckCount });
}
```

### Pattern 4: Origin-Tagged Backfill Transactions

**What:** Every backfill write carries `source: 'crdt-backfill'`. Live edits use `source: 'local-fabric'` (Phase 29). Phase 33 reads these origins for activity log row generation.

**When to use:** Inside `runBackfill` per-row write — pass through `originPayloadFactory({source: 'crdt-backfill', ...})`.

**Example:** See Pattern 2 above (`originPayload` construction inside the row loop).

### Anti-Patterns to Avoid

- **"Diff = delete" reconciliation.** Reading both stores, computing the diff, and deleting from one to "match" the other. This is Pitfall 5 (the simple-sync killer). The lint rule / CI grep / code-review checklist blocks the pattern by construction. **If two stores diverge transiently, the only legal remediation is retrying the missing-side write.**
- **"Owner-only" backfill.** CONTEXT.md explicitly rejects this. Any collaborator with edit access triggers backfill. Idempotency via `client_anno_id` makes concurrent runs harmless.
- **Wholesale Y.Doc replacement during backfill.** The `applyUpdate-only` invariant from Phase 27 still applies. `runBackfill` writes go through `applyFabricCreate` which uses `ydoc.transact(fn, origin)` per row — never a single big `Y.applyUpdate(ydoc, encodedState)` that replaces state.
- **Per-edit queue replay.** CONTEXT.md: "the queue holds only the most recent state of each annotation." Latest-version-wins. Never append; always replace by `annoId` key.
- **Retry forever for permanently-failing annotations.** CONTEXT.md: quarantine after ~10 retries with `"didn't save, please try redrawing"` inline marker.
- **Visual "imported" marker on pre-v2.4 annotations.** CONTEXT.md: explicitly rejected. Migrated annotations render visually identical to native v2.4 annotations. Only `meta.deviceId === "before-v2.4"` records the migration.
- **Including highlights in the dual-write fan-out.** Highlights stay on legacy. Filter by `annotation_type !== 'highlight'` at the fan-out call site.
- **Mid-session kill-switch flip taking effect immediately.** CONTEXT.md: active sessions keep current behavior; only fresh document opens see the new flag value. The kill-switch is read inside `<YDocProvider>`'s mount-time check (matches Phase 27 Plan 27-05 pattern).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-(user, document) advisory lock | Custom localStorage mutex with TTL + heartbeat | `navigator.locks.request(name, {mode:'exclusive'}, cb)` | Browser-managed; auto-released on tab crash; same primitive Phase 27 already uses |
| Y.Map idempotency check | Manual "have I seen this annoId" Set | The bridge's existing `meta.authorId` existence sentinel (line 226 of `crdtAnnotationBridge.js`) | Already shipped in Phase 29; reusing it means re-runs are no-ops by construction |
| Per-property merge during backfill | Full Y.Map clear-and-set | Bridge's `shallowEqual` skip (line 250-256) — no-op writes filtered | Existing pattern; backfill reusing the bridge inherits this for free |
| Queue persistence | Custom IndexedDB store | Plain `localStorage` JSON blob keyed by userId | Existing app already uses localStorage for cloud-sync queue; bounded size (max ~100 stuck annotations × ~5KB each = 500KB << 5MB limit). IndexedDB is overkill. |
| Retry backoff | Custom exponential backoff library | Hand-rolled `BACKOFF_MS = [1, 2, 4, 8, 16, 30]` array | Trivial; no library dependency; matches Phase 28 reconnect machinery |
| Cross-tab queue coordination | Polling localStorage | `BroadcastChannel('crdt_dual_write:{userId}')` if needed (likely not — Web Locks already arbitrates the backfill; queue drain just runs on a per-tab timer) | Same primitive Phase 27 already uses |
| Author/timestamp preservation on backfill | New schema column | Read legacy row's `user_id` and `created_at`, write into `meta.authorId` / `meta.createdAt` directly | Legacy data already has both fields; just thread them through |
| Idempotency key | New UUID column | Existing `highlight_id` column + existing `fabricObject.data.id` field | Same UUID is already in both stores; no migration needed |
| Banner UI | New banner component | Extend `StorageFailureBanner` with new code variant `sync_queue_stuck` | Phase 27 + 28 + 29 all extended this same component; Phase 30 follows the precedent |
| Document-tile "unsaved changes" indicator | New component tree | Add small icon to existing dashboard document tile component (planner identifies which file owns it; likely `src/components/Dashboard/*.jsx` or similar) | Reads queue state from `useDualWriteQueue` hook; surface is just one icon; no new component tree needed |

**Key insight:** Phase 30's job is **wiring**, not building. Every primitive (Y.Map idempotency, Web Locks, banner shape, bridge entry point, origin payload, queue persistence) is already shipped or already standard. The phase ships ~300-400 LOC of glue: backfill module, queue module, fan-out function, banner copy variant, document-tile icon. Net new dependency surface = 0.

## Common Pitfalls

### Pitfall 30-1: createdAt clobber on backfill (NEW — Phase 30 specific)

**What goes wrong:** The bridge's `applyFabricCommit` hardcodes `metaYMap.set('createdAt', Date.now())` at line 244 of `crdtAnnotationBridge.js`. If backfill calls `applyFabricCreate` without modification, every imported annotation will get its `meta.createdAt` set to the backfill timestamp — NOT the legacy row's original `created_at`. MIGRATE-01 violation: "original creation date preserved" fails.

**Why it happens:** Phase 29's bridge was built for live edits where `Date.now()` IS the create timestamp. Phase 30 is the first call site that needs to override the create timestamp.

**How to avoid:** Either (a) thread `ctx.createdAt` through `applyFabricCommit` and have the bridge prefer it when present (small bridge edit; out of `crdtAnnotationBridge.js` Always-Protected scope per CONTEXT.md DO NOT CHANGE list — but Phase 29 explicitly grants extension under "protected as an extension surface"), OR (b) post-process inside `runBackfill` — after `applyFabricCreate` lands, do a second `metaYMap.set('createdAt', legacyCreatedAtMs)` inside the same `ydoc.transact` block. **Recommend option (b)** — keeps the bridge byte-identical, makes the override surgical.

**Warning signs:** Activity log entries (Phase 33) for migrated documents show import-day timestamps for every annotation instead of original creation dates.

### Pitfall 30-2: Author attribution clobber (NEW — Phase 30 specific)

**What goes wrong:** Same shape as Pitfall 30-1 but for `meta.authorId`. The bridge's CREATE path sets `metaYMap.set('authorId', ctx?.userId)` at line 242. The `ctx.userId` in the backfill code MUST be the legacy row's `user_id` (original creator), NOT the importing user's id. If a developer naively passes the current authenticated user as `ctx.userId`, every migrated annotation will be attributed to the importing user — MIGRATE-01 violation.

**Why it happens:** Easy mistake — `useYDoc` exposes `undoCtx` which is the importing user's identity. Reusing that for backfill writes is the obvious-wrong path.

**How to avoid:** Per-row, build a fresh `ctx = { userId: row.user_id, deviceId: 'before-v2.4', ... }` inside the backfill loop. NEVER use `useYDoc().undoCtx` for backfill — that's for live edits.

**Warning signs:** Properties panel on migrated annotations shows the importing user's name as creator instead of the original v2.3 creator.

### Pitfall 30-3: Tab race during initial open (concurrent backfill attempts)

**What goes wrong:** User opens document in two tabs simultaneously. Both tabs' `<YDocProvider>` mounts fire `runBackfill` at the same instant. Without the Web Lock, both tabs query Postgres, both iterate the same rows, both call `applyFabricCreate` per row. The bridge's idempotency catches duplicates at the `meta.authorId` sentinel level (no data corruption), but you waste 2× the Y.Doc updates and 2× the network round-trip to Supabase. Worse, if Supabase rate-limits, one tab might fail mid-loop and the other might land partial state — both tabs' Y.Doc end up consistent due to CRDT, but the user experience is "noisy import."

**Why it happens:** Web Locks fixes it; the question is whether the planner remembers to wrap the backfill in `navigator.locks.request`. Documenting it explicitly as a pitfall.

**How to avoid:** ALWAYS wrap `runBackfill`'s body in `navigator.locks.request(name, {mode: 'exclusive'}, async () => { ... })`. Lock name format: `y-doc-backfill-${userId}-${documentId}` (per-user-per-document scope so different documents don't queue against each other). The loser tab waits, then short-circuits via the `backfill_done:${userId}` marker check.

**Warning signs:** Server logs show 2× legacy SELECT queries per (user, document) on first v2.4 open across two tabs.

### Pitfall 30-4: Highlight bleed-through

**What goes wrong:** Backfill or dual-write fan-out forgets to filter `annotation_type === 'highlight'`. Highlights enter the Y.Doc. v2.5 highlight migration's idempotency check (`client_anno_id`) hits a key collision because Phase 30 already populated the Y.Map with a half-migrated highlight that doesn't have the v2.5 schema fields (e.g., `checklist_responses`, `space_id`, `module_id`). Excel-sync downstream chokes.

**Why it happens:** The filter is small (`if (annotationType === 'highlight') return`) but easy to forget. Plus the legacy `loadAllNonHighlightAnnotations` already filters at SELECT time, so a developer might assume the backfill loop is "safe" without an explicit check — but the dual-write FAN-OUT runs on every Fabric commit including potential future-highlight commits.

**How to avoid:** Two-layer defense: (a) the Postgres SELECT query in `runBackfill` filters `IN ('ink', 'freetext', ..., 'eraser')` — same `NON_HIGHLIGHT_TYPES` constant from `annotationCloudSync.js`; (b) the dual-write fan-out's first check is `if (annotationType === 'highlight') return legacyResult` — never even reaches the CRDT-side write. Both filters ride the same constant so adding a new annotation type updates both at once.

**Warning signs:** v2.5 highlight migration plan's first acceptance test (load existing highlights without collision) fails immediately. Or earlier: any v2.4 user's Y.Doc grows to include rows with `annotation_type === 'highlight'`.

### Pitfall 30-5: Queue starvation by quarantined entry

**What goes wrong:** A single annotation hits a permanent error (e.g., RLS rejected because user lost edit access between commit and retry). Without a per-entry quarantine, the queue retries that entry forever, and on every retry tick it's the FIRST entry processed (because it's been in queue longest). Other valid entries behind it never get processed.

**Why it happens:** Naive FIFO drain.

**How to avoid:** Per-entry `attempts` counter; `quarantined: true` after threshold (CONTEXT.md: ~10 attempts). The drain loop SKIPS quarantined entries and continues with the next. The user sees the inline marker on the quarantined annotation; the rest of the queue keeps moving.

**Warning signs:** Banner shows `stuckCount: 1` indefinitely while user is actively editing other annotations that should drain successfully.

### Pitfall 30-6: Stale queue replay after kill-switch flip

**What goes wrong:** User has 5 entries in the dual-write retry queue (CRDT side failed, legacy side succeeded). Admin flips `crdtFeatureFlag` off. User refreshes. App boot reads queue from localStorage, but `isCRDTEnabled()` now returns false. If the drain loop doesn't check the flag, it tries to write to a Y.Doc that the kill-switch just told the rest of the app to ignore — wasted effort, possibly errors.

**Why it happens:** Queue persistence is decoupled from kill-switch state.

**How to avoid:** The drain loop's first check is `if (!isCRDTEnabled()) return` — silently skip entirely. The queue stays in localStorage, ready to resume if the kill-switch flips back. Banner gates on the same flag — `if (!isCRDTEnabled()) hide banner` — so the user doesn't see a stuck-queue banner for a queue that's intentionally paused.

**Warning signs:** Stuck-queue banner shows even after kill-switch flip; or DevTools console shows errors trying to write to a null Y.Doc.

### Pitfall 30-7: Backfill blocking first-open paint

**What goes wrong:** `runBackfill` is called synchronously inline with document open. Backfill takes 800ms on a doc with 200 annotations. PDF renders, but annotations don't appear for 800ms — perceived as a regression vs Phase 27's "instant first-open" criterion.

**Why it happens:** Easy to wire `runBackfill` directly into the `useEffect` body that mounts the YDocProvider; that effect runs before paint completes if it's synchronous.

**How to avoid:** Defer with `Promise.resolve().then(() => runBackfill(...))` or `setTimeout(runBackfill, 0)` — runs after the current render commit completes. The PDF page paints immediately; annotations from the legacy column are read by `useAnnotationsCRDT` falling back to the legacy state slice (CONTEXT.md: "the v2.4 read path renders from the legacy data, then flips to the CRDT store atomically once the copy completes"). CONTEXT.md "Claude's Discretion" lists this as a planner decision — recommend deferred.

**Warning signs:** First-open feel regresses from "instant" to "annotations appear after a beat."

## Code Examples

Verified patterns from official sources + the existing codebase:

### Existing pattern: bridge create with idempotency-by-sentinel

Source: `src/lib/collab/crdtAnnotationBridge.js` lines 175-265 (Phase 29 production). Phase 30 reuses verbatim.

```javascript
// Inside applyFabricCommit/Create:
const existingAuthorId = typeof metaYMap.get === 'function' ? metaYMap.get('authorId') : undefined;
const isCreate = existingAuthorId == null;

if (isCreate) {
  // CREATE-only meta keys — UNDO-03 invariant.
  metaYMap.set('authorId', ctx?.userId);
  metaYMap.set('deviceId', ctx?.deviceId);
  metaYMap.set('createdAt', Date.now());  // <-- Phase 30 must override for backfill
}

// Per-property writes — DO NOT clear-and-set. shallowEqual skip is the
// idempotency guarantee: re-running the same backfill twice produces zero
// updates because every property's prev value matches the new value.
if (fabricJson) {
  for (const key of Object.keys(fabricJson)) {
    const prev = typeof fabricYMap.get === 'function' ? fabricYMap.get(key) : undefined;
    if (shallowEqual(prev, fabricJson[key])) continue;  // <-- THIS IS THE IDEMPOTENCY
    fabricYMap.set(key, fabricJson[key]);
  }
}
```

### Existing pattern: Web Locks election in production

Source: `src/lib/collab/ydocLifecycle.js` lines 119-151 (Phase 27 production). Phase 30 reuses pattern.

```javascript
navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
  if (detached) return;
  role = 'leader';
  try {
    persistence = new IndexeddbPersistence(documentId, ydoc);
    persistence.on('synced', () => {
      if (!detached) onStorageState({ code: 'ok', role: 'leader' });
    });
    // Hold the lock for the tab's lifetime. Promise intentionally never resolves.
    await new Promise(() => {});
  } finally {
    try { persistence?.destroy(); } catch { /* swallow */ }
  }
}).catch(() => { /* loser path or rare failure */ });
```

For Phase 30 the lock callback DOES resolve — the leader runs the backfill and releases. Different scope from Phase 27's "hold for tab lifetime."

### New pattern: Banner copy variant extension

Source: pattern from `src/components/collab/StorageFailureBanner.jsx`. Phase 30 adds one variant:

```javascript
// Add to COPY map (line ~45):
sync_queue_stuck: {
  body: "Some changes haven't saved yet. We'll keep retrying — you can keep working. If this stays for a while, try refreshing or check your connection.",
  action: 'Retry now',
},

// Add to HEADING_BY_CODE map (line ~117):
sync_queue_stuck: 'Saving is catching up',

// Add to SECONDARY_BY_CODE map (line ~139):
sync_queue_stuck: 'Your edits are safe on this device · Stay online to finish syncing',

// Add to JSDoc @param code union type at line 186.
```

That's the full extension surface — no new render branches, no new CSS, no new chrome. Existing banner handles role=alert / sticky / dismiss / action-link / locked-CSS-vars.

### New pattern: Document-tile "unsaved changes" indicator

Planner identifies which file owns the document tile (likely a dashboard / project list component; scout during planning). The hook exposes:

```javascript
// src/hooks/useDualWriteQueue.js (NEW)
export function useDualWriteQueue() {
  // Reads from crdtDualWriteQueue module's localStorage state
  // + mounts a 1s polling tick (or BroadcastChannel listener)
  return {
    stuckCount,             // banner gate: > 0 + > 30s elapsed
    quarantinedAnnoIds,     // per-annotation marker set
    hasPendingForDocument,  // (documentId) => boolean for tile indicator
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-source-of-truth flip-day migration ("disable v2.3, all clients use v2.4") | Two-phase dual-write era + sealed cutover | Locked by `.planning/research/PITFALLS.md` Pitfall 1 (2026-04-26 research) | Phase 30 IS Phase A; Phase 31 IS Phase B. Without dual-write, every minute of rollout = data-loss window. |
| Diff-based reconciliation ("if cloud says X but local says Y, delete the difference") | Replace, never reconcile | Locked by simple-sync post-mortem (Phase 11, 2026-04-10); reaffirmed by PITFALLS.md Pitfall 5 | Phase 30 explicitly bans the pattern via lint rule / CI grep. The previous simple-sync system bled data because of this exact pattern. |
| Fabric.js JSON rows as source-of-truth | Y.Doc as source-of-truth (post-cutover); legacy rows as fallback during dual-write era | Phase 31 owns the seal flip; Phase 30 sets up the data path | New v2.4 clients read from Y.Doc; v2.3 still in the wild reads from legacy column. Reads never bleed across paths. |
| Optimistic single-write to cloud | Local-first via Y.Doc + IndexedDB → dual-write to cloud + CRDT | Phase 27 + 28 + 29 stack; Phase 30 extends to legacy table | Edits land locally instantly, sync in background. Half-failed sync handled by retry queue, not by user-facing error. |
| Per-row LWW upsert for collab | Per-property LWW via Y.Map | Phase 29 (COLLAB-03) | Backfill exploits this: re-running on already-imported data is no-op at property level (shallowEqual skip), not just at row level. |

**Deprecated/outdated:**

- **`useAnnotationCloudSync` / `cloudSyncMigration` / `cloudSyncQueue`** — preserved through Phase 30 dual-write era; decommission is Phase 34. Phase 30 EXTENDS these paths with the dual-write fan-out; does NOT rewrite them.
- **AlexDunmow/y-supabase package** — explicitly avoided in v2.4. Custom Supabase Realtime adapter (Phase 28 locked) is the transport. Phase 30 does not interact with transport directly — it consumes the bridge.

## Open Questions

### Question 1: Threading `createdAt` through the bridge

**What we know:** `crdtAnnotationBridge.applyFabricCommit` hardcodes `Date.now()` for `meta.createdAt` (line 244). Phase 30 backfill MUST preserve the legacy row's `created_at`. Two options:
- (a) Modify the bridge to accept `ctx.createdAt` and prefer it on CREATE when present
- (b) Post-process inside `runBackfill` — after `applyFabricCreate` lands, run a second `metaYMap.set('createdAt', legacyCreatedAtMs)` in the same `ydoc.transact` block

**What's unclear:** CONTEXT.md DO NOT CHANGE list says "Phase 29 ships ... protected" — but right after that says "the bridge's structure with new copy variants; the existing component is not rewritten." Bridge can be EXTENDED, just not rewritten. Either option is in-scope; planner picks.

**Recommendation:** Option (b) — keeps the bridge byte-identical, makes the override surgical and contained inside `crdtBackfill.js`. The post-process write inside the same transact does NOT emit a duplicate Yjs update because Yjs collapses same-transaction writes to a single update.

### Question 2: `applyFabricCommit`-only invariant grep test

**What we know:** Phase 27 ships `tests/phase27/applyUpdateOnlyInvariant.test.mjs` which grep-asserts that `new Y.Doc(` appears only in `ydocRegistry.js`. Phase 30's backfill writes go through the bridge → `ydoc.transact` → emits an update via the existing `Y.Doc` instance → bridge does NOT call `Y.applyUpdate(ydoc, ...)` because it's not pushing a wholesale state update; it's just writing to Y.Map keys. The `applyUpdate-only` invariant is about NEVER replacing the doc wholesale.

**What's unclear:** Phase 30 `runBackfill` does not need to call `Y.applyUpdate` at all — it goes through the bridge's `ydoc.transact(...)` per row. So the existing grep test passes by construction. **No new test needed for this invariant.**

**Recommendation:** Confirm by running the existing invariant test after Phase 30 implementation; expect green. If a planner ever sees a need to call `Y.applyUpdate` directly in `runBackfill` (e.g., bulk-import optimization), STOP and reconsider — that's a hint they're trying to replace state instead of merging.

### Question 3: "Diff = delete" lint surface — custom ESLint rule vs CI grep

**What we know:** CONTEXT.md "Claude's Discretion": planner picks the surface. Custom ESLint rule is most expressive (AST-level pattern match for `.delete(...)` calls inside files matching `crdtBackfill|annotationCloudSync|crdtDualWriteQueue` after a comparison expression); CI grep is simplest.

**What's unclear:** Project has no ESLint config customization currently — adding one for this single rule is overkill. CI grep can match patterns like `// diff.*delete\|reconcile.*delete` and require a comment override for false positives.

**Recommendation:** **Code-review checklist callout + CI grep.** ESLint rule is overengineered for a 4-file blast radius. Sample CI grep:

```bash
# scripts/check-no-diff-delete.mjs
git grep -nE '(diff|reconcile|sync).*delete|delete.*(diff|reconcile|sync)' \
  -- 'src/lib/collab/crdtBackfill.js' \
     'src/lib/collab/crdtDualWriteQueue.js' \
     'src/services/annotationCloudSync.js' \
  | grep -v 'NO_DIFF_DELETE_OK' \
  && exit 1 || exit 0
```

Add `// NO_DIFF_DELETE_OK: explanation` as the documented escape hatch for legitimate uses.

### Question 4: Document-tile indicator location

**What we know:** CONTEXT.md "Claude's Discretion": planner identifies which file owns the document list / sidebar tile. CONTEXT.md also says "Likely per-user since the queue is local; planner confirms."

**What's unclear:** Which existing component owns the dashboard tile? Possible candidates: `src/components/Dashboard/*` or wherever the project list / document picker lives. **Planner: scout during Wave 0.** Recommend a `git grep` for `pdfFile.name` / "open document" entry points.

**Recommendation:** Surface is one icon + tooltip. Use existing dashboard icon system. Per-user (only the user with the stuck queue sees their own indicator) — trivially true since the queue is in localStorage scoped to the user.

### Question 5: Backfill timing — synchronous inline vs deferred task

**What we know:** CONTEXT.md "Claude's Discretion": "Likely deferred so the document renders immediately."

**Recommendation:** **Defer.** Wrap the backfill call in `Promise.resolve().then(() => runBackfill(...))` inside `<YDocProvider>`'s mount effect. The PDF page paints first; legacy annotations render via `useAnnotationsCRDT` falling back to the legacy state slice (CONTEXT.md: "the v2.4 read path renders from the legacy data, then flips to the CRDT store atomically once the copy completes"). This requires `useAnnotationsCRDT` to know how to read from legacy when the Y.Map is empty — small extension Phase 30 must wire.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in Node test runner) for unit tests + Playwright (`@playwright/test`) for e2e — same as Phases 27-29 |
| Config file | `playwright.config.mjs` (existing) for e2e; no config file for `node:test` (auto-discovery via `npm test`) |
| Quick run command | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs` (per-file) |
| Full suite command | `npm test` (existing — runs all `node --test` co-located + `tests/phase*` suites) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIGRATE-01 | Existing v2.3 row appears in v2.4 with original `created_by` user as `meta.authorId` and `meta.deviceId === "before-v2.4"` | unit | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs` | ❌ Wave 0 |
| MIGRATE-01 | `meta.createdAt` preserves legacy row's `created_at` (NOT import-time) | unit | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs` | ❌ Wave 0 |
| MIGRATE-01 | Backfill is idempotent — running twice produces zero duplicate annotations and no overwrites | unit | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs` | ❌ Wave 0 |
| MIGRATE-01 | Highlight rows skipped during backfill | unit | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs` | ❌ Wave 0 |
| MIGRATE-01 (origin contract) | Backfill writes carry `source: 'crdt-backfill'` origin tag | unit | `node --test src/lib/collab/__tests__/crdtBackfill.test.mjs` | ❌ Wave 0 |
| MIGRATE-01 (e2e) | Open v2.3 PDF in v2.4 client; document renders immediately; backfill runs silently; reload → annotations persist via Y.Doc | e2e | `npx playwright test --grep "phase30-backfill-roundtrip"` | ❌ Wave 0 |
| Phase 30 dual-write | `dualWriteFabricCommit` fires both legacy upsert AND bridge.applyFabricCommit when CRDT enabled + non-highlight | unit | `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` | ❌ Wave 0 |
| Phase 30 dual-write | When kill switch off, dual-write skips CRDT side; legacy behavior byte-identical | unit | `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` | ❌ Wave 0 |
| Phase 30 dual-write | When `annotation_type === 'highlight'`, dual-write skips CRDT side regardless of kill switch | unit | `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` | ❌ Wave 0 |
| Phase 30 retry queue | Failed legacy write enqueues entry; subsequent retry tick re-attempts and removes from queue on success | unit | `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | ❌ Wave 0 |
| Phase 30 retry queue | Re-edit during queued state replaces entry (latest-version-wins, NOT append) | unit | `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | ❌ Wave 0 |
| Phase 30 retry queue | Quarantine after 10 failed attempts; entry stays in queue with `quarantined: true`; subsequent drain skips quarantined entries | unit | `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | ❌ Wave 0 |
| Phase 30 retry queue | 30-second silence threshold fires `onStuck` callback when any entry has been pending > 30s | unit | `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | ❌ Wave 0 |
| Phase 30 retry queue | Queue persists to localStorage; reading queue from localStorage on app boot returns the same entries | unit | `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | ❌ Wave 0 |
| Phase 30 retry queue (e2e) | Inject network failure on legacy write; verify banner appears after 30s; verify queue drains on network restore | e2e | `npx playwright test --grep "phase30-stuck-queue-banner"` | ❌ Wave 0 |
| Phase 30 lint guard | "Diff = delete" CI grep returns 0 hits across the 3 migration files | smoke | `node scripts/check-no-diff-delete.mjs` (NEW) | ❌ Wave 0 |
| Phase 30 banner | StorageFailureBanner with `code='sync_queue_stuck'` renders heading "Saving is catching up", body matches CONTEXT.md, action link "Retry now" | unit | `node --test src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs` (or extend existing test file) | ❌ Wave 0 |
| Phase 30 Web Locks | Two concurrent `runBackfill(...)` calls on same `(userId, documentId)` produce ONE leader path + ONE no-op loser path | unit (with browser-API mock) | `node --test src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs` | ❌ Wave 0 |
| Phase 30 race window | Edit during backfill — user creates a new annotation while backfill is in flight; both annotations land in Y.Map without collision | e2e | `npx playwright test --grep "phase30-edit-during-backfill"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test src/lib/collab/__tests__/<changed-file>.test.mjs` — under 5 seconds per file
- **Per wave merge:** `npm test` — full unit suite (~30s baseline preserved from Phase 29)
- **Phase gate:** Full suite green + all 4 Phase 30 e2e specs un-fixme'd before `/gsd:verify-work 30`

### Wave 0 Gaps

- [ ] `src/lib/collab/__tests__/crdtBackfill.test.mjs` — covers MIGRATE-01 (author/device/timestamp preservation, idempotency, highlight skip, origin tag)
- [ ] `src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs` — covers Web Locks election (loser short-circuit)
- [ ] `src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` — covers retry queue (enqueue, drain, replace, quarantine, stuck threshold, persistence)
- [ ] `src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` — covers `dualWriteFabricCommit` fan-out (kill switch, highlight filter, both-sides happy path, one-side-fail enqueue)
- [ ] `src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs` — covers new copy variant (heading, body, action link, dismiss button rendering)
- [ ] `tests/phase30/phase30-backfill-roundtrip.spec.mjs` — Playwright e2e for first-open silent backfill + reload persistence
- [ ] `tests/phase30/phase30-stuck-queue-banner.spec.mjs` — Playwright e2e for retry queue + 30s banner threshold
- [ ] `tests/phase30/phase30-edit-during-backfill.spec.mjs` — Playwright e2e for race window
- [ ] `tests/phase30/phase30-quarantine-marker.spec.mjs` — Playwright e2e for quarantined-annotation inline marker
- [ ] `scripts/check-no-diff-delete.mjs` — CI grep gate; runs in `npm test` script extension OR as a separate CI step

## Sources

### Primary (HIGH confidence)
- `.planning/research/SUMMARY.md` — single decision document; Phase 30 = "Migration Phase A — Dual-Write Era" with explicit Pitfall 1 + 5 defenses
- `.planning/research/PITFALLS.md` Pitfall 1 (lines 13-34) — migration partial-state failure mode; idempotent backfill via `client_anno_id`; "no diff-equals-delete logic anywhere"
- `.planning/research/PITFALLS.md` Pitfall 5 (lines 120-150) — applyUpdate-only invariant; never replace state wholesale
- `.planning/research/ARCHITECTURE.md` §11 (lines 434-493) — backfill-via-advisory-lock pattern; one-time per-document backfill; "source rows are kept (NOT deleted) as recovery fallback"
- `.planning/research/STACK.md` — Yjs trio at `^13.6.30` / `^1.0.7` / `^9.0.12`; no new deps for migration; bytea binary updates
- `.planning/phases/27-crdt-foundation/27-CONTEXT.md` — applyUpdate-only invariant; storage-failure banner pattern; highlights-stay-on-legacy
- `.planning/phases/27-crdt-foundation/27-04-PLAN.md` — `crdtFeatureFlag.isCRDTEnabled()` 3-tier read order
- `.planning/phases/27-crdt-foundation/27-05-PLAN.md` — `<YDocProvider>` mount pattern; backfill mounts inside this boundary
- `.planning/phases/27-crdt-foundation/27-UI-SPEC.md` — banner shape contract Phase 30 reuses
- `.planning/phases/28-transport-spike-auth-validator/28-CONTEXT.md` — origin payload structure; permission_revoked channel
- `.planning/phases/28-transport-spike-auth-validator/28-RECONCILIATION.md` — locked transport choice (custom Supabase Realtime adapter); RLS migration `20260504000000` live
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-CONTEXT.md` — bridge `applyFabricCommit` entry; `meta.updatedAt` LWW tiebreak; per-user undo via `trackedOrigins`
- `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-RECONCILIATION.md` — bridge does NOT include legacy-side writes (Phase 30 owns)
- `src/services/annotationCloudSync.js` (line 26 NON_HIGHLIGHT_TYPES, line 173 loadAllNonHighlightAnnotations) — read path Phase 30 backfill reuses
- `src/lib/collab/crdtAnnotationBridge.js` (lines 71-88 shallowEqual, 175-265 applyFabricCommit, 226-227 isCreate sentinel) — bridge's idempotency contract
- `src/lib/collab/crdtFeatureFlag.js` — Phase 30 reuses verbatim
- `src/lib/collab/ydocLifecycle.js` (lines 119-151 Web Locks pattern) — Phase 30 reuses pattern
- `src/components/collab/StorageFailureBanner.jsx` — extension surface
- `src/components/collab/YDocProvider.jsx` — Phase 30 backfill mounts inside this provider
- `src/services/annotationTypeSerializers.js` lines 175-189 (highlight_id field as stable per-annotation UUID), lines 198-223 (deserializeRowToFabricObject) — backfill row ingest path
- [Yjs Y.Map official docs](https://docs.yjs.dev/api/shared-types/y.map) — Y.Map field semantics
- [Yjs Document Updates official docs](https://docs.yjs.dev/api/document-updates) — applyUpdate, encodeStateAsUpdate, mergeUpdates; HIGH confidence on idempotent updates
- [Yjs README — applyUpdate is commutative + idempotent at the binary update level](https://github.com/yjs/yjs/blob/main/README.md) — HIGH
- [Web Locks API on MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — `navigator.locks.request` semantics, browser support
- [Lock API caniuse](https://caniuse.com/mdn-api_lock) — Baseline since March 2022; Chrome 69+, FF 96+, Safari 15.4+, Edge 79+

### Secondary (MEDIUM confidence)
- [Yjs community thread — "Are YJS observers meant to be idempotent?"](https://discuss.yjs.dev/t/are-yjs-observers-meant-to-be-idempotent/3894) — community-validated idempotency expectations
- [Yjs community thread — "Migrating data to YJS, optimizing storage"](https://discuss.yjs.dev/t/migrating-data-to-yjs-optimizing-storage/2748) — migration size patterns
- [Y.Map semantics — Yjs Docs / Y-Map repo](https://github.com/y-js/y-map) — set/delete/observe behavior
- [PowerSync blog — Postgres + Yjs CRDT pattern](https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync) — bytea storage, batching
- [Hocuspocus + Supabase Auth (reference only)](https://emergence-engineering.com/blog/hocuspocus-with-supabase) — Hocuspocus path is dormant per Phase 28 lock; included for completeness

### Tertiary (LOW confidence — flagged for validation)
- Whether `setTimeout(runBackfill, 0)` vs `Promise.resolve().then(runBackfill)` produces a perceptibly different first-open feel on slow Electron builds — needs benchmark in Wave 1; planner verifies
- Whether the `BroadcastChannel` cross-tab queue coordination is needed beyond Web Locks (CONTEXT.md "Claude's Discretion") — likely no; Web Locks already arbitrates the backfill, and the queue drain runs on a per-tab timer; planner confirms during Wave 0 scout

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive (Yjs trio, Web Locks, Phase 27/28/29 modules) is already in production use here
- Architecture: HIGH — patterns are already shipped in Phases 27-29; Phase 30 is wiring, not invention
- Pitfalls: HIGH — drawn from `.planning/research/PITFALLS.md` (live document) + 2 new Phase-30-specific pitfalls (createdAt clobber, author clobber) verified against the existing bridge code
- Validation: HIGH — Phase 27/28/29 test-scaffold pattern (per-test existsSync skip-guard) carries forward verbatim

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (30 days for stable Yjs/Supabase/Electron stack); re-verify Web Locks browser support if any browser baseline shifts before Phase 31 starts

---

*Research for: Phase 30 Migration Phase A — Dual-Write Era*
*Confidence: HIGH*
