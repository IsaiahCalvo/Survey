# Plan Review Log: BL-23 — templates editor background refresh wipes in-progress category renames
Started 2026-06-10 ~10:25 (scheduled loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-BL23.md (root PLAN.md is the governing Excel-sync contract — untouched).

## Round 1 — Codex
Findings:
1. `mintId` recreated each render → effect-dep loop or stale-closure trap. Fix: stable identity.
2. Render-phase `dirtyRef.current = dirty` writes are a concurrent-React footgun. Fix: effect keyed on prop version + last-processed guard, dirty in deps.
3. Save-failure assumption wrong: `hubSaveTemplates` catches without rethrow → editor clears dirty permanently on failed saves. Fix: rethrow from host or clear dirty only on resolve.
4. Save/refetch race: dirty cleared before persistence/refetch completes can reload stale rows. Fix: saving guard / clear-on-resolve.
5. Remote delete while dirty gets resurrected on Save (persistTemplates re-creates missing rows). Fix: detect deferred remote deletes.
6. Remote edits silently overwritten on Save; conflict-detect via updatedAt/hash.
7. Positional id-cache keys mis-attach ids after insert/delete/reorder of id-less rows. Fix: semantic path + occurrence keys, test insertion.
8. `resolveTitleCommit` equal-after-trim still calls renameCategory → mutateTpl sets dirty even on no-op blur. Fix: noop action.
9. Escape-then-blur dirties via the same no-op bug. Fix: covered by noop; add test.
10. Plan path said `src/home/Dashboard.jsx`; actual host is `src/Dashboard.jsx`.
11. Pure-util tests won't catch hook deps, DOM snapback, save race, buildRich wiring. Fix: component rerender tests.
12. Simpler alternative: one effect keyed by prop version + explicit dirty policy; no render-synced refs.
VERDICT: REVISE

### Claude's response
Verified findings 3/4 live before accepting: `persistTemplates` (Dashboard.jsx:1148) swallows every per-row error AND the outer catch; `hubSaveTemplates` (3114) alerts without rethrowing; exactly two persistTemplates callers (hubSaveTemplates + the template-modal save, which has its own catch). Also verified 8: `mutateTpl` sets dirty unconditionally, so a no-op blur dirties the editor.
Accepted 1 (lazy-ref stable mint), 2+12 (rewrote the reload effect: guard ref written only inside the effect, keyed on `reloadFromProps` useCallback identity as the (templates,user) snapshot key, `dirty`/`rich` in deps with early-return guard — no render-phase ref writes), 3+4 (editor clears dirty only in `.then`, restores on `.catch`; host: persistTemplates counts row failures and throws after the refetch, hubSaveTemplates rethrows after its alert — `deleteTemplates`' existing `.catch(setDirty(true))` becomes functional for free), 7 (semantic name+occurrence cache keys via `createOccurrenceKeyer`, insertion-before test added), 8+9 (new `noop` action when trimmed value equals current name; Escape-then-blur test), 10 (path corrected).
Partially accepted 11: added source-tripwire tests over TemplatesEditor.jsx + Dashboard.jsx (BL-22 pattern) covering the effect guard, onBlur wiring, buildRich mint sites, dirty-clear timing, and the host throw contract. Rejected jsdom/RTL component mounting: no component-test infra exists in the repo (node:test only); introducing that stack is its own task, logged as follow-up.
Rejected 5/6 for this slice: deferred remote deletes/edits resolving last-writer-wins on Save is today's Save semantics; the alternative (current behavior) silently wipes the ACTIVE user's edits, which is strictly worse. Real conflict handling needs a product decision — queued for Isaiah on the board per loop rules (no product decisions while away). Documented as explicit accepted limitations in the plan.

## Round 2 — Codex
1. `deleteTemplates` still clears dirty synchronously — same save/refetch wipe race for deletes. Fix: gate on save resolve like handleSaveTemplates.
2. `persistTemplates` outer catch/refetch failure still swallowed unless explicitly rethrown.
3. `createOccurrenceKeyer` fails same-label insertion ([A,A] + insert A above shifts old ids). Fix: test it; neighbor-aware matching or document the narrower limit.
4. `resolveTitleCommit` noop return shape ambiguous. Fix: canonical currentName + whitespace-around-unchanged test.
5. Test gaps: delete failure/race, outer persist throw, duplicate-label id stability.
Remote-conflict out-of-scope accepted (last-writer-wins acknowledged).
VERDICT: REVISE

### Claude's response
Accepted all five.
1. `deleteTemplates` now mirrors handleSaveTemplates (.then clear / .catch restore) AND the onSaveTemplates call moves out of the setRich updater — the same impure-updater footgun Codex flagged in BL-22 r2 (StrictMode double-invoke → double save); plan adds a file-wide tripwire that no onSaveTemplates call lives inside a setRich updater.
2. persistTemplates outer catch rethrows after logging; failure counter throws after the refetch.
3. Documented the same-label limit explicitly in the plan (needs duplicate names + id-less legacy rows + remote same-label insertion mid-typing) and pinned it with a test asserting the stated suffix-shift behavior. Neighbor-aware reconciliation rejected as complexity not warranted for that corner — Codex's own offered alternative.
4. noop returns canonical currentName; whitespace-around-unchanged test added.
5. Tripwires added: deleteTemplates dirty-clear timing, outer persist rethrow, duplicate-label keyer behavior.

## Round 3 — Codex
1. Save/delete promise race: edits made while a Save/Delete is in flight get dirty cleared by the older promise's `.then` → next refetch wipes them. Fix: edit-revision counter, conditional clear.
2. Acceptance criterion overclaims id stability — "row inserted above" is false for same-label rows per the documented limit. Fix: qualify distinct-label.
3. Semantic cache keys collide when labels contain `|`/`#`. Fix: JSON.stringify array keys or nested Maps.
VERDICT: REVISE

### Claude's response
Accepted all three.
1. `editRevisionRef` + `markEdited()` (bump + setDirty(true)) replaces every mutation-site setDirty(true); both handleSaveTemplates and deleteTemplates capture the revision at dispatch and clear dirty only if unchanged on resolve; failure handlers keep plain setDirty(true) (restoring dirty is not a new edit). Tripwire 9c pins zero bare setDirty(true) outside catches/markEdited.
2. Acceptance criterion now says DISTINCT-label insertion, with the same-label suffix churn stated as the test-pinned limit; added a criterion for the in-flight-edit race.
3. Keyer keys are now JSON.stringify([scopeKey, label, occurrence]) — collision-proof; explicit collision test added (3b).

## Round 4 — Codex
1. `deleteTemplates` never calls markEdited() before capturing rev — delete-while-clean stays dirty=false during the in-flight save (background refetch can full-reload and transiently resurrect), and delete-during-save lets the older save clear dirty. Fix: markEdited() before setRich(next), capture the bumped revision.
2. Plain `setDirty(true)` in failure handlers lets an older failed save re-dirty after a newer edit/save already succeeded. Fix: revision-conditional catch.
VERDICT: REVISE

### Claude's response
Accepted both.
1. deleteTemplates now calls markEdited() before setRich(next) and captures rev after the bump — a delete is an edit; dirty=true during the in-flight save also blocks the transient-resurrection reload.
2. Both save paths' catches are now `if (editRevisionRef.current === rev) setDirty(true)` — when newer edits exist unsaved, dirty is already true via markEdited, so nothing is lost; when a newer save succeeded, the stale failure no longer re-dirties. Tripwire 9c updated to pin zero bare setDirty(true) outside markEdited and revision-conditional then/catch in both paths.

## Round 5 — Codex
No material blockers. Dirty guard, legacy id stability, empty-title feedback, save/delete races, host rethrow contract, and tests covered; remote-conflict and same-label churn limits explicit and accepted.
VERDICT: APPROVED

### Claude's response
Converged in 5 rounds. Proceeding to implementation under the loop's standing authorization (Isaiah away; loop rules: build after Codex plan approval, gated on vite build + node tests, then Codex result review).

## Result review — Codex (same session, 6 rounds)
Implementation reviewed against PLAN-BL23.md with regression hunting. Each round's finding was accepted and fixed:
1. handleCancelEdits didn't invalidate in-flight save/delete settlements → cancel now bumps editRevisionRef before reloadFromProps.
2. Two Save clicks can share an edit revision → saveReqSeqRef added; then/catch in both save paths require rev AND latest-request match.
3. Concurrent onSaveTemplates writes interleave at the backend → dispatchTemplatesSave promise chain serializes all persistence calls (dispatch order = write order, chain survives rejections).
4. Queued save diffs against the dispatch render's stale templates closure → persistTemplates baseline moved to a fresh ref.
5. (refinement of 4) templatesRef is render-synced, not refetch-synced — queued save can start before React re-renders after the predecessor's refetch → new supabaseRowsRef: render-synced AND advanced synchronously from the refetch result (with an empty-result poisoning guard); persistTemplates diffs against it (config.id||row.id mapping) and resolveSupabaseTemplateId searches it so queued saves UPDATE rather than duplicate rows their predecessor created.
6. No material findings. VERDICT: APPROVED.
Final gates: vite build clean; 1390 tests / 1384 pass / 0 fail / 6 skipped (baseline 1368; 22 new BL-23 tests).
