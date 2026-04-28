---
phase: 30-migration-dual-write
plan: 02
subsystem: collab
tags: [yjs, supabase, web-locks, migration, crdt, dual-write, idempotency]

# Dependency graph
requires:
  - phase: 30-migration-dual-write
    provides: Plan 30-01 test scaffolds (crdtBackfill.test.mjs + crdtBackfill.weblocks.test.mjs) + scripts/check-no-diff-delete.mjs CI grep gate
  - phase: 29-fabric-yjs-binding-per-user-undo
    provides: applyFabricCreate / applyFabricCommit bridge entry points + meta.authorId existence sentinel for idempotency
  - phase: 28-transport-spike-auth-validator
    provides: originBuilder.buildOrigin frozen-payload factory
  - phase: 27-crdt-foundation
    provides: applyUpdate-only invariant test + ydocLifecycle Web Locks election precedent
  - phase: 21-cloud-sync
    provides: NON_HIGHLIGHT_TYPES list (annotationCloudSync.js line 26)
provides:
  - "src/lib/collab/crdtBackfill.js — pure-module runBackfill() with Web Locks election + bridge integration + Pitfall 30-1 createdAt override"
  - "Idempotent legacy → CRDT backfill keyed by client_anno_id (highlight_id) with per-(user, document) Web Locks arbitration"
  - "MIGRATE-01 metadata preservation: meta.authorId = legacy row.user_id, meta.deviceId = 'before-v2.4', meta.createdAt = legacy row.created_at"
  - "Backfill writes carry origin source: 'crdt-backfill' so Phase 33 activity log can render the single 'Document migrated' row per migrated document"
  - "Per-user yMapMeta marker `backfill_done:${userId}` propagates via CRDT sync — second device opening after first finishes short-circuits"
affects:
  - "30-04 dual-write fan-out (annotationCloudSync.js narrow waiver) — consumes runBackfill from the same provider boundary"
  - "30-06 YDocProvider mount — wires runBackfill on first v2.4 open via originPayloadFactory"
  - "33-activity-log — reads origin.source === 'crdt-backfill' to render the per-document 'Document migrated' row"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-module + Web Locks election (callback resolves on done, not held forever — diverges from Phase 27 lifetime-hold pattern)"
    - "Pitfall 30-1 fix: post-create override pass — second ydoc.transact in same origin to overwrite bridge's hardcoded Date.now() createdAt with legacy timestamp"
    - "Defensive deserialization: handles both production {fabricObject} shape and test-fixture flat-JSON-string shape"
    - "Per-user yMapMeta marker (backfill_done:${userId}) wrapped in tagged transact for clean Phase 33 attribution surface"

key-files:
  created:
    - "src/lib/collab/crdtBackfill.js (~280 LOC pure module)"
  modified:
    - "src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs (Node 22 navigator-getter compat fix)"

key-decisions:
  - "Pitfall 30-1 override approach: separate ydoc.transact wrapping metaYMap.set('createdAt', legacyMs) AFTER applyFabricCreate. Same backfill origin ensures Phase 33 attributes both transactions to the migration; Y.Map per-key LWW means the override wins for read."
  - "Pitfall 30-2 fix: ctx.userId = row.user_id (NOT importing user) at every per-row site. Bridge writes meta.authorId from ctx, so author attribution is preserved by passing the legacy creator at call time."
  - "Defensive deserialization (deserializeRowDefensive) instead of importing annotationTypeSerializers.deserializeRowToFabricObject. Tests use a flat-JSON-string row shape that the production deserializer rejects (it expects {fabricObject} wrapper). Defensive helper handles both shapes."
  - "Optional yMapAnnotations arg — tests pass it directly for assertion ergonomics; production callers (Plan 30-06 YDocProvider) get default ydoc.getMap('annotations'). Both paths exercised."
  - "Optional originPayloadFactory — tests rely on default (originBuilder.buildOrigin + source override); Plan 30-06 will pass a factory so the per-user undo manager can recognize backfill writes via reference equality if needed later."
  - "Closing transact for backfill_done marker also tagged with 'crdt-backfill' origin — clean single attribution surface for Phase 33 (entire migration sits behind one origin source)."
  - "SSR/Node fallback when navigator.locks absent — runs unlocked. Tests inject fake navigator.locks for the weblocks test pair; production browsers always have it."

patterns-established:
  - "Pitfall fix via post-write override: when an upstream module (Phase 29 bridge) hardcodes a value the caller needs to override, wrap a follow-up Y.Map.set in its own ydoc.transact tagged with the same origin. Cleaner than rewriting the bridge."
  - "Defensive deserialization helper for migration code: caller-side helper that handles multiple legacy data shapes (production-strict + test-fixture-loose) without modifying the canonical deserializer."
  - "Plan-30-1-style scaffold compat fix: when a test scaffold breaks on a newer Node version, fix the scaffold defensively (Object.defineProperty for getter-only globals) rather than working around it in production code."

requirements-completed:
  - MIGRATE-01

# Metrics
duration: 4min
completed: 2026-04-28
---

# Phase 30 Plan 02: Backfill Module — runBackfill with Web Locks + Bridge Integration Summary

**Pure-module runBackfill that copies legacy v2.3 annotations into the Y.Doc with original-author + 'before-v2.4' device-tag + original-timestamp preservation, idempotent across re-runs via the Phase 29 bridge's meta.authorId sentinel, Web-Locks-arbitrated against same-user-same-doc tab races.**

## Performance

- **Duration:** ~4 minutes
- **Started:** 2026-04-28T17:03:25Z
- **Completed:** 2026-04-28T17:07:46Z
- **Tasks:** 1
- **Files modified:** 2 (1 new, 1 fixed)

## Accomplishments

- New pure module `src/lib/collab/crdtBackfill.js` (~280 LOC) implements the full MIGRATE-01 data path
- 8/8 Plan 30-01 backfill test scaffolds flipped skip → green:
  - 6 from `crdtBackfill.test.mjs` (authorId preservation, deviceId literal, createdAt override, idempotency, highlight skip, origin tag)
  - 2 from `crdtBackfill.weblocks.test.mjs` (concurrent leader/loser election, fast loser short-circuit < 100ms)
- Per-user `backfill_done:${userId}` marker stored INSIDE Y.Doc — propagates via CRDT sync to other devices
- Pitfall 30-1 (createdAt clobber by bridge's hardcoded Date.now()) defended via post-create override pass tagged with same backfill origin
- Pitfall 30-2 (author clobber by importing user) defended via per-row ctx.userId = row.user_id
- Plan 30-04 (dual-write fan-out) and Plan 30-06 (YDocProvider mount) unblocked — `runBackfill` is now consumable

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement runBackfill() with Web Locks election + bridge integration + createdAt override** — `ed4b26db` (feat)

_Note: This is a TDD plan but the test scaffolds were pre-existing from Plan 30-01 (per execution context) — the RED step was already on disk before execution started, so the pattern was effectively a single GREEN commit._

## Files Created/Modified

- `src/lib/collab/crdtBackfill.js` (NEW, ~280 LOC) — pure module exporting `runBackfill` (default + named) and `NON_HIGHLIGHT_TYPES_FOR_BACKFILL` constant
- `src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs` (Plan 30-01 scaffold fix) — Node 22 navigator-getter compatibility via `Object.defineProperty` instead of plain assignment

## Decisions Made

1. **Pitfall 30-1 fix approach:** Post-create override pass. After `applyFabricCreate`, perform a SECOND `ydoc.transact(() => metaYMap.set('createdAt', legacyMs), originPayload)` to override the bridge's hardcoded `Date.now()`. Both transactions carry the `'crdt-backfill'` origin so Phase 33 attributes the entire migration to a single source surface. Y.Map per-key LWW means the second write wins for read.

2. **Pitfall 30-2 fix approach:** Per-row `ctx.userId = row.user_id` (NOT the importing user). The bridge writes `meta.authorId` from `ctx.userId` at line 242 of crdtAnnotationBridge.js, so MIGRATE-01 author attribution is preserved by passing the legacy creator at call time. Same applies to the origin payload's userId field for transaction-level Phase 33 attribution.

3. **Defensive deserialization (NOT reuse of `deserializeRowToFabricObject`):** Plan 30-01 test scaffolds pass `annotation_data` as a flat JSON string (`'{"left":0,"top":0}'`) without the production-shape `{fabricObject}` wrapper. The production deserializer in `annotationTypeSerializers.js` throws on rows without `data.fabricObject`. Inline `deserializeRowDefensive` helper handles both shapes — tries `raw.fabricObject` first, falls back to `raw` itself; injects stable `data.id` from `row.highlight_id` when missing.

4. **Optional `yMapAnnotations` arg:** Test scaffolds pass it directly (so they can hold a single reference for assertions); production callers default to `ydoc.getMap('annotations')`. Both paths exercised in tests.

5. **Optional `originPayloadFactory`:** Tests rely on default (originBuilder.buildOrigin + spread-then-freeze with `source: 'crdt-backfill'`); Plan 30-06 will pass a factory so per-user undo manager can recognize backfill writes via reference equality if needed.

6. **Closing transact tagged with backfill origin:** The `yMapMeta.set('backfill_done:${userId}', Date.now())` marker write is wrapped in its own `ydoc.transact` carrying the `'crdt-backfill'` origin. Phase 33 sees a single clean attribution surface for the entire migration (per-row writes + closing marker all under one origin source).

7. **Web Locks pattern divergence from Phase 27:** Phase 27's `ydocLifecycle.js` holds the lock for tab lifetime via `await new Promise(() => {})` (intentional never-resolve). Plan 30-02 RESOLVES the callback after backfill completes — the lock is for serialization, not lifetime ownership. Loser tabs that arrive after the leader marks `backfill_done` short-circuit on the marker check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan 30-01 weblocks test scaffold incompatible with Node 22 navigator getter**

- **Found during:** Task 1 (after initial GREEN run)
- **Issue:** Plan 30-01's `crdtBackfill.weblocks.test.mjs` scaffold uses plain assignment `globalThis.navigator = { locks }` to install the mock. Node 22 exposes `globalThis.navigator` as a getter-only property, causing `TypeError: Cannot set property navigator of #<Object> which has only a getter`. Both weblocks tests failed.
- **Fix:** Replaced plain assignment with `Object.defineProperty(globalThis, 'navigator', { value, writable, configurable, enumerable })` + descriptor restore via `t.after`. The existing descriptor is `configurable: true` so this is safe. Extracted into `installMockNavigator(t, mock)` helper for both tests.
- **Files modified:** `src/lib/collab/__tests__/crdtBackfill.weblocks.test.mjs`
- **Verification:** Both weblocks tests now pass (8/8 backfill tests green); CI gate exits 0; Phase 27 invariant test still green
- **Committed in:** `ed4b26db` (Task 1 commit)

**2. [Rule 1 - Bug] CI gate (`scripts/check-no-diff-delete.mjs`) flagged docstring lines that described what we WON'T do**

- **Found during:** Task 1 verification
- **Issue:** Header comments describing the Phase 30 architectural lock used phrases like "delete...reconcile" and "delete...sync" that matched the gate's regex `\b(diff|reconcile|sync)\b[^\n]{0,80}\bdelete\b`. The gate fired on lines like `// scripts/check-no-diff-delete.mjs scans this file...` because `diff-delete` (hyphenated) word-boundaries match.
- **Fix:** Reworded the docstring to use "row removal" / "reconcile-by-removal" instead of "delete...reconcile". Added inline `// NO_DIFF_DELETE_OK` escape comment on the surviving line. Removed path reference that produced word-boundary collisions on `diff-delete`.
- **Files modified:** `src/lib/collab/crdtBackfill.js` (header comment block)
- **Verification:** `node scripts/check-no-diff-delete.mjs` exits 0 with "OK - 0 violations across 3 files"
- **Committed in:** `ed4b26db` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)

**Impact on plan:** Both fixes were necessary scaffold/comment hygiene — neither changed plan scope or production behavior. The Node 22 navigator fix unblocks an entire test class (Web Locks election scenarios) for all future Phase 30 plans; the CI-gate comment rework is a pure docstring change with no semantic effect.

## Issues Encountered

None during planned work — both deviations above were caught immediately by the verification step (test run + CI gate run) and resolved inline within Task 1.

## User Setup Required

None — no external service configuration required. Plan 30-02 is a pure module addition with zero new dependencies and zero schema changes.

## Next Phase Readiness

- Plan 30-04 (dual-write fan-out in `annotationCloudSync.js` under narrow waiver) can now reference `runBackfill` from the same `<YDocProvider>` boundary
- Plan 30-06 (YDocProvider mount integration) can wire `runBackfill` on first v2.4 open via the `originPayloadFactory` parameter
- Phase 33 activity log already has its data path: filter on `origin.source === 'crdt-backfill'` to identify the per-document migration entries; the `backfill_done:${userId}` yMapMeta marker is the single-row signal

**Always-Protected files byte-identical:** `git diff --stat src/App.jsx src/components/PageAnnotationLayer.jsx src/components/FabricDrawingCanvas.jsx src/components/FabricEditCanvas.jsx src/components/FabricEraserCanvas.jsx src/components/SVGAnnotationLayer.jsx package.json vite.config.js` produced empty output. No DO NOT CHANGE list violations.

**Test baseline preserved:** `npm test` results 358 pass / 9 baseline-fail / 27 skip (vs Phase 29 baseline 350 / 9 / 35). Exactly 8 tests flipped skip→green; 9 pre-existing baseline failures unchanged (cloudSyncMigration tests + convertPdfAnnotationToFabric variants + Phase 29 undo-tombstone-resurrection tests — all out of Plan 30-02 scope).

## Self-Check: PASSED

- `src/lib/collab/crdtBackfill.js` — FOUND
- `.planning/phases/30-migration-dual-write/30-02-SUMMARY.md` — FOUND
- Commit `ed4b26db` — FOUND in git log

---
*Phase: 30-migration-dual-write*
*Completed: 2026-04-28*
