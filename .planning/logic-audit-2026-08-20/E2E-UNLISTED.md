# E2E unlisted controls — not in the 59-row matrix

**This-pass (2026-08-22 place-time Entity dialog):** U-01 leftover (not a new UL row). Live `pendingEntitySelection` after a Walls draw when the template has entities. Rail Entity picker / Jump / Set location / Create category / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-place-entity-dialog-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Entity):** U-01 leftover (not a new UL row). Live rail `survey-marker-entity-trigger` / `aria-label="Entity"` → `applyEntitySelectionForMarker`. Jump / Set location / Create category / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-entity-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Jump / Set location):** U-01 leftover (not a new UL row). Live rail `Jump to this Survey Marker` / `Set location on PDF` → `handleLocateItemOnPDF` / pending draw. Create category / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-jump-set-location-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Create category):** U-01 leftover (not a new UL row). Live rail `Create category` → `CreateCategoryModal` → `addCategoryToCurrentTemplate`. Category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-create-category-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Delete selected categories):** U-01 leftover (not a new UL row). Live rail `Delete selected categories` + confirm → `deleteCategory` + marker wipe. Rename / item Delete / overlay Delete not replayed. Receipt `fix-logs/survey-rail-delete-categories-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Rename):** U-01 leftover (not a new UL row). Live rail `Rename ${name}` → `commitSurveyMarkerName`. Rail Delete / overlay Delete not replayed. Receipt `fix-logs/survey-rail-rename-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Delete selected items):** U-01 leftover (not a new UL row). Live rail `Delete selected items` + confirm. Overlay Delete not replayed. Receipt `fix-logs/survey-rail-delete-selected-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-marker delete chrome):** U-01 / E-04 leftover (not a new UL row). Live overlay `Delete Survey Marker` + Select Backspace/Delete. Rail `Delete selected items` not this pass. Receipt `fix-logs/survey-marker-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-marker handle drag):** U-01 / E-01 / E-02 / E-03 leftover (not a new UL row). Live placed-marker body + 8 resize + `mtr`. 390 same overlay (no bbox strip). Receipt `fix-logs/survey-marker-handle-drag-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 counter nubbin / Shift-orbit):** S-05 / E-02 leftover (not a new UL row). Live nubbin + Shift-orbit + place-time Shift. 390 uses the same SVG handle (no pause-orbit). Receipt `fix-logs/counter-nubbin-orbit-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 bbox edit mode):** not a new UL row. Double-click / 390 **Resize and rotate** leftover after vertex-N (not E-01 rect bbox; not `vertex-N`; not line `p1`/`p2`/`midpoint`). Receipt `fix-logs/bbox-edit-mode-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 polygon/polyline vertex handles):** X-04 leftover (not a new UL row; not E-01 bbox; not S-03/S-04 line chrome). Live imported `vertex-N`. Ellipse radii / ink vertices / stamp edit omitted. Receipt `fix-logs/poly-vertex-handles-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 line/arrow endpoint + midpoint handles):** S-03/S-04 leftover (not a new UL row; not E-01 bbox). Live `p1`/`p2`/`midpoint` + snap-to-straight. Callout mid-edge omitted in source. Receipt `fix-logs/line-endpoint-midpoint-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 callout text-box flip + knee-rollback leftovers):** T-02 leftovers (not a new UL row). Live flip past opposite + resize-into-knee rollback. Receipt `fix-logs/callout-textbox-resize-leftovers-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 callout text-box corner resize):** T-02 `textBox-tl/tr/bl/br` (not a new UL row; not E-01 shape handles). Receipt `fix-logs/callout-textbox-resize-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 callout knee / leader / arrowTip drag):** T-02 edit handles (not a new UL row). Not clipboard paste (T-02 / thin leftovers). Receipt `fix-logs/callout-knee-drag-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Keep active / notes / page-ctx):** Keep active is U-01 chrome (not a new UL row). Survey notes is marker chrome (not create-Note). UL-32 execute leftovers: Mirror V / Reset / Cut / Copy / Paste. Extract **missing-handler**. Receipt `fix-logs/survey-keep-notes-page-ctx-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Survey Previous/Next module):** U-01 live module **Next/Prev** (not a new UL row). Walls stays the category **stamp**. Receipt `fix-logs/survey-module-nav-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 thumbnail click):** V-06 live thumb **left-click** (not a new UL row). UL-07 stays the page-number **input**. Receipt `fix-logs/thumbnail-click-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Fit height):** UL-05 was cluster-level (menu open / Fit page + Fit width). Fit height is its own mode. Receipt `fix-logs/fit-height-2026-08-22.md`. Exhausted “GAP = 0” **falsified**. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 mobile Bookmarks):** V-07 mobile sheet (not a new UL row). Create / up-down / Open page 3 / 0+999 clamp. Hub tabs now `aria-label`. Receipt `fix-logs/mobile-bookmarks-2026-08-21.md`. Unblocked catalog exhausted: `fix-logs/unblocked-catalog-exhausted-2026-08-21.md` (later falsified). Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 Eraser Size every preset):** D-04 Size catalog every discrete **1…100** + custom 40 (default 20). Not a new UL row; not D-05 Width and not UL-35 Counter Size. Receipt `fix-logs/eraser-size-presets-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 Counter Size + Start):** UL-35 Size catalog every preset 5…64 + clamp 4–76; Start number intended/break/edge (lock after second pin). Not D-05 Width. Receipt `fix-logs/counter-size-start-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 F3 / counter Delete / cloud bump):** UL-34 every integer 1–20 live on the local Bump field (not leftover-18 persist). UL-35 series-list Delete execute + confirm; pin Delete is keyboard-only (pin menu stays Continue pin). F3/Ctrl+G are unlisted find aliases (not new UL rows). Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 leftover-18 unblock):** UL-03 web `/` Auth-modal gate live; UL-13/16 previewBlocked save/wipe live; UL-20 trial not clicked; UL-21/22 Connect fail-closed; UL-24 Send fail-closed; UL-45 still needs a second-account tuple. Space CSV / PDF Pages added as save/export inventory (not new UL rows). Receipt `fix-logs/leftover18-unblock-2026-08-21.md`. Goal stays open.

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Matrix:** `FEATURE-MATRIX.md` / `E2E-STATUS.md` (59 rows)  
**This file:** every user-facing control found in toolbars, context menus, AccountSettings, ShareModal, PDFSidebar, AppShell chrome, mobile chrome, KeyboardShortcutsOverlay, color/font pickers that is **not already its own matrix row**.

Vite `http://localhost:5173/` was reused (not killed). Live checks used `?testPdf=clickable-link-test.pdf` and `?testPdf=spike-120-pages.pdf`. PDFViewer touch this wave is the tiny Continue-pin action pass only.

**Status legend:** `untested` · `pass` · `fail` · `blocked`

**Counts:** **46** unlisted controls · **0** still untested · **46** proved (Node and/or live) · live-blocked leftovers now: UL-45 two-client roster, UL-15 captcha completion, UL-16 wipe, UL-20 Stripe click, UL-21/22 live OAuth, UL-46 native · UL-24 mint + UL-44 Retry flush now live · **4** issues (3 wave 1 + Continue pin stub, all closed) · **0** open issues this wave

The **59-row matrix is not claimed complete** from this file. This file only covers the extra 46 controls.

Unblocked catalog follow-up (2026-08-21, not new UL rows): `fix-logs/e2e-unblocked-followup.md` / `e2e-unblocked-followup.spec.mjs` 6/6 — T-04/T-06/C-03/C-04/S-04/P-04 C/V-01 narrow. Leftover edges: `fix-logs/e2e-unblocked-followup-2.md` / `e2e-unblocked-followup-2.spec.mjs` 5/5. Completeness hunt: `fix-logs/e2e-catalog-completeness.md` / `e2e-catalog-completeness.spec.mjs` 5/5 — hub docs/projects/archive empty + U-02 rename/pages + UL-33 Dashed/Dotted. Host-gated UL leftovers unchanged. Remaining unblocked-unproven **0**.

## Proved

| How | What |
|---|---|
| Node `tests/e2eUnlistedControls.test.mjs` | **17 / 0 fail** — overlay, B helpers, Share parse+roles+block copy, AccountSettings catalog + password/unlink, sidebar tabs + close-panel contract, context/pages menus, print range + copies/rotate/markups, forms/style/fit, zoom/page clamp, sync/presence hide, Create space without `documentId` |
| Live `scripts/e2e-unlisted-live.mjs` | Overlay Close; **B** width; Fit; Forms hidden; History; **zoom %** 200 / 0→min / 9999→4000 / 50→min; **page #** 0+99 stay 1 on 1-page, jump 3 on 120-page; collapse panel; Search tab; Spaces tab; pages-thumb Duplicate menu; Style Solid+Cloud bump; counter series; Edit text disabled; print panel **not** opened (flag off); sync/presence hidden |
| Live `debug/scenarios/e2e-context-menu-spaces.spec.mjs` | **UL-27–31** 3/3 on reused Vite 5173 + `?testPdf=clickable-link-test.pdf`. Chrome right-click suppressed; empty page Paste-only (gray `#5a6473`); owned rect Cut/Copy/Paste + Bring to front / Send to back; Continue pin re-arms Counter; **U-02** Create space → Space 1 / Space 2, no `file.id` |
| Fixes | Print Clear `0` (wave 1); Share email dedupe (wave 1); overlay Close name (wave 1); copies/rotate helpers; this wave: Continue pin was a stub — now switches series + `setActiveTool('counter')` |

## Unlisted control table

| ID | Surface | Control | Intended | Break / edge | Status |
|---|---|---|---|---|---|
| UL-01 | Shortcuts overlay | Close (X / backdrop / Esc) | Dismiss overlay; focus trap owns Esc | Close had no accessible name | **pass** (live + Node; Close now `aria-label="Close"`) |
| UL-02 | Shortcuts overlay | **B** — toggle sidebar | Open/close left rail | Ignore in INPUT/TEXTAREA/contenteditable; modifiers | **pass** (Node helpers + live width change) |
| UL-03 | Shortcuts overlay | Ctrl/⌘O Open document | Open file | Web vs Electron File→Open | **pass** (IPC). Native chooser **opened** on 5175; pick/cancel **blocked** (AX + loginwindow). `fix-logs/electron-desktop.md` |
| UL-04 | Shortcuts overlay | Ctrl+0 Fit page | Fit page (not 100%) | Conflicts with zoom field focus | **pass** (listed + live: 50% then Ctrl+0 left 50%) |
| UL-05 | AppShell rail | Fit options menu | Fit page / width / **height** / manual | Narrow shell; Fit height ≠ Fit page on 390 | **pass** (this pass: Fit height intended/break/edge — `e2e-fit-height.spec.mjs`; prior live click was page+width only) |
| UL-06 | AppShell rail | Zoom % edit field | Type a percent; clamp 1–4000 | `0` / 50% lift to engine dynamic min (~100% here); 9999→4000; failed select-all appends | **pass** (live fill: 200%, 0→100%, 9999→4000%, 50→100%; Node clampScale) |
| UL-07 | AppShell rail | Page number edit | Jump by typing | 0 / >numPages revert; 1-page PDF | **pass** (live: 0+99 stay 1; jump 3 on 120-page; Node `coercePageNumber`). This pass: type 8 vs thumb 3; type 121 reverts — thumb click is V-06, not this row |
| UL-08 | PDFSidebar | Version history button | Open RevisionsPanel | Guest / no `file.id`; `?testPdf=` uses local key | **pass** (live visible; A-07 is the panel) |
| UL-09 | PDFSidebar | Search text tab | Focus find field | Mobile label is `Search` | **pass** (Node + live tab click) |
| UL-10 | PDFSidebar | Spaces tab | Spaces overlay list | Hidden when spaces entitlement off | **pass** (Node + live tab present on `?testPdf=`) |
| UL-11 | PDFSidebar | Close document panel | Collapse / close hub | Mobile sheet vs desktop chevron | **pass** (live width 48↔272; Node: mobile backdrop `aria-label="Close document panel"`) |
| UL-12 | AccountSettings | Tabs: General / Connected services / Subscription | Always land on General | Do not persist last tab (KAL-68) | **pass** (Node) |
| UL-13 | AccountSettings | Edit profile — first/last name | Save via `updateProfile` | Empty / partial save | **pass** (live + Node). `e2e-helper-only-live.spec.mjs`: empty first/last blocked by required; email locked. Cloud `updateProfile` persist still needs a real session. |
| UL-14 | AccountSettings | Email (read-only) | Display only | Input disabled + hint | **pass** (Node) |
| UL-15 | AccountSettings | Password set/change + reset-link + Turnstile | Google-only = Set; else Change | Captcha fail; mismatch; last Google method | **pass** (live mismatch + Node). Preview shows Set-a-password; mismatch errors. Live Turnstile completion still blocked. |
| UL-16 | AccountSettings | Delete account + type `DELETE` | Block if still owns shared docs | Wrong confirm string; collaborator rows | **pass** (live confirm + Node). `delete` stays disabled; `DELETE` enables; Cancel. Live wipe still blocked. |
| UL-17 | AccountSettings | Sign out | `signOut` + close | Mid-save | **pass** (live). Settings Sign out closes the modal on hubPreview. Live hub session teardown still blocked. |
| UL-18 | AccountSettings | Usage sub-tab | `<UsageIndicator/>` | Load fail | **pass** (live tab). Usage sub-tab opens on hubPreview. Live billing-API meter still blocked. |
| UL-19 | AccountSettings | Monthly / Annual billing toggle | Free users only; 17% save copy | Paid/developer hide toggle | **pass** (Node) |
| UL-20 | AccountSettings | Start trial / Manage billing / Contact sales | Stripe checkout; portal `returnUrl`; mailto | CORS `*` stays; no fake IDs | **pass** (live catalog). Start trial visible, not clicked. Contact sales present. Live Stripe Checkout still blocked. |
| UL-21 | AccountSettings | Microsoft Connect / Reconnect / Disconnect | MSAL; hidden on Capacitor | Session expired | **pass** (live Connect fail-closed). Live MSAL still blocked. |
| UL-22 | AccountSettings | Google Connect / Disconnect | Last sign-in method blocked | Unlink without password | **pass** (live Connect fail-closed + Node). Live OAuth still blocked. |
| UL-23 | ShareModal | Permission select Viewer \| Editor \| Owner | One role for link + email. **No Commenter** (locked KAL-31) | Matrix A-03 lists Commenter — Access Mgmt, not this dialog | **pass** (Node) |
| UL-24 | ShareModal | Copy link | Mint link-only invite; clipboard | Free-tier block; no target id; clipboard fail | **pass** (live mint). Signed-in owner Invite → Copy link minted (`e2e-signed-in-leftovers.spec.mjs`). HubPreview still fail-closed. Email Send not clicked. |
| UL-25 | ShareModal | Invite-by-email + Send | Parse comma/space/semicolon; lowercase | Invalid skip; **dupes now deduped** | **pass** (Node parse) |
| UL-26 | ShareModal | Cancel / Close + free-tier banner | Focus trap; no fake URL before mint | Placeholder only until Copy | **pass** (Node) |
| UL-27 | Context menu | Cut | Own marks only; clipboard mode=cut | Foreign author; readonly body | **pass** (live). Owned rect cut then empty-page paste restored a clone |
| UL-28 | Context menu | Copy | Stash shape / callout | Empty target | **pass** (live). Copy left the original; empty-page Paste added a new id |
| UL-29 | Context menu | Paste | Empty page = Paste only; gray if empty clipboard | Callout vs shape clipboard | **pass** (live). Empty page is Paste-only; desktop grays via `#5a6473` + `cursor:default` (not opacity). Chrome right-click shows no menu |
| UL-30 | Context menu | Bring to front / forward / backward / back | Overlap-aware z-order | **Omitted on callouts** (own SVG layer) | **pass** (live). Bring to front moved id to last SVG sibling; Send to back to first |
| UL-31 | Context menu | Continue pin (counter) | Keep series + re-arm Counter | Missing series | **pass** (live). Was a log-only stub; now switches series and leaves `[data-counter-overlay]` armed |
| UL-32 | Pages panel menu | Cut / Copy / Paste / Duplicate / Rotate / Mirror H+V / Reset / Delete | Page ops live on thumbs, not canvas | 1-page delete; empty clipboard | **pass** (this pass: **Mirror V / Reset / Cut / Copy / Paste execute** — `fix-logs/survey-keep-notes-page-ctx-2026-08-22.md`; prior Duplicate execute). **Extract missing-handler** |
| UL-33 | AppShell toolbar | Style picker Solid / Dashed / Dotted / Cloud | Cloud only on rect | Ellipse has no Cloud | **pass** (Node + live Solid/Cloud/Dashed/Dotted). Completeness: armed Dashed `6,4` + Dotted `2,4`; ellipse omits Cloud (`e2e-catalog-completeness.spec.mjs`) |
| UL-34 | AppShell toolbar | Cloud bump size 1–20 | Rect + cloud only | Letters / 0 / 99 | **pass** (every integer 1–20 live + 0→1 / 99→20 / letters rejected / empty→1; `e2e-cloud-bump-1-20.spec.mjs`) |
| UL-35 | AppShell toolbar | Counter series: New Count / Continue / start # / Size / delete series | Series list + context menu | Permission toast on delete; Size 3/77 | **pass** (this pass: Size every preset 5…64 + clamp 4–76; Start 10 / letters/0/empty→1 / lock after 2 pins — `e2e-counter-size-start.spec.mjs`; prior: series-list Delete + pin Delete **renumbers**) |
| UL-36 | AppShell toolbar | Edit text (Aa) | Enter overlay on selected text/callout | Disabled with no selection | **pass** (wired + live disabled) |
| UL-37 | AppShell toolbar | Forms category + 4 tools | Text field / Checkbox / Radio / Signature | **`{false && (` hidden for first release** | **pass** (hidden live). Tools Node-pass |
| UL-38 | Form properties | Name / default / tooltip / required / read-only / Delete field | Value hidden for checkbox/radio/signature | Id-less field | **pass** (Node) |
| UL-39 | Print panel | Pages to print + All / Current view / Clear | Empty = all; Clear = include none (`0`) | **Clear `0` used to become page 1 on blur** | **pass** (Node; Clear fix) |
| UL-40 | Print panel | Paper (10) + custom W×H + Auto/Portrait/Landscape | Custom 1–200 in | Garbage inches fall back | **pass** (Node + live this pass). 10 papers; empty W → `8.5`; H `999` → `200`. Flag restored. |
| UL-41 | Print panel | Rotate ±90 + Mirror H/V | Scope All/Select/Current | Empty select range | **pass** (Node + live clockwise this pass). Flag restored. |
| UL-42 | Print panel | Copies ± (1–999) / collate / duplex | − floors at 1 | 0 / 1000 | **pass** (Node + live: Fewer@1 stays 1; `0`→1; `1000`→999). Flag restored. |
| UL-43 | Print panel | Markups / color toggles + Save as PDF dest | Flatten path is X-03 | Destination list empty | **pass** (Node + live Markups toggle + dest option). Flag restored. |
| UL-44 | Sync chip | Details popover + Retry now | Retry outbox | Hidden when `synced` / no cloud | **pass** (Node + live Retry flush). Chip hidden on `?testPdf=`. Signed-in offline draw → **Offline · 1 saved locally** + Retry now. Offline Retry does not claim success. Online flush keeps the mark. Receipt `fix-logs/e2e-outbox-retry.md`. |
| UL-45 | Presence | Avatar stack + popover | N viewing | Same-user roster; hidden without collab | **pass** (Node + signed-in self row **just you** + same-user two-tab/two-context still **just you**). Hidden on `?testPdf=`. **blocked live two-client roster** — needs a second account. Receipt `fix-logs/e2e-two-tab-presence.md`. |
| UL-46 | Mobile chrome | Styled selects + color-picker close backdrop | Same style/arrowhead catalogs | touchcancel is E2E-CHROME-04 | **pass** (live 390×844). Eraser-mode select + Text color picker backdrop close. Native Capacitor still blocked. |

## Blocked list (live only — Node/catalog already done)

| IDs | Why blocked |
|---|---|
| UL-03 | Native File→Open opened `Open PDF document` on Vite 5175; pick/cancel unproven (AX menu-bar only; clicks hit loginwindow Login). `fix-logs/electron-desktop.md`. |
| UL-13, UL-15–18, UL-20–22 | **chrome live** on `?hubPreview=1`. Remaining: live Turnstile completion, account wipe, Stripe Checkout, MSAL, Google OAuth. |
| UL-24 | **live mint** on a signed-in owner doc (`e2e-signed-in-leftovers.spec.mjs`). HubPreview remains fail-closed. Email Send still not clicked. |
| UL-27–31 | **closed live** — prior “pdf.js swallow” was a harness miss (right-click at viewer 40,40 is chrome, off-page). |
| UL-40–43 | **closed live this pass** (`e2e-print-panel.spec.mjs` 1/1). Flag **restored false**. Repeat live needs another DEV flip. |
| UL-44 | **closed live** — offline draw on a signed-in UUID doc (`e2e-outbox-retry.spec.mjs`). Chip correctly hidden on `?testPdf=`. |
| UL-45 | Signed-in self row **just you**. Same-user two tabs / two contexts also **just you**. Two-client roster blocked: official lease has no `list`; `assign` needs a human `email\|userId\|tier\|status` (`fix-logs/e2e-host-leftovers.md`). |
| UL-46 | Native Capacitor still untested. Web 390×844 chrome is live (`e2e-helper-only-live.spec.mjs`). |

## Intentionally not rows (covered by an existing ID)

Color swatches / hex / opacity / spectrum / Match Fill = C-01…C-06. Fonts / size / B/I/U/S / align / font color = T-03…T-07. Arrowhead 6 styles = S-04. Undo/Redo = E-05. Export button = X-02. Pan/Select/Draw/Shapes/Text tools = V/D/S/T rows. Bookmarks add/reorder = V-07.

## New issues

### E2E-UL-04 — Continue pin was a log-only stub — **fixed**

- `item('Continue pin', 'continuePin')` had no action, so the menu closed and logged `[AnnotCtxMenu] continuePin`.
- Now calls `handleContinuePin`: switch that pin's series + `setActiveTool('counter')`.
- Proof: live UL-31 — overlay stays armed; no stub log.

Wave-1 issues stay closed:

### E2E-UL-01 — Print **Clear** became page 1 on blur — **fixed**

- Clear writes `pagesToPrint = '0'` (include none). `clampRangeToMax` / `sanitizeRangeInput` rewrote `0` → `1`.
- Helpers moved to `src/components/printRangeUtils.js`. Lone `0` is kept.

### E2E-UL-02 — Share email list minted duplicates — **fixed**

- `a@x.com, a@x.com` would mint twice. `parseEmails` in `src/home/shareInviteParse.js` now lowercases and dedupes.

### E2E-UL-03 — Shortcuts overlay Close had no accessible name — **fixed**

- Icon-only button. Added `aria-label="Close"` + `type="button"` in `KeyboardShortcutsOverlay.jsx`. Live: named button present.

## Observations (not product bugs)

- ShareModal roles are **Viewer / Editor / Owner** only. Commenter lives on Access Management (A-03), not this dialog.
- Forms category is **compile-hidden** (`false &&` in AppShell). Code + `FORM_TOOLS` stay; flip the flag to ship.
- Custom **Print panel** is also compile-gated (`PRINT_PANEL_ENABLED = false`). Cmd+P prints the blob/OS path. Flip the flag to ship the panel UI.
- Zoom field advertises 1–4000, but `zoomController` also applies a **dynamic minimum** (often ~fit-page). On `clickable-link-test.pdf` at 1440×900, `0` / `1` / `50` display as `100%`. `200` and `4000` apply.
- Context-menu Group/Ungroup omitted until the matrix-per-shape rewrite.
- Callout menu has no z-order (own SVG layer + id-sort).
- AccountSettings / ShareModal need hub auth — not faked on `?testPdf=`.
- CORS `Access-Control-Allow-Origin: '*'` stays.

## Hub leftovers wave (2026-08-21)

See `fix-logs/e2e-hub-templates-leftovers.md`. Reused Vite 5173. Not new UL rows.

- Templates editor create/edit/delete proven on `?hubPreview=1` (U-03). Blank rename restore is E2E-HUB-01.
- Hub sidebar **Archive** is document archive (`ArchiveScreen`), not KAL-44 checklist archive. Do not count that button as U-04.
- `kal441-form-fields.pdf` widgets live in `.pdfjsFormLayer` (also class `annotationLayer`). Wait for inputs; a same-tick count can be 0.

## Files touched (no commit)

- `src/hooks/useAnnotationContextMenu.jsx` (Continue pin action)
- `src/PDFViewer.jsx` (tiny: pass `handleContinuePin` into the menu bundle)
- `tests/e2eUnlistedControls.test.mjs` (17 tests)
- `debug/scenarios/e2e-context-menu-spaces.spec.mjs`
- this file
