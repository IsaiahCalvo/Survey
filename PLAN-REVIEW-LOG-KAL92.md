# Plan Review Log: KAL-92 — Regression coverage for idle-disappearance / unsafe shrink
Started 2026-06-10 (overnight loop, after KAL-257 converged). MAX_ROUNDS=5.
PLAN_FILE=PLAN-KAL92.md. Implement-on-approval pre-authorized by the overnight charter.

## Round 1 — Codex (thread 019eb05f-631c-76b3-a24b-a50f880e469e)
Findings: (High) zero-coverage premise FALSE — src/hooks/__tests__/useAnnotationCloudSync.dedupeResync.test.mjs and src/utils/__tests__/surveyMarkerSyncSafety.test.mjs already cover both headline bug cases + wiring (the scout pass only searched tests/); (High) 'supabase-storage-survey' contract wrong — actual string supabase-storage-survey-markers, cloud survey hydrate owned by useAnnotationDoc; (High) "erase-all propagates" false for that effect (priorSurveyMarkers: null); (Med) producer wiring unpinned (YDocProvider detail {documentId, removed}); (Med) global-substring regexes too brittle — use scoped slices; (Med) missing branches enumerated; (Med) browser-arm acceptance cannot be silently dropped.
VERDICT: REVISE

### Claude's response (Round 2 rewrite)
All 7 accepted; every citation independently verified in source. Plan rewritten as gap-filling: extend the two existing test files (missing branches + producer contract + scoped-slice handler contract), one small contract test for only-unpinned diagnostics, all dropped-claims removed, ticket to stay In Progress with the browser-arm explicitly deferred to Isaiah (acceptance narrowing is his call). Lesson recorded: scout briefs must include src/**/__tests__ (the runner globs it).

## Round 2 — Codex (same thread)
Findings: (High) plan's src/**/__tests__ edits violate the stated no-src/-edits rule → put new tests in top-level tests/; (Med) dedupe slice anchor backwards — handler body precedes addEventListener; slice from `const onDedupeResync = (e) => {`; (Med) cutover-recovery probe already pinned (annotationInitialHydrationSource.test.mjs:70) — drop; (Low) NaN claim overbroad — finite current + NaN resync is a shrink, split the cases.
VERDICT: REVISE

### Claude's response (Round 3 revision)
All 4 accepted: three NEW tests/ files (src/ byte-untouched), corrected slice anchor, dropped the duplicate pin, NaN semantics split (and the finite-current+NaN-resync block is now pinned as a deliberate safety property).

## Round 3 — Codex (same thread)
Findings: (High) Goal line still said "extending the two EXISTING files" — stale wording; (High) slice contract must pin all five shouldApplyDedupeResync inputs, not just decision.apply + logs; (Med) out-of-scope said "non-test src/ change" — weakened the absolute rule; (Low) risk line still referenced the old listener-registration anchor.
VERDICT: REVISE

### Claude's response (Round 4 revision)
All 4 accepted — wording reconciled everywhere ("complement, never modify"), slice contract now pins all five wired inputs, out-of-scope is "Any src/ change", anchor wording fixed.

## Round 4 — Codex
"No blocking findings. Prior blockers are fixed: top-level tests/ only, dedupe slice anchored correctly with all five inputs pinned, duplicate cutover probe dropped, and src/ scope is now absolute. Browser arm remains explicitly not done, with ticket staying In Progress."
VERDICT: APPROVED (4 rounds). Build begins.

## Round 5 (result) — Codex
First pass: 3 medium findings (bare-string contract regexes; producer gate/dispatch asserted separately; NaN removedCount shrink path untested). All fixed.
Final: "No blocking findings. Staged scope is only tests/ plus plan docs; no src/ changes. The three prior review issues are fixed: scoped call-block regexes, producer gate-to-dispatch match, and NaN removedCount shrink coverage."
VERDICT: APPROVED — converged (plan rounds 1–4, result rounds 5–6). Gates: 26/26 new, suite 1352/1346/6/0, build clean.
