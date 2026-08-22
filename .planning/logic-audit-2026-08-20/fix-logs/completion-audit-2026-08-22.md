# Completion audit — 2026-08-22 (requirement-by-requirement)

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Uncertain = not achieved. Save / export / import / recursive E2E until no issues remain is still the standing objective — not “96 IDs + leftover-18 parked”.

Last workers said: this-catalog exhausted; leftover-18 fail-closed local slices all have dedicated proofs; leftover-18 live hosts still missing. This pass treated that as **unproven** and re-audited the current tree.

## Method

Sources read (not copied as truth):

- `.planning/logic-audit-2026-08-20/REPORT.md` (headline 103 = 58 + 45 pre-fold)
- `known-bugs-deep-dive.json` (KB-1 / KB-2 only; **no extra IDs**)
- `ISSUE-INVENTORY.md`, `COMPLETION-AUDIT.md`, `E2E-STATUS.md`, `FEATURE-MATRIX.md`, `E2E-UNLISTED.md`
- `fix-logs/leftover18-unblock-2026-08-21.md`, leftover-18 2026-08-22 fail-closed receipts, `after-hub-retry-exhausted-hunt-2026-08-22.md`

Tree checks this pass:

- Stomp one-liners still live: `historyHelpers.js:124` `startsWith('excel:')`; `CompactColorPicker.jsx:336` `Math.abs(localOpacity - matchOpacityPct) <= 1`; `syncStatusViewModel.js:41-48` `pending` **before** queue-offline (`:50`).
- Zero `checkAndQuit` in `src/`. `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`. `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false`. `DevTestRoute.jsx` still “Do NOT set file.id”.
- `.env.local` / `.env.test` / `.bot-credentials.json` **missing**. Did not invent tokens, Stripe, MSAL, Turnstile, leases, plus-aliases, or prod SQL.
- Citation-only inventory rows (P1-09 / P1-10 / P1-15 / P1-18 / P1-20 / P1-32 / P1-35 / P1-40 / P1-49) have Node tests in `tests/pdfViewerUndoOneLiners.test.mjs`, `tests/pdfViewerStaleIdCommits.test.mjs`, `tests/crdtHistoryScope.test.mjs`. Re-ran those plus leftover-18 / stomp Node: **50 / 50**.
- Color / font / format catalogs in `annotationStyleCatalog.js` match `e2e-pickers-every-swatch.spec.mjs` (16 swatches, 6 single-name fonts, 18 sizes, B/I/U/S, 9-cell align).
- Leftover-18 dedicated fail-closed specs still on disk (table below). Live hosts still missing.

Did **not** replay Templates / Projects / Documents / Archive / Settings fail-closed / Spaces / Survey-rail / PDF waves as filler. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / Move/Copy backends.

**Unblocked leftover found this pass:** none that is not leftover-18, not compile-hidden, and not a stub.  
**Leftover-18 live leftover found:** none that still lacks a dedicated fail-closed local slice. Remaining work is host-gated.

## Counts

| Class | Count | What it is |
|---|---|---|
| **proved** | **96** | Unique REPORT IDs: product symbol + Node and/or live Playwright + receipt |
| **fail-closed** | **18** | leftover-18 dedicated local slices (not original 96 IDs) |
| **weak** | **0** | No “status proven / no receipt / skip-already-proven without Node or live” row |
| **stomped** | **0** | Named one-liners still in tree |
| **missing** | **0** | No vanished unique REPORT ID |
| **host-gated leftover-18** | **18** | Same 18; live hosts still missing |
| Headline extras P2-34(a)(b)(c) / P2-35(a)(b)(c) | **6 proved** | Not extra inventory IDs |
| Folded z-order ticket | **proved** | Same as KB-2 |
| Undocumented pass-2 +2 | **missing as text** | No REPORT paragraph |

## Headline extras (103 − 96)

| Extra | Class | Evidence |
|---|---|---|
| Pass-1 z-order ticket folded into KB-2 | **proved** | `src/utils/annotationZOrder.js`; `tests/annotationZOrder.test.mjs` |
| P2-34(a) Home/End / ←→ | **proved** | `KeyboardShortcutsOverlay.jsx`; `tests/pdfViewerUndoOneLiners.test.mjs`; live UL-02 / keyboard matrix |
| P2-34(b) `B` sidebar | **proved** | `PDFViewer.jsx`; `tests/sidebarToggleHotkey.test.mjs` |
| P2-34(c) Ctrl+W / Ctrl+Tab overlay lies | **proved** | Overlay no longer lists them |
| P2-35(a) dismiss-then-reopen | **proved** | `useMobileSheetMotion.js` generation-guard |
| P2-35(b) hard-hide survey exits | **proved** | `fix-logs/mobile-sheets-p2-35b.md` |
| P2-35(c) `touchcancel` | **proved** | hook `onTouchCancel` → `settleDrag` |
| Undocumented +2 | **missing as text** | No defect to classify |

## Original 96 unique IDs

Legend: **proved** = dedicated receipt and/or Node + live Playwright on disk. Cluster live specs (`e2e-p1-12-38-53-live`, `e2e-stomp-nine-live`, `e2e-00fda232-thirteen-live`, wave8/9) count as live proof for those IDs. Node-only Microsoft / SQL IDs count as proved for the in-tree symbol; live MSAL / SQL apply stay leftover-18 / deploy leftovers.

### Known bugs

| ID | Class | Evidence |
|---|---|---|
| KB-1 | **proved** | `src/utils/eraserPolicy.js` `getEraserOperation` → `'skip'`; `tests/eraserPolicy.test.mjs`; `fix-logs/eraser-policy-entire-mode.md`; live D-03 / D-04 |
| KB-2 | **proved** | `src/utils/annotationZOrder.js`; `tests/annotationZOrder.test.mjs` |

### Pass 1

| ID | Class | Evidence |
|---|---|---|
| P1-01 | **proved** | `pdfAnnotationsPdfLib.js` `getLineEndpoints`; `tests/lineArrowEndingExport.test.mjs`; live `e2e-adversarial-wave8.spec.mjs` + `e2e-00fda232-thirteen-live.spec.mjs`; `fix-logs/e2e-adversarial-wave8.md` |
| P1-02 | **proved** | `resolveExportedLineEnding2`; `tests/lineArrowEndingExport.test.mjs`; live `e2e-stomp-nine-live.spec.mjs`; `fix-logs/e2e-stomp-nine-live.md` |
| P1-03 | **proved** | `/BE` + `buildCloudPathCommands`; live thirteen + wave8; `fix-logs/e2e-00fda232-thirteen-live.md` |
| P1-04 | **proved** | flatten `width * \|scaleX\|`; `tests/printFlattenOnPage.test.mjs` + export-scale / ink / text flatten Node; live wave9 / scale leftovers |
| P1-05 | **proved** | `applyGroupLineWorldTransform`; `tests/svgInteractionFixes.test.mjs`; live thirteen |
| P1-06 | **proved** | `resolveAnnotationIndexById` at pointermove/up; same Node + live thirteen |
| P1-07 | **proved** | `TextEditOverlay.jsx` `replaceTextInPageJson`; `tests/pdfViewerStaleIdCommits.test.mjs` (re-ran this pass) |
| P1-08 | **proved** | `captureSelectionStableIds` / `remapSelectionByStableIds`; Node + live thirteen |
| P1-09 | **proved** | `pushLocalAnnotationHistoryAction` clears `redoHistoryRef`; `tests/pdfViewerUndoOneLiners.test.mjs` (re-ran) |
| P1-10 | **proved** | `src/utils/crdtHistoryScope.js`; `tests/crdtHistoryScope.test.mjs` + undo one-liners (re-ran) |
| P1-11 | **proved** | `annotationLocalHistory.js` `mergeAnnotationHistoryUpdate`; `tests/annotationLocalHistory.test.mjs` |
| P1-12 | **proved** (stomp one-liner **still live**) | `historyHelpers.js:124` `startsWith('excel:')`; `tests/historyStacks.test.mjs` (re-ran); live `e2e-p1-12-38-53-live.spec.mjs`; `fix-logs/e2e-p1-12-38-53-live.md` |
| P1-13 | **proved** | `previewBaselineByPageRef`; undo one-liners + live `e2e-testpdf-import.spec.mjs`; `fix-logs/e2e-testpdf-import.md` |
| P1-14 | **proved** | `renumberCounters`; `tests/counterNumberingPageRefs.test.mjs`; live thirteen + wave8 |
| P1-15 | **proved** | callout `onEditCommit` text+bounds merge; `tests/pdfViewerStaleIdCommits.test.mjs` (re-ran) |
| P1-16 | **proved** | `matchesSelectedModule` (no null-module early-return); `tests/pdfViewerSurveyMarkers.test.mjs` |
| P1-17 | **proved** | `mergeLivePagePresentation`; `src/utils/__tests__/pageAnnotationReindex.test.mjs` |
| P1-18 | **proved** | `remapClipboardPage`; undo one-liners (re-ran) |
| P1-19 | **proved** | `DocumentVersionConflictError`; `documentVersionCheck.js` |
| P1-20 | **proved** | `__shapeSpyOn` DEV-only; undo one-liners (re-ran) |
| P1-21 | **proved** | `commitShapeCreationRef` on tool-switch; `tests/svgKeyboardHandlers.test.mjs`; wave7 zoomGeneration mid-draw |
| P1-22 | **proved** | `buildBulkDeletePlan`; `lib/collab/bulkDeletePlan.js` |
| P1-23 | **proved** | `stampImportedAnnotationAuthor`; live `e2e-testpdf-import.spec.mjs` |
| P1-24 | **proved** | `canModifySurveyMarker`; `lib/collab/permissionScope.js` |
| P1-25 | **proved** | `legacyGroupArrow.js`; `tests/legacyGroupArrow.test.mjs`; `fix-logs/export-flatten-siblings.md` |
| P1-26 | **proved** | `isLegacyGroupArrow` dblclick; `tests/legacyGroupArrow.test.mjs` |
| P1-27 | **proved** | circle in fill/stroke gates; `tests/selectedAnnotationColorSwatch.test.mjs` |
| P1-28 | **proved** | blank text → `null`; `src/utils/textEditCommit.js` |
| P1-29 | **proved** | `unionIdSet` / `subtractIdSet`; `tests/svgInteractionFixes.test.mjs`; live thirteen |
| P1-30 | **proved** | `collectLocalInteractionIds`; `remoteDeleteInteraction.js` |
| P1-31 | **proved** | `shouldShowSelectionTransformHandles`; `tests/selectionHandleVisibility.test.mjs` |
| P1-32 | **proved** | `rotation-input:${annotationIndex}`; undo one-liners (re-ran) |
| P1-33 | **proved** | context-menu `resolveAnnotationIndexById`; `annotationZOrder.js` |
| P1-34 | **proved** | `selectedIds` multi-id copy/cut; `SVGAnnotationLayer.jsx`; `tests/svgKeyboardHandlers.test.mjs` |
| P1-35 | **proved** | paste offset uses `pageSize.width`; undo one-liners (re-ran) |
| P1-36 | **proved** | `isOwnAnnotation`; `annotationLocalHistory.js` |
| P1-37 | **proved** | `AppShell.jsx` `showOpacity={false}`; `tests/annotationStyleUiContract.test.mjs` |
| P1-38 | **proved** (stomp one-liner **still live**) | `CompactColorPicker.jsx:336`; `tests/compactColorPickerLayout.test.mjs` (re-ran); live p1-12-38-53 |
| P1-39 | **proved** | `normalizeHexColor` / `isValidHexColor`; `annotationStyleCatalog.js` |
| P1-40 / P1-41 | **proved** | `handleZoomModeSelectRef` FIT_PAGE / WIDTH / HEIGHT; undo one-liners + live `e2e-fit-height.spec.mjs` |
| P1-42 | **proved** | `getPdfDocumentCacheStamp`; `tests/pagesPanelUtils.test.mjs`; live stomp-nine |
| P1-43 | **proved** | `canReorderVisiblePages`; same Node + live stomp-nine |
| P1-44 | **proved** | `nextBookmarkOrder`; `tests/bookmarkAtomicEdit.test.mjs`; live stomp-nine |
| P1-45 | **proved** | `planBookmarkDelete` + `bookmark:` history; undo one-liners + `fix-logs/p1-45-undo.md` |
| P1-46 | **proved** | `mergeSidebarWrite`; guest / no-Y.Doc localStorage leftover accepted (not leftover-18) |
| P1-47 | **proved** | `collectBookmarkTreePersistUpdates`; `tests/bookmarkReorderUtils.test.mjs`; live stomp-nine |
| P1-48 | **proved** | `prepareAtomicBookmarkEdit`; `tests/bookmarkAtomicEdit.test.mjs` |
| P1-49 | **proved** | `pageMutationRevision` in search key; undo one-liners (re-ran) |
| P1-50 | **proved** | `SPACES_MAP = 'spacesById'`; `tests/spacesKeyedMap.test.mjs` |
| P1-51 | **proved** | `spaceHasActivatableRegions`; `spaceRegionOrphans.js` |
| P1-52 | **proved** | `unscopeOrphanedRegionAnnotations`; same module |
| P1-53 | **proved** (stomp one-liner **still live**) | `syncStatusViewModel.js:41-48` pending before queue-offline; `tests/syncStatusUi.test.mjs` (re-ran); live p1-12-38-53 |
| P1-54 | **proved** | `isLikelyBlackThumbnailPixels`; `tests/pagesPanelUtils.test.mjs`; live stomp-nine |
| P1-55 | **proved** | `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`; `tests/annotationDualWriteRetired.test.mjs`; live stomp-nine |

### Pass 2

| ID | Class | Evidence |
|---|---|---|
| P2-01 | **proved** (SQL **apply leftover**) | `invite_blocked_free_tier`; `kal31_guard_invite_creator_tier`. Not leftover-18. |
| P2-02 | **proved** | `summarizeOutboxRetry`; live `e2e-outbox-retry.spec.mjs` |
| P2-03 | **proved** (SQL **apply leftover**) | `ACCOUNT_HAS_COLLABORATORS`; `20260820020000_…` |
| P2-04 | **proved** | `TemplateOverwriteWarningModal` |
| P2-05 | **proved** (SQL **apply leftover**) | `kal31_revoke_document_invite` |
| P2-06 | **proved** | `userCanManageProjectTeam`; `tests/rolesTeamManageGate.test.mjs`; live stomp-nine |
| P2-07 | **proved** | `userCanManageDocumentAccess`; same Node + live stomp-nine |
| P2-08 | **proved** | `linkGoogleIdentity`; `AuthContext.jsx` |
| P2-09 | **proved** | `excelLiveSyncWriteStatus.js` |
| P2-10 | **proved** (SQL **apply leftover**) | `excel_sync_state_identity_fingerprint_uidx` |
| P2-11 | **proved** | `createQuitCoordinator`; **zero** `checkAndQuit` in `src/` |
| P2-12 | **proved** | `storageStateAfterResignIn`; `collabBannerState.js` |
| P2-13 | **proved** | `isCapacitorMicrosoftConnectHidden`; `tests/microsoftOAuthRouting.test.mjs`; live thirteen. Deep-link leftover. |
| P2-14 | **proved** (Node; live MSAL leftover-18 A-02) | `preserveLegacyTokenMetadata`; `src/services/__tests__/microsoftConnectionMarker.test.mjs` |
| P2-15 | **proved** | `ACCOUNT_DELETION_CONFIRMATION = 'DELETE'` |
| P2-16 | **proved** | same as P1-30 |
| P2-17 | **proved** | `PRESENCE_STALE_MS = 10 * 60 * 1000` |
| P2-18 | **proved** | `isSameReSignInUser`; `ReSignInModal.jsx` |
| P2-19 | **proved** | `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false` (X-06 host leftover-18) |
| P2-20 | **proved** | live-sync effect gated on `oneDriveFileId` + `excelSessionId` |
| P2-21 | **proved** (SQL **apply leftover**) | same `20260820230000` create-branch whitelist |
| P2-22 | **proved** | `ensureFreshToken`; `OneDriveFolderBrowser.jsx` |
| P2-23 | **proved** (SQL **apply leftover**) | `FOR UPDATE` last-owner lock |
| P2-24 | **proved** (Node) | `shouldWipeSharedConnectionRow`; microsoftConnectionMarker tests |
| P2-25 | **proved** (Node) | `selectPreferredAccount`; `tests/msalAuthMain.test.mjs` |
| P2-26 | **proved** (Node) | `classifySilentTokenError`; `tests/msGraphMicrosoftAuth.test.mjs` |
| P2-27 | **proved** | `CANONICAL_RETURN_URL = 'https://surveytool.app/'` |
| P2-28 | **proved** (SQL **apply leftover**) | `proTrialPeriodDays`; `tests/billing.test.mjs` |
| P2-29 | **proved** (SQL **apply leftover**) | `withStripeEventIdempotency` |
| P2-30 | **proved** | `DATA_REMOVED_RETRY`; `accountPlatform.js` |
| P2-31 | **proved** | `describeProfileSaveOutcome` |
| P2-32 | **proved** | `canUnlinkProvider`; AccountSettings Set-a-password |
| P2-33 | **proved** | `resumePendingInviteAfterAuth` |
| P2-34 | **proved** | overlay + PDFViewer + `tests/sidebarToggleHotkey.test.mjs` + undo one-liners |
| P2-35 | **proved** | `useMobileSheetMotion.js`; `fix-logs/mobile-sheets-p2-35b.md` |
| P2-36 | **proved** | `app.requestSingleInstanceLock()` |
| P2-37 | **proved** | flatten skip non-finite box; `tests/printFlattenOnPage.test.mjs`; live wave9 |
| P2-38 | **proved** | `readBillingQuery`; `ToastHost.jsx` |
| P2-39 | **proved** | `surveyTestLogsDir`; `surveyDiagPaths.js` |

## Leftover-18 (fail-closed local + host-gated)

All 18 stay parked. Local fail-closed slices exist. Live hosts still missing. `.env.local` was **not** invented.

| ID | Class | Fail-closed evidence | Still-missing host |
|---|---|---|---|
| X-01 | **fail-closed** + **host-gated leftover-18** | `e2e-leftover18-save-export.spec.mjs` (no `file.id`; Save version owner-gated); `tests/leftover18FailClosed.test.mjs` | identity-churn / signed-in cloud save |
| X-05 persist | **fail-closed** + **host-gated leftover-18** | leftover18-save-export form local fill; same Node | saved `file.id` cloud persist |
| X-06 writeback | **fail-closed** + **host-gated leftover-18** | `e2e-survey-excel-actions-failclosed.spec.mjs`; leftover18 Node flag off | live Microsoft 365 sheet |
| U-04 cloud | **fail-closed** + **host-gated leftover-18** | `e2e-u04-archive.spec.mjs` + `e2e-account-settings-usage.spec.mjs` local meters | Dashboard + Supabase meter |
| A-01 Turnstile | **fail-closed** + **host-gated leftover-18** | `e2e-a01-hubpreview-adversarial.spec.mjs`; leftover18 Node no-token gate | live captcha completion |
| A-02 MSAL | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-connect-failclosed.spec.mjs`; `fix-logs/account-settings-connect-failclosed-2026-08-22.md` | live MSAL |
| A-03 inbox | **fail-closed** + **host-gated leftover-18** | `e2e-hub-docs-share-access.spec.mjs`; leftover18 Node | live email delivery |
| A-05 Stripe | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-start-trial-failclosed.spec.mjs`; `fix-logs/account-settings-start-trial-failclosed-2026-08-22.md` | live signed-in Checkout |
| A-06 roster | **fail-closed** + **host-gated leftover-18** | `e2e-two-tab-presence.spec.mjs`; leftover18 Node `user_id` dedupe | second-account lease tuple |
| UL-03 | **fail-closed** + **host-gated leftover-18** | `e2e-hub-docs-upload-failclosed.spec.mjs`; `fix-logs/hub-docs-upload-failclosed-2026-08-22.md` | native Electron pick/cancel |
| UL-13 | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-general.spec.mjs` Save `Preview cannot save profile changes` | real `updateProfile` persist |
| UL-15 | **fail-closed** + **host-gated leftover-18** | leftover18 Node Turnstile gate + General password mismatch / reset-link fail-closed + helper-only | live Turnstile password change |
| UL-16 | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-delete-account-failclosed.spec.mjs`; `fix-logs/account-settings-delete-account-failclosed-2026-08-22.md` | live account wipe |
| UL-20 | **fail-closed** + **host-gated leftover-18** | same as A-05 | live Stripe Checkout |
| UL-21 | **fail-closed** + **host-gated leftover-18** | same as A-02 | live MSAL |
| UL-22 | **fail-closed** + **host-gated leftover-18** | same as A-02 | live Google OAuth |
| UL-24 | **fail-closed** + **host-gated leftover-18** | same as A-03 | inbox send |
| UL-45 | **fail-closed** + **host-gated leftover-18** | same as A-06 | second-account lease |

**Counts:** **0** leftover-18 unblocked-and-proven · **18** fail-closed local · **18** host-gated.

## Objective controls (color / font / format / resize / rotation / save / export / import)

| Requirement | Class | Evidence |
|---|---|---|
| All 16 color swatches | **proved** | `COLOR_PICKER_PRESETS`; `e2e-pickers-every-swatch.spec.mjs`; C-01 / C-05 |
| All 6 fonts (single name) | **proved** | `FONT_FAMILIES` six names, no comma stacks; every-swatch T-03 |
| All 18 font sizes | **proved** | `FONT_SIZE_PRESETS`; every-swatch T-04 |
| Bold / italic / underline / strike | **proved** | every-swatch T-05 |
| Alignment 3×3 | **proved** | every-swatch 9 cells |
| Hex / invalid | **proved** | `normalizeHexColor` / `isValidHexColor`; C-02 |
| Opacity / HSV / Match Fill | **proved** | C-03 / C-04 / C-06 + P1-38 live |
| Resize / rotation | **proved** | E-01 / E-02 + bbox / callout / line / poly / survey-marker / nubbin dedicated slices |
| Save (cloud) | **host-gated leftover-18** X-01 | leftover18-save-export no `file.id` |
| Export / print / `?testPdf=` import | **proved** | leftover18-save-export + wave9 + `e2e-testpdf-import.spec.mjs` |
| Hub web file-control import | **host-gated leftover-18** A-01 / X-05 | `e2e-import-roundtrip.spec.mjs` |
| Form fill | **proved** widgets / **host-gated** persist | leftover18-save-export X-05 |

No unblocked thinner-than-dedicated-slice color / font / format / resize / rotation control found this pass.

## Compile-hidden / stubs (parked, not invented)

Custom Print panel (`PRINT_PANEL_ENABLED = false`); Forms designer `{false &&`; text-highlight split menu; Note / Underline / Strike / Squiggly create TODOs; Group / Ungroup omitted; stamp/image create (import preserve only); measurement tool; Extract Pages; Link create; Copy-to-Spaces dead setter; Templates category Move/Copy stub; checklist Y/N/N-A (no compiled-in items); empty New project `console.log` unless `workflowE2E`.

## High-risk invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` | **yes** |
| SVG `viewBox` owns zoom | **yes** |
| Container-aware canvas `offsetWidth / pageSize.width` | **yes** |
| Single-name `fontFamily` | **yes** |
| CORS `Access-Control-Allow-Origin: '*'` | **yes** (not tightened) |

8448 MiB / 75/250 geometry-timing **not** loosened. Official `npm test` not re-run this pass (standing `partialEraserComplexity` crossing-500 allocation leftover on this host).

## Product

No product bug. UL-03 390 empty Upload selector scoped to `.documents-mobile-list` so “No documents yet” / Upload PDF do not collide with other hub copy (already-dedicated leftover-18 spec).

## Next leftover

**Host-gated leftover-18 live hosts.** First named: **X-01** identity-churn / signed-in cloud save (needs `.env.local` auto-login — missing; do not invent). Then X-05 persist, X-06 writeback, A-01 Turnstile success, A-02 live MSAL, A-05 Stripe Checkout, A-06 / UL-45 second-account lease.

Do **not** re-claim unblocked GAP = 0. Goal stays open.
