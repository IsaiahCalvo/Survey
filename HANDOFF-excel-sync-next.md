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

5. **Conflict review — PARTIAL.** Review items are captured and now surfaced (item 1), but there is no "same field changed on both sides" detection and no per-row choose-a-side UI. Next: detect field-level conflict (app value vs Excel value both differ from last-synced baseline — baseline store is `excelSyncBaselineStore.js`) and present a simple keep-mine / take-Excel choice instead of guessing.

6. **Clear sync status wording — PARTIAL / INCONSISTENT.** Status strings are scattered across `lastSyncMessage` / `liveSyncStatus` in PDFViewer (e.g. "Live synced", "Sync failed", "needs your choice", the close-Excel alert). They are not a single vocabulary. Next: define one small set of plain-English statuses (saved · needs sync · close Excel first · needs your choice · queued until safe · synced) in a pure helper and route the UI through it. Local + testable; pairs naturally with item 1.

7. **End-to-end test cases — PARTIAL.** `agent-cli/` drives the real backend headless and there are many unit tests, but there is no single scenario suite covering: copied row, renamed row, deleted row, local Excel open vs closed, personal OneDrive, Business OneDrive, SharePoint/Teams. Next: build these as agent-cli scenarios / node tests, mocking the Graph paths where a live account is required.

## Items that were MISSING from the user's list (add these)

8. **Microsoft sign-in migration (the real blocker).** The current embedded sign-in only offers password, so the user (who forgot the work password) cannot log into the work M365 account at all — which blocks live verification of items 2, 3, 4, and the business slices of 7. Fix per PLAN: move to `@azure/msal-node` `acquireTokenInteractive` + system browser + loopback redirect, with main-process token custody, plus the Azure app-registration change (Mobile/desktop platform + `http://localhost` redirect + allow public client). This is a product/access decision + an environment the agent can't test alone — surface it, don't silently attempt.

9. **Stale / export-clock guard.** Don't let an older Excel import clobber newer in-app edits. A clock/baseline gate that refuses (or routes to conflict review #5) when the sheet is older than the app's last change. Distinct from conflict detection; protects against the original data-loss bug.

10. **`null`-markerId review surface (carry-over from item 1).** Brand-new unmatched Excel rows need somewhere to show up since they have no panel row yet.

11. **Desktop file-watcher permission error.** The local file-watcher hits `EPERM` on the Desktop/Logs path; minor but open.

## Recommended order (best next step first)

1. **Item 6 — clear sync status wording** (local, fully testable, pairs with the icon just shipped; gives the user a coherent vocabulary to test against).
2. **Item 5 — conflict review** (uses the baseline store + the review surface from item 1; high data-safety value; local + mockable).
3. **Item 4 — received-only deletion through History restore** (data-safety; gated on confirming the restore path; local + testable).
4. **Item 9 — stale/export-clock guard** (small, protects against the original bug).
5. **Item 7 — scenario test suite** (lock in everything above with copied/renamed/deleted/open-closed/personal/business/SharePoint cases).
6. **Items 2 + 3 + 8** — wire capability gating and the writeback flush, but these need the Microsoft sign-in migration (item 8) and a real work account to verify end-to-end. Do the wiring + mocks now; flip the master gate only after a live pass.

## Recommended starting point for the next session

Start with **item 6 (status wording)** — it is local, low-risk, immediately testable on the dev server, and it gives the user the plain-English vocabulary every later item reports through. Then move to item 5 (conflict review). Stop only for a real blocker (item 8 / live account) or a product decision.
