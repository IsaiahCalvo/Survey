# Handoff: Remove the Legacy Persistence Engine Entirely

**Generated**: 2026-06-06 (late session)
**Branch**: `main` (local-only, direct-to-main; push only after Isaiah tests on the dev server)
**Status**: Ready to start — audited, not yet begun

## Goal

Move EVERYTHING still persisting through the old engine onto the new Yjs source-of-truth
engine (`useAnnotationDoc` → `annotationDocSync.js` → `annotation_updates` + `annotation_snapshots`),
then delete the old engine and its now-obsolete tests. End state: ONE persistence system.
Old annotation/PDF data loss is acceptable (Isaiah can re-upload) — **breaking live features is not.**

## Background: what "the old engine" actually is

It is TWO overlapping systems, both still live, plus a flat table:

1. **Legacy flat-table path** — `src/services/documentAnnotationService.js` +
   `src/services/annotationCloudSync.js` + the `document_annotations` table (+ `doc_yjs_state`,
   `doc_yjs_updates`) + Supabase Storage "sidecar" blobs. Still the live home of **survey markers,
   spaces, and presence**.
2. **Phase-27/28/29/30 CRDT collab layer** — `src/components/collab/YDocProvider.jsx`,
   `src/lib/collab/crdtBackfill.js`, `ydocLifecycle.js`, `crdtDualWriteQueue.js`. `isCRDTEnabled()`
   defaults ON; `AppShell.jsx` wraps every open tab in `<YDocProvider>`. Feeds undo/redo and runs
   dual-write retries via `annotationCloudSync.js`. This is a SEPARATE Y.Doc (keyed by raw
   `documentId`) from the new path's Y.Doc (keyed `annoflat:<documentId>`).

The **new engine** (Phase 36, cut over earlier today) currently persists only the things that flow
through `annotationsByPage` (regular fabric annotations: pen, shapes; and callouts). Everything else
is still on the old engine.

## What is on which engine RIGHT NOW (verified this session)

| Data kind | Current engine | Notes |
|---|---|---|
| Regular fabric annotations (pen, shapes) | **NEW** (`useAnnotationDoc`) | Verified green (agent-cli/yjs-roundtrip, roundtrip-save-reopen) |
| Callouts | **NEW** (rides `annotationsByPage` capture) | Confirm in next session; believed migrated |
| Embedded PDF imports (pages 6-11 etc.) | **NEW** (import-once effect) | Fixed + proven this session (agent-cli/import-once-roundtrip) |
| **Survey markers (highlights)** | **OLD** (`documentAnnotationService.js`) | Full save/hydrate/delete/subscribe path. The big one. |
| **Spaces** | **OLD** (Storage sidecar via `resolveSafeSnapshot`) | PDFViewer.jsx:17202 |
| **Regions / space+region annotations** | **UNKNOWN — audit first** | Not yet traced; user explicitly wants these moved |
| **Presence (live cursors)** | **OLD** (`updateDocumentPresence` etc.) | New engine has NO presence yet |
| Undo/redo history | **OLD CRDT layer** (`YDocProvider`/`useYDoc`) | Feeds PDFViewer undo stack (PDFViewer:9338) |

## Completed (this session — already shipped to local main)

- [x] Embedded-import-once fix (durable marker; a stray mark no longer blocks import). Commit `85b836c9`.
- [x] Complete delete cleanup (hard-delete cascade everywhere incl. file-not-found; purge raw-UUID
      IndexedDB + cloudSyncQueue localStorage). Commit `85b836c9`.
- [x] New proof harness `agent-cli/import-once-roundtrip.mjs` (reproduces Isaiah's exact bug, PASS).
- [x] Fallow dead-code cleanup (deps + dead exports + unexports). Commits `265d1c05`, `c08c2c6d`, `6f8b856e`.
- [x] Full audit of what's live vs removable — see "Files to Know" below.

## Not Yet Done (the actual mission for next session)

- [ ] **Audit step (do FIRST):** trace regions, spaces+region annotations, callouts, and presence —
      confirm exactly which engine each uses and what the new engine is missing to host them.
- [ ] Decide the architecture: does the new `annotationDocSync` Y.Doc REPLACE the Phase-28
      `YDocProvider` CRDT layer, or do they merge into one Y.Doc? (They are currently two separate
      Y.Docs. Undo/redo + presence live on the old one.) This decision gates everything else.
- [ ] Migrate **survey markers** onto the new engine (save + hydrate + delete + realtime subscribe).
- [ ] Migrate **spaces / regions / region+space annotations** onto the new engine (replace the
      Storage-sidecar + `resolveSafeSnapshot` restore path).
- [ ] Migrate **presence** onto the new engine (or a dedicated realtime channel) so
      `documentAnnotationService` presence calls can be retired.
- [ ] Retire the **CRDT collab layer** (`YDocProvider` + `crdtBackfill` + `ydocLifecycle` +
      `crdtDualWriteQueue`) once undo/redo + dual-write live on the new engine — OR consciously keep it
      if it becomes the single Y.Doc. Don't leave two Y.Docs.
- [ ] Delete the now-dead legacy code (only after the above): `useAnnotationCloudSync.js`,
      `cloudSyncQueue.js`, `snapshotStore.js`, `mergePreservingImportedMarks` (from `safeSnapshot.js`),
      `documentAnnotationService.js`, `annotationCloudSync.js`, and the `document_annotations` /
      `doc_yjs_state` / `doc_yjs_updates` tables.
- [ ] Test-file audit & cleanup (see "Test-file policy" — do NOT blanket-delete).

## The exact removal blockers (why nothing is deletable yet)

From `debug/fallow-audit/2026-06-06/AUDIT-cleanup-scope.md` (read it — it has file:line for every claim):

| Item | Status | Blocker |
|---|---|---|
| `documentAnnotationService.js` | LIVE | Survey markers' entire save/hydrate/delete/subscribe/presence path |
| `annotationCloudSync.js` | LIVE | `YDocProvider` calls `upsertFabricAnnotation` + `loadAllNonSurveyMarkerAnnotations` + dual-write retry |
| `resolveSafeSnapshot` (in `safeSnapshot.js`) | LIVE | Survey-marker hydrate (PDFViewer:14988) + spaces sidecar (17202) + survey sidecar (17171). Keep `countSnapshotItems` too (internal). |
| CRDT layer (`YDocProvider` etc.) | LIVE | Default-on; wraps every tab; feeds undo/redo |
| `useAnnotationCloudSync.js` (hook) | INERT but blocked | 3 tests `readFileSync` it with NO skip-guard → deleting the file crashes `npm test`. Also `cloudSyncQueue.js` + `snapshotStore.js` only die alongside it. `mergePreservingImportedMarks` only used by it. |

So the ONE inert-but-removable cluster (`useAnnotationCloudSync` + `cloudSyncQueue` + `snapshotStore`
+ `mergePreservingImportedMarks`) can only be deleted as a batch AFTER fixing/removing the 3
no-skip-guard tests — and it's near-zero value until the survey-marker migration is done anyway, so
do it as the LAST cleanup step.

## Failed Approaches (Don't Repeat These)

- **Don't try to "just delete the old code" as cleanup.** It was attempted this session and
  abandoned: the old persistence is still the live home of survey markers, spaces, and presence, and
  the CRDT layer is on by default. Deleting any of it now breaks working features. The only path is
  migrate-then-delete.
- **Don't delete `useAnnotationCloudSync.js` (or `cloudSyncQueue.js`/`snapshotStore.js`) standalone.**
  Three test files read the hook as raw text with no `existsSync` guard, so deletion throws ENOENT and
  crashes the whole `npm test` run before any test executes. Fix those tests first.
- **Don't GC `document_annotations` while survey markers still write to it.** Data loss is fine, but
  the table is still actively written by the live survey-marker path — emptying it breaks today's
  survey markers, not just old data.

## Key Decisions (made this session)

| Decision | Rationale |
|---|---|
| Stay on Supabase (no Convex) | Two research docs concluded the DB isn't the bottleneck; rendering is. `convex-vs-supabase-pdf-annotation.md` + `docs/database-stack-research-2026-06-06.md`. |
| New engine = Yjs op-log + snapshot | Google-Docs/Figma shape; already built + cut over. `.planning/optimization/PERSISTENCE-ARCHITECTURE.md`. |
| Embedded import gated on durable marker, not mark count | A single user mark was silently blocking PDF import (Isaiah's bug). |
| Migrate-then-delete, never delete-first | Old code is live; deleting first breaks survey markers/presence. |

## Test-file policy — Isaiah's instruction vs my pushback (READ THIS BEFORE DELETING ANY TEST)

**Isaiah's instruction (verbatim intent):** tests feel unnecessary; "everything should be official
100%"; "there's no need to keep a test file"; if we don't need it, get rid of it. He then explicitly
delegated the call: "I guess that's for you to audit, investigate, and use your best judgment on."

**My pushback (strong, reasoned — surface this to Isaiah before acting):**
Do **NOT** blanket-delete the test suite. Deleting all tests would actively work against the stated
goal ("official 100%"). Here is the detailed reasoning, the evidence, and the exact policy I
recommend instead.

### Why "delete all tests" is the wrong move

1. **Tests are not "unofficial" — they are the official proof.** The instinct seems to be that test
   files are scaffolding/clutter separate from the "real" product. They are the opposite: they are the
   executable definition of what "working" means. Removing them doesn't make the app more official; it
   removes the only automated evidence that the app does what it claims. For a one-person, AI-built,
   pre-launch product where Isaiah cannot manually re-verify 900+ behaviors each change, the tests ARE
   the QA department.

2. **They have already paid for themselves THIS session — twice.**
   - The full node suite (`node scripts/run-node-tests.mjs`, ~921 tests) caught a real regression the
     moment the fallow cleanup deleted a role-set comment: the KAL-31 contract test failed, which is
     how we knew to move that documentation onto the kept function instead of silently breaking a
     guarded invariant. Without that test, the breakage ships invisibly.
   - The `agent-cli/*-roundtrip.mjs` harnesses are how we PROVED, against the real Supabase backend,
     that save→reopen, re-upload reuse, and the embedded-import-once fix actually work — including
     reproducing Isaiah's exact pages-6-11 bug and confirming it's fixed. That is the single most
     "official 100%" artifact we produced; deleting it would mean future changes to persistence have
     zero objective verification.

3. **The migration ahead is the highest-data-loss-risk work in the whole project.** We are moving
   survey markers, spaces, regions, and presence between persistence engines. The way you avoid
   silently corrupting/losing live user data during that migration is a per-kind roundtrip test that
   asserts the data survives save→reopen→delete on the NEW engine before the OLD path is deleted.
   Deleting tests here removes the safety net at the exact moment it matters most.

### The policy I recommend (this is the "best judgment" Isaiah asked for)

Classify every test, keep or delete by category — do NOT delete by default:

- **KEEP — real-backend proof harnesses** (`agent-cli/*-roundtrip.mjs`, `reupload-survival`,
  `roundtrip-save-reopen`, `import-once-roundtrip`, `yjs-roundtrip`). These ARE the official
  verification. Expand them: write one new harness per migrated data kind.
- **KEEP — tests that assert LIVE behavior/invariants** that will still exist after the migration
  (e.g. the new-engine store/sync tests, contract guards for features that remain). These are the
  regression net for the migration itself.
- **DELETE — tests that exclusively cover code being removed.** A test for `useAnnotationCloudSync`,
  `snapshotStore`, `mergePreservingImportedMarks`, or the legacy flat-table services becomes obsolete
  *by construction* the moment that code is deleted. Delete it in the SAME commit as the code it
  covered — never leave a test pointing at a deleted module.
- **FIX-OR-DELETE — the brittle source-grep tests.** Three files read source as raw text with no
  `existsSync` skip-guard (`annotationInitialHydrationSource`, `syncStatusUi`,
  `eraserSaveHistorySyncContracts`); they crash the whole run if their target file is removed. When you
  remove their target, remove/rewrite these in the same commit. (Separately: this grep-on-source style
  is fragile — if any are worth keeping, port them to assert behavior, not file contents.)

### Operating rule for the migration

Every commit that DELETES code also deletes that code's now-obsolete tests — together, never
separately. Every commit that MIGRATES a data kind adds a roundtrip harness proving it on the new
engine BEFORE the old path is removed. Net effect: the suite shrinks honestly (dead tests leave with
dead code) while coverage of LIVE behavior never drops. That is how you reach "100% official" — by
making every test correspond to something real, not by having zero tests.

**If after reading this Isaiah still wants a more aggressive cut, get an explicit confirm naming which
categories to drop — don't infer "delete everything" from "I feel like we don't need tests."**

## Files to Know

| File | Why it matters |
|---|---|
| `debug/fallow-audit/2026-06-06/AUDIT-cleanup-scope.md` | The removal map: every live caller, every test blocker, file:line. START HERE. |
| `debug/fallow-audit/2026-06-06/AUDIT-continuity.md` | (If present) data-continuity trace; was interrupted — may need re-running. |
| `.planning/optimization/PERSISTENCE-ARCHITECTURE.md` | The definitive target architecture + 7-step plan. |
| `docs/database-stack-research-2026-06-06.md` | Why we stay on Supabase. |
| `src/services/annotationDocSync.js` | The NEW engine. The migration target. |
| `src/hooks/useAnnotationDoc.js` | React seam for the new engine (open/hydrate/capture). |
| `src/services/documentAnnotationService.js` | The OLD survey-marker engine to be replaced. |
| `src/components/collab/YDocProvider.jsx` | The OLD CRDT layer (undo/redo, dual-write) — decide its fate. |
| `src/PDFViewer.jsx` | ~34k lines, highest-risk. Survey-marker + spaces hydration live here (14968, 14988, 17171, 17202); import-once effect ~20625. Minimum-diff only. |

## Code Context

New engine handle API (what to route survey markers / spaces / regions through):
```js
// openAnnotationDoc({ documentId, supabase, clientId, enableLocal, enableRealtime, doc }) → handle
handle.getByPage()              // { [page]: { objects: [...] } }
handle.applyByPage(byPage)      // merge state in → emits Y.Doc update → annotation_updates INSERT
handle.getMeta(key) / setMeta(key, value)   // <-- use meta for non-page data (spaces, regions?)
handle.onChange(cb); handle.flushSnapshot(); handle.drain(); handle.destroy();
```
Open question to resolve: survey markers + spaces aren't per-page fabric objects in the same shape —
decide whether they become objects in `annotationsByPage` (so they ride `applyByPage`) or live in
Y.Doc `meta`/separate maps. The store engine is `src/services/annotationDocStore.js` (pure, testable).

Embedded-import-once gate (the pattern to mirror for "do this once per doc"):
```js
// read documents.embedded_import_completed_at; if null → do work → stamp it; else skip
```

## Resume Instructions

1. Read `debug/fallow-audit/2026-06-06/AUDIT-cleanup-scope.md` end to end (the removal map).
2. **Audit phase** — trace and write down, for regions / spaces / region+space annotations / callouts /
   presence: which engine, which exact call sites, and what the new engine lacks to host each.
   Spawn parallel Sonnet investigators (one per data kind) writing to `debug/` — don't hold it all in context.
3. **Decide** the YDocProvider question: one Y.Doc or two. Write the decision down before coding.
4. Migrate one data kind at a time, smallest-blast-radius first (suggest: callouts confirm → spaces →
   regions → survey markers → presence). After EACH:
   - `npx vite build` (expect clean)
   - `node scripts/run-node-tests.mjs` (baseline was 921/0/6 this session)
   - Run the relevant `agent-cli/*-roundtrip.mjs`; write a NEW harness per migrated kind proving
     save→reopen→delete against the real backend (this is the official proof Isaiah wants).
   - Commit on local main; let Isaiah test on the dev server before pushing.
5. Only after a kind is fully on the new engine + proven, delete its old code path.
6. LAST: delete the inert cluster (`useAnnotationCloudSync` + `cloudSyncQueue` + `snapshotStore` +
   `mergePreservingImportedMarks`) together, fixing the 3 no-skip-guard tests in the same commit.
7. Drop the dead tables (`document_annotations`, `doc_yjs_state`, `doc_yjs_updates`) via migration once
   nothing reads/writes them.

## Setup Required

- Real-backend harnesses need `.env` / `.env.local` (Supabase URL + anon key + `VITE_DEV_AUTO_LOGIN_EMAIL`/`_PASSWORD`). Already present on this machine.
- Run harnesses with `node agent-cli/<name>.mjs` (they sign in as the dev account, RLS enforced).

## Warnings

- `PDFViewer.jsx`, `useAnnotationCloudSync.js`, `PageAnnotationLayer.jsx`, `viewerShared.js` are the
  high-risk files (CLAUDE.md). Honor the enforced invariants: container-aware canvas sizing,
  single-name fontFamily, the `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer`.
- There are **two Y.Docs** today (`annoflat:<id>` new vs raw-`<id>` CRDT). Don't accidentally write to
  the wrong one. The raw-`<id>` IndexedDB is now purged on delete (this session's fix).
- Uncommitted at handoff time: 4 modified test files in the working tree (`mergePreservingImportedMarks`,
  `pdfAnnotationImporter`, `overlayPresentationGate`, `safeSnapshot`) — these were modified BEFORE this
  session (not by it). Decide whether to keep/commit them as part of the test audit.
- A prior session note: the `git add -A` mistake bundled some unrelated WIP (prototype spikes, main,
  viewerShared) into the fallow-cleanup commits this session. Not a behavior change, but history is
  slightly mixed if you go spelunking.
