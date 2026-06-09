# Plan Review Log: Excel↔Survey identity, copy/paste, dedup, safe writeback, Microsoft auth
Act 1 (grill) complete — plan locked with the user, both research passes folded in. MAX_ROUNDS=5.
PLAN_FILE=PLAN.md (active section: "Amendment 2026-06-08(b)").

## Round 1 — Codex
No files modified.

**Findings**

- Duplicate-token auto-resolution can steal identity. If the user copies a row, edits the original, and leaves the copy unchanged, “best matching stored content” will keep the token on the copy and create the edited original as a new item. Fix: do not infer “original” by content; require an explicit continuation signal, otherwise review.

- The current matcher treats all duplicate tokens as review (`rowImportMatcher.js:49-72`), so this is not a caller-only change. Fix: redesign the matcher decision model and tests around duplicate groups.

- “Remember imported rows immediately” is insufficient for rows edited before ID writeback. Blank recovery only matches current fingerprints; if the row changes, it becomes new again. Fix: persist a pending alias keyed by workbook/sheet/row plus assigned marker/token, and review if that alias becomes ambiguous.

- Assigning a fresh token in app memory while Excel still contains blank/old duplicate IDs creates churn. A copied row still carrying the old token will re-enter as a duplicate group on the next save. Fix: duplicate-token resolution must recognize pending-writeback aliases before creating another marker.

- The identity record does not currently store token, pending writeback, workbook, sheet, or row locator (`excelIdentityRecord.js`, `buildScopeImportPlans.js:107-117`). Fix: extend the identity record and matcher input with those fields.

- Import metadata can be dropped when visible fields do not change. The import paths only call `setSurveyMarkers` on counted updates/deletes (`PDFViewer.jsx:13760`, `14286`), but identity stamping may be metadata-only. Fix: treat identity stamping as a persisted state change, without marking user-visible content dirty.

- The writeback queue is underspecified. “Markers whose Row ID still needs to land” is not enough to patch the correct cell after row moves, sheet renames, workbook moves, or restart. Fix: define a durable queue schema with workbook id/path, sheet id/name, scope, row locator, expected old cell value, new token, retry state, and read-after-write confirmation.

- Clearing `pendingRowIdWriteback` on “confirmed write” is too vague. Graph PATCH or local write success is not enough. Fix: clear only after reading the target cell back and verifying it equals the assigned token.

- Local “Excel closed” detection via `~$file.xlsx` is not reliable enough as a write gate, especially with stale lock files, cloud-sync folders, and the existing watcher/allowlist EPERM problem. Fix: use sentinel only as one signal; require parent-dir watch/stat, file mtime stability, write/readback verification, and fail to manual export when uncertain.

- The plan says business Graph live writeback is “already implemented,” but current code updates whole worksheet ranges from a rebuilt workbook (`PDFViewer.jsx:12458-12492`) or full-file uploads (`12498-12508`), gated off by `EXCEL_AUTOMATIC_WRITEBACK_ENABLED=false`. Fix: implement a new column-A single-cell patch writer; do not reuse the existing whole-range path.

- The manual “Pull from Excel” diagnosis should not be logging-first only. A likely concrete root cause is visible: manual pull downloads by path (`PDFViewer.jsx:14574-14576`), while auto-sync prefers file id (`14742-14747`); SharePoint exports can store `/drives/{driveId}/items/{id}` as `oneDriveApiPath` (`13087`), which `downloadExcelFileByPath()` wraps incorrectly as `/me/drive/root:{path}`. Fix: make manual pull prefer `oneDriveFileId` and only path-fallback for real root paths, then add matcher logs.

- Microsoft auth migration is under-scoped. `msal-node` is not in `package.json`, current code hand-rolls PKCE in the renderer (`MSGraphContext.jsx:627-684`), and MSAL generally owns refresh tokens in its cache rather than exposing them for the existing Supabase `refresh_token` model. Fix: choose one architecture: main-process MSAL cache with renderer getting only access-token status, or system-browser PKCE preserving explicit refresh-token storage.

- Returning tokens to the renderer over IPC weakens the auth boundary. Fix: keep refresh tokens/MSAL cache in the main process and expose narrow IPC such as `msgraph:getAccessToken`, not raw refresh tokens.

- Observability still needs privacy bounds. Per-row logs must not dump full Row IDs, notes, or token material. Fix: log row number, token class, short token hash, decision, reason, queue state, and workbook/sheet ids.

VERDICT: REVISE
### Claude's response (Round 1)
Accepted and incorporated (most findings — they are correct):
- Duplicate-token identity theft: DROP content-best-match as the discriminator. New rule: a token stays bound to the marker the app's record already maps it to; among rows carrying that token, the FIRST occurrence retains the binding, later duplicates become new items with freshly-minted tokens; "needs your choice" only when the bound marker can't be tied to any carrying row. Deterministic, no content-theft, and copy-below "just works".
- Matcher (not just caller) changes: duplicate handling redesigned around duplicate GROUPS + fresh-ID assignment; new tests.
- Edited-before-writeback + churn: add a durable PENDING-WRITEBACK ALIAS (workbook+sheet id, scope, assigned markerId, assigned token, row locator, expected-old-cell-value) consulted by the matcher BEFORE creating a marker, so a not-yet-written row is never re-created and a content edit before writeback still resolves. Best-effort; the durable fix is writing the token back ASAP.
- Identity record/matcher input extended with token, pendingRowIdWriteback, workbook/sheet ids, row locator.
- Metadata-only stamping must persist even when no visible change (don't gate identity persistence on updatesCount>0), without marking the survey dirty.
- Writeback queue schema specified (workbook id/path, sheet id/name, scope, row locator, expected old value, new token, retry state, read-after-write).
- Clear pendingRowIdWriteback only after READ-BACK verify the cell equals the token.
- Local "Excel closed": lock-file is ONE signal; add mtime stability + write/readback + fail-to-manual-export when uncertain.
- CORRECTION accepted: business-Graph live writeback is NOT already implemented as cell-PATCH — existing code does whole-range/full-file (gated off). Plan now calls for a NEW single-cell column-A patch writer.
- Pull-from-Excel: ALSO fix the concrete bug Codex found (manual pull downloads by PATH, auto by file id; SharePoint oneDriveApiPath wrapped wrong by downloadExcelFileByPath) — prefer oneDriveFileId, path-fallback only for real root paths. Keep logging-first too: the user's failing case was a LOCAL file where that OneDrive-path bug does not apply, so the local mystery still needs the logs.
- Microsoft auth: keep MSAL cache + refresh tokens in the MAIN process; expose only narrow IPC (msgraph:getAccessToken / status); do NOT hand raw refresh tokens to the renderer.
- Observability privacy bounds: log row number, token class, short token HASH (not the token), decision, reason, queue state, workbook/sheet ids — never full Row IDs/notes/token material.

Modified vs Codex's exact fix:
- Codex wanted duplicate→review unless an explicit continuation signal. The user REQUIRES copy/paste to auto-work, so we use the deterministic first-occurrence-keeps-binding rule above instead of always-review, with review as the ambiguity escape hatch. This keeps the user's UX while removing the content-theft path Codex flagged.

## Round 2 — Codex
Most Round 1 issues are addressed, but the amendment still has material gaps.

- `PLAN.md:229` still says business Graph live writeback is “Already implemented,” while `PLAN.md:236` and `PLAN.md:247` correctly say it is new single-cell patch work. Fix: remove “Already implemented” from the capability matrix.

- The first-occurrence duplicate rule is still positional identity. If a copied row is pasted above the original, or sorting happens before writeback, the placed marker can bind to the wrong physical row. Fix: first occurrence may be an auto-rule only when row order is known unchanged since baseline; otherwise review.

- The pending alias cannot reliably resolve “content edited before writeback” after sort/move because the sheet does not contain the assigned token yet, and `expectedOldCellValue` may be blank or the duplicated old token shared by multiple rows. Fix: if alias lookup does not identify exactly one row, review instead of creating or applying.

- The plan says identity/alias stamping stays out of the dirty fingerprint so it “never marks the survey unsynced,” but pending ID writeback means Excel is not fully synced. Fix: keep it out of content-dirty state, but show a separate pending-writeback sync state and queue depth.

- Queue and alias durability still lack a named storage/load barrier. The governing context says imports must wait for queue load, but the amendment does not say where aliases live or that manual/auto import blocks until aliases load. Fix: specify the durable store and require import to fail closed until queue + aliases are loaded.

- “Local/personal → only when Excel is closed / on next app export” is ambiguous. A next export to the linked path while Excel is open is exactly the unsafe write path. Fix: next export clears queue only if it writes the linked workbook through a proven safe path or intentionally relinks to a clean copy.

- Microsoft auth is improved, but still leaves a core architecture choice open while claiming existing sessions keep working. Fix: choose main-process MSAL cache as source of truth, add a dual-read or reconnect migration for old Supabase refresh-token rows, and remove the unresolved “OR” before implementation.

VERDICT: REVISE
### Claude's response (Round 2)
All seven accepted (all are correct convergence-tightening):
1. Removed "Already implemented" from the business-Graph capability-matrix cell (it contradicted the "new single-cell patch writer" decision).
2. Positional first-occurrence duplicate rule now applies ONLY when sheet row order is provably unchanged since the export baseline (row-order fingerprint / export clock); otherwise the duplicate group goes to review. No positional identity guess on a sorted/moved sheet.
3. Pending-alias lookup must identify EXACTLY ONE row; if zero or >1 candidate, review instead of create/apply.
4. Distinguish content-dirty from IDs-pending-writeback: identity/alias stamping stays out of the content dirty fingerprint, but a SEPARATE "pending writeback (N)" sync state + queue depth is surfaced (Excel isn't fully synced until IDs land).
5. Named durable store for queue+aliases (localStorage-backed, per-document, like the other sync stores); import FAILS CLOSED until queue + aliases are hydrated (no import races the load).
6. "On next export" clarified: an export clears queued IDs only if that export wrote through a proven-safe path (Excel closed / business-Graph cell PATCH) or intentionally relinked to a clean copy — never merely because an export was attempted to a linked path open in Excel.
7. Microsoft auth: COMMIT to main-process MSAL cache as the source of truth; old Supabase refresh-token rows get a one-time reconnect/dual-read migration; removed the unresolved "OR".

## Round 3 — Codex
The seven Round 2 points are mostly addressed, but the revision introduced two material contradictions.

- The duplicate-token rule now says auto-positioning applies only when row order is “provably unchanged since export baseline,” and also says any insert since baseline sends the group to review. A normal copy/paste creates an inserted row, so the rule would review the exact copy case it is supposed to auto-resolve. Fix: define the guard as “baseline rows keep their relative order/locator, allowing inserted duplicate rows after the bound row”; review when the duplicate appears before or displaces the baseline row.

- The active section commits to a main-process MSAL cache, but the risks still say “Microsoft token-custody choice … must be settled before coding.” Fix: delete the stale risk and specify the persistent cache location/mechanism.

- The active queue says localStorage-backed, but the governing Stage 3 queue says it must survive multiple devices. LocalStorage is per-device, so another device can miss pending aliases and recreate rows. Fix: scope localStorage to local/single-device workflows, or put cloud workbook queues/aliases in the shared app store.

- The risks still say “copy pasted above keeps the binding,” which contradicts the new review-on-untrusted-order rule. Fix: update that risk to say pasted-above must review.

VERDICT: REVISE
### Claude's response (Round 3)
All four accepted (internal-consistency fixes introduced by the R2 edits):
1. Duplicate guard reworded: auto-resolve when the BOUND (original) row still holds its baseline relative order/locator and the duplicate is an INSERTED row AFTER it (the normal copy-below case); review only when the duplicate appears BEFORE or DISPLACES the baseline row. (My R2 wording wrongly reviewed the very copy case it should auto-resolve.)
2. Deleted the stale "token-custody must be settled" risk (now decided) and named the persistent cache mechanism: main-process msal-node cache persisted via @azure/msal-node-extensions, or an encrypted file in Electron userData via safeStorage.
3. Queue+alias store scoped by file type: LOCAL files use the per-device localStorage store; CLOUD workbooks (business/personal OneDrive) put the queue+aliases in the SHARED app store (Y.Doc/Supabase) so a second device doesn't recreate pending rows.
4. Updated the stale "pasted above keeps the binding" risk to "pasted above / displacing the baseline row → review."

## Round 4 — Codex
Round 3 blockers are resolved.

The active amendment now covers the key failure modes I flagged: duplicate-token auto-resolution is constrained to the normal copy-below case, pending aliases fail closed unless exactly one row is identified, queue/alias durability is scoped correctly for local versus cloud, unsafe exports do not clear writeback state, and Microsoft auth now has one token-custody direction with a persistent-cache path.

Remaining notes are implementation-level, not plan blockers:

- Add explicit tests for copy-below, paste-above, sorted-before-writeback, stale alias, and multi-device cloud pending alias hydration.
- Keep the Key Decisions duplicate-token summary aligned with the stricter rule in Approach so implementers do not accidentally use “first row wins” without the baseline-order guard.
- Treat the MSAL persistent-cache choice as the first task in the auth slice, before changing IPC.

VERDICT: APPROVED
### Resolution
APPROVED on Round 4. Incorporated the three implementation-level notes: aligned the Key Decisions duplicate summary with the baseline-order guard; added a 'Required tests' gate (copy-below, paste-above, sorted-before-writeback, stale alias, repeated-save idempotence, multi-device hydration, read-back-verify); and noted the MSAL persistent-cache choice is the first auth-slice task before touching IPC. Plan locked; awaiting user sign-off before any code.
