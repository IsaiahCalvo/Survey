# FIX-LOG stomp sweep — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Checkout:** `995e07b9` restore plus later P1-12 / P1-38 / P1-53 + harness. This pass compared FIX-LOG product claims against current `src/` / `supabase/` / `tests/`.  
**Does not mark the audit goal complete.** Did **not** replay P1-12 / P1-38 / P1-53, wave7, or the VM catalog. Did **not** retry the 18 host leftovers. Did **not** apply prod SQL. Did **not** loosen 8448 or 75/250. Did **not** read `.bot-credentials.json` / `.env*`.

## Inventory

**84** receipt files:

| Location | Count |
|---|---|
| `.planning/logic-audit-2026-08-20/fix-logs/*.md` | 80 |
| `fix-logs/*.md` | 4 |

## Skip set (not re-proved)

| Receipt | Why skipped |
|---|---|
| `.planning/.../e2e-wave7-stomp.md` | wave7 + already-restored P1-12 / P1-38 / P1-53 |
| `.planning/.../e2e-vm-unblocked.md` + `fix-logs/e2e-vm-unblocked.md` | VM catalog |
| `fix-logs/e2e-p1-12-38-53-live.md` | those three already live-proved |
| leftover-18 E2E receipts (`e2e-host-leftovers.md`, `e2e-host-leftovers-recheck.md`, `e2e-signed-in-leftovers.md`, `e2e-u04-archive.md`, `e2e-two-tab-presence.md`, `e2e-a01-hubpreview-adversarial.md`, `e2e-hub-templates-leftovers.md`, `e2e-local-hosts.md`, `e2e-capacitor-ul46.md`) | leftover 18 — do not retry |
| other `e2e-*` (adversarial waves 2–6, unblocked follow-ups, catalog, helper-only, chrome-04, context-menu, named-revision, outbox-retry, silent-stub, hubpreview-noop, local-migrations, unlisted-controls) | E2E-only / no new product patch |
| `w4-02-pinch.md` | E2E-only (no product edit) |
| `eraser-memory-cap.md` | diagnose only |
| `resume-workspace.md` (both trees) | restore log, not a product patch |

P1-12 (`excel:` history whitelist), P1-38 (Match Fill opacity ring), P1-53 (pending-before-offline) **still present** — not replayed.

## Product receipts checked (claimed `src/` / `supabase/` / `tests/` patches)

Checked against current disk (spot-grep + `00fda232` vs `995e07b9` min-diff class):

`svg-interaction.md`, `p2-34-sidebar.md`, `p2-02.md` / `p2-02-followup.md` / `p2-02-complete.md`, `sql-identity-owner-restore.md`, `kal436-survey-rail.md`, `sharing-invites.md` / `sharing-invites-restore.md`, `mobile-sheets.md` / `mobile-sheets-hook-restore.md` / `mobile-sheets-p2-35b.md`, `text-commit.md`, `p2-38-restore.md`, `roles-team.md`, `migration-version-dedupe.md`, `p1-45-adversarial.md` / `p1-45-undo.md` / `p2-13-p1-45-46.md`, `last-owner-race.md`, `w4-03-testpdf-history.md`, `sync-status-history.md` (P1-55 only), `pages-panel.md`, `p2-34-overlay.md`, `microsoft-auth.md`, `pdfviewer-serialized.md`, `excel-identity-sql.md`, `eraser-policy.md` / `eraser-policy-verify.md` / `eraser-policy-entire-mode.md` / `eraser-preview.md` / `eraser-timing-budget.md` / `erase-outbox-concurrency.md`, `electron-desktop.md` / `electron-quit-restore.md`, `account-deletion-restore.md`, `counter-numbering.md`, `account-settings.md` / `account-settings-overlap.md`, `billing.md` / `billing-trial-skip-restore.md` / `billing-event-id-verify.md`, `collab-ux.md`, `bookmarks-panel.md`, plus inventory/reconcile docs (`completion-audit-current.md`, `completion-audit-leftovers.md`, `report-103-reconcile.md`).

Also checked FIX-LOG one-liners for **P1-02** (`resolveExportedLineEnding2`) even though that ID lives in `FIX-LOG.md` rather than a standalone receipt — same min-diff class as the three stomps.

### Renames / inlined — **not** stomps (behavior still present)

| Claim | Current form |
|---|---|
| P1-28 `isBlankTextEdit` | inlined `if (!String(text ?? '').trim()) return null` in `buildExistingTextCommitJSON` |
| P1-39 `pickerHex.js` | `annotationStyleCatalog.js` `HEX6` / `normalizeHexColor` |
| P1-45 / P1-48 old names | `countBookmarkDescendants` / `describeBookmarkDeleteConfirm` / `prepareAtomicBookmarkEdit` |
| P2-27 `appBillingPortalReturnUrl` | `BILLING_PORTAL_RETURN_URL` |

Already-held after `995e07b9` + later restores (not re-opened): P1-12 `excel:`, P1-38 `matchOpacityPct`, P1-53 pending-before-offline, P1-45 `bookmark:delete` + confirm, P1-48 atomic rename, P2-38 `?billing=` consume, SQL **files** for P2-01/03/05/10/21/23/28/29 (in-tree, **not applied**).

## Stomps found → restored (9 IDs)

Same class as P1-12 / P1-38 / P1-53: claimed helpers existed on `00fda232` and were dropped by the `995e07b9` restore. Later click-contract / last-owner work on the same files was kept.

| ID | Receipt | What was gone | Restore |
|---|---|---|---|
| **P1-02** | `FIX-LOG.md` | `createLineAnnotation` only wrote `/LE` if `lineEnding2` already set | `resolveExportedLineEnding2` maps `arrowheadStyle` / `tool:'arrow'` |
| **P1-42** | `pages-panel.md` | PagesPanel never hit IndexedDB | `getPdfDocumentCacheStamp` / `buildPagesPanelThumbKey` + `thumbnailStore().get/put` |
| **P1-43** | `pages-panel.md` | Space-filtered drag still called `onReorderPages` | `canReorderVisiblePages` gates internal mime / drop |
| **P1-54** | `pages-panel.md` | `isLikelyBlackThumbnailSrc` existed but was never called | probe via `isLikelyBlackThumbnailPixels`; one retry |
| **P1-44** | `bookmarks-panel.md` | New bookmarks had no `order` (jump to top) | `nextBookmarkOrder` on create / child / folder / add-to-group |
| **P1-47** | `bookmarks-panel.md` | `persistBookmarkTree` wrote every row | `collectBookmarkTreePersistUpdates` (delta only) |
| **P1-55** | `sync-status-history.md` | Comments still claimed live dual-write | `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false` + RETIRED comments |
| **P2-06** | `roles-team.md` | Manage Team buttons unwrapped | `userCanManageProjectTeam` + `canManageProjectTeam(...)` on every opener |
| **P2-07** | `roles-team.md` | SurveyHub only `user_id === user.id` | `userCanManageDocumentAccess` + `getDocumentCollaborators` lookup |

### Proof (Node contracts)

`node --test tests/lineArrowEndingExport.test.mjs tests/pagesPanelUtils.test.mjs tests/bookmarkAtomicEdit.test.mjs tests/bookmarkReorderUtils.test.mjs tests/annotationDualWriteRetired.test.mjs tests/rolesTeamManageGate.test.mjs`

**40 / 40 pass.**

Intended / break / edge covered in those suites (export `/LE` mapping; cache key + black probe + filtered reorder; bookmark order + delta persist; dual-write flag; owner vs viewer team/access gates). No Vite 5173 live-prove this pass (Node only). Did not invent extra product work beyond these nine.

High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration` (`PDFViewer.jsx` zoom-start increment), SVG `viewBox={`0 0 ${width} ${height}`}`, container-aware canvas sizing (untouched), `FONT_FAMILIES` six single names in `annotationStyleCatalog.js`, CORS `Access-Control-Allow-Origin: '*'` (untouched).

## Leftover 18 (unchanged — do not retry)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers still in-tree (not applied): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## Return

| Metric | Value |
|---|---|
| Receipts checked | **84** |
| Stomps found / restored | **9** (P1-02, P1-42, P1-43, P1-44, P1-47, P1-54, P1-55, P2-06, P2-07) |
| Leftover 18 | **unchanged** |

## Goal

Stays **open**.
