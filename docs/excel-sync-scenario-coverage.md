# Excel ↔ Survey Marker Sync — Scenario Coverage Index (BL-13)

_Compiled 2026-06-10 (overnight loop). Maps every BL-13 matrix cell to the test that
covers it. Cite stable identifiers — exact test names where short, otherwise the
file's suite/scenario labels — never line numbers. Governing docs: root `PLAN.md`
"Product Decision Amendments" (the contract), `HANDOFF-excel-sync-next.md`,
`.planning/blank-rowid-matching-verdict.md`. Update this index when scenario tests
move or new cells gain coverage._

## How to read this

Import-side decisions (what a row becomes) are **surface-independent** — the plan
builder (`buildScopeImportPlans`) has no storage-surface input. The storage surface
(local / personal OneDrive / business OneDrive / SharePoint) only decides **whether
writeback is attempted afterward**, which is why the surface matrix appears only in
the writeback rows.

## Scenario → coverage

| Scenario | Covering test(s) | Governing decision |
|---|---|---|
| **Copied row** (token duplicated, copy below) — matcher level | `rowImportMatcher.test.mjs`: "copied row (same token twice) → first is the original (match), second becomes a new copy"; "re-saving the same copied rows is idempotent…"; "a third copy appears → only the genuinely new one is created" | PLAN.md Amendment 2026-06-08(b), key decision #3 (copy auto-resolves to a new item by binding+position) |
| **Copied row — plan level + lineage stamping** | `excelScenarioGaps.test.mjs`: G1 | same |
| **Copied row pasted ABOVE / displacing the original** | ⚠️ **NOT TESTED — CONTRACT DRIFT, OWNER SIGN-OFF NEEDED.** PLAN.md decision #3 says before/displacing → review; `rowImportMatcher.js` implements first-row-wins (in-code "accepted tradeoff" note, which is not a PLAN.md amendment). Either amend PLAN.md to bless first-row-wins or fix the matcher; then add the test. | drift between PLAN.md decision #3 and implementation |
| **Renamed row, WITH Row-ID token** | `buildScopeImportPlans.test.mjs`: "valid in-scope token on its exported marker → match (apply) at the right row index" (renamed item fixture); `rowImportMatcher.test.mjs`: "rename + answer edit on the same token → still match, with changed fields reported"; `excelBlankRowIdScenario.test.mjs`: MIXED tier-precedence test | PLAN.md Amendment #10 (Row ID matches a marker → same marker is updated on rename/edit) |
| **Renamed row, blank Row ID** — matcher level | `rowImportMatcherFieldOverlap.test.mjs` (Tier-4 recovery suite) | blank-rowid-matching-verdict.md amendments |
| **Renamed row, blank Row ID — plan level** | `excelScenarioGaps.test.mjs`: G2 | same |
| **Deleted row (received marker) — two-import grace** | `excelDeleteGrace.test.mjs`: "genuine delete across two imports: trashed on the second exactly as before"; "cut+save+paste+save: two imports, one continuous Survey Marker…" | PLAN.md Amendment #1 (delete authority) + HANDOFF (grace window, commit 131d63d9) |
| **Deleted row (never-received marker) — permanent protection** | `excelDeleteGrace.test.mjs` (never-received cases); `excelScenarioGaps.test.mjs`: G3 (gate-before-triage composition) | PLAN.md Amendment #1 |
| **Row moved across sheets (cross-scope)** | `sheetRowPosition.test.mjs`: cross-scope move through `buildScopeImportPlans` (shield blocks wrong local pairing; old scope degrades to restorable delete; destination creates); `rowImportMatcherPositional.test.mjs`: "cross-scope reconciliation…" (matcher unit) | HANDOFF cross-scope reconciliation (commit 5108cc97). NOTE: the handoff's word "move" is ambiguous — the implemented + locked contract is shield-from-wrong-pairing + restorable delete+create deferred via grace, NOT same-marker transfer. |
| **Move + genuine delete + never-received in ONE import (shield selectivity)** | `excelScenarioGaps.test.mjs`: G3 | composition of the three decisions above |
| **Excel OPEN vs CLOSED (local file) — writeback flush** | `tests/excelLiveSyncWritebackIntegration.test.mjs`: Scenario 3 (lock sentinel present → deferred; absent → flushed + verified); `rowIdLocalWriteback.test.mjs` (full unit suite: sentinel, mtime drift, readback verify) | PLAN.md Amendment 2026-06-08(b) capability matrix (never write a local file Excel may have open) |
| **Excel OPEN vs CLOSED — import/pull side** | Not a service-level behavior: the plan builder operates on already-parsed worksheet data and has no lock input (verified — a lock-state test would be vacuous). The open/closed distinction only gates writeback (above) and the file-watcher trigger (component/OS level, see below). | — |
| **Personal OneDrive vs Business OneDrive vs SharePoint/Teams — capability + gate** | `excelCapability.test.mjs` (tier classification + `LIVE_WRITEBACK_ENABLED=false` pin); `liveSyncEligibility.test.mjs` (gate matrix + probe + reason codes); `liveSyncVerification.test.mjs` (read-only verify probe) | PLAN.md Amendment 2026-06-08(b) capability matrix |
| **Surface matrix — writeback drains** | `tests/excelLiveSyncWritebackIntegration.test.mjs`: Scenario 1 (business end-to-end, session lifecycle, no full-file upload invariant), 2a/2b (personal refused — terminal consumer tenant / probed personal driveType), 3 (local); `rowIdGraphWriteback.test.mjs` (unit: pre-check, read-back, stale locator, auth expiry, dormancy) | same |
| **Surface matrix — import decisions** | Surface-independent by construction (no surface input to the planner) — covered by every plan-level test above. | — |
| **Blank-Row-ID population scenarios (EX1–EX5 + live bug)** | `excelBlankRowIdScenario.test.mjs` (the five locked examples, the verbatim 2026-06-09 bug, exported variant C, mixed tier precedence) | blank-rowid-matching-verdict.md AMENDMENTS |

## Honest non-service cells (component / live level — not unit-testable here)

| Behavior | Why not service-level | Tracking |
|---|---|---|
| Live SharePoint/Teams poll trigger (`usedRange` read cadence) | Lives in the viewer's auto-import + poll loop (component) | BL-12 (M365 live verification) |
| Real `~$file.xlsx` lock detection on the actual Desktop path | OS/Electron EPERM behavior, not simulatable via the fs facade | BL-15 (file-watcher EPERM) |
| "Needs your choice" per-row review icon | React component rendering | KAL-59 family / review-surface work |
| Brand-new unmatched Excel rows review surface (null marker id) | UI surface does not exist yet | HANDOFF open item 10 / BL-14 |

## Open sign-off item for Isaiah

**Paste-above contract drift:** PLAN.md key decision #3 says a copy placed
before/displacing the bound row goes to review; the shipped matcher resolves
first-row-wins (both rows survive as items; identity follows the first row) with an
in-code note calling it an accepted tradeoff. A code comment can't amend the
contract. Decide: bless first-row-wins with a PLAN.md amendment, or change the
matcher to review. Until then this cell stays untested by design.
