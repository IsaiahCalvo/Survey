# Plan Review Log: BL-22 — survey marker name prompt default snaps back on delete
Started 2026-06-10 ~08:55 (scheduled loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-BL22.md (PLAN.md is the governing Excel-sync contract — untouched).

## Round 1 — Codex
Findings:
1. Enter still saves during IME composition (32244). Fix: ignore Enter when composing.
2. autoFocus does not select the default, so immediate typing/paste appends to "camera 1". Fix: select on first focus only when input state is null.
3. Source-contract tests prove strings, not behavior. Fix: add a behavior test (default shown → clear → stays blank → type custom → save custom).
4. Commit test "count >= 2" is weak. Fix: scope assertions to the Name Prompt Modal block, require exactly the live Enter + Save coercions.
5. Pending-marker deletion (23801) closes the modal without clearing name input — stale hidden state survives. Fix: clear to null in that branch.
6. Repeated `?? defaultName` logic in value/Enter/Save. Fix: compute once or extract a tiny resolver and test it.
VERDICT: REVISE

### Claude's response
Accepted 2, 3, 4, 5, 6:
- (6+3) extracted `resolveSurveyMarkerPromptName(input, defaultName)` into viewerShared.js next to generateDefaultSurveyMarkerName; behavior tests target it directly. Display keeps inline `??` (single trivial use; extraction there is indirection without test value).
- (2) added `onFocus` select-when-untouched (state === null) — pairs with autoFocus to select the default once at open; never re-selects after editing.
- (4) tripwires now slice the Name Prompt Modal block and assert exact counts (1 display use, 2 resolver calls) plus whole-file zero-counts for the old patterns.
- (5) verified at PDFViewer.jsx:23801 — functional updater nulls pendingSurveyMarkerName without clearing input. Fix: idempotent setSurveyMarkerNameInput(null) inside the matched branch; reading state outside the updater would add a useCallback dep and churn callback identity (2026-05-13 publish-effect gotcha in this exact file).
Rejected 1 (IME Enter guard): pre-existing behavior orthogonal to the revert bug; expanding key-event semantics in the 34k-line high-risk file is out of scope for this slice. Logged as follow-up candidate in the BL-22 issue file.

## Round 2 — Codex
- IME exclusion accepted for this slice.
- BLOCKING: step 7 put setSurveyMarkerNameInput(null) inside the setPendingSurveyMarkerName updater — updaters must stay pure; render-phase update warnings/restarts, a React footgun fixing a mostly-masked issue. Fix: drop the clear, or guard outside with pendingSurveyMarkerName in deps and accept tiny callback churn.
- Minor: contract test should not require the nested-setter shape.
VERDICT: REVISE

### Claude's response
Accepted both. Step 7 now keeps the updater pure and adds a separate guarded clear before it, with pendingSurveyMarkerName joining the useCallback deps — churn is immaterial since surveyMarkers is already a dep (callback re-creates on every marker change today). Tripwire reworded to assert the guard + clear pair, not a nesting shape. My round-1 dep-churn concern was overblown and is withdrawn in the plan text.

## Round 3 — Codex
- BLOCKING: behavior tests cannot import src/viewerShared.js — Node fails on its extensionless internal imports (vite-only resolution). Fix: put the resolver in a small leaf util imported by PDFViewer.jsx and behavior-test that util.
- Step 7 shape confirmed sound.
VERDICT: REVISE

### Claude's response
Verified Codex's claim live: `node -e "import('./src/viewerShared.js')"` fails on './utils/annotationPreviewDiag' (extensionless). Accepted: resolver moves to new leaf util src/utils/surveyMarkerNamePrompt.js (zero internal imports), imported by PDFViewer.jsx; viewerShared.js now untouched. Plan updated.

## Round 4 — Codex
- No material blockers. Nit: setter-site count becomes 14 after step 7's guarded clear.
- Leaf util resolves the Node import problem; step 7 pure and acceptable.
VERDICT: APPROVED

### Claude's response
Nit fixed in plan. Converged in 4 rounds. Proceeding to implementation under the loop's standing authorization (Isaiah away; loop rules: build after Codex plan approval, gated on vite build + node tests, then Codex result review).

## Result review — Codex (same session)
Implementation reviewed against PLAN-BL22.md plus regression hunt over the replace-all reset sites, the new useCallback dep (only rebinds the SVG delete-key effect), and the onFocus guard. Gates: vite build clean, 1368 tests / 0 fail (13 new). Findings: none blocking.
VERDICT: APPROVED
