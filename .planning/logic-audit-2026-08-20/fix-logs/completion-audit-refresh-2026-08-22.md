# Completion-audit refresh — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / leases.  
Did **not** loosen **8448** MiB. Did **not** launch a catalog hunt.

The prior 103-ID write-up (`fix-logs/completion-audit-2026-08-22.md`, commit `86a27cd8`) is **stale**. After it landed, this branch added Continue pin, Continue Count toolbar, Print fail-closed, compile-hidden classification, leftover-18 fail-closed slices (already on disk before some later hunts; re-checked), official contract alignments (`surveyKeepActive` / `surveyEmptyCreateTemplate` / `pageOperationsQueueMounted`), and a leftover-18 host-bundle. This pass reclassified every unique audit ID plus leftover-18 against the **current tree**.

## Method

Sources re-read (not copied as truth):

- `.planning/logic-audit-2026-08-20/REPORT.md` (headline 103 = 58 + 45 pre-fold)
- `known-bugs-deep-dive.json` (KB-1 / KB-2 only; **no extra IDs**)
- `ISSUE-INVENTORY.md`, `COMPLETION-AUDIT.md`, `E2E-STATUS.md`
- `fix-logs/completion-audit-2026-08-22.md` (stale), `fix-logs/leftover18-host-bundle-2026-08-22.md`

Tree checks this pass:

- Stomp one-liners still live: `historyHelpers.js:124` `startsWith('excel:')`; `CompactColorPicker.jsx:336` `Math.abs(localOpacity - matchOpacityPct) <= 1`; `syncStatusViewModel.js:41-48` `pending` **before** queue-offline (`:50`). Producer still `PDFViewer.jsx:17316` `addHistoryCheckpoint('excel:auto-sync')`.
- Zero `checkAndQuit` in `src/`. `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`. `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false`. `DevTestRoute.jsx:207` still “Do NOT set file.id”.
- `.env.local` / `.env.test` / `.bot-credentials.json` / `.survey-test-account.json` **missing**. Process auto-login / Stripe / MSAL / Turnstile **ABSENT**. Docker / `supabase` CLI **absent**. Vite `127.0.0.1:5173` **200** (reused; not spawned). Did not invent hosts.
- Only `src/` product edit after stale audit `86a27cd8`: `82431923` Counter overlay `e.button !== 0` guard (UL-31). Does **not** touch unique-ID symbols.
- Citation drift (still proved): P2-35 hook lives at `src/mobile/useMobileSheetMotion.js` (not `src/hooks/`); P1-09 `redoHistoryRef.current = []` now `PDFViewer.jsx:24081`; P1-15 merge now `:32551-32564`; P1-16 `matchesSelectedModule` now `:28655`; P2-34(b) `B` now `:23822`.
- Focused Node this pass **107 / 107** (see Evidence). Includes leftover18 `96 unique inventory IDs still have proven receipts`.

**Unblocked leftover found this pass:** none that is not leftover-18, not compile-hidden, and not a stub.  
Did **not** re-run a catalog hunt as filler.

## Counts

| Class | Count | What it is |
|---|---|---|
| **proved** | **96** | Unique REPORT IDs: product symbol + Node and/or live Playwright + receipt |
| **fail-closed** | **18** | leftover-18 dedicated local slices (not original 96 IDs) |
| **host-gated leftover-18** | **18** | Same 18; live hosts still missing |
| **weak** | **0** | No “status proved / leftover still matches original defect” row |
| **stomped** | **0** | Named one-liners still in tree |
| **missing** | **0** | No vanished unique REPORT ID |
| Headline extras P2-34(a)(b)(c) / P2-35(a)(b)(c) | **6 proved** | Not extra inventory IDs |
| Folded z-order ticket | **proved** | Same as KB-2 |
| Undocumented pass-2 +2 | **missing as text** | No REPORT paragraph |

Counts **unchanged** vs the stale audit. Classification now includes post-`86a27cd8` landings (Continue pin / Continue Count / Print fail-closed / compile-hidden / official contract alignments / leftover-18 host-bundle) as **already-dedicated leftovers**, not unique-ID reopens.

## Headline extras (103 − 96)

| Extra | Class | Evidence |
|---|---|---|
| Pass-1 z-order ticket folded into KB-2 | **proved** | `src/utils/annotationZOrder.js`; `tests/annotationZOrder.test.mjs` |
| P2-34(a) Home/End / ←→ | **proved** | `KeyboardShortcutsOverlay.jsx:46-47`; `tests/pdfViewerUndoOneLiners.test.mjs` |
| P2-34(b) `B` sidebar | **proved** | `PDFViewer.jsx:23822`; overlay `:73`; `tests/sidebarToggleHotkey.test.mjs` |
| P2-34(c) Ctrl+W / Ctrl+Tab overlay lies | **proved** | Overlay no longer lists them (Navigation/Actions/Interface only) |
| P2-35(a) dismiss-then-reopen | **proved** | `src/mobile/useMobileSheetMotion.js` generation-guard |
| P2-35(b) hard-hide survey exits | **proved** | `requestClose`; `fix-logs/mobile-sheets-p2-35b.md` |
| P2-35(c) `touchcancel` | **proved** | hook `:226` `onTouchCancel` → `settleDrag` |
| Undocumented +2 | **missing as text** | No defect to classify |

## Original 96 unique IDs

Legend: **proved** = product symbol still in tree + dedicated receipt and/or Node + live Playwright on disk. Cluster live specs (`e2e-p1-12-38-53-live`, `e2e-stomp-nine-live`, `e2e-00fda232-thirteen-live`, wave8/9) still count as live proof. Node-only Microsoft / SQL IDs stay proved for the in-tree symbol; live MSAL / SQL apply stay leftover-18 / deploy leftovers.

### Known bugs

| ID | Class | Evidence |
|---|---|---|
| KB-1 | **proved** | `src/utils/eraserPolicy.js:64-66` `getEraserOperation` → `'skip'`; `tests/eraserPolicy.test.mjs` (re-ran); `fix-logs/eraser-policy-entire-mode.md`; live D-03 / D-04 |
| KB-2 | **proved** | `src/utils/annotationZOrder.js:5-9,124,147` `data.zOrder` + `resolveAnnotationIndexById`; `tests/annotationZOrder.test.mjs` (re-ran) |

### Pass 1

| ID | Class | Evidence |
|---|---|---|
| P1-01 | **proved** | `pdfAnnotationsPdfLib.js:2362` / `:3144` `getLineEndpoints`; flatten `:3351` does not re-add `left`. `tests/lineArrowEndingExport.test.mjs`; live wave8 + thirteen; `fix-logs/e2e-adversarial-wave8.md` |
| P1-02 | **proved** | `resolveExportedLineEnding2` `:2515`; `tests/lineArrowEndingExport.test.mjs`; live `e2e-stomp-nine-live.spec.mjs`; `fix-logs/e2e-stomp-nine-live.md` |
| P1-03 | **proved** | `/BE` `:1797` + `buildCloudPathCommands` `:3408`; `pdfAppAnnotationMetadata.js` `pdfCloudIntensity`; live thirteen + wave8 |
| P1-04 | **proved** | flatten `width * \|scaleX\|`; `tests/printFlattenOnPage.test.mjs` + export-scale / ink / text flatten Node; live wave9 |
| P1-05 | **proved** | `useSVGInteraction.js:178` `applyGroupLineWorldTransform` used `:1516` / `:1783`; `tests/svgInteractionFixes.test.mjs` |
| P1-06 | **proved** | `resolveAnnotationIndexById` at pointermove `:1293` / pointerup `:2971`; same Node + live thirteen |
| P1-07 | **proved** | `TextEditOverlay.jsx:81` `replaceTextInPageJson`; `:343` uses `originalRef.current`. `tests/pdfViewerStaleIdCommits.test.mjs` (re-ran) |
| P1-08 | **proved** | `captureSelectionStableIds` / `remapSelectionByStableIds`; Node + live thirteen |
| P1-09 | **proved** | `PDFViewer.jsx:24046` `pushLocalAnnotationHistoryAction`; `:24081` `redoHistoryRef.current = []`. Undo one-liners (re-ran) |
| P1-10 | **proved** | `src/utils/crdtHistoryScope.js:7`; wired `PDFViewer.jsx:11928` / `:12201`. `tests/crdtHistoryScope.test.mjs` (re-ran) |
| P1-11 | **proved** | `annotationLocalHistory.js:580` `mergeAnnotationHistoryUpdate` |
| P1-12 | **proved** (stomp one-liner **still live**) | `historyHelpers.js:124` `startsWith('excel:')`; producer `:17316`. `tests/historyStacks.test.mjs` (re-ran); live `e2e-p1-12-38-53-live.spec.mjs` |
| P1-13 | **proved** | `previewBaselineByPageRef`; undo one-liners + live `e2e-testpdf-import.spec.mjs` |
| P1-14 | **proved** | `renumberCounters`; `tests/counterNumberingPageRefs.test.mjs`; live thirteen + wave8 |
| P1-15 | **proved** | `PDFViewer.jsx:32551-32564` callout `onEditCommit` merges only `text` + text-box bounds. Stale-id Node (re-ran) |
| P1-16 | **proved** | `PDFViewer.jsx:28655` `matchesSelectedModule` (no null-module early-return) |
| P1-17 | **proved** | `pageAnnotationReindex.js:353` `mergeLivePagePresentation`; `usePageOperations.js:84` |
| P1-18 | **proved** | `remapClipboardPage` `:324`; `PDFViewer.jsx:12427`. Undo one-liners (re-ran) |
| P1-19 | **proved** | `DocumentVersionConflictError`; `documentVersionCheck.js` |
| P1-20 | **proved** | `shapeBleedDiagnostics.js:275` `window.__shapeSpyOn`; DEV-only. Undo one-liners (re-ran) |
| P1-21 | **proved** | `SVGAnnotationLayer.jsx:1314-1325` `commitShapeCreationRef` on tool-switch |
| P1-22 | **proved** | `lib/collab/bulkDeletePlan.js:105`; `PDFViewer.jsx:18838` |
| P1-23 | **proved** | `pdfAnnotationImporter.js:74` `stampImportedAnnotationAuthor` (`:5134` apply) |
| P1-24 | **proved** | `permissionScope.js:249` `canModifySurveyMarker`; `PDFViewer.jsx:27102` (no outer fail-open guard) |
| P1-25 | **proved** | `legacyGroupArrow.js:8`; `fix-logs/export-flatten-siblings.md` |
| P1-26 | **proved** | `isLegacyGroupArrow` dblclick `PDFViewer.jsx:11539` / `:31901` |
| P1-27 | **proved** | circle in fill/stroke gates; selection maps circle→ellipse |
| P1-28 | **proved** | `textEditCommit.js:142` / `:197` blank → `null` |
| P1-29 | **proved** | `unionIdSet` / `subtractIdSet` vs `selectedCalloutIds` (`:2939` / `:2953`) |
| P1-30 | **proved** | `remoteDeleteInteraction.js:8` `collectLocalInteractionIds` |
| P1-31 | **proved** | `selectionHandleVisibility.js:84` `shouldShowSelectionTransformHandles` |
| P1-32 | **proved** | `RotationInputField.jsx:105` ``rotation-input:${annotationIndex}:${Date.now()}``. Undo one-liners (re-ran) |
| P1-33 | **proved** | `annotationZOrder.js:124`; context-menu resolve-by-id |
| P1-34 | **proved** | `SVGAnnotationLayer.jsx` `selectedIds` multi-id copy/cut |
| P1-35 | **proved** | `PDFViewer.jsx:4043` `pageSizesRef` (612/792 fallback only). Undo one-liners (re-ran) |
| P1-36 | **proved** | `annotationLocalHistory.js:30` `isOwnAnnotation` |
| P1-37 | **proved** | `AppShell.jsx:1833` `showOpacity={false}` |
| P1-38 | **proved** (stomp one-liner **still live**) | `CompactColorPicker.jsx:336`; `tests/compactColorPickerLayout.test.mjs` (re-ran) |
| P1-39 | **proved** | `annotationStyleCatalog.js:65` / `:79` `normalizeHexColor` / `isValidHexColor` |
| P1-40 / P1-41 | **proved** | `handleZoomModeSelectRef` FIT_PAGE / WIDTH / HEIGHT `:23848-23858`. Undo one-liners (re-ran) |
| P1-42 | **proved** | `pagesPanelUtils.js:25` `getPdfDocumentCacheStamp`; `PagesPanel.jsx:410` `thumbnailStore` |
| P1-43 | **proved** | `canReorderVisiblePages`; `PagesPanel.jsx:214` |
| P1-44 | **proved** | `bookmarkEditUtils.js:3` `nextBookmarkOrder` |
| P1-45 | **proved** | `planBookmarkDelete` + `bookmark:` history; undo one-liners (re-ran); `fix-logs/p1-45-undo.md` |
| P1-46 | **proved** | `sidebarPersistence.js:57` `mergeSidebarWrite`. Guest / no-Y.Doc still localStorage-only (accepted leftover, not leftover-18) |
| P1-47 | **proved** | `bookmarkReorderUtils.js:163` `collectBookmarkTreePersistUpdates` |
| P1-48 | **proved** | `prepareAtomicBookmarkEdit`; `tests/bookmarkAtomicEdit.test.mjs` |
| P1-49 | **proved** | `PDFViewer.jsx:7364` `pageMutationRevision` in search key. Undo one-liners (re-ran) |
| P1-50 | **proved** | `annotationDocStore.js:601` `SPACES_MAP = 'spacesById'` |
| P1-51 | **proved** | `spaceRegionOrphans.js:19` `spaceHasActivatableRegions`; `PDFViewer.jsx:19734` |
| P1-52 | **proved** | `unscopeOrphanedRegionAnnotations` `:25` |
| P1-53 | **proved** (stomp one-liner **still live**) | `syncStatusViewModel.js:41-48` pending before queue-offline; `tests/syncStatusUi.test.mjs` (re-ran) |
| P1-54 | **proved** | `isLikelyBlackThumbnailPixels`; `PagesPanel.jsx:166` |
| P1-55 | **proved** | `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`; `tests/annotationDualWriteRetired.test.mjs` |

### Pass 2

| ID | Class | Evidence |
|---|---|---|
| P2-01 | **proved** (SQL **apply leftover**) | `send-invite-email/handler.js:194` `invite_blocked_free_tier`; `kal31_guard_invite_creator_tier`. Not leftover-18. |
| P2-02 | **proved** | `annotationOutboxRetryView.js:39` `summarizeOutboxRetry`; live `e2e-outbox-retry.spec.mjs` |
| P2-03 | **proved** (SQL **apply leftover**) | `delete-account/index.ts:109` `ACCOUNT_HAS_COLLABORATORS`; `20260820020000_…` |
| P2-04 | **proved** | `TemplateOverwriteWarningModal`; `PDFViewer.jsx:36840` |
| P2-05 | **proved** (SQL **apply leftover**) | `kal31_revoke_document_invite` `DELETE FROM document_collaborators` |
| P2-06 | **proved** | `userCanManageProjectTeam` on `ProjectsFolderTree.jsx:428` / `ManageTeamModal.jsx:424` |
| P2-07 | **proved** | `userCanManageDocumentAccess`; `SurveyHub.jsx:121` |
| P2-08 | **proved** | `AuthContext.jsx:695` `linkGoogleIdentity` |
| P2-09 | **proved** | `excelLiveSyncWriteStatus`; `PDFViewer.jsx:14162` |
| P2-10 | **proved** (SQL **apply leftover**) | `excel_sync_state_identity_fingerprint_uidx` |
| P2-11 | **proved** | `quitCoordinator.cjs:7` `createQuitCoordinator`. **Zero** `checkAndQuit` in `src/` |
| P2-12 | **proved** | `collabBannerState.js:12` `storageStateAfterResignIn`; `YDocProvider.jsx:1704` |
| P2-13 | **proved** | `microsoftOAuthRouting.js:20` `isCapacitorMicrosoftConnectHidden`. Deep-link leftover (not leftover-18 list) |
| P2-14 | **proved** (Node; live MSAL leftover-18 A-02) | `preserveLegacyTokenMetadata`; `microsoftConnectionMarker.test.mjs` |
| P2-15 | **proved** | `accountPlatform.js:228` `ACCOUNT_DELETION_CONFIRMATION = 'DELETE'` |
| P2-16 | **proved** | same as P1-30 |
| P2-17 | **proved** | `src/hooks/presenceRoster.js:30` `PRESENCE_STALE_MS = 10 * 60 * 1000` + `:31` 60s heartbeat |
| P2-18 | **proved** | `reSignInAccount.js:2` `isSameReSignInUser`; `ReSignInModal.jsx:118` |
| P2-19 | **proved** | `excelWritebackGate.js:14` `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false` (X-06 host leftover-18) |
| P2-20 | **proved** | live-sync effect gated on `oneDriveFileId` + `excelSessionId` |
| P2-21 | **proved** (SQL **apply leftover**) | same `20260820230000` create-branch whitelist |
| P2-22 | **proved** | `OneDriveFolderBrowser.jsx:106` `ensureFreshToken` |
| P2-23 | **proved** (SQL **apply leftover**) | `20260820220000_…` `FOR UPDATE` |
| P2-24 | **proved** (Node) | `shouldWipeSharedConnectionRow`; microsoftConnectionMarker tests |
| P2-25 | **proved** (Node) | `msalAuthMain.js:78` `selectPreferredAccount`; `tests/msalAuthMain.test.mjs` |
| P2-26 | **proved** (Node) | `classifySilentTokenError`; `tests/msGraphMicrosoftAuth.test.mjs` |
| P2-27 | **proved** | `billingReturn.ts` `CANONICAL_RETURN_URL = 'https://surveytool.app/'` |
| P2-28 | **proved** (SQL **apply leftover**) | `billingTrial.ts` `proTrialPeriodDays`; `tests/billing.test.mjs` |
| P2-29 | **proved** (SQL **apply leftover**) | `stripeEventIdempotency.ts` `withStripeEventIdempotency` |
| P2-30 | **proved** | `DATA_REMOVED_RETRY`; `accountPlatform.js:247` |
| P2-31 | **proved** | `describeProfileSaveOutcome`; `AccountSettings.jsx:321` |
| P2-32 | **proved** | `canUnlinkProvider`; `AccountSettings.jsx:1230` |
| P2-33 | **proved** | `pendingInviteResume.js:68`; `main.jsx:360` |
| P2-34 | **proved** | overlay + `PDFViewer.jsx:23822` `B` + undo one-liners (re-ran) |
| P2-35 | **proved** | `src/mobile/useMobileSheetMotion.js:226` `onTouchCancel`; hosts `PDFSidebar.jsx:375` |
| P2-36 | **proved** | `electron-main.js:21` `app.requestSingleInstanceLock()` |
| P2-37 | **proved** | flatten skip non-finite box; `tests/printFlattenOnPage.test.mjs`; live wave9 |
| P2-38 | **proved** | `billingReturn.js:4` `readBillingQuery`; `ToastHost.jsx` `consumeBillingQueryOnBoot` |
| P2-39 | **proved** | `surveyDiagPaths.js:3` `surveyTestLogsDir`; `PDFViewer.jsx:5008` |

SQL **apply** leftovers on already-proved IDs (do not apply to prod Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29.

## Leftover-18 (fail-closed local + host-gated)

All 18 stay parked. Local fail-closed slices exist. Live hosts still missing. `.env.local` was **not** invented. Host-bundle receipt: `fix-logs/leftover18-host-bundle-2026-08-22.md`.

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
| UL-15 | **fail-closed** + **host-gated leftover-18** | leftover18 Node Turnstile gate + General password mismatch / reset-link fail-closed | live Turnstile password change |
| UL-16 | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-delete-account-failclosed.spec.mjs`; `fix-logs/account-settings-delete-account-failclosed-2026-08-22.md` | live account wipe |
| UL-20 | **fail-closed** + **host-gated leftover-18** | same as A-05 | live Stripe Checkout |
| UL-21 | **fail-closed** + **host-gated leftover-18** | same as A-02 | live MSAL |
| UL-22 | **fail-closed** + **host-gated leftover-18** | same as A-02 | live Google OAuth |
| UL-24 | **fail-closed** + **host-gated leftover-18** | same as A-03 | inbox send |
| UL-45 | **fail-closed** + **host-gated leftover-18** | same as A-06 | second-account lease |

**Counts:** **0** leftover-18 unblocked-and-proven · **18** fail-closed local · **18** host-gated.

## Post-stale-audit landings (not unique IDs; already dedicated)

These landed after `86a27cd8` and do **not** reopen any of the 96:

| Landing | Class | Evidence |
|---|---|---|
| UL-31 Continue pin | **proved leftover** (not leftover-18) | `e2e-continue-pin.spec.mjs`; `tests/continuePin.test.mjs` (re-ran **4 / 4**); `fix-logs/continue-pin-2026-08-22.md`. Product: overlay ignores non-primary (`82431923`). |
| UL-35 toolbar Continue Count | **proved leftover** (not leftover-18) | `e2e-continue-count-toolbar.spec.mjs`; `tests/continueCountToolbar.test.mjs` (re-ran **4 / 4**); `fix-logs/continue-count-toolbar-2026-08-22.md` |
| Print blob/OS fail-closed | **fail-closed** (not leftover-18; not compile-hidden reachable chrome) | `e2e-print-panel-failclosed.spec.mjs`; `tests/printPanelFailClosed.test.mjs` (re-ran); `PRINT_PANEL_ENABLED = false` `PDFViewer.jsx:29394`; `fix-logs/print-panel-failclosed-2026-08-22.md` |
| Stamp / measure / Group / Extract / Note-Link / Forms | **compile-hidden** | `e2e-compile-hidden-tools-unreachable.spec.mjs`; `tests/compileHiddenToolsUnreachable.test.mjs` (re-ran **7 / 7**); `fix-logs/compile-hidden-tools-2026-08-22.md` |
| Official contract alignments | **test-path** | `surveyKeepActive` notes → `noteHasContent` (product `SurveySpacesRail.jsx:1208` **not** reverted); empty-module Create template Walls sibling seed; `pageOperationsQueueMounted` repo `file://` harness. Isolated files re-ran this pass. |
| Leftover-18 host-bundle | **host-gated** | `fix-logs/leftover18-host-bundle-2026-08-22.md`. X-01 **not** live-proved. |

## Objective controls (color / font / format / resize / rotation / save / export / import)

Unchanged from stale audit. `FONT_FAMILIES` still six single names (`Arial`, `Helvetica`, `Times New Roman`, `Courier New`, `Georgia`, `Verdana`) — no comma stacks. Cloud save stays **host-gated leftover-18 X-01**.

## Compile-hidden / stubs (parked, not invented)

Custom Print panel (`PRINT_PANEL_ENABLED = false`); Forms designer `{false &&`; text-highlight split menu; Note / Underline / Strike / Squiggly create TODOs; Group / Ungroup omitted; stamp/image create (import preserve only); measurement tool; Extract Pages; Link create; Copy-to-Spaces dead setter; Templates category Move/Copy stub; checklist Y/N/N-A (no compiled-in items); empty New project `console.log` unless `workflowE2E`.

## High-risk invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` | **yes** (`PDFViewer.jsx:3245`; SVG + FabricEraserCanvas still watch it) |
| SVG `viewBox` owns zoom | **yes** (`SVGAnnotationLayer.jsx:4666` `viewBox={0 0 ${width} ${height}}`; no JS zoom coordination) |
| Container-aware canvas `offsetWidth / pageSize.width` | **yes** (PAL init/settle/scale paths; no `pageSize * scale` in `PDFViewer.jsx`) |
| Single-name `fontFamily` | **yes** (`FONT_FAMILIES` six names) |
| CORS `Access-Control-Allow-Origin: '*'` | **yes** (not tightened) |

8448 MiB / 75/250 geometry-timing **not** loosened. Official `npm test` not re-run this pass (standing `partialEraserComplexity` crossing-500 allocation leftover on this host).

## Evidence (this pass)

Focused Node **107 / 107** (`node --test` on):

- `tests/leftover18FailClosed.test.mjs` (**12 / 12**, including “96 unique inventory IDs still have proven receipts”)
- `tests/historyStacks.test.mjs` (P1-12)
- `tests/compactColorPickerLayout.test.mjs` (P1-38)
- `tests/syncStatusUi.test.mjs` (P1-53)
- `tests/eraserPolicy.test.mjs` (KB-1)
- `tests/annotationZOrder.test.mjs` (KB-2)
- `tests/pdfViewerUndoOneLiners.test.mjs` (P1-09 / 13 / 18 / 20 / 32 / 35 / 40 / 45 / 49 + P2-34)
- `tests/pdfViewerStaleIdCommits.test.mjs` (P1-07 / P1-15)
- `tests/crdtHistoryScope.test.mjs` (P1-10)
- `tests/continuePin.test.mjs` / `tests/continueCountToolbar.test.mjs`
- `tests/printPanelFailClosed.test.mjs` / `tests/compileHiddenToolsUnreachable.test.mjs`
- `tests/surveyKeepActive.test.mjs` / `tests/surveyEmptyCreateTemplate.test.mjs`
- `tests/pageOperationsQueueMounted.test.mjs` / `tests/hubDismissBarrierContracts.test.mjs`

Did **not** replay leftover-18 live Playwright (hosts still absent). Did **not** replay Continue pin / Continue Count / Print live specs. Vite 5173 reused only for the host probe (`HTTP 200`).

## Product

No product bug. No unique-ID restore. No leftover-18 live leftover that still lacks a dedicated fail-closed local slice.

## Next leftover

**Host-gated leftover-18 live hosts.** First named: **X-01** identity-churn / signed-in cloud save (needs `.env.local` auto-login — missing; do not invent). Then X-05 persist, X-06 writeback, A-01 Turnstile success, A-02 live MSAL, A-05 Stripe Checkout, A-06 / UL-45 second-account lease.

Do **not** re-claim unblocked GAP = 0. Goal stays open.
