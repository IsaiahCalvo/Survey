# E2E status — wave 5 remaining + hub leftovers

**This-pass (2026-08-21 Counter Size + Start number):** unique leftover after F3 / series Delete / cloud bump. Pickers skipped Size as “Width already D-05”. Live-proved Counter Size every preset **5/8/12/16/24/32/48/64** (SVG `A r,r`); clamp 3/0→**4**, 77/999→**76**, letters rejected, empty→4. Start **10** renumbers the lone pin; letters/0/empty→1; second pin after Start 7 is **8**; Start locks after two pins. Playwright `e2e-counter-size-start.spec.mjs` **1 / 1 (7.5s)** on `?testPdf=clickable-link-test.pdf`. Node `counterSizeStartNumber.test.mjs` **2 / 2**. No product bug. Official `npm test` 8448 leftover not loosened (no high-risk edit). Receipt `.planning/logic-audit-2026-08-20/fix-logs/counter-size-start-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 F3 / counter-series Delete / cloud bump 1–20):** three named leftovers after result-row click. (1) F3 = Next, Shift+F3 = Previous, **Ctrl+G is bound as find Next** (Group stays compile-hidden); overlay omits F3/G; closed-bar / 0-hit no-op; F3 in a text annotation leaves the typed text and still walks. (2) Keyboard + Select-menu Delete of one pin in a 3-count series **renumbers**; first/middle/last + undo; Pen-armed still deletes; series-list Delete + confirm wipes; UL-31 Continue pin not replayed. (3) Local Cloud bump — every integer **1–20** stored; 0→1 / 99→20 / letters rejected. Not leftover-18 persist. Playwright **3 / 3 (32.3s)**. Node **6 / 6**. Receipt `.planning/logic-audit-2026-08-20/fix-logs/f3-counter-delete-bump-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 Search result-row click):** unique leftover after Search Previous. Live-proved `[data-result-index]` list: mid-row `1→7` (active `…-1`→`…-7`), last row `12 of 12` + Page 3, first row back to Page 1, same-row stay, 0-hit/empty/literal no rows, 1-hit stay, Pen-armed last-row jump, Next after mid click, later-page row index 6 → Page 2. Playwright `e2e-search-result-click.spec.mjs` **1 / 1 (33.4s)** on `?testPdf=text-search-glyph-lab.pdf`. Node `searchResultClick.test.mjs` **2 / 2**. No product bug. Official `npm test` 8448 leftover not loosened (no high-risk edit). Receipt `.planning/logic-audit-2026-08-20/fix-logs/search-result-click-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 Search Previous):** unique leftover after wave6 Next wrap. Live-proved Previous walk `3→2→1`, first→last wrap (`1 of 12` → `12 of 12`), X + Esc dismiss/clear highlights, 0-hit hidden, 1-hit stay, empty query, literal `.*(` , Previous while Pen armed, Shift+Enter vs page-focused button, no case-toggle, hyphen/`é`, query-change reset, wrap after page jump. Playwright `e2e-search-previous.spec.mjs` **1 / 1 (1.1m)** on `?testPdf=text-search-glyph-lab.pdf`. Node `searchPrevious.test.mjs` **2 / 2**. No product bug. Official `npm test` 8448 leftover not loosened (no high-risk edit). Receipt `.planning/logic-audit-2026-08-20/fix-logs/search-previous-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 keyboard shortcut matrix):** first unique unblocked leftover after print/export-options/stamp/measure were compile-gated or already proven. Live-proved Delete, Ctrl+]/[, Ctrl+F, tool letters P/H/T/Q/L/A/C/V, Esc overlay, and no-Duplicate / no-Group. Playwright `e2e-keyboard-shortcut-matrix.spec.mjs` **1 / 1 (4.2s)**. Node `keyboardShortcutMatrix.test.mjs` **2 / 2**. No product bug. Official `npm test` 8448 leftover not loosened (no high-risk edit). Receipt `.planning/logic-audit-2026-08-20/fix-logs/keyboard-shortcut-matrix-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 env-unlock + mobile chrome hit targets):** secrets hunt found **no** `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` / Stripe / MSAL. Leftover-18 **0** newly fully proven. Track B: 390×844 viewer More/header/dock + hub mobile list/filter/detail live-proven. Playwright `e2e-mobile-chrome-hit-targets.spec.mjs` **3 / 3 (9.2s)**. Node `mobileChromeHitTargets.test.mjs` **2 / 2**. Product: live page-input commit + mobile `pageInputRef`. Official `npm test` after PDFViewer: standing leftover `partialEraserComplexity` **11970.51 > 8448** (not loosened). Receipt `.planning/logic-audit-2026-08-20/fix-logs/env-unlock-or-next-gap-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 leftover-18 unblock + save/export/import):** legal slices for all 18 leftovers; **0** fully unblocked. Space CSV / PDF Pages + toolbar Export + Save Log + History Save-version fail-closed live-proven. Receipt `.planning/logic-audit-2026-08-20/fix-logs/leftover18-unblock-2026-08-21.md`. Playwright `e2e-leftover18-save-export.spec.mjs` **5 / 5 (11.9s)**. Node `leftover18FailClosed.test.mjs` **12 / 12**. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 audit-status refresh):** evidence re-grep of all 96 unique REPORT IDs + leftover-18 park list. **0** stomps. **0** weak/missing. Leftover **18** unchanged (not replayed). Did **not** replay waves 5–13 / flatten / survey-marker / pages menu / History restore / PDF-link ftp / thin leftovers / callout last-writer / hub extras / every-swatch pickers. Receipt `.planning/logic-audit-2026-08-20/fix-logs/audit-status-refresh-2026-08-21.md`. Goal stays open.

**Prior-pass (2026-08-21 pickers every swatch):** catalog-reconcile “0 GAP” was cluster-level. This pass live-proved every discrete fill/border/pen/counter/font-color swatch, all 18 sizes, B/I/U/S, 9 align cells, Style ×4, and per-type resize/rotate handles. Playwright `e2e-pickers-every-swatch.spec.mjs` **5 / 5 (32.6s)**. No product bug. Font families stay single names. Receipt `.planning/logic-audit-2026-08-20/fix-logs/pickers-every-swatch-2026-08-21.md`. Leftover **18** unchanged. Did **not** replay waves 5–13 / flatten / leftover-18 / hub extras / callout last-writer. Goal stays open.

**Prior-pass (2026-08-21 catalog reconcile):** independent chrome catalog vs leftover-18. Prior “remaining unblocked-unproven 0” was unproven until this table. Unique unblocked GAP found: hub documents extras (More Copy/Paste, Select Duplicate, Move/Copy, column Sort, Preview). Live `e2e-hub-docs-extras.spec.mjs` **1 / 1 (1.7s)**. No product bug. Receipt `.planning/logic-audit-2026-08-20/fix-logs/catalog-reconcile-2026-08-21.md`. Leftover **18** unchanged. Did **not** replay waves 5–13 / flatten / leftover-18 / thin leftovers / callout last-writer. Goal stays open.

**Prior-pass (2026-08-21 callout cross-page paste):** the unique leftover after thin leftovers — callout clone via context-menu Paste — is live-proven. Receipt `.planning/logic-audit-2026-08-20/fix-logs/callout-cross-page-paste-2026-08-21.md`. Playwright `e2e-callout-paste.spec.mjs` **1 / 1 (11.5s)** + thin leftovers **3 / 3 (20.1s)** (callout hunt now a hard clone). Product: `pickActiveClipboard` last-writer-wins; Cmd+C reads live `selectedCalloutIds`. Leftover **18** unchanged. Did **not** replay waves 5–13 / flatten / leftover-18. Goal stays open.

**Prior-pass (2026-08-21 thin leftovers):** three leftover clusters live-proven. Receipt `.planning/logic-audit-2026-08-20/fix-logs/thin-leftovers-2026-08-21.md`. Playwright `e2e-thin-leftovers.spec.mjs` **3 / 3**. Product: imported `/Text` sticky stamps `id`/`data.id` (`convertTextToFabricNote`). No Note create tool invented. Leftover **18** unchanged.

**Prior-pass (2026-08-21 later):** unique cluster **native PDF Link / URL / mailto / page-jump** live-proven. Receipt `.planning/logic-audit-2026-08-20/fix-logs/pdf-links-2026-08-21.md` + `fix-logs/e2e-pdf-links.md`. Playwright `e2e-pdf-links.spec.mjs` **1 / 1 (3.7s)**. Product: E2E-LINK-01 allowlist (`http:`/`https:`/`mailto:`) in `PdfjsLinkLayer`. No create/edit Link tool (not invented).

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**This wave does not claim the whole app is done.** Wave 5 live-tested leftover helper-only rows on reused Vite `http://localhost:5173` + `?testPdf=`. Receipt: `fix-logs/e2e-wave-remaining.md`. Hub leftovers (`hubPreview` templates, 1-dot tap, U-04, kal441 widgets): `fix-logs/e2e-hub-templates-leftovers.md`. U-04 archive-with-markers closed on `?hubPreview=1`: `fix-logs/e2e-u04-archive.md`. Did not stamp `file.id`.

**URL:** `http://localhost:5173/?testPdf=clickable-link-test.pdf` then `http://localhost:5173/?testPdf=text-search-glyph-lab.pdf`  
Vite was already on **5173** (`npm run dev:ui`); reused, not killed.

Matrix source: `FEATURE-MATRIX.md`  
**Feature rows:** 59

## Automated this wave (Node, no Electron)

| Catalog | What was proven |
|---|---|
| Font color picker | `firstPreset="none"` + `showOpacity={false}` on AppShell; mobile text color same |
| Stroke picker | Desktop + mobile pass `minOpacity=1` and Match Fill on the stroke tab |
| Callout | Blank discard; style patch (bold/italic/underline/strike/Georgia/dash); leader round-trip; export writes annotations |
| Zoom math | 10% floor; `zoomGeneration` still bumped at pdf.js zoom-start |
| Stroke/eraser sizes | All width presets clamp; draft rejects decimals/signs |
| Eraser policy | Pen ink → partial; rect → skip partial / entire |
| Shortcuts / tools | Overlay lists V ⇧V P H E T Q L A C, page nav, search, Escape |
| Form + checklist | `collectFormFieldValues`; archive flips `archived` |

**Focused suite this wave:** `tests/e2eWave3RemainingRows.test.mjs` + updated UI contract — **13 / 0 fail**.

## Row status

| ID | Feature | Status | Exact checks / window repro |
|---|---|---|---|
| V-01 | Pan | **pass** (window + narrow) | At overflow zoom, unlabeled Pan `btn-icon` drag moved `survey-pdfjs-viewer` scroll; annotation count unchanged. Pen drag at 100% created ink and did not change scroll. Fit-width 100% has no overflow (pan no-ops — expected). **Narrow 700×820:** More → Zoom in ×5 overflowed; named Pan moved scroll `284/403` → `565/633`. Receipt `fix-logs/e2e-unblocked-followup.md`. |
| V-02 | Select annotations | **pass** (window) | Stroke-click selects (center miss is stroke-hit). Shift-click: first select 8 handles, second kept group chrome (8 handles + 1 overlay). Marquee around two rects left a selection overlay. |
| V-03 | Select text | **pass** (window) | On `text-search-glyph-lab.pdf`, Select text ⇧V + drag on `.pdfjsTextLayer.is-interactive` selected `Text Sear`. Measurement `.textLayer` is off-screen (`x=-100000`) — do not target it. |
| V-04 | Zoom | **pass** (pinch + buttons) | W4-02 pinch stands. Wave 5: toolbar Zoom in/out + Fit page + Fit width changed the % readout. |
| V-05 | Page nav | **pass** (overlay) | ←/→ Home/End listed. **Window:** 1-page PDF ignores next; multi-page Home/End jump. |
| V-06 | Pages panel | **pass** (live thumbs) | jump page 3; 1-page next no-op; IntersectionObserver JPEG upgrade + long-doc scroll |
| V-07 | Bookmarks | **pass** (live drag) | dnd-kit reorder Alpha→bottom; clash toast; page 99 clamps; self-drop no-op |
| V-08 | Search | **pass** (Next + Previous wrap + result-row click + F3/Ctrl+G) | Wave6: Next wrap / no-match / Esc-clear. Prior: Previous + result-row click. This pass: F3 = Next, Shift+F3 = Previous, Ctrl+G / Ctrl+Shift+G same wrap. Overlay omits F3/G. Closed-bar / 0-hit no-op. F3 in a text annotation does not insert F3. Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. |
| V-09 | Shortcuts overlay | **pass** (overlay) | `?` lists tools; Escape owned by focus trap. **Window:** press `?` then Esc. |
| D-01 | Pen / ink | **pass** (window stroke + 1-dot tap) | True tap (down+up, no drag) on `?testPdf=clickable-link-test.pdf` committed path `268ff89b-…`. Intended: `createProductionPaperInk` keeps a 1-point centerline. Mid-zoom still W4 Zoom-in. |
| D-02 | Highlighter | **pass** (window freehand + print) | Text-highlight split menu is hidden (KAL-240). **Cmd+P** is base PDF (`withMarkup=false`). **Cmd+Shift+P** flattens regular marks: highlighter included (`fabric: 1`), survey-marker highlight excluded (`surveyMarkers: 1`). Receipt `fix-logs/e2e-unblocked-followup-2.md`. |
| D-03 | Eraser object | **pass** (window entire) | Partial over a rect skips. Full stroke erase of topmost user rect `e7413165…` removed only that id (19 → 18). |
| D-04 | Eraser ink | **pass** (window bite) | Fresh ink `d` 2954 → 1763 and split to 2 paths (partial). Follow-up full-stroke pass removed that ink (19 → 18). |
| D-05 | Stroke width | **pass** (presets) | all 12 width presets + clamp 1–100. **Window:** type `0` / `999` / `12.5` in the size field. |
| S-01 | Rectangle | **pass** (window + cloud + bump 1–20) | Live drag + Style → Cloud option then draw. Completeness: armed Dashed `6,4` / Dotted `2,4`. This pass: every integer **1–20** on `Cloud bump size` stores `pdfCloudIntensity`; 0→1 / 99→20 / letters rejected / empty→1. Local field, not leftover-18. Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. |
| S-02 | Ellipse | **pass** (window) | Live drag commit. |
| S-03 | Line | **pass** (window) | Live drag commit. |
| S-04 | Arrow + heads | **pass** (window + 6 heads + selected patch) | Live drag commit. Prior pass: all 6 armed-tool labels. This pass: deselect → reselect → V-shape / Open circle / None stored on `data.arrowheadStyle`. |
| S-05 | Counter | **pass** (window pin + series Delete + Size + Start) | `[data-counter-overlay]` drag-to-place. Prior: keyboard + Select-menu Delete **renumbers**. This pass: Size catalog **5…64** + clamp 4–76; Start 10 / lock after second pin. Receipt `fix-logs/counter-size-start-2026-08-21.md`. UL-31 Continue pin not replayed. |
| T-01 | Textbox create/edit | **pass** (live edit) | Overlay drag mounts editor; type + click-out commits. Escape discards a new box. |
| T-02 | Callout create/edit | **pass** (live edit) | Q-drag mounts `[data-text-edit-overlay] [contenteditable]` (auto-focused). Typed text; Bold 700; Font Georgia. Blank discard on empty tool-switch still intended. |
| T-03 | Font family | **pass** |  |
| T-04 | Font size | **pass** (all 18 + mobile clamp) | All 18 presets 8…72. Desktop has no numeric field (dropdown only; typing `13` adds no option). Real custom control is mobile `textbox "Font size"` at 390×844: `1`/`0` → 6, `999` → 200, `48` commits 48. |
| T-05 | Bold/italic/underline/strike | **pass** | live Bold / italic / strike prior; this pass Underline `aria-pressed=true` while editing. |
| T-06 | Alignment 3×3 | **pass** (all 9 live) | All 9 `top\|middle\|bottom` × `left\|center\|right` cells clicked. Justify not offered. |
| T-07 | Font color | **pass** | opaque picker (no transparent, no slider) |
| C-01 | Preset grid | **pass** |  |
| C-02 | Hex field | **pass** |  |
| C-03 | Opacity | **pass** (live % + slider) | Opacity field set to 55 on a selected rect. This pass: fill-picker `range` → 40, Transparent disables slider, `#FF0000` re-enables. Electron leftover. |
| C-04 | Spectrum HSV | **pass** (live drag + leave/re-enter) | Color → Color spectrum. SV drag set valuetext `Saturation 96%, brightness 50%`; hue track drag set `aria-valuenow` 352. This pass: pointer left SV (`Saturation 0%, brightness 100%`) then re-entered (`85% / 80%`). Pointer-capture keeps the drag. |
| C-05 | Fill/stroke/font sites | **pass** (live click + counter) | Fill `#FF0000` + Border `#0000FF` on a rect. Counter **Fill** vs **Number**: pin fill `#FF0000`, number `#0000FF` then `#FFFFFF` without clobbering fill. |
| C-06 | Match Fill | **pass** | desktop + mobile stroke tab |
| E-01 | Resize | **pass** (live drag) | br/tl/tr/bl/mr/ml/mb changed bbox. `mt` failed when the handle sat under top chrome (y≈67); same handle worked on a lower rect (h 182→203). |
| E-02 | Rotation | **pass** (live drag + Shift 45°) | W4-01 stem hit. Numeric: ArrowUp = +1°, Shift+ArrowUp = +45°. Handle Shift-drag near 44° snaps to 45°; far angle 23° stays 23° (soft 3° threshold). |
| E-03 | Move | **pass** (clamp) | page clamp. **Window:** drag a rect off-page; multi-select drag. |
| E-04 | Delete | **pass** (window) | After blur, Backspace removed selected user rect. No-ops while Width/zoom INPUT is focused (documented focus guard). |
| E-05 | Undo / redo | **pass** (window cross-tool) | Pen then rect; toolbar Undo×2 then Redo×2 restored the count. Foreign collab undo still needs two clients. |
| E-06 | Context menu | **pass** (owned live) | UL-27–31: chrome right-click suppressed; empty page Paste-only; owned rect Cut/Copy/Paste + z-order; Continue pin re-arms Counter. Callout z-order still omitted by design. |
| X-01 | Cloud save | **helper-only / blocked** | Outbox view-model. Live identity-churn still needs a signed-in cloud user whose session identity changes. Chip correctly hidden on `?testPdf=`. |
| X-02 | Export annotated PDF | **pass** (download) | Live Export button started a `.pdf` download. |
| X-03 | Print flatten | **pass** (Cmd+P) | Custom panel off (`PRINT_PANEL_ENABLED=false`). Cmd+P logs `[PrintPanel] OPEN` and uses the blob-iframe path. Native dialog leftover. |
| X-04 | Import | **pass** (live fixture) | `kal412-mixed-import-e2e.pdf` mounted ≥1 `isPdfImported`. |
| X-05 | Form fields | **pass** (live widgets) | `kal441-form-fields.pdf` `.pdfjsFormLayer` rendered **8** widgets (2 text, textarea, checkbox, 3 radios, select). Typed `wave-form`; value stuck after blur. Select/pan required. Prior 0-widget count was a race / wrong wait, not a missing fixture. Cloud persist still needs a saved doc. |
| X-06 | Excel | **pass** (live export) | `e2e-helper-only-live.spec.mjs`: Survey → KAL-436 → Walls → EXPORT downloaded `KAL-436_Preservation_Template_export.xlsx`. No `file.id`. Live sheet writeback / Excel host still blocked. |
| U-01 | Survey rail | **pass** (live stamp) | `?surveyTransitionE2E=1` → KAL-436 template → Walls → `[data-survey-marker-id]`. |
| U-02 | Spaces / regions | **pass** (create + rename + pages) | Spaces tab + **Create space** on `?testPdf=` (no `file.id`). Completeness: rename Hunt Space; page `99` rejected; page `1` adds a region. Cloud space sync still needs a saved doc. |
| U-03 | Templates | **pass** (hubPreview editor) | `/?hubPreview=1&tab=templates`: create `Template 3`, rename+Save, blank-rename no-op (E2E-HUB-01), delete `Template 4`. Empty fixture create. Cloud archive host still unused on this route. |
| U-04 | Checklists | **pass** (hubPreview archive-with-markers) | `/?hubPreview=1&tab=templates` Security Walk-Through → Cameras. Used item `i1` (usage 3) opens `archive-confirm-modal` (“3 survey markers have…”) + Cancel/Archive. Cancel leaves the item. Archive moves it to `archived-items-c1`. Unused `i2` hard-deletes with no modal. HubPreview now passes `getChecklistItemUsageCount` (static seed on existing mock ids). `?testPdf=` rail still has no Archive-item control — KAL-44 is TemplatesEditor. |
| A-01 | Sign in | **pass** (live guest chrome) | `e2e-helper-only-live.spec.mjs` on `/?hubPreview=1&guest=1`: Sign in + AuthModal. Empty/human gate without a captcha token; signup mismatch; Continue without an account. Live Turnstile password login still blocked. |
| A-02 | Microsoft / OneDrive | **pass** (live Connect chrome) | Settings → Connected services → Microsoft Connect fails closed (`Preview cannot start Microsoft login`). Live MSAL still blocked. |
| A-03 | Invites + roles | **pass** (live mint) | Viewer/Editor/Owner (no Commenter); invalid email. Signed-in Copy-link mint: `e2e-signed-in-leftovers.spec.mjs` `SHARE_MINT` minted (no fake URL). Live email delivery still blocked. |
| A-04 | Account settings | **pass** (live hubPreview) | General / Connected / Subscription; Edit profile empty-required; password mismatch; DELETE confirm; Sign out closes. Live OAuth/wipe still blocked. |
| A-05 | Billing | **pass** (live catalog) | Usage + Manage subscription; Pro/Enterprise cards; Start trial visible (not clicked); Contact sales. Live Stripe Checkout still blocked. |
| A-06 | Collab presence | **pass** (self row + same-user two-tab) / **blocked** (roster) | Signed-in real doc **just you**. Same auto-login, two tabs + two contexts on one UUID doc (`e2e-two-tab-presence.spec.mjs`): both idle, one drawing, and after close all stayed **just you**. UI did not claim `2 viewing`. Exact blocker: presence upserts `document_id,user_id,client_type=app` then `PresenceAvatars` dedupes by `user_id`. Live two-client roster still needs a second signed-in collab account. Receipt `fix-logs/e2e-two-tab-presence.md`. |
| A-07 | Revisions | **pass** (local + cloud events + named restore) | `?testPdf=` jump + delete-restore. Signed-in named restore: `e2e-named-revision-restore.spec.mjs` — Save version v8, cancel restore kept mark2, restore v8 dropped mark2 (9→8), named row still listed. Receipt `fix-logs/e2e-named-revision-restore.md`. |
| P-01 | Mobile sheets | **pass** (finger-follow) | 390×844 proxy. Handle tracks then spring-back; 90px dismisses. touchcancel stranded — E2E-CHROME-04 |
| P-02 | Mobile text formatting | **pass** (catalog) |  |
| P-03 | Electron menus | **pass** (File menu) | File shows Open / Export / Print / Print+annot. Print click: `targetWindow alive: true`. |
| P-04 | Tool keybindings | **pass** (live arm + C + matrix + F3/G find) | P→Pen, H→Highlighter, E/⇧E→Partial erase, T→Text, Q→Callout, L→Line, A→Arrow. V / ⇧V do not set `btn-active` labels (Select is unlabeled `btn-icon`); ⇧V still enabled text-select. **C** arms `[data-counter-overlay]`; C while Zoom % focused is ignored. Matrix: Delete, Ctrl+]/[, Ctrl+F, Esc overlay; Ctrl+D invents nothing. **Ctrl+G is bound as find Next** (not Group — Group stays compile-hidden). This pass: F3 / Shift+F3 / Ctrl+G / Ctrl+Shift+G. Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. |

## Live-window checks this wave

| Check | Result |
|---|---|
| E2E-W2-02 continuous spectrum drag | **pass** |
| E2E-W2-03 resize handles | **pass** (8/8 when not under chrome) |
| E2E-W2-03 rotation drag | **pass** — W4-01 fixed |
| E2E-W3-01 Q-tool callout create | **pass** (overlay + type + Bold/Georgia) |
| V-01 pan | **pass** (overflow only) |
| V-02 marquee / Shift-click | **pass** |
| V-03 ⇧V | **pass** |
| V-04 pinch | **pass** — CDP two-touch; cancel commits preview; lift → pinch-release; mid-ink pinch discards |
| V-08 Find wrap | **pass** (Next wave6 + Previous + result-row click) |
| E-04 Backspace | **pass** (after blur) |
| E-05 undo/redo | **pass** |
| A-07 revisions | **pass** (W4-03 local History + named cloud restore) |
| A-07 jump + delete-restore | **pass** — W5-01 |
| Cross-page paste (rect/ellipse/pen/text + **callout** + break/edge) | **pass** — `e2e-thin-leftovers.spec.mjs` (callout clone hard-pass) + `e2e-callout-paste.spec.mjs`. Last-copied wins: copy callout then paste on page M mints a new `callout-…` with leader/text intact. Receipt `fix-logs/callout-cross-page-paste-2026-08-21.md` |
| Pages Duplicate execute (incl. annotations + armed + History Restore + undo wipe) | **pass** — same spec; first/last Duplicate; Undo disabled after page-structure |
| Imported sticky chrome | **pass** (proxy + click-through) / **compile-hidden** (create-Note + no SVG popup). Fixture `e2e-sticky-note.pdf`. |
| Remaining tools / zoom / export / print / survey stamp | **pass** — `e2e-wave-remaining.spec.mjs` 8/8 |
| Hub leftovers (U-03 / D-01 tap / U-04 / X-05) | **pass** — leftovers 4/4; U-04 full path `e2e-u04-archive.spec.mjs` 1/1 |
| Helper-only leftovers (A-01–05 / X-06 / UL-13–22/24/46) | **pass** — `e2e-helper-only-live.spec.mjs` 5/5. UL-44 Retry flush now live (`e2e-outbox-retry.spec.mjs`). Same-user two-tab presence live (`e2e-two-tab-presence.spec.mjs`) — still **just you**. X-01 identity-churn, A-06 two-client roster still blocked. |
| UL-27–31 context menu + U-02 Create space | **pass** — `e2e-context-menu-spaces.spec.mjs` 3/3 |
| Eraser partial ink / full-stroke ink | **pass** |
| Eraser entire rect | **pass** (topmost only) |
| P-04 tool keys | **pass** (see row) |
| A-06 same-user two-tab / two-context | **blocked** (roster) — both stayed **just you**; not a second account |
| Unblocked catalog leftovers (T-04/T-06/C-03/C-04/S-04/P-04/V-01) | **pass** — `e2e-unblocked-followup.spec.mjs` 6/6 |
| Unblocked leftover edges (T-04 clamp / E-02 Shift+45° / D-02 print / C-05 counter colors / S-04 selected patch) | **pass** — `e2e-unblocked-followup-2.spec.mjs` 5/5 |
| Catalog completeness (hub docs/projects/archive + spaces extras + UL-33 dash) | **pass** — `e2e-catalog-completeness.spec.mjs` 5/5. Receipt `fix-logs/e2e-catalog-completeness.md`. Did **not** cover hub Copy/Paste/Duplicate/Move/Sort/Preview. |
| Catalog reconcile hub extras (Copy/Paste / Select Duplicate / Move/Copy / Sort / Preview) | **pass** — `e2e-hub-docs-extras.spec.mjs` 1/1 (1.7s). Receipt `fix-logs/catalog-reconcile-2026-08-21.md`. Cluster GAP **0**; per-swatch still open until pickers pass. |
| Pickers every swatch / font / format / handles | **pass** — `e2e-pickers-every-swatch.spec.mjs` 5/5 (32.6s). Receipt `fix-logs/pickers-every-swatch-2026-08-21.md`. Per-value GAP **0**. |
| Keyboard shortcut matrix (Delete / Ctrl+]/[ / Ctrl+F / tool letters / Esc / no Duplicate) | **pass** — `e2e-keyboard-shortcut-matrix.spec.mjs` 1/1 (4.2s). Overlay omits Delete/Duplicate/z-order rows; keys still live. Group/Ungroup stay compile-hidden. Receipt `fix-logs/keyboard-shortcut-matrix-2026-08-21.md`. |
| Search Previous remainder (walk / wrap / X+Esc / 0+1-hit / literal / armed / focus) | **pass** — `e2e-search-previous.spec.mjs` 1/1 (1.1m) on glyph-lab `Helvetica` 12 hits. No case-toggle. Receipt `fix-logs/search-previous-2026-08-21.md`. |
| Search result-row click (list jump / same-row / later page / 0+1-hit / armed) | **pass** — `e2e-search-result-click.spec.mjs` 1/1 (33.4s). Mid `7 of 12`; last Page 3; later-page index 6 → Page 2. Receipt `fix-logs/search-result-click-2026-08-21.md`. |
| F3 / Ctrl+G find aliases | **pass** — `e2e-f3-find-aliases.spec.mjs` 1/1 (20.7s). Overlay omits F3/G. F3/Ctrl+G Next, Shift+F3/Ctrl+Shift+G Previous, wrap, closed-bar / 0-hit no-op, in-text swallow (match still walks). Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. |
| Counter-series Delete execute | **pass** — `e2e-counter-series-delete.spec.mjs` 1/1 (5.2s). Keyboard + Select-menu Delete **renumbers**; first/middle/last + undo; Pen-armed still deletes; series-list Delete + confirm wipes. UL-31 Continue pin not replayed. Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. |
| Cloud bump every integer 1–20 | **pass** — `e2e-cloud-bump-1-20.spec.mjs` 1/1 (5.4s). Local UL-34 field. 1…20 stored; path 1 vs 20 changed; 0→1 / 99→20 / letters rejected. Not leftover-18. Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. |
| Counter Size catalog + Start number | **pass** — `e2e-counter-size-start.spec.mjs` 1/1 (7.5s). Size presets 5…64; clamp 4–76; Start 10 / letters/0/empty→1; second pin 7→8; Start locks. Not D-05 Width. Receipt `fix-logs/counter-size-start-2026-08-21.md`. |

W3-01 was a harness miss (`contenteditable`, not textarea). W4-02 true two-finger pinch proven via Chrome CDP (see `fix-logs/w4-02-pinch.md`). Toolbar Zoom-in remains the zoomGeneration ink-commit proof; live pinch mid-ink discards. Wave 5: `fix-logs/e2e-wave-remaining.md`. Unblocked follow-up: `fix-logs/e2e-unblocked-followup.md`. Leftover edges: `fix-logs/e2e-unblocked-followup-2.md`.

## Next waves (not done)

Named cloud restore closed (`fix-logs/e2e-named-revision-restore.md`). Same-user two-tab presence proven **just you** (`fix-logs/e2e-two-tab-presence.md`) — two-client roster still needs a second account. Electron/native Capacitor. Live Stripe / MSAL / applied migrations. Identity-churn still blocked. U-04 cloud usage count still needs Dashboard + Supabase (hubPreview uses the existing SurveyHub callback with a static seed). Hub leftovers wave: `fix-logs/e2e-hub-templates-leftovers.md`. U-04 receipt: `fix-logs/e2e-u04-archive.md`. The app is not done.
