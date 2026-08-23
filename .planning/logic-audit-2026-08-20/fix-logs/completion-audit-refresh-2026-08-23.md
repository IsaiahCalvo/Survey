# Completion-audit refresh — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `4ab0be92` (T-01 live Textbox rubber-band).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another short “X-01 still blocks” receipt. Did **not** pad a FEATURE-MATRIX hunt. Did **not** invent another rotation / create-preview subslice. Did **not** loosen official `npm test` **8448** MiB or 75/250.

The prior 103-ID refresh (`fix-logs/completion-audit-refresh-2026-08-22.md`, commit `f2e3d496`) is **stale**. After it landed, this branch receipted the live-create family (S-01/S-02 rect/ellipse; S-03/S-04 line/arrow; T-02 callout; T-01 textbox; D-01/D-02 freehand; D-03/D-04 eraser stroke) and the selected-transform family (rect/ellipse/textbox/cloud-rect/ink resize+`mtr`; E-02 pill / Shift+45 / free-drag; E-03 move; V-04 Fit page + Ctrl+wheel). This pass reclassified every unique audit ID plus leftover-18 against the **current tree + current SHAs**.

## Tree inspect (one leftover — none unique)

Inspected live chrome after T-01 (`4ab0be92`). Rejected as leftover-18, compile-hidden, already dedicated, or a create-preview / rotation replay:

| Candidate | Verdict |
|---|---|
| Survey-marker in-drag dashed `#4A90E2` rect | **Replay.** `SHAPE_CREATION_TOOLS` path; U-01 Walls stamp-create + placed handle drag already receipted. |
| Callout create auto-edit (`isNewCallout` / blank delete) | **Already dedicated.** Wave-3 Q overlay + type; T-02 keep-alive; UL-36 Aa; `calloutBlankCommit.test.mjs`. Not a new leftover. |
| Cloud live create | **No dedicated tool.** Style→Cloud is S-01 Rect rubber-band. |
| Counter live create | **Window pin already receipted.** |
| Callout / Counter / Line 8-handle `mtr` | **Not live.** Knee / nubbin / `p1`/`p2`/`midpoint` already receipted. |
| Keyboard nudge | **Not wired.** ArrowLeft/Right are page nav. |
| Insert image / stamp / create-poly / Extract / measure / Group / Note-Link / Forms / Print panel | **Compile-hidden / zero callers.** |
| Text-markup highlight / Underline / Strike / Squiggly | **Compile-hidden** (toolbar TODOs commented). |
| Theme / appearance | **Absent.** |
| Tab reorder / title rename | **No real two-PDF-tab path.** |
| Group-rotate 15° | **Not live.** Group `moveOnly` hides `mtr`. |
| Annotation Duplicate | **No chrome.** Context menu has no Duplicate; Ctrl+D invents 0. |
| Search Match case / Whole word | **Absent** (V-08 already recorded). |
| leftover-18 X-01 | **Host-gated.** Names in `.env.local`; still need coordinator lease + real `file.id`. Not proved this pass. |

**Unblocked leftover found this pass:** none that is not leftover-18, not compile-hidden, and not a replay.

## Method

Sources re-read (not copied as truth):

- `.planning/logic-audit-2026-08-20/REPORT.md` (headline 103 = 58 + 45 pre-fold)
- `known-bugs-deep-dive.json` (KB-1 / KB-2 only; **no extra IDs**)
- `ISSUE-INVENTORY.md`, `COMPLETION-AUDIT.md`, `E2E-STATUS.md`
- `fix-logs/completion-audit-refresh-2026-08-22.md` (stale), `fix-logs/textbox-live-create-2026-08-23.md`

Tree checks this pass:

- Stomp one-liners still live: `historyHelpers.js:124` `startsWith('excel:')`; `CompactColorPicker.jsx:336-338` `Math.abs(localOpacity - matchOpacityPct) <= 1`; `syncStatusViewModel.js:41-48` `pending` **before** queue-offline (`:50`). Producer still `PDFViewer.jsx:17328` `addHistoryCheckpoint('excel:auto-sync')`.
- Zero `checkAndQuit` in `src/`. `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`. `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false`. `DevTestRoute.jsx:207` still “Do NOT set file.id”.
- Process auto-login / `FILE_ID` / `LEASE_TOKEN` **ABSENT**. `.env.local` X-01 **names** PRESENT (gitignored; values not printed). `.env.test` / `.bot-credentials.json` / `.survey-test-account.json` **missing**. Docker / `supabase` / `graphify` CLI **absent**. Did not invent hosts.
- Citation drift (still proved): P1-09 `pushLocalAnnotationHistoryAction` `PDFViewer.jsx:24087` / `redoHistoryRef.current = []` `:24122`; P1-15 callout `onEditCommit` `:32520` (`resolveCommittedCalloutText`); P1-16 `matchesSelectedModule` `:28696`; P2-34(b) `B` `:23863`.
- Focused Node this pass **110 / 110** (see Evidence). Includes leftover18 **12 / 12** + print-panel “96 unique inventory IDs still have proven receipts”.

## Counts

| Class | Count | What it is |
|---|---|---|
| **proved** | **96** | Unique REPORT IDs: product symbol + Node and/or live Playwright + receipt |
| **fail-closed** | **18** | leftover-18 dedicated local slices (not original 96 IDs) |
| **host-gated leftover-18** | **18** | Same 18; live hosts still missing (lease + `file.id`) |
| **weak** | **0** | No “status proved / leftover still matches original defect” row |
| **stomped** | **0** | Named one-liners still in tree |
| **missing** | **0** | No vanished unique REPORT ID |
| Headline extras P2-34(a)(b)(c) / P2-35(a)(b)(c) | **6 proved** | Not extra inventory IDs |
| Folded z-order ticket | **proved** | Same as KB-2 |
| Undocumented pass-2 +2 | **missing as text** | No REPORT paragraph |

Counts **unchanged** vs the stale 2026-08-22 refresh. Classification now includes post-`f2e3d496` live-create + selected-transform leftovers as **already-dedicated**, not unique-ID reopens.

## Headline extras (103 − 96)

| Extra | Class | Evidence |
|---|---|---|
| Pass-1 z-order ticket folded into KB-2 | **proved** | `src/utils/annotationZOrder.js`; `tests/annotationZOrder.test.mjs` (re-ran) |
| P2-34(a) Home/End / ←→ | **proved** | `KeyboardShortcutsOverlay.jsx:46-47`; `tests/pdfViewerUndoOneLiners.test.mjs` (re-ran) |
| P2-34(b) `B` sidebar | **proved** | `PDFViewer.jsx:23863`; overlay `:75`; `tests/sidebarToggleHotkey.test.mjs` |
| P2-34(c) Ctrl+W / Ctrl+Tab overlay lies | **proved** | Overlay no longer lists them (Navigation/Actions/Interface only) |
| P2-35(a) dismiss-then-reopen | **proved** | `src/mobile/useMobileSheetMotion.js` generation-guard |
| P2-35(b) hard-hide survey exits | **proved** | `requestClose`; `fix-logs/mobile-sheets-p2-35b.md` |
| P2-35(c) `touchcancel` | **proved** | hook `:226` `onTouchCancel` → `settleDrag` |
| Undocumented +2 | **missing as text** | No defect to classify |

## Original 96 unique IDs

Legend: **proved** = product symbol still in tree + dedicated receipt and/or Node + live Playwright on disk. Cluster live specs still count. Node-only Microsoft / SQL IDs stay proved for the in-tree symbol; live MSAL / SQL apply stay leftover-18 / deploy leftovers.

Stomp one-liners **still live** this pass: P1-12 / P1-38 / P1-53. Full per-ID table remains in `COMPLETION-AUDIT.md` §1 and `ISSUE-INVENTORY.md` (96 rows still `**proven**`; Node `printPanelFailClosed` “96 unique inventory IDs still have proven receipts” **pass**). Citation-only drift listed above; statuses unchanged.

## Leftover-18 (fail-closed local + host-gated)

All 18 stay parked. Local fail-closed slices exist. Live hosts still missing. Did **not** invent a lease. Did **not** stamp `file.id`.

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` / `.survey-test-account.json` / `.env.test` | **none** |

X-01 not live-proved. Still needs coordinator lease (`email|userId|tier|status`) **and** a real saved `file.id`. Do not stamp `file.id` on `?testPdf=`. Do not cloud-write on the personal-like `.env.local` identity.

| ID | Class | Fail-closed evidence | Still-missing host |
|---|---|---|---|
| X-01 | **fail-closed** + **host-gated leftover-18** | `e2e-leftover18-save-export.spec.mjs`; `tests/leftover18FailClosed.test.mjs` | identity-churn / signed-in cloud save + lease + `file.id` |
| X-05 persist | **fail-closed** + **host-gated leftover-18** | leftover18-save-export form local fill; same Node | saved `file.id` cloud persist |
| X-06 writeback | **fail-closed** + **host-gated leftover-18** | `e2e-survey-excel-actions-failclosed.spec.mjs`; leftover18 Node flag off | live Microsoft 365 sheet |
| U-04 cloud | **fail-closed** + **host-gated leftover-18** | `e2e-u04-archive.spec.mjs` + `e2e-account-settings-usage.spec.mjs` | Dashboard + Supabase meter |
| A-01 Turnstile | **fail-closed** + **host-gated leftover-18** | `e2e-a01-hubpreview-adversarial.spec.mjs`; leftover18 Node no-token gate | live captcha completion |
| A-02 MSAL | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-connect-failclosed.spec.mjs` | live MSAL |
| A-03 inbox | **fail-closed** + **host-gated leftover-18** | `e2e-hub-docs-share-access.spec.mjs`; leftover18 Node | live email delivery |
| A-05 Stripe | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-start-trial-failclosed.spec.mjs` | live signed-in Checkout |
| A-06 roster | **fail-closed** + **host-gated leftover-18** | `e2e-two-tab-presence.spec.mjs`; leftover18 Node `user_id` dedupe | second-account lease tuple |
| UL-03 | **fail-closed** + **host-gated leftover-18** | `e2e-hub-docs-upload-failclosed.spec.mjs` | native Electron pick/cancel |
| UL-13 | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-general.spec.mjs` Save fail-closed | real `updateProfile` persist |
| UL-15 | **fail-closed** + **host-gated leftover-18** | leftover18 Node Turnstile gate + General password mismatch | live Turnstile password change |
| UL-16 | **fail-closed** + **host-gated leftover-18** | `e2e-account-settings-delete-account-failclosed.spec.mjs` | live account wipe |
| UL-20 | **fail-closed** + **host-gated leftover-18** | same as A-05 | live Stripe Checkout |
| UL-21 | **fail-closed** + **host-gated leftover-18** | same as A-02 | live MSAL |
| UL-22 | **fail-closed** + **host-gated leftover-18** | same as A-02 | live Google OAuth |
| UL-24 | **fail-closed** + **host-gated leftover-18** | same as A-03 | inbox send |
| UL-45 | **fail-closed** + **host-gated leftover-18** | same as A-06 | second-account lease |

**Counts:** **0** leftover-18 unblocked-and-proven · **18** fail-closed local · **18** host-gated.

SQL **apply** leftovers on already-proved IDs (do not apply to prod Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29.

## Post-stale-refresh landings (not unique IDs; already dedicated)

These landed after `f2e3d496` and do **not** reopen any of the 96:

| Landing | Class | Evidence |
|---|---|---|
| S-01/S-02 live rect/ellipse rubber-band | **proved leftover** | `e2e-shape-live-create.spec.mjs`; `fix-logs/shape-live-create-2026-08-23.md` |
| S-03/S-04 live Line/Arrow rubber-band | **proved leftover** | `e2e-line-arrow-live-create.spec.mjs`; `fix-logs/line-arrow-live-create-2026-08-23.md` |
| T-02 live Callout rubber-band | **proved leftover** | `e2e-callout-live-create.spec.mjs`; `fix-logs/callout-live-create-2026-08-23.md` |
| T-01 live Textbox rubber-band | **proved leftover** | `e2e-textbox-live-create.spec.mjs`; `tests/textboxLiveCreate.test.mjs` (re-ran **3 / 3**); `fix-logs/textbox-live-create-2026-08-23.md` |
| D-01/D-02 live freehand stroke | **proved leftover** | `e2e-freehand-live-stroke.spec.mjs`; `fix-logs/freehand-live-stroke-2026-08-23.md` |
| D-03/D-04 live eraser stroke | **proved leftover** | `e2e-eraser-live-stroke.spec.mjs`; `fix-logs/eraser-live-stroke-2026-08-23.md` |
| Selected rect/ellipse/textbox/cloud/ink resize+`mtr` | **proved leftover** | `e2e-annotation-resize` / `ellipse-resize-rotate` / `textbox-resize-rotate` / `cloud-resize-rotate` / `ink-resize-rotate` |
| E-02 pill Arrow / Shift+45 / free-drag | **proved leftover** | `e2e-rotation-input-arrow` / `rotation-shift-snap` / `annotation-rotate` |
| V-04 Fit page + Ctrl+wheel | **proved leftover** | `e2e-fit-page.spec.mjs`; `e2e-ctrl-wheel-zoom.spec.mjs` |

## Objective controls

Unchanged. `FONT_FAMILIES` still six single names (`Arial`, `Helvetica`, `Times New Roman`, `Courier New`, `Georgia`, `Verdana`) — no comma stacks. Cloud save stays **host-gated leftover-18 X-01**.

## Compile-hidden / stubs (parked, not invented)

Custom Print panel (`PRINT_PANEL_ENABLED = false`); Forms designer `{false &&`; text-highlight split menu; Note / Underline / Strike / Squiggly create TODOs; Group / Ungroup omitted; stamp/image create (import preserve only); measurement tool; Extract Pages; Link create; Copy-to-Spaces dead setter; Templates category Move/Copy stub; checklist Y/N/N-A (no compiled-in items).

## High-risk invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` | **yes** (`PDFViewer.jsx:3247` `useState(0)`; `:1959` zoom-start + `:1995` `gesture-start`; SVG `:1393` + FabricEraserCanvas `:404` still watch it) |
| SVG `viewBox` owns zoom | **yes** (`SVGAnnotationLayer.jsx:4666` `viewBox={0 0 ${width} ${height}}`; no JS zoom coordination) |
| Container-aware canvas `offsetWidth / pageSize.width` | **yes** (`PageAnnotationLayer.jsx:7747-7751` `containerW / width` → `effectiveScale`) |
| Single-name `fontFamily` | **yes** (`FONT_FAMILIES` six names) |
| CORS `Access-Control-Allow-Origin: '*'` | **yes** (checkout / portal / send-email / send-profile-change-notification / excel-apply-changeset — not tightened) |

8448 MiB / 75/250 geometry-timing **not** loosened. Official `npm test` not re-run this pass (standing `partialEraserComplexity` crossing-500 allocation leftover on this host).

## Evidence (this pass)

Focused Node **110 / 110** (`node --test` on):

- `tests/leftover18FailClosed.test.mjs` (**12 / 12**)
- `tests/historyStacks.test.mjs` (P1-12)
- `tests/compactColorPickerLayout.test.mjs` (P1-38)
- `tests/syncStatusUi.test.mjs` (P1-53)
- `tests/eraserPolicy.test.mjs` (KB-1)
- `tests/annotationZOrder.test.mjs` (KB-2)
- `tests/pdfViewerUndoOneLiners.test.mjs` (P1-09 / 13 / 18 / 20 / 32 / 35 / 40 / 45 / 49 + P2-34)
- `tests/pdfViewerStaleIdCommits.test.mjs` (P1-07 / P1-15)
- `tests/crdtHistoryScope.test.mjs` (P1-10)
- `tests/continuePin.test.mjs` / `tests/continueCountToolbar.test.mjs`
- `tests/printPanelFailClosed.test.mjs` (includes “96 unique inventory IDs still have proven receipts”)
- `tests/compileHiddenToolsUnreachable.test.mjs`
- `tests/surveyKeepActive.test.mjs` / `tests/surveyEmptyCreateTemplate.test.mjs`
- `tests/pageOperationsQueueMounted.test.mjs` / `tests/hubDismissBarrierContracts.test.mjs`
- `tests/textboxLiveCreate.test.mjs` (**3 / 3**)

Did **not** replay leftover-18 live Playwright (hosts still gated). Did **not** replay live-create / transform Playwright. No product file.

## Product

No product bug. No unique-ID restore. No unique unblocked leftover.

## Next leftover

**Host-gated leftover-18 live hosts.** First named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Then X-05 persist, X-06 writeback, A-01 Turnstile success, A-02 live MSAL, A-05 Stripe Checkout, A-06 / UL-45 second-account lease.

Do **not** re-claim unblocked GAP = 0. Goal stays open.
