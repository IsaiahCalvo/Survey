# Plan: KAL-92 — Regression coverage for annotation idle-disappearance + unsafe sync shrink (test-only slice)
_Round 3 draft — revised per Codex rounds 1–2. Overnight charter: NO src/ edits of any kind (all new tests live in top-level tests/), no production DB, no push._

## Goal
Close the REMAINING coverage gaps for the idle-disappearance bug class — missing guard branches, the event-producer contract, and unpinned Save Log diagnostics — with three NEW top-level `tests/` files that COMPLEMENT (never duplicate, never modify) the two existing guard test files. Zero `src/` changes of any kind.

## Corrected context (all verified in-source this session)
- **Existing coverage (round-1 plan wrongly said "zero"):**
  - `src/hooks/__tests__/useAnnotationCloudSync.dedupeResync.test.mjs` — covers exactly ONE guard branch (`startup-shrink` with BOTH `startupSyncInFlight:true` AND `hydrated:false`) + a source-order contract (decision call before the state setter).
  - `src/utils/__tests__/surveyMarkerSyncSafety.test.mjs` — covers the `hydrate-empty-delete-guard` bug case, the post-hydrate empty-with-prior `run:true` case (reason not asserted), and a source contract (guard before sync call, `hydrationReady: surveyAnnotationHydration?.ready === true` wiring, skip-log signature).
- **Uncovered guard branches:** dedupe: `not-a-shrink` (growth/equal), flag isolation (only `startupSyncInFlight`, only `!hydrated`), `shrink-exceeds-dedupe-removal`, allowed `expected-dedupe-shrink`, negative `removedCount` clamp (`Math.max(0,…)`), NaN-input defaults. Survey: all four `sync-disabled` prerequisites, branch priority (`sync-disabled` beats `hydrate-empty-delete-guard`), `empty-unchanged`, pending-hydrate NON-empty (`hydrationReady:false, currentCount>0` → runs), reason-string assertions, no-args defaults.
- **Producer wiring unpinned:** `YDocProvider.jsx:884-887` dispatches `crdt:dedupe-resync` with `detail: { documentId: docId, removed: dedupeResult.removed }`, gated on `dedupeResult.removed > 0`. If `removed` ever stopped being sent, the guard's `shrink-exceeds-dedupe-removal` semantics silently break while existing hook-side regexes still pass.
- **Corrections from Codex round 1 (all verified):** the sidecar survey context string is `supabase-storage-survey-markers` (PDFViewer.jsx:18148), CLOUD survey hydrate is owned by `useAnnotationDoc` (already pinned in `annotationInitialHydrationSource.test.mjs`) — so the round-1 "all three kinds via resolveSafeSnapshot" contract was wrong and is dropped. The survey-marker sync effect passes `priorSurveyMarkers: null` (PDFViewer.jsx:16291), so no erase-all-propagation claim is made for that path — the guard-level inverse (`run:true` post-hydrate) is already tested.
- Baseline: 1326 tests / 1320 pass / 6 skip / 0 fail.

## Approach
All new tests are NEW top-level files under `tests/` — the existing `src/**/__tests__` files are left byte-untouched (no src/ edits at all). New tests cover ONLY branches/wiring the existing files don't.
1. **NEW `tests/dedupeResyncSafetyBranches.test.mjs`:**
   - Branch unit tests for `shouldApplyDedupeResync`: growth and equal → `not-a-shrink`; shrink with ONLY `startupSyncInFlight:true` (hydrated) → `startup-shrink`; shrink with ONLY `hydrated:false` → `startup-shrink`; hydrated shrink > removed → `shrink-exceeds-dedupe-removal`; hydrated shrink ≤ removed → `expected-dedupe-shrink` (apply); negative `removedCount` clamps to 0 so ANY hydrated shrink blocks; `shrink` value reported correctly.
   - NaN semantics split correctly (Codex R2): no-args and all-NaN → counts default 0 → `not-a-shrink`; finite `currentCount` with `resyncCount: NaN` → treated as shrink-to-zero and BLOCKED while un-hydrated (pins the safety property that a NaN resync can never wipe a populated view).
   - Producer contract: YDocProvider source dispatches `crdt:dedupe-resync` with `detail: { documentId: docId, removed: dedupeResult.removed }` behind a `removed > 0` gate.
   - Scoped handler contract: slice the hook source from `const onDedupeResync = (e) => {` (handler body start — it precedes the addEventListener call) through the listener cleanup/removal; assert WITHIN the slice, in order: the `shouldApplyDedupeResync({` call with ALL FIVE inputs wired (`currentCount`, `resyncCount`, `removedCount`, `startupSyncInFlight`, `hydrated`), the `decision.apply` gate, the `dedupe-resync skipped unsafe shrink` signature, and the `dedupe-resync — restoring state` signature.
2. **NEW `tests/surveyMarkerSyncSafetyBranches.test.mjs`:**
   each missing prerequisite (`hasDocumentId:false` / `hasUserId:false` / `documentSyncEnabled:false` / `syncBlocked:true`) → `sync-disabled`; priority case (`syncBlocked:true` AND pending-hydrate-empty) → `sync-disabled` wins; `empty-unchanged` (both zero, hydrated); pending-hydrate NON-empty (`hydrationReady:false, currentCount:3, priorCount:5`) → runs (guard only blocks the empty case); post-hydrate delete case asserts `reason: 'changed-or-delete-after-hydrate'`; no-args call → `sync-disabled`.
3. **NEW `tests/annotationIdleRecoveryContracts.test.mjs`** — pins ONLY diagnostics no existing test asserts (cutover-recovery probe DROPPED — already pinned by annotationInitialHydrationSource.test.mjs:70; remaining items re-verified unpinned by grep before writing):
   - `initial-hydrate-callouts` resolveSafeSnapshot context (callout hydrate is safety-wrapped);
   - `supabase-storage-survey-markers` sidecar context (local sidecar survey hydrate safety-wrapped);
   - stale-cache signatures `stale-cache shrink suppressed` and `re-hydrate after suppress — restoring state from Y.Map`.
4. Gates: `npx vite build` green; `node scripts/run-node-tests.mjs` → all prior 1326 unchanged + new tests pass, 6 skip / 0 fail.
5. Codex reviews the diff; iterate. Local commit only. Linear KAL-92 → **In Progress** (NOT Done) + evidence comment; Obsidian issue file + board updated. **Acceptance honesty:** the ticket's "integration or browser regression reproduces a stale-smaller Y.Doc startup snapshot" bullet requires a mounted-hook/browser harness — deferred with an explicit blocker note (cheapest path: the survey-test-backed app environment from KAL-257); narrowing acceptance is Isaiah's call, not mine.

## Key decisions & tradeoffs
- **New top-level tests/ files vs extending `src/**/__tests__`:** the overnight charter's "no src/ edits" is absolute, so the existing in-src test files stay byte-untouched and the gap coverage lives in `tests/` (round-2 Codex fix; round-1's "extend" guidance is satisfied in spirit — no duplicated assertions, each new test names the existing file it complements).
- **Scoped-slice regex vs global substring:** slice from listener start to cleanup, assert order/arguments inside — proves wiring scope, not just string presence (round-1 Codex fix).
- **No erase-all-propagation claim:** that path provably passes `priorSurveyMarkers: null`; claiming propagation coverage would be false (round-1 Codex fix).
- **Ticket stays In Progress:** the browser-arm acceptance bullet is unmet by design in this slice; flagged, not faked.

## Risks / open questions
- Log-string pins make refactors noisier — intended; these are the ticket's "required diagnostics".
- Slice extraction needs stable anchors (handler-body start `const onDedupeResync = (e) => {` and the listener cleanup) — anchors verified present; the test asserts anchor uniqueness before slicing.

## Out of scope
Any `src/` change; mounted-hook/browser integration; eraser path (covered); cloud survey hydrate contract (covered by annotationInitialHydrationSource.test.mjs); production DB.
