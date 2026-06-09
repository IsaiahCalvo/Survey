# Handoff — Excel ↔ Survey Marker sync: remaining open items

**Updated:** 2026-06-09. **Branch:** `main` (local, unpushed — direct-to-main; the user tests on their dev server; push only on their say-so).

This is the entry point for the next session. It confirms the user's open-items list against the live code, adds the items that were missing from that list, and recommends what to do next. Background contract is still `PLAN.md` (read the "Product Decision Amendments — 2026-06-08 (GOVERNING)" section first) and `PLAN-REVIEW-LOG.md`. Prior progress is in `HANDOFF-excel-sync.md`.

## Working invariants (do not break)

- Plain-English only in replies to the user (no file paths / code names / line numbers). Always write "Survey Marker" in full.
- Direct-to-main: commit locally, do NOT push without the user's say-so. Gate every change on `npx vite build` + `node scripts/run-node-tests.mjs`. Baseline at this handoff: **1078 pass / 0 fail / 6 skipped**, build clean.
- Live Excel writeback master gate stays **OFF** (`LIVE_WRITEBACK_ENABLED = false` in `src/services/excelCapability.js`) until proven on a real work M365 account.
- Excel-driven deletion of PLACED Survey Markers stays review-only for now (flagged, never auto-deleted). High-risk files (minimum-viable-diff, run tests after): `src/PDFViewer.jsx`, `src/SurveySpacesRail.jsx`, the Fabric canvases, `src/components/SVGAnnotationLayer.jsx`.

## Status of the user's 7 items (confirmed against code)

1. **Red review icon in Survey panel — DONE (commit `0e52bd09`, 2026-06-09).** Rows whose last import was flagged now show a red exclamation icon with a plain-English hover tooltip. Logic: `pendingImportReview` (PDFViewer) → memoized `surveyReviewByMarkerId` → rail prop → icon in `SurveySpacesRail.jsx`. Tooltip text lives in `src/services/excelReviewMessages.js` (pure + tested). **Gap to finish later:** review entries with a `null` markerId (a brand-new unmatched Excel row with no app marker yet) have no row to attach to — they need a separate surface (e.g. a small "rows we couldn't place" list). Needs a live sync that actually produces review items to eyeball it on the dev server.

2. **Microsoft work-account live sync — FOUNDATION BUILT, NOT WIRED.** `classifyExcelCapability` now requires connected + work tenant + proven Graph `driveType` (business/documentLibrary), and `excelSessionService` is drive-scoped for SharePoint/Teams (commits `7ac4bb7d` etc.). BUT the classifier has **no live callers yet** — `liveSyncEnabled` is still just a manual toggle gated only on `isOneDrive`. Next: gather the runtime signals (is-connected, tenant `tid`, Graph `driveType` from `excelGraphService`), feed them to `classifyExcelCapability`, and only allow the live-sync path / probe when it returns business-graph eligible. Full end-to-end verification is **blocked** on a working work-account login (see item 8).

3. **Row ID writeback cleanup — STORE BUILT, NO WRITER/FLUSH.** `src/services/rowIdWritebackQueue.js` (localStorage queue) exists and is tested but has **no live callers**. Still missing: (a) a single-cell column writer for the business-Graph path, (b) the local "write when Excel is closed, then read-back-verify" flush, (c) the call that drains the queue when a safe path is available. Blocked on a live env for full proof; the local-when-closed path is partly testable with the open-Excel detection already shipped.

4. **Excel deleting received markers — NOT STARTED.** Today deletions are review-only candidate-deletes (flagged via item 1, never applied). Next: allow deletion ONLY for markers that carry an `exportedAt` (Excel previously received them — the `excelExportAck` stamp already exists), and route every such deletion through the existing History/restore path so it's recoverable. Confirm the History restore path covers Survey Markers before enabling.

5. **Conflict review — DETECTOR DONE (commit `86c0e0cb`), UI is a product decision.** The pure field-level detector landed: `src/services/excelConflictDetect.js` (`detectFieldConflicts` / `classifyRowConflict`, reusing `diffRowFields` over the stored per-field fingerprints). A field is a CONFLICT only when both the app and Excel moved it off the last-synced baseline AND disagree; one side only → that side wins; both changed different fields → clean MERGE. **Remaining (needs the user's call):** wire it into `executeExcelImport`/`executeAutoExcelImport` (compare stored `excelSync.fieldFingerprints` baseline vs current app values vs incoming Excel values), route CONFLICT rows into `pendingImportReview` with a `conflict` reason (the red icon already covers it), and build the choose-a-side UI (keep-mine / take-Excel, per field or per row?). The UI shape is the product decision.

6. **Clear sync status wording — DONE (commit `f5ae0028`, 2026-06-09).** One plain-English vocabulary + tones now lives in `src/services/excelSyncStatus.js` (saved · synced · syncing · needs sync · needs your choice · close Excel first · queued until safe · no changes · cancelled · failed). The Survey panel status banner colors by tone, so warnings (close Excel, needs your choice, queued) and successes (synced/saved) are no longer shown identical to neutral info. **Optional follow-up:** route the scattered `setLastSyncMessage` literals in PDFViewer through the canonical labels, and add a persistent per-survey state badge (saved / needs sync) instead of only the transient banner.

7. **End-to-end test cases — PARTIAL.** `agent-cli/` drives the real backend headless and there are many unit tests, but there is no single scenario suite covering: copied row, renamed row, deleted row, local Excel open vs closed, personal OneDrive, Business OneDrive, SharePoint/Teams. Next: build these as agent-cli scenarios / node tests, mocking the Graph paths where a live account is required.

## Items that were MISSING from the user's list (add these)

8. **Microsoft sign-in migration (the real blocker).** The current embedded sign-in only offers password, so the user (who forgot the work password) cannot log into the work M365 account at all — which blocks live verification of items 2, 3, 4, and the business slices of 7. Fix per PLAN: move to `@azure/msal-node` `acquireTokenInteractive` + system browser + loopback redirect, with main-process token custody, plus the Azure app-registration change (Mobile/desktop platform + `http://localhost` redirect + allow public client). This is a product/access decision + an environment the agent can't test alone — surface it, don't silently attempt.

9. **Stale / export-clock guard.** Don't let an older Excel import clobber newer in-app edits. A clock/baseline gate that refuses (or routes to conflict review #5) when the sheet is older than the app's last change. Distinct from conflict detection; protects against the original data-loss bug.

10. **`null`-markerId review surface (carry-over from item 1).** Brand-new unmatched Excel rows need somewhere to show up since they have no panel row yet.

11. **Desktop file-watcher permission error.** The local file-watcher hits `EPERM` on the Desktop/Logs path; minor but open.

## Landed this session (2026-06-09)

- Item 1 (review icon) — `0e52bd09`. Item 6 (status vocabulary + tone banner) — `f5ae0028`. Item 5 detector core — `86c0e0cb`. Plus the earlier exact-lock-check + proof-gated capability + SharePoint path fix — `7ac4bb7d`.

## Recommended order (best next step first)

1. **Item 5 — wire the conflict detector + choose-a-side UI** (detector is done; needs a product decision on the choice UI, then wiring into import + the review surface).
2. **Item 4 — received-only deletion through History restore** (data-safety; gated on confirming the restore path covers Survey Markers; local + testable).
3. **Item 9 — stale/export-clock guard** (small, protects against the original bug).
4. **Item 7 — scenario test suite** (lock in everything above with copied/renamed/deleted/open-closed/personal/business/SharePoint cases).
5. **Items 2 + 3 + 8** — wire capability gating and the writeback flush, but these need the Microsoft sign-in migration (item 8) and a real work account to verify end-to-end. Do the wiring + mocks now; flip the master gate only after a live pass.

## Recommended starting point for the next session

Two product decisions and one hard blocker now gate the remaining work: (a) the choose-a-side conflict UI shape (item 5), (b) confirming the History restore path covers Survey Markers before enabling Excel-driven deletion (item 4), and (c) the Microsoft work-account sign-in migration that blocks live verification of items 2/3 (item 8). Everything that did NOT require one of those is now done. Start by resolving the item 5 UI decision, then wire it.
