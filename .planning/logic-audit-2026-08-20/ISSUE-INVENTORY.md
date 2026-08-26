# Logic-audit issue inventory

Written: 2026-08-20 · Wave 1 foundation  
**This-pass (2026-08-26 selected-callout Color swatch Fill / Border Opacity as-is):** not leftover-18. Live Color Fill / Border already offered 0–100 and persist / export / flatten / page view already honored the 0–1 value, but `PDFViewer` selected-callout toolbar swatch floored `Math.max(..., 0.08)` / `Math.max(..., 0.2)` so a selected Fill of 0–7 or Border of 0–19 painted a ghost 8% / 20% until the picker was re-touched. Product `3f10d86c`. Receipt `fix-logs/callout-toolbar-swatch-opacity-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Callout Fill Opacity below 8% as-is on screen):** not leftover-18. Live Color Fill Opacity already offered 0–100 and persist / export / flatten already honored the 0–1 value, but view / spec / PAL floored `Math.max(..., 0.08)` so a next-draw Fill of 0–7 painted a ghost 8% until Fill was re-touched. Product `02d8a8a8`. Receipt `fix-logs/callout-fill-opacity-screen-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Eraser Size persist):** not leftover-18. Live Eraser Type already persisted, but Size stayed session-only so remount dropped first swipe to diameter 20 until Size was touched. Product `53d63a7c`. Receipt `fix-logs/eraser-size-persist-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 filled paper-ink flatten fill):** not leftover-18. Live Highlighter / Pen Color Opacity already rode rgba `fill` + export Ink `/CA`, but print flatten stroked the outline hex-only (black 1pt). Product `4877404f`. Receipt `fix-logs/ink-flatten-fill-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Text Fill after sibling persist):** not leftover-18. Text prefs omitted `fillColor` / `fillOpacity` so Callout white / 90 and Counter badge red leaked into the Text Color swatch until Fill was touched. Product `63792671`. Receipt `fix-logs/text-fill-after-sibling-2026-08-26.md`. First-create box fill stays empty — not invented. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Arrowhead after sibling persist):** not leftover-18. Session-shared `arrowheadStyle` leaked Callout V-shape into Arrow and Arrow Open circle into Callout until Arrowhead was touched. Product `742dc241`. Receipt `fix-logs/arrowhead-after-sibling-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Style dash after sibling persist):** not leftover-18. Session-shared `lineBorderStyle` leaked Callout / Rect Dashed into Text / Ellipse until Style was touched. Product `c082fc76`. Receipt `fix-logs/style-dash-after-sibling-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Counter Number color opacity export):** not leftover-18. Live Counter Number Opacity already rode rgba `data.numberColor` + flatten; export Circle `/AP` painted the label hex-only after the Fill `/ca` reset so a faded Number reached Acrobat opaque. Product `4562beb2`. Receipt `fix-logs/counter-number-color-opacity-export-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-26 Textbox first-create Style persist):** not leftover-18. Live Text Style already rode selected-patch `strokeDashArray`; first-create used envelope null so next-draw Dashed never persisted until Style was re-touched. Product `45acb83d`. Receipt `fix-logs/textbox-first-create-dash-2026-08-26.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Goal stays open.

**Prior-pass (2026-08-25 receipts-comment product bugs a/b/c):** not leftover-18. Fixed the three product bugs inventoried from comment `5414370572`: (a) usage document count now excludes `archived` / `user_archived_at`; (b) `?docId=` resolves the invite row and revoke voids matching invites; (c) profile first/last can clear to blank. Receipts in `fix-logs/archive-count-2026-08-25.md`, `invite-deeplink-2026-08-25.md`, `profile-name-clear-2026-08-25.md`. Leftover-18 host-proved / human-gated table unchanged. Did **not** write a 103-ID refresh. Did **not** hunt. Goal stays open.

**Prior-pass (2026-08-25 leftover-18 owner-local receipts fold):** leftover-18 table only. Receipt source PR 800 comment `5414370572`. **Host-proved:** X-01, X-05, U-04, UL-13, A-06 / UL-45. **Still human-gated:** A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. New product bugs from that comment (not leftover-18; not claimed fixed here): (a) archived documents still count toward the free-tier 5-document cap; (b) invite `?docId=` false already-accepted + remove-collaborator leaves invite rows; (c) profile first/last cannot clear to blank. Did **not** write a 103-ID refresh. Did **not** hunt. Goal stays open.

**Evidence refresh:** 2026-08-23c completion-audit refresh (`fix-logs/completion-audit-refresh-2026-08-23c.md`). Reclassified all 96 unique IDs + leftover-18 against current tree after product SHAs (callout strip-on-import `aeeed41c`, line Restore near-zero, Counter `data.id` Delete + remapped `data.left`) and dedicated leftovers (CCW/180 persist, form persist + `mtr` CCW, remapped `mtr` after page 180, page-2-only rotate). Prior `60e2c706` / `372988cd` refresh is stale. Tree inspect: X-01 names **PRESENT**; process env absent; no lease + no `file.id`. **96 proved / 0 stomped / 0 weak / 0 missing.** Leftover-18 still **18** fail-closed local + **18** host-gated. Headline extras P2-34/P2-35 stay **6 proved**. Stomps P1-12 / P1-38 / P1-53 still live. Citation drift: P1-15 `:32549`; P1-09 `:24126`; P1-16 `:28700`; P2-34(b) `:23867`. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim leftover-18 GAP = 0. Did **not** claim leftover-18 proved.

**Prior evidence refresh:** 2026-08-23b completion-audit refresh (`fix-logs/completion-audit-refresh-2026-08-23b.md`). Reclassified all 96 unique IDs + leftover-18 against tip `372988cd` after the remapper / leftover-portrait / History-restore / form-widget campaign. Prior `43cefd4f` / `4ab0be92` refresh is stale. Tree inspect: X-01 names **PRESENT**; process env absent; no lease + no `file.id`. **96 proved / 0 stomped / 0 weak / 0 missing.** Leftover-18 still **18** fail-closed local + **18** host-gated. Headline extras P2-34/P2-35 stay **6 proved**. Stomps P1-12 / P1-38 / P1-53 still live. Focused Node **116 / 116**. Citation drift: P1-15 `:32545`; P1-38 `:338`; P1-49 `:7370`; viewBox `:4681`. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim leftover-18 GAP = 0.

**Prior evidence refresh:** 2026-08-23 completion-audit refresh (`fix-logs/completion-audit-refresh-2026-08-23.md`, `43cefd4f` / `4ab0be92`). Reclassified all 96 unique IDs + leftover-18 after the live-create + selected-transform families. **Stale** after the remapper / leftover-portrait / History-restore / form-widget campaign. **96 proved / leftover-18 18 host-gated.** Focused Node **110 / 110**.

**Prior evidence refresh:** 2026-08-23 T-01 live Textbox rubber-band then auto-edit mount intended+break+edge (`fix-logs/textbox-live-create-2026-08-23.md`). In-drag `[data-text-preview]` (10px dashed gate) + pointerup `isNewText` + zoom keep-track on `?testPdf=` (no `file.id`). Prior T-01 auto-edit / selected resize not replayed. Cloud has no dedicated tool. Counter window pin already receipted. No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-23 T-02 live Callout rubber-band then commit intended+break+edge (`fix-logs/callout-live-create-2026-08-23.md`). In-drag `.callout-preview` (CREATE-01 dashed `5,5`) + pointerup 4px gate + zoom keep-track on `?testPdf=` (no `file.id`). Prior T-02 knee / corners / arrowhead catalogs not replayed. No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-23 S-03 / S-04 live Line/Arrow rubber-band then commit intended+break+edge (`fix-logs/line-arrow-live-create-2026-08-23.md`). In-drag `line.shape-creation-preview` (CREATE-01 dashed `5,5`) + pointerup 3pt gate + zoom keep-track on `?testPdf=` (no `file.id`). Callout `.callout-preview` is a different path. No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-23 S-01 / S-02 live rect/ellipse rubber-band then commit intended+break+edge (`fix-logs/shape-live-create-2026-08-23.md`). In-drag `.shape-creation-preview` + pointerup 2pt gate + zoom keep-track on `?testPdf=` (no `file.id`). Line/arrow dashed create is a different path. No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-23 D-01 selected Pen / Highlighter bbox resize + canvas `mtr` intended+break+edge (`fix-logs/ink-resize-rotate-2026-08-23.md`). Affine/scale + `sourceWidth` hold + flip + free 90°/180° on `?testPdf=` (no `file.id`). Counter has no separate bbox/`mtr`. Keyboard nudge is not wired. Insert image / stamp create has no path. No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-23 S-01 selected Cloud bbox resize + canvas `mtr` intended+break+edge (`fix-logs/cloud-resize-rotate-2026-08-23.md`). Path rebuild + intensity hold + flip + free 90°/180° on `?testPdf=` (no `file.id`). Callout bbox/`mtr` is not live. No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 E-03 selected-annotation move intended+break+edge (`fix-logs/annotation-move-2026-08-22.md`). Single + group-move + clamp on `?testPdf=` (no `file.id`). No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 T-01 textbox create auto-edit intended+break+edge (`fix-logs/textbox-create-edit-2026-08-22.md`). Type / click-out / blank / Escape / tight-fit / wrap / re-edit on `?testPdf=` (no `file.id`). No product bug. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **25 / 25**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 E-02 RotationInputField intended+break+edge (`fix-logs/rotation-input-field-2026-08-22.md`). Type / blur / wrap / Escape on `?testPdf=` (no `file.id`). Ctrl+A now clears the pill. P1-32 hold-arrow not replayed. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 C-06 Match Fill intended+break+edge (`fix-logs/match-fill-2026-08-22.md`). Opacity lock + missing-fill one-visible on `?testPdf=` (no `file.id`). P1-38 ring not replayed. Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 UL-07 page number field intended+break+edge (`fix-logs/page-number-field-2026-08-22.md`). Escape skip-commit + live field on `?testPdf=` (no `file.id`). Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still need lease + `file.id`. Playwright **2 / 2**. Node **15 / 15**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 ?testPdf= local save / reload-restore (`fix-logs/testpdf-local-save-reload-2026-08-22.md`). Fidelity audit: pickers wrote the local cache but never reloaded. Live-proved intended+break+edge on `?testPdf=` (no `file.id`). Cloud save / identity-churn stays leftover-18 **X-01**. Hosts still **absent**. Playwright **1 / 1**. Node **3 / 3**. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 completion-audit refresh (`fix-logs/completion-audit-refresh-2026-08-22.md`). Reclassified all 96 unique IDs + leftover-18 against the current tree after Continue pin / Continue Count / Print fail-closed / compile-hidden / official contract alignments / leftover-18 host-bundle. **96 proved / 0 stomped / 0 weak / 0 missing.** Leftover-18 still **18** fail-closed local + **18** host-gated. Hosts still **absent**. Focused Node **107 / 107**. Did **not** invent hosts. Did **not** hunt. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 leftover-18 host-bundle (`fix-logs/leftover18-host-bundle-2026-08-22.md`). Re-inspected env as authoritative. `.env.local` / process auto-login / Stripe / MSAL / Turnstile / lease files still **absent**. Cursor cloud environment **null**. X-01 **not** live-proved. Official next fail-stop is isolated **8448**. Cap not loosened. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 independent Search-open hunt after keepActive (`fix-logs/after-keepactive-independent-search-hunt-2026-08-22.md`). Last hunt missed Search; this pass opened it (V-08 dedicated; no Match case / Whole word). No unique unblocked leftover. Official next fail-stop is isolated **8448** (`partialEraserComplexity` crossing500 allocation `12283.13 MiB`). Cap not loosened. X-01 hosts still **absent**. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 surveyKeepActive official notes chrome contract (`fix-logs/survey-keepactive-notehascontent-2026-08-22.md`). Add/Edit item notes keys off intended `noteHasContent` (photos/videos count). Official next fail-stop is isolated **8448** (`partialEraserComplexity` crossing500 allocation `12283.13 MiB`). Cap not loosened. X-01 hosts still **absent**. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 empty-module Create template official contract (`fix-logs/survey-empty-create-template-contract-2026-08-22.md`). Walls belongs to the Two Category sibling seed; empty-module stays `categories: []`. Official next fail-stop is `surveyKeepActive` stale `noteHasContent`. X-01 hosts still **absent**. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 UL-35 toolbar Continue Count (`fix-logs/continue-count-toolbar-2026-08-22.md`). Cluster-only series-row switch now has intended+break+edge. Barrier contract matched Projects `[ref, trigger]`. X-01 hosts still **absent**. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 compile-hidden tools hunt (`fix-logs/compile-hidden-tools-2026-08-22.md`). Stamp / measure / Group / Extract / Note-Link / Forms are compile-hidden or zero callers — **no** Print-class reachable fail-closed chrome. X-01 hosts still **absent**. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 host probe + Print fail-closed (`fix-logs/host-probe-2026-08-22.md`, `fix-logs/print-panel-failclosed-2026-08-22.md`). X-01 hosts **absent**. 96 unique IDs still **proved**. Leftover-18 still **18** fail-closed local + **18** host-gated. Print custom panel stays compile-hidden; reachable blob/OS path now has a dedicated fail-closed slice (not leftover-18). Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-22 requirement-by-requirement completion audit (`fix-logs/completion-audit-2026-08-22.md`). 96 unique IDs still **proved**. Stomp one-liners P1-12 / P1-38 / P1-53 still live. Leftover-18 still **18** fail-closed local + **18** host-gated. Did **not** mark `/goal` complete. Did **not** re-claim unblocked GAP = 0.

**Prior evidence refresh:** 2026-08-21 leftover-18 legal unblock + save/export/import inventory.

Sources: `REPORT.md` + `known-bugs-deep-dive.json` (103 headline / **96 unique IDs**)

**This-pass (2026-08-21 leftover-18 unblock):** maximum legal proof for each leftover-18 item. **0** unblocked-and-proven. **18** partial (fail-closed / local slice). **0** still-blocked with no slice. None moved out of leftover-18. `.env.local` / `.env.test` / `.bot-credentials.json` / Docker missing — no invented tokens, no prod SQL, no lease guess. Receipt: `fix-logs/leftover18-unblock-2026-08-21.md`. Node `tests/leftover18FailClosed.test.mjs` **12 / 12**. Live `e2e-leftover18-save-export.spec.mjs` **5 / 5**. Goal stays open.

**Prior-pass (2026-08-21 status refresh):** grepped every unique ID’s product symbol + test/fix-log. Prior inventory still listed most rows as wave-1 `open` after later waves had closed them — that was **stale bookkeeping**, not a reopen. No silent stomps of P1-12 / P1-38 / P1-53 or the leftover-18 park list. **0** restores. Leftover **18** stay parked. Receipt: `fix-logs/audit-status-refresh-2026-08-21.md`.

Did **not** replay leftover-18, waves 5–13, flatten, survey-marker, pages menu, History restore, PDF-link ftp, thin leftovers, callout last-writer, hub extras, or every-swatch pickers.

## Count reconciliation

| Source | Claimed | Canonical unique IDs in this inventory |
|---|---|---|
| Pass 1 (incl. 2 known bugs) | 58 | **57** = KB-1 + KB-2 + P1-01…P1-55 |
| Pass 2 | 45 | **39** = P2-01…P2-39 |
| **Headline total** | **103** | **96 unique issues** |

**Why 103 ≠ 96.** The synthesis headline counts *pre-fold / pre-merge* auditor tickets:

- Pass 1 “58” includes the z-order finding both as known-bug 2.2 **and** as a later “z-order persistence” ticket that REPORT.md then folded into KB-2. Unique after fold: 57.
- Pass 2 “45” expands two merged composites: P2-34 (3 shortcut tickets) and P2-35 (3 mobile-sheet tickets). Unique IDs: 39. Expanded sub-defects: 39 − 2 + 6 = 43. Remaining +2 vs 45 is undocumented double-count in the pass-2 rollup (no additional unique defect text exists).

**This inventory is the source of truth: 96 unique issues.** Known-bugs JSON contributes **no extra IDs** — it is the deep-dive for KB-1 and KB-2 only.

### This-pass status counts (96 unique + leftover-18 E2E)

| Status | Count | What it means |
|---|---|---|
| **proven** | **96** | All unique REPORT IDs: product symbol + test or fix-log still on disk |
| **stomped** | **0** | No previously-landed one-liner missing |
| **stomped-restored** | **0** | No restore this pass |
| **weak** | **0** | No symbol-only / leftover-matches-original-defect rows |
| **missing** | **0** | No vanished symbols |
| **leftover-18** | **18** | Parked E2E host paths (not original 96 IDs). Keep parked. |

SQL **apply** leftovers on already-proven IDs (do not apply to prod Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29. Those stay **proven** in-tree.

---

## Status legend

- `proven` — product symbol still present; cited file:line + test or fix-log
- `stomped` — previously landed fix missing from the product tree (restore required)
- `weak` — symbol present but leftover still matches the original defect
- `missing` — symbol gone; no restore yet
- `leftover-18` — parked host path (captcha / Stripe / MSAL / inbox / roster / persist / writeback / native pick). Do not fake.

**User-visible** = a person can hit it in the running product without opening DevTools/tests.
**Test-only** = dead code, comment drift, or a path only a test/harness can reach.

---

## High-risk serialization (do not parallelize)

These files are load-bearing. Any two workers that both write them **must be serialized**.

| File | Risk |
|---|---|
| `src/PDFViewer.jsx` | Highest — ~34k lines |
| `src/PageAnnotationLayer.jsx` | Legacy canvas path |
| `src/components/FabricEraserCanvas.jsx` | `zoomGeneration` contract |
| `src/components/SVGAnnotationLayer.jsx` | SVG viewBox owns zoom |
| `src/viewerShared.js` | Imported by both big files |
| `package.json` / `vite.config.js` | Infra |

This refresh did **not** edit high-risk files.

---

## Leftover-18 (not original 96 IDs)

`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

This-pass leftover-18 (2026-08-25 owner-local receipts fold; source PR 800 comment `5414370572`). Fail-closed local slices stay in `fix-logs/leftover18-unblock-2026-08-21.md`. Do **not** replay host-proved slices from this VM.

| ID | Verdict | Host |
|---|---|---|
| X-01 | **host-proved** via owner-local receipt | identity-churn on leased bot-1 → bot-2; `file.id` real. Comment `5414370572`. |
| X-05 persist | **host-proved** via owner-local receipt | cloud persist on real `file.id`. Same comment. |
| X-06 writeback | **human-gated** | live sheet host / MSAL / Graph |
| U-04 cloud | **host-proved** via owner-local receipt | Dashboard + Supabase meter on leased bots. Same comment. |
| A-01 Turnstile | **human-gated** | live captcha completion |
| A-02 MSAL | **human-gated** | live MSAL / Graph login |
| A-03 / UL-24 inbox | **human-gated** | live email delivery |
| A-05 / UL-20 Stripe | **human-gated** | live signed-in Checkout |
| A-06 / UL-45 roster | **host-proved** via owner-local receipt | two signed-in accounts on one document. Same comment. |
| UL-03 | **human-gated** | native Electron pick/cancel |
| UL-13 | **host-proved** via owner-local receipt | real `updateProfile` persist. Same comment. |
| UL-15 | **human-gated** | live Turnstile password change |
| UL-16 | **human-gated** | live account wipe (not authorized) |
| UL-21 | **human-gated** | live MSAL |
| UL-22 | **human-gated** | live Google OAuth |

---

## All unique IDs (96)

Columns: id · title · status · evidence (current `file:line` + test / fix-log)

### Known bugs

| ID | Title | Status | Evidence |
|---|---|---|---|
| KB-1 | Eraser deletes everything it touches (no ink-only / no topmost) | **proven** | `src/utils/eraserPolicy.js:64-66` `getEraserOperation` → `'skip'` when not `isPartialEraseEligible`; `pageSpaceEraser.js:1096` honors skip; `surveyMarkerEraser.js:68`. Engine `erasePageAnnotations({mode:'entire'})` all-hits is **intentional**; live planner is topmost-only. `tests/eraserPolicy.test.mjs`; `fix-logs/eraser-policy-entire-mode.md` |
| KB-2 | Bring-to-front/back does not persist | **proven** | `src/utils/annotationZOrder.js:5-9,124,147` `data.zOrder` + `resolveAnnotationIndexById`; `annotationDocStore.js:601` read sort. `tests/annotationZOrder.test.mjs` |

### Pass 1 — CRITICAL / HIGH

| ID | Title | Status | Evidence |
|---|---|---|---|
| P1-01 | Drawn/edited line/arrow exports and prints at wrong page position | **proven** | `pdfAnnotationsPdfLib.js:2362` `createLineAnnotation` + `:3144` `drawFlattenedLine` use `getLineEndpoints`; flatten `:3351` does not re-add `left`. `tests/lineArrowEndingExport.test.mjs`; `tests/legacyArrowGroupExportPosition.test.mjs`; `fix-logs/e2e-adversarial-wave8.md` |
| P1-02 | Arrowheads silently dropped on export | **proven** | `pdfAnnotationsPdfLib.js:2515` `resolveExportedLineEnding2` maps `arrowheadStyle` / `tool:'arrow'` → `/LE`. `tests/lineArrowEndingExport.test.mjs`; `fix-logs/e2e-stomp-nine-live.md` |
| P1-03 | Cloud rectangle borders permanently lost on export | **proven** | `pdfAnnotationsPdfLib.js:1797` `/BE` intensity + `:3408` `buildCloudPathCommands`; `pdfAppAnnotationMetadata.js:53-54` `pdfCloudIntensity` / `pdfCloudPathD`. `fix-logs/e2e-00fda232-thirteen-live.md` |
| P1-04 | Printed circles/ovals/rects use pre-resize size | **proven** | `pdfAnnotationsPdfLib.js:3367-3372` `width * \|scaleX\|` / skip non-finite. Family: polyline/polygon, circle radii, ink affine, FreeText wrap. `tests/printFlattenOnPage.test.mjs`; `tests/exportScaleLeftovers.test.mjs`; `tests/inkPrintFlattenAffine.test.mjs`; `tests/textFlattenAffineScale.test.mjs` |
| P1-05 | Multi-select rotate/resize displaces lines | **proven** | `useSVGInteraction.js:178` `applyGroupLineWorldTransform` via `getLineEndpoints`; used `:1516` / `:1783`. `tests/svgInteractionFixes.test.mjs` |
| P1-06 | Resize/rotate/move commits by stale index | **proven** | `useSVGInteraction.js:110` `resolveAnnotationIndexById` at pointermove `:1293` / pointerup `:2971`. `tests/svgInteractionFixes.test.mjs` |
| P1-07 | Text-edit commit by stale index | **proven** | `TextEditOverlay.jsx:81` `replaceTextInPageJson`; `:343` uses `originalRef.current`. `tests/pdfViewerStaleIdCommits.test.mjs` |
| P1-08 | Undo retargets selection to a different shape | **proven** | `useSVGInteraction.js:121` `captureSelectionStableIds` / `:131` `remapSelectionByStableIds`. `tests/svgInteractionFixes.test.mjs` |
| P1-09 | Redo resurrects old page snapshot | **proven** | `PDFViewer.jsx:24087` `pushLocalAnnotationHistoryAction`; `:24122` `redoHistoryRef.current = []` |
| P1-10 | Own undo wipes teammate edits | **proven** | `src/utils/crdtHistoryScope.js:7` `scopeHistoryStateForCrdtRestore`; wired `PDFViewer.jsx:11880` / `:12153` |
| P1-11 | Own undo reverts teammate’s concurrent edit | **proven** | `annotationLocalHistory.js:580` `mergeAnnotationHistoryUpdate` |
| P1-12 | Excel auto-sync permanently jams undo | **proven** | **Stomp one-liner still live:** `historyHelpers.js:124` `reason.startsWith('excel:')`. Producer `PDFViewer.jsx` `addHistoryCheckpoint('excel:auto-sync')`. `tests/historyStacks.test.mjs`; `fix-logs/e2e-p1-12-38-53-live.md` |
| P1-13 | First edit-and-undo after import deletes imports | **proven** | `PDFViewer.jsx:10139` `previewBaselineByPageRef`; import skip-save deletes baseline `:25079`. `fix-logs/e2e-testpdf-import.md` |
| P1-14 | Cross-page counter renumber never saves | **proven** | `counterNumbering.js` `renumberCounters` replaces changed page buckets. `tests/counterNumberingPageRefs.test.mjs`; `tests/counterRenumberSavePolicy.test.mjs` |
| P1-15 | Callout text edit clobbers teammate move/restyle | **proven** | `PDFViewer.jsx:32545` `resolveCommittedCalloutText` (merges text + text-box bounds onto the live callout) |
| P1-16 | Reopened documents hide all survey markers | **proven** | `PDFViewer.jsx:28696` `matchesSelectedModule` (no early-return on null module) |
| P1-17 | Page ops revert other edits during upload | **proven** | `pageAnnotationReindex.js:353` `mergeLivePagePresentation`; `usePageOperations.js:83`. `src/utils/__tests__/pageAnnotationReindex.test.mjs` |
| P1-18 | Cut/copy page clipboard goes stale | **proven** | `pageAnnotationReindex.js:324` `remapClipboardPage`; `PDFViewer.jsx:12379`. Same test file |
| P1-19 | Two people doing page ops silently overwrite | **proven** | `documentVersionCheck.js:1` `DocumentVersionConflictError`; `AppShell.jsx` `expectedUpdatedAt` |
| P1-20 | Cmd/Ctrl+Shift+D downloads two debug files | **proven** | `shapeBleedDiagnostics.js:275` `window.__shapeSpyOn`; DEV-only |

### Pass 1 — MEDIUM / LOW

| ID | Title | Status | Evidence |
|---|---|---|---|
| P1-21 | Switching tools mid-stroke discards in-progress ink/shape | **proven** | `SVGAnnotationLayer.jsx:1314-1325` `commitShapeCreationRef` on tool-switch |
| P1-22 | Eraser skips cross-author delete confirmation | **proven** | `lib/collab/bulkDeletePlan.js:105` `buildBulkDeletePlan`; `eraseApprovalCandidates.js`; `PDFViewer.jsx:18699` |
| P1-23 | Non-owners cannot erase/edit imported markups | **proven** | `pdfAnnotationImporter.js:74` `stampImportedAnnotationAuthor` (`:5134` apply). `fix-logs/e2e-testpdf-import.md` |
| P1-24 | Survey-marker move/resize fails open | **proven** | `lib/collab/permissionScope.js:249` `canModifySurveyMarker`; `PDFViewer.jsx:26960` (no outer fail-open guard) |
| P1-25 | Legacy group arrows ignore rotation/scale | **proven** | `legacyGroupArrow.js:8` `isLegacyGroupArrow` / `buildLegacyArrowGroupTransform`. Export sibling `legacyArrowGroupToLine`. `fix-logs/export-flatten-siblings.md` |
| P1-26 | Double-click edit is a no-op on legacy group arrows | **proven** | `PDFViewer.jsx:121` import; `:11491` / `:31713` dblclick maps `isLegacyGroupArrow` |
| P1-27 | Legacy `circle`-typed ellipses ignore toolbar restyle | **proven** | `PDFViewer.jsx:3872` / `:7468` circle in fill/stroke gates; `:23156` selection maps circle→ellipse |
| P1-28 | Clearing all text leaves an invisible ghost | **proven** | `textEditCommit.js:142` / `:197` blank → `null` |
| P1-29 | Shift+marquee replaces callout selection | **proven** | `useSVGInteraction.js:141` `unionIdSet` / `:147` `subtractIdSet` vs `selectedCalloutIds` (`:2939` / `:2953`). `tests/svgInteractionFixes.test.mjs` |
| P1-30 | Remote-delete “Removed by X — Restore?” toast is dead | **proven** | `components/collab/remoteDeleteInteraction.js:8` `collectLocalInteractionIds`; YDocProvider Restore toast |
| P1-31 | AutoCAD SHX Text shows working resize/rotate handles | **proven** | `selectionHandleVisibility.js:80-89` `shouldShowSelectionTransformHandles`; `SVGAnnotationLayer.jsx:106` SHX in select-delete-only set. `tests/selectionHandleVisibility.test.mjs` |
| P1-32 | Holding rotation-field arrow key creates one undo per keypress | **proven** | `RotationInputField.jsx:105` ``rotation-input:${annotationIndex}:${Date.now()}`` |
| P1-33 | Open context menu can apply z-order to the wrong shape | **proven** | `annotationZOrder.js:124`; `PDFViewer.jsx:26283` `resolveAnnotationIndexById` |
| P1-34 | Cmd+C/X only work for exactly one shape | **proven** | `SVGAnnotationLayer.jsx:845` `selectedIds` (multi-id copy/cut) |
| P1-35 | Repeat-paste offset hardcodes US-Letter | **proven** | `PDFViewer.jsx:4043` / `:7890` `pageSizesRef` (612/792 is fallback only) |
| P1-36 | Owner-scoping silently drops undo for contributor edits | **proven** | `annotationLocalHistory.js:30` `isOwnAnnotation` |
| P1-37 | Font color opacity slider is dead on desktop | **proven** | `AppShell.jsx:1833` `showOpacity={false}` |
| P1-38 | “Match Fill” swatch never shows selected when fill is translucent | **proven** | **Stomp one-liner still live:** `CompactColorPicker.jsx:338` `Math.abs(localOpacity - matchOpacityPct) <= 1`. `tests/compactColorPickerLayout.test.mjs`; `fix-logs/e2e-p1-12-38-53-live.md` |
| P1-39 | Hex field accepts invalid colors like `zzzzzz` | **proven** | `annotationStyleCatalog.js:65` `normalizeHexColor` / `:79` `isValidHexColor` |
| P1-40 / P1-41 | Cmd+0/1/2 silently degrade fit / keyboard fit % disagrees | **proven** | `PDFViewer.jsx:7880` `handleZoomModeSelectRef`; `:6818` / `:23706-23716` FIT_PAGE / WIDTH / HEIGHT |
| P1-42 | Sidebar thumbnails never use IndexedDB cache | **proven** | `pagesPanelUtils.js:25` `getPdfDocumentCacheStamp`; `PagesPanel.jsx:403` `thumbnailStore`. `tests/pagesPanelUtils.test.mjs` |
| P1-43 | Drag-reorder in a filtered Space also moves hidden pages | **proven** | `pagesPanelUtils.js:79` `canReorderVisiblePages`; `PagesPanel.jsx:214`. Same test |
| P1-44 | New bookmarks jump to top of an already-ordered list | **proven** | `bookmarkEditUtils.js:3` `nextBookmarkOrder`. `tests/bookmarkAtomicEdit.test.mjs` |
| P1-45 | Deleting a bookmark group nukes nested bookmarks with no count/undo | **proven** | `bookmarkEditUtils.js:81-99` count/confirm; `:117` `planBookmarkDelete`; `PDFViewer.jsx:12778` `bookmark:delete` slice. `tests/bookmarkAtomicEdit.test.mjs`; `tests/pdfViewerUndoOneLiners.test.mjs`; `fix-logs/p1-45-undo.md` |
| P1-46 | Bookmarks/page names/spaces metadata localStorage-only | **proven** | `sidebarPersistence.js:57` `mergeSidebarWrite`; `PDFViewer.jsx:9993`. Guest / no-Y.Doc still localStorage-only (accepted leftover, not leftover-18) |
| P1-47 | Bookmark drag-reorder is O(n²) | **proven** | `bookmarkReorderUtils.js:138` `collectBookmarkTreePersistUpdates`. `tests/bookmarkReorderUtils.test.mjs` |
| P1-48 | Rejected duplicate-name bookmark rename keeps showing unsaved name | **proven** | `BookmarksPanel.jsx` `commitName` → `prepareAtomicBookmarkEdit`. `tests/bookmarkAtomicEdit.test.mjs` |
| P1-49 | Search results go stale after page reorder/rotate | **proven** | `PDFViewer.jsx:7370` `pageMutationRevision` in search key |
| P1-50 | Concurrent Spaces edits are whole-array LWW | **proven** | `annotationDocStore.js:601` `SPACES_MAP = 'spacesById'` |
| P1-51 | Activating an empty Space blanks the canvas | **proven** | `spaceRegionOrphans.js:19` `spaceHasActivatableRegions`; `PDFViewer.jsx:19595` |
| P1-52 | Deleting a region while a teammate draws inside it orphans their annotation | **proven** | `spaceRegionOrphans.js:25` `unscopeOrphanedRegionAnnotations` |
| P1-53 | Sync pill shows red “Offline” during every healthy save | **proven** | **Stomp one-liner still live:** `syncStatusViewModel.js:41-48` `pending` **before** queue-offline (`:50`). `tests/syncStatusUi.test.mjs`; `fix-logs/e2e-p1-12-38-53-live.md` |
| P1-54 | Black-thumbnail-detection guard is dead code | **proven** | `pagesPanelUtils.js:45` `isLikelyBlackThumbnailPixels`; `PagesPanel.jsx:166`. `tests/pagesPanelUtils.test.mjs` |
| P1-55 | Legacy dual-write to `document_annotations` is dead | **proven** | `annotationCloudSync.js:52` `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false`. `tests/annotationDualWriteRetired.test.mjs` |

### Pass 2 — CRITICAL / HIGH

| ID | Title | Status | Evidence |
|---|---|---|---|
| P2-01 | Free-tier sharing paywall is client-side only | **proven** | `send-invite-email/handler.js:194` `invite_blocked_free_tier`; SQL `kal31_guard_invite_creator_tier`. **Apply leftover** (not leftover-18) |
| P2-02 | Offline/conflict retry queue is never fed | **proven** | `annotationOutboxRetryView.js:39` `summarizeOutboxRetry`; live UL-44 `e2e-outbox-retry.spec.mjs` |
| P2-03 | Account deletion destroys collaborators’ work | **proven** | `delete-account/index.ts:109` `ACCOUNT_HAS_COLLABORATORS`; `20260820020000_…`. **Apply leftover** |
| P2-04 | OneDrive/SharePoint save silently overwrites existing files | **proven** | `PDFViewer.jsx:147` / `:36619` `TemplateOverwriteWarningModal` |
| P2-05 | Revoke pending invite does not remove already-granted access | **proven** | `20260820010000_…` `kal31_revoke_document_invite` `DELETE FROM document_collaborators`. **Apply leftover** |
| P2-06 | Any project member can open Manage Team | **proven** | `projectInviteService.js:86` `userCanManageProjectTeam` on `ProjectsFolderTree.jsx:428` / `ManageTeamModal.jsx:424`. `tests/rolesTeamManageGate.test.mjs` |
| P2-07 | Promoting to Owner never unlocks Manage Access | **proven** | `projectInviteService.js:72` `userCanManageDocumentAccess`; `SurveyHub.jsx:110`. `tests/rolesTeamManageGate.test.mjs`; `tests/kal31InviteContract.test.mjs` |
| P2-08 | “Connect Google” is sign-in, not link | **proven** | `AuthContext.jsx:695` `linkGoogleIdentity` |
| P2-09 | Manual Sync to Excel reports success when every write failed | **proven** | `excelLiveSyncWriteStatus.js:5`; `PDFViewer.jsx:14023` |
| P2-10 | SharePoint-tier can mint duplicate Survey Markers for one Excel row | **proven** | `20260820230000_…` `excel_sync_state_identity_fingerprint_uidx`. **Apply leftover** |
| P2-11 | Desktop quit is a fixed ~5s hang | **proven** | `quitCoordinator.cjs:7` `createQuitCoordinator`. **Zero** `checkAndQuit` in `src/` |
| P2-12 | Access-removed banner can be permanently lost after re-sign-in | **proven** | `collabBannerState.js:12` `storageStateAfterResignIn`; `YDocProvider.jsx:1704` |
| P2-13 | Microsoft sign-in on iOS/Android is a dead end | **proven** | `microsoftOAuthRouting.js:20` `isCapacitorMicrosoftConnectHidden`; `:23` `isMicrosoftConnectAvailable`. `tests/microsoftOAuthRouting.test.mjs`. Deep-link OAuth leftover (not leftover-18 list) |
| P2-14 | Desktop Microsoft connect clobbers web/mobile tokens | **proven** | `microsoftConnectionMarker.js:32` `preserveLegacyTokenMetadata`. `src/services/__tests__/microsoftConnectionMarker.test.mjs`. Live MSAL is leftover-18 A-02 / UL-21 |
| P2-15 | Delete-account button permanently disabled | **proven** | `accountPlatform.js:228` `ACCOUNT_DELETION_CONFIRMATION = 'DELETE'` |

### Pass 2 — MEDIUM / LOW

| ID | Title | Status | Evidence |
|---|---|---|---|
| P2-16 | Remote-delete Restore? toast permanently dead | **proven** | same as P1-30 (`remoteDeleteInteraction.js:8`) |
| P2-17 | “N viewing” drops anyone idle 2 minutes on one page | **proven** | `presenceRoster.js:30` `PRESENCE_STALE_MS = 10 * 60 * 1000` + `:31` 60s heartbeat |
| P2-18 | Re-sign-in modal accepts a different account mid-session | **proven** | `reSignInAccount.js:2` `isSameReSignInUser`; `ReSignInModal.jsx:118` |
| P2-19 | “Live sync real-time” copy is only half-true | **proven** | `excelWritebackGate.js:14` `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false` (X-06 writeback leftover-18) |
| P2-20 | Every Live Sync connect double-fires | **proven** | `PDFViewer.jsx:13978` live-sync effect gated on `oneDriveFileId` + `excelSessionId` |
| P2-21 | Excel `create` ops skip the field/template whitelist | **proven** | same `20260820230000` create-branch whitelist. **Apply leftover** |
| P2-22 | OneDrive picker never refreshes the Microsoft token | **proven** | `OneDriveFolderBrowser.jsx:106` `ensureFreshToken`; `PDFViewer.jsx:14293` |
| P2-23 | Two owners removing each other can leave a document ownerless | **proven** | `20260820220000_…` `FOR UPDATE`. **Apply leftover** |
| P2-24 | One tab’s stale MS token failure wipes the shared connection row | **proven** | `microsoftConnectionMarker.js:68` `shouldWipeSharedConnectionRow`. Same Node test as P2-14 |
| P2-25 | Switching MS accounts on desktop can silently refresh as the old account | **proven** | `electron/msalAuthMain.js:78` `selectPreferredAccount`. `tests/msalAuthMain.test.mjs` |
| P2-26 | Network blip at desktop launch treated as broken MS connection | **proven** | `electron/msalAuthMain.js:59` `classifySilentTokenError`. `tests/msGraphMicrosoftAuth.test.mjs` |
| P2-27 | Billing lifecycle emails route “return to merchant” to google.com | **proven** | `billingReturn.ts` `CANONICAL_RETURN_URL = 'https://surveytool.app/'` |
| P2-28 | Unlimited repeat 7-day Pro trials | **proven** | `billingTrial.ts` `proTrialPeriodDays`. `tests/billing.test.mjs`. **Apply leftover** |
| P2-29 | Stripe webhook emails are not idempotent | **proven** | `stripeEventIdempotency.ts` `withStripeEventIdempotency`. Same test. **Apply leftover** |
| P2-30 | Half-failed account deletion strands a live account whose data is gone | **proven** | `delete-account` `DATA_REMOVED_RETRY`; `accountPlatform.js:247` |
| P2-31 | Profile save reports total failure even when name already saved | **proven** | `accountPlatform.js:142` `describeProfileSaveOutcome`; `AccountSettings.jsx:321` |
| P2-32 | Google-only accounts see a Change Password form that can never succeed | **proven** | `accountPlatform.js:73` `canUnlinkProvider`; `AccountSettings.jsx:1230` |
| P2-33 | Invite link → sign-in → dashboard; invite abandoned | **proven** | `pendingInviteResume.js:68` `resumePendingInviteAfterAuth`; `main.jsx:360` |
| P2-34 | Eight documented keyboard shortcuts do nothing (3 merged) | **proven** | Overlay `KeyboardShortcutsOverlay.jsx:45-47` Home/End; `:75` `B`; no Ctrl+W / Ctrl+Tab. `PDFViewer.jsx:23863` `B`. `tests/sidebarToggleHotkey.test.mjs` |
| P2-35 | Mobile bottom sheets: reopen race, missing exits, stuck mid-drag | **proven** | `src/mobile/useMobileSheetMotion.js:226` `onTouchCancel`; hosts bind `PDFSidebar.jsx:375`. `useMobileSheetMotion.touchcancel.test.mjs`; `fix-logs/mobile-sheets-p2-35b.md` |
| P2-36 | Launching desktop twice races the Microsoft token cache | **proven** | `electron-main.js:21` `app.requestSingleInstanceLock()` |
| P2-37 | Export/print can serialize literal `Infinity`/`NaN` | **proven** | `pdfAnnotationsPdfLib.js:3372` flatten skip non-finite box. `tests/printFlattenOnPage.test.mjs` |
| P2-38 | Post-checkout `?billing=success` is never read | **proven** | `billingReturn.js:4` `readBillingQuery`; `ToastHost.jsx:43` `consumeBillingQueryOnBoot` |
| P2-39 | Save Log local-disk write hardcoded to maintainer path | **proven** | `surveyDiagPaths.js:3` `surveyTestLogsDir`; `PDFViewer.jsx:5008` |

### P2-34 / P2-35 sub-defects (headline extras, not extra inventory IDs)

| Sub | Status | Evidence |
|---|---|---|
| P2-34(a) Home/End / ←→ in continuous | **proven** | Overlay `:45-47`; `PDFViewer.jsx` page-nav |
| P2-34(b) `B` sidebar | **proven** | `PDFViewer.jsx:23863`; overlay `:75` |
| P2-34(c) Ctrl+W / Ctrl+Tab overlay lies | **proven** | Overlay no longer lists them (Navigation/Actions/Interface only) |
| P2-35(a) dismiss-then-reopen race | **proven** | `useMobileSheetMotion.js` generation-guard + `resetMotion` |
| P2-35(b) hard-hide survey exits | **proven** | `requestClose`; `fix-logs/mobile-sheets-p2-35b.md` |
| P2-35(c) `touchcancel` | **proven** | `src/mobile/useMobileSheetMotion.js:226` `onTouchCancel` → `settleDrag` |

### P2-02 placement note

P2-02 was a product decision (wire outbox vs retire unused queue). Closed as **proven** via the live outbox path (`summarizeOutboxRetry` + UL-44). Do **not** reintroduce a second half-system.

---

## Feature-bucket roster (historical spawn map)

Buckets below are the original wave-1 parallelization map. Statuses in the tables above supersede any “open / wave-1 fixed” notes in this roster.

| Bucket | IDs |
|---|---|
| `export-print` | P1-01, P1-02, P1-03, P1-04, P2-37 |
| `eraser-policy` | KB-1 |
| `color-picker` | P1-37, P1-38, P1-39 |
| `sharing-invites` | P2-01, P2-05, P2-33 |
| `roles-team` | P2-06, P2-07 |
| `account-settings` | P2-03, P2-08, P2-15, P2-30, P2-31, P2-32 |
| `billing` | P2-27, P2-28, P2-29, P2-38 |
| `bookmarks-panel` | P1-44, P1-45, P1-47, P1-48 |
| `pages-panel` | P1-42, P1-43, P1-54 |
| `sync-status-history` | P1-12, P1-53, P1-55 |
| `excel-identity-sql` | P2-10, P2-21 |
| `mobile-sheets` | P2-35 |
| `electron-desktop` | P2-11, P2-36 |
| `microsoft-auth` | P2-13, P2-14, P2-24, P2-25, P2-26 |
| `text-commit` | P1-28 |
| `counter-numbering` | P1-14 |
| `collab-ux` | P1-30, P2-12, P2-16 |
| `last-owner-race` | P2-23 |
| `svg-interaction` | P1-05, P1-06, P1-08, P1-29 |
| `z-order` | KB-2, P1-33 |
| `pdfviewer-*` | remaining P1 / P2 SERIALIZE rows (see prior wave-1 table) |

---

## Goal

Leftover **18** still blocks `/goal` complete. This leftover-18 legal-unblock pass does **not** mark the goal complete. Save / export / import / recursive E2E remain first-class.
