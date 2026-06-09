# Handoff — Excel ↔ Survey Marker sync: remaining open items

**Updated:** 2026-06-09. **Branch:** `main` (local, unpushed — direct-to-main; the user tests on their dev server; push only on their say-so).

This is the entry point for the next session. It confirms the user's open-items list against the live code, adds the items that were missing from that list, and recommends what to do next. Background contract is still `PLAN.md` (read the "Product Decision Amendments — 2026-06-08 (GOVERNING)" section first) and `PLAN-REVIEW-LOG.md`. Prior progress is in `HANDOFF-excel-sync.md`.

## Working invariants (do not break)

- Plain-English only in replies to the user (no file paths / code names / line numbers). Always write "Survey Marker" in full.
- Direct-to-main: commit locally, do NOT push without the user's say-so. Gate every change on `npx vite build` + `node scripts/run-node-tests.mjs`. Baseline at this handoff: **1110 pass / 0 fail / 6 skipped**, build clean (was 1078 before items 5 & 4 landed).
- Live Excel writeback master gate stays **OFF** (`LIVE_WRITEBACK_ENABLED = false` in `src/services/excelCapability.js`) until proven on a real work M365 account.
- Excel-driven deletion of PLACED Survey Markers stays review-only for now (flagged, never auto-deleted). High-risk files (minimum-viable-diff, run tests after): `src/PDFViewer.jsx`, `src/SurveySpacesRail.jsx`, the Fabric canvases, `src/components/SVGAnnotationLayer.jsx`.

## Status of the user's 7 items (confirmed against code)

1. **Red review icon in Survey panel — DONE (commit `0e52bd09`, 2026-06-09).** Rows whose last import was flagged now show a red exclamation icon with a plain-English hover tooltip. Logic: `pendingImportReview` (PDFViewer) → memoized `surveyReviewByMarkerId` → rail prop → icon in `SurveySpacesRail.jsx`. Tooltip text lives in `src/services/excelReviewMessages.js` (pure + tested). **Gap to finish later:** review entries with a `null` markerId (a brand-new unmatched Excel row with no app marker yet) have no row to attach to — they need a separate surface (e.g. a small "rows we couldn't place" list). Needs a live sync that actually produces review items to eyeball it on the dev server.

2. **Microsoft work-account live sync — FOUNDATION BUILT, NOT WIRED.** `classifyExcelCapability` now requires connected + work tenant + proven Graph `driveType` (business/documentLibrary), and `excelSessionService` is drive-scoped for SharePoint/Teams (commits `7ac4bb7d` etc.). BUT the classifier has **no live callers yet** — `liveSyncEnabled` is still just a manual toggle gated only on `isOneDrive`. Next: gather the runtime signals (is-connected, tenant `tid`, Graph `driveType` from `excelGraphService`), feed them to `classifyExcelCapability`, and only allow the live-sync path / probe when it returns business-graph eligible. Full end-to-end verification is **blocked** on a working work-account login (see item 8).

3. **Row ID writeback cleanup — STORE BUILT, NO WRITER/FLUSH.** `src/services/rowIdWritebackQueue.js` (localStorage queue) exists and is tested but has **no live callers**. Still missing: (a) a single-cell column writer for the business-Graph path, (b) the local "write when Excel is closed, then read-back-verify" flush, (c) the call that drains the queue when a safe path is available. Blocked on a live env for full proof; the local-when-closed path is partly testable with the open-Excel detection already shipped.

4. **Excel deleting received markers — DONE (commit `b80f19dc`, 2026-06-09).** History restore was first verified to bring back the full Survey Marker including its PDF location (the delete event stores the whole marker; the restore handler re-adds it AND redraws it on the page from `marker.bounds` at `marker.pageNumber`; covered by `tests/surveyMarkerHistory.test.mjs`). With that proven, the import now auto-removes a previously-RECEIVED marker (carries `exportedAt` → `wasReceivedByExcel`) when Excel drops its row — no prompt — but routes it through the existing History + 30-day-trash machinery so it's one-click restorable. `rowImportMatcher` was tightened so a delete candidate excludes any marker a review decision references (ambiguous blank-recovery, unknown/duplicate tokens): a candidate now means strictly "no Excel row references this marker at all". Markers Excel never received stay review-only. Bulk-delete confirmation (manual import) still applies. **Note:** the legacy name-match path (sheets with NO Row ID column) still protects placed markers — only Row-ID scopes auto-delete.

5. **Conflict review — DONE (commit `ef1058b6`, 2026-06-09).** End-to-end now: a single shared builder (`src/services/markerRowValues.js`) produces a marker's visible row values; export writes its cells AND stamps its fingerprints from it, and `executeExcelImport`/`executeAutoExcelImport` build `appValuesByMarkerId` with the SAME builder + scope resolution and pass it to `buildScopeImportPlans`, so a both-sides edit downgrades to a `conflict` review (no longer a no-op in the live viewer). A round-trip test proves export cells → import read-back → identical fingerprints (the false-conflict guard). The red Survey-panel icon is clickable for conflicts and offers **"Keep app version" / "Use Excel version"** (one choice per item, whole row). `src/services/excelConflictResolve.js` applies Excel's content on "use Excel"; both choices re-stamp the marker's `excelSync` baseline to the incoming Excel values so the row stops flagging and the next sync sees agreement (this is what lets a choice stick while writeback is gated off).

6. **Clear sync status wording — DONE (commit `f5ae0028`, 2026-06-09).** One plain-English vocabulary + tones now lives in `src/services/excelSyncStatus.js` (saved · synced · syncing · needs sync · needs your choice · close Excel first · queued until safe · no changes · cancelled · failed). The Survey panel status banner colors by tone, so warnings (close Excel, needs your choice, queued) and successes (synced/saved) are no longer shown identical to neutral info. **Optional follow-up:** route the scattered `setLastSyncMessage` literals in PDFViewer through the canonical labels, and add a persistent per-survey state badge (saved / needs sync) instead of only the transient banner.

7. **End-to-end test cases — PARTIAL.** `agent-cli/` drives the real backend headless and there are many unit tests, but there is no single scenario suite covering: copied row, renamed row, deleted row, local Excel open vs closed, personal OneDrive, Business OneDrive, SharePoint/Teams. Next: build these as agent-cli scenarios / node tests, mocking the Graph paths where a live account is required.

## Items that were MISSING from the user's list (add these)

8. **Microsoft sign-in migration (the real blocker).** The current embedded sign-in only offers password, so the user (who forgot the work password) cannot log into the work M365 account at all — which blocks live verification of items 2, 3, 4, and the business slices of 7. Fix per PLAN: move to `@azure/msal-node` `acquireTokenInteractive` + system browser + loopback redirect, with main-process token custody, plus the Azure app-registration change (Mobile/desktop platform + `http://localhost` redirect + allow public client). This is a product/access decision + an environment the agent can't test alone — surface it, don't silently attempt.

9. **Stale / export-clock guard.** Don't let an older Excel import clobber newer in-app edits. A clock/baseline gate that refuses (or routes to conflict review #5) when the sheet is older than the app's last change. Distinct from conflict detection; protects against the original data-loss bug.

10. **`null`-markerId review surface (carry-over from item 1).** Brand-new unmatched Excel rows need somewhere to show up since they have no panel row yet.

11. **Desktop file-watcher permission error.** The local file-watcher hits `EPERM` on the Desktop/Logs path; minor but open.

## Landed this session (2026-06-09)

- Item 1 (review icon) — `0e52bd09`. Item 6 (status vocabulary + tone banner) — `f5ae0028`. Item 5 detector core — `86c0e0cb`. Plus the earlier exact-lock-check + proof-gated capability + SharePoint path fix — `7ac4bb7d`.
- **Item 5 complete (shared row-value builder + choose-a-side UI) — `ef1058b6`. Item 4 complete (Excel deletes received markers via History, after verifying restore covers PDF location) — `b80f19dc`.**

## Recommended order (best next step first)

1. **Item 9 — stale/export-clock guard** (small, decision-free, protects against the original data-loss bug; refuse or route-to-conflict an import older than the app's last change).
2. **Item 7 — scenario test suite** (lock in items 5 & 4 with copied/renamed/deleted/open-closed/personal/business/SharePoint cases as agent-cli / node scenarios, mocking the Graph paths a live account needs).
3. **Item 1 / item 10 — null-markerId review surface** (a small "rows we couldn't place" list for brand-new unmatched Excel rows that have no panel row to pin a red icon to).
4. **Items 2 + 3 + 8** — wire capability gating and the writeback flush, but these need the Microsoft sign-in migration (item 8) and a real work account to verify end-to-end. Do the wiring + mocks now; flip the master gate only after a live pass.

## Recommended starting point for the next session

Items 5 (conflict review + choose-a-side UI) and 4 (Excel deletes received markers via History) are now DONE end-to-end and committed (`ef1058b6`, `b80f19dc`); History restore was verified to cover the full Survey Marker including its PDF location. The remaining decision-free, locally-testable work is the stale/export-clock guard (item 9) — start there — then the scenario test suite (item 7). The only hard blocker left is the Microsoft work-account sign-in migration (item 8), which gates live verification of items 2/3 and the live writeback master gate (still OFF). **Live-test items 5 & 4 on the dev server before pushing.**
