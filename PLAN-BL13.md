# Plan: BL-13 — Excel-sync scenario coverage: gap tests + coverage index (test-only slice)
_Round 3 draft — reshaped after Codex round-1 falsified the centerpiece; rounds 2-3 resolved the paste-above contract drift handling. No production-code changes, no production DB, no push._

## What round 1 established (all verified in-source)
- **The BL-13 matrix is mostly covered already.** Cross-sheet move is tested END-TO-END at plan level (`src/services/__tests__/sheetRowPosition.test.mjs:243-274`: two-scope `worksheetDataList`, shield blocks the wrong local pairing, old scope `candidateDeletes:['mCut']`, destination `new-row`) — the implemented, locked contract is "move degrades to a silent RESTORABLE delete+create", protected by the delete-grace window (`excelDeleteGrace.test.mjs:207-231` cut+save+paste+save = one continuous Survey Marker). My earlier "destination recovers the same marker" reading over-promised. The handoff's word "move" is ambiguous; what code+tests implement and pin is "shield from wrong local pairing, then restorable delete+create deferred via grace" — G3 and the coverage index describe exactly that IMPLEMENTED behavior and the index calls out the handoff's ambiguous phrasing.
- **Copy paste-above is CONTRACT DRIFT needing owner sign-off:** governing PLAN.md decision #3 says a copy placed before/displacing the bound row → review; the matcher implements first-row-wins (`rowImportMatcher.js:143-146`, with an in-code "accepted tradeoff" note that is NOT a PLAN.md amendment). A code comment cannot supersede the governing doc. BL-13 therefore does NOT test paste-above either way — the drift is recorded in the coverage index + ticket as an explicit Isaiah sign-off item (amend PLAN.md to bless first-row-wins, or fix the matcher to review).
- **Never-received delete protection lives in delete-grace triage** (gates on `exportedAt`/received), NOT in `buildScopeImportPlans` — plan-level `candidateDeletes` is just "unmatched, not review-referenced".
- (e) import-indifference is vacuous at plan level (no lock input exists); (f) surface-independence is tautological (planner has no surface input) and the classifier/gate/drain matrix is fully covered (slice 5 + unit suites).

## Goal (reshaped)
Two deliverables, both honest about the existing coverage:
1. **`src/services/__tests__/excelScenarioGaps.test.mjs`** — ONLY the verified-missing compositions, all at the `buildScopeImportPlans` (+ triage where relevant) layer, fixtures copied from the established builders:
   - **G1 — Copy at plan level** (matcher-level exists, plan-level doesn't): copy-below → original `match` + copy `copy-new`/`create` with `copyOfMarkerId`/`copyOrdinal` lineage (lineage ONLY — token mint/writeback is a different seam, per Codex); second import with both rows tokened → `copy-existing` idempotency, no duplicate creation. NO paste-above test (contract drift — see above; sign-off item, not a test).
   - **G2 — Blank-Row-ID rename at plan level** (field-overlap recovery is matcher-tested only): tokenless row, item field changed, enough identity fields overlapping → `missing-rowid` + `recoveredBy:'field-overlap'` + apply to the right marker through the REAL plan builder; assert no `candidateDeletes` for it.
   - **G3 — Move + genuine delete in ONE import** (shield selectivity — no existing composition): two-scope fixture where marker X moved A→B AND marker Y (received) genuinely deleted; assert the IMPLEMENTED shield/degrade behavior is per-fingerprint (X's old-scope delete is the restorable degrade; Y enters `candidateDeletes`), then drive BOTH through the received gate + `triageCandidateDelete` pair exactly as `excelDeleteGrace.test.mjs` does: first import stamps pending-delete marks (nothing trashed); a never-received marker Z absent in the same import is protected by the `wasReceivedByExcel` gate BEFORE triage, permanently.
   Each test carries the governing citation (amendment/handoff/matcher-comment).
2. **Coverage index** `docs/excel-sync-scenario-coverage.md` — the BL-13 matrix as a table: every scenario cell (copied/renamed/deleted/moved × token/blank × open/closed × local/personal/business/SharePoint) → the covering test file + test name, the governing decision citation, and the three honest non-service cells (live SharePoint poll trigger, real Desktop lock EPERM, needs-your-choice UI) marked component/live-level with their tracking items. This is the artifact that makes the matrix auditable — the ticket's real intent.

## Gates & process
`npx vite build`; `node scripts/run-node-tests.mjs` (1352 + new, 6 skip, 0 fail). Codex result review → converge → local commit. BL-13 is not in Linear (workspace full): update Obsidian issue file + board line + `.planning/optimization/BACKLOG-not-yet-in-linear.md` item 7. Status: deliverable complete = check the board box (test-only task, exempt from the cap).

## Key decisions & tradeoffs
- **Index + gap tests instead of a redundant "one big suite":** duplicating 30+ existing assertions into a parallel suite would rot; the index gives the "one place to look" the backlog item wanted, the gap tests close the real holes.
- **Paste-above excluded from tests entirely:** it is contract drift (PLAN.md says review; matcher does first-row-wins) — the index records it as an owner sign-off item. Move-degrade tests pin the IMPLEMENTED behavior, with the handoff's ambiguous "move" wording called out in the index.
- **No (e)/(f) service tests:** vacuous/tautological per round 1 — the index records where those behaviors ARE tested (slice 5, capability/gate suites) instead.

## Risks / open questions
- G3's triage step must use the real `triageCandidateDelete`/`markPendingDelete` API exactly as `excelDeleteGrace.test.mjs`'s `simulateImport` does — reuse that helper pattern verbatim.
- The coverage-index doc must cite test NAMES (stable) not line numbers (drift).

## Out of scope
Production code; re-opening the paste-above or move-degrade decisions; writeback drain matrix; live M365 (BL-12); Linear.
