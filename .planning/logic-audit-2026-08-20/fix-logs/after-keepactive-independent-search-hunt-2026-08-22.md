# Hunt after keepActive — independent Search-open leftover scan — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last keepActive hunt (`after-keepactive-exhausted-hunt-2026-08-22.md`) claimed no unique leftover but **did not open Search** (`/^Search$/` miss after History/Bookmarks). This pass treated that receipt as unproven and independently hunted remaining reachable chrome vs E2E-UNLISTED / FEATURE-MATRIX / E2E-STATUS + live `/?hubPreview=1` + `empty=1` + `?testPdf=clickable-link-test.pdf` + **opened Search** on `text-search-glyph-lab.pdf` + zoom menu + `?` overlay + `kal441-form-fields.pdf` + leftover-18 hosts + 390.

Did **not** copy the last hunt receipt as truth. Did **not** replay Continue pin / Continue Count / Print fail-closed / leftover-18 fail-closed / compile-hidden live E2E / Templates / Projects / Documents / Archive / Settings / Spaces / Survey-rail / PDF waves / Keep active / Photo-Video. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / Print panel / stamp / measure / Group / Extract / Note-Link. Did **not** loosen official `npm test` **8448** MiB or 75/250 geometry/timing.

## Hunt (what was actually opened)

Playwright `e2e-after-keepactive-independent-search-hunt.spec.mjs` **1 / 1 (6.0s)** on reused Vite `http://127.0.0.1:5173`.

| Surface | Opened / counted | Class |
|---|---|---|
| `/?hubPreview=1` | Account exact **0**; Settings / Start trial / Connect **0**; Upload **1**; Theme / Notifications / Comments / page-drop **0**; Documents/Projects/Templates/Archive present | Families already dedicated. Upload leftover-18 UL-03 fail-closed (not clicked). Settings leftover-18 not opened. |
| `/?hubPreview=1&empty=1` | Upload **2**; New project **0**; New template **0**; Start trial / Connect **0** | Empty Upload leftover-18 UL-03. Empty New project already classified stub (`console.log`). Empty New template is U-03 dedicated local mint (not replayed). |
| `?testPdf=clickable-link-test.pdf` | Export **1**; History **1**; Bookmarks **1**; Search **1**; Pages **1**; Spaces **1**; Print / stamp / Extract / Forms / Continue Count / Continue pin / Actual size / Rename page / Two-page / Rotate view / Comments / Theme / Notifications / page-drop / Match case / Whole word **0** | Export leftover-18. History / Bookmarks / Search / Pages / Spaces already dedicated. Compile-hidden / stubs stay 0. |
| Zoom menu | Fit page **1**; Fit width **1**; Fit height **1**; Actual size **0**; Two-page **0**; Rotate view **0** | UL-05 / V-04 already dedicated. Actual size / two-page / rotate-view compile-hidden. |
| Search panel (`text-search-glyph-lab.pdf`) — **opened this pass** | Field **3**; Next **1**; Previous **1**; Match case **0**; Whole word **0** | V-08 already dedicated (Next wrap / Previous wrap / result-row click / F3). No case-toggle leftover. Last hunt missed this panel; opening it did **not** surface a new leftover. |
| `?` overlay | Stamp / Measure / Extract / Forms / Continue **0**; Search text **1**; F3 **0** | UL-01 already dedicated. Compile-hidden stay 0. F3 omitted from overlay (already `f3-counter-delete-bump`). |
| `kal441-form-fields.pdf` | Draw **1**; form-layer widgets **7**; Forms toolbar **0**; Continue Count / Print **0** | X-05 leftover-18 widgets + local fill. Forms designer compile-hidden. |
| leftover-18 hosts | `envLocalHint` false; `file.id` null | X-01 still absent. Not invented. |
| 390 `?testPdf=` | Continue pin / Continue Count / Print / stamp / Extract / Forms / Actual size / Two-page / Rotate view / Search / Match case **0**; History **1** | Same parked / dedicated / compile-hidden classes. Mobile Search lives in the sheet (V-08 dedicated). |

## Unlisted rows checked (UL-01…UL-46)

Every E2E-UNLISTED row was classified this pass. None is a unique unblocked leftover.

| ID | Class | Why this pass |
|---|---|---|
| UL-01 Close overlay | **Already dedicated** | Overlay Close counted; live `?` listed Search text. Not replayed. |
| UL-02 **B** sidebar | **Already dedicated** | Overlay lists Toggle sidebar. Not replayed. |
| UL-03 Open / Upload | **leftover-18** | Hub Upload **1** / empty Upload **2**. Dedicated fail-closed already. Native pick/cancel still host-gated. Not clicked. |
| UL-04 Ctrl+0 Fit page | **Already dedicated** | Zoom Fit page **1**. Not replayed. |
| UL-05 Fit options | **Already dedicated** | Fit page / width / height **1**. Actual size **0** (compile-hidden). |
| UL-06 Zoom % | **Already dedicated** | Not replayed. |
| UL-07 Page number | **Already dedicated** | Not replayed. |
| UL-08 History button | **Already dedicated** | History **1** (A-07 empty `?testPdf=`). Save version leftover-18 X-01. Not clicked. |
| UL-09 Search tab | **Already dedicated** | **Opened this pass** (last hunt missed). Field/Next/Previous present. V-08 dedicated. |
| UL-10 Spaces tab | **Already dedicated** | Spaces **1**. U-02 dedicated. Space CSV leftover-18. Not replayed. |
| UL-11 Close document panel | **Already dedicated** | Not replayed. |
| UL-12 Settings tabs | **Already dedicated** | Settings **0** on hub chrome (chip path). Not opened. |
| UL-13 Edit profile | **leftover-18** | Cloud persist still host-gated. Dedicated General Cancel already. Not opened. |
| UL-14 Email read-only | **Already dedicated** | Not opened. |
| UL-15 Password + Turnstile | **leftover-18** | Live captcha still host-gated. Not opened. |
| UL-16 Delete account | **leftover-18** | Dedicated Confirm fail-closed already. Live wipe still host-gated. Not opened. |
| UL-17 Sign out | **Already dedicated** | Preview fail-closed already. Live teardown leftover-18. Not opened. |
| UL-18 Usage | **Already dedicated** | Local empty chrome dedicated. Billing-API leftover-18. Not opened. |
| UL-19 Monthly/Annual | **Already dedicated** | Node. Not opened. |
| UL-20 Start trial | **leftover-18** | Hub Start trial **0**. Dedicated click fail-closed already. Live Stripe still host-gated. |
| UL-21 Microsoft Connect | **leftover-18** | Hub Connect **0**. Dedicated fail-closed already. Live MSAL still host-gated. |
| UL-22 Google Connect | **leftover-18** | Same as UL-21. |
| UL-23 Share roles | **Already dedicated** | Node. Not opened. |
| UL-24 Copy link | **leftover-18** | HubPreview fail-closed already. Live inbox still host-gated. Email Send not clicked. |
| UL-25 Invite parse | **Already dedicated** | Node. Not opened. |
| UL-26 Share Cancel | **Already dedicated** | Node. Not opened. |
| UL-27–30 Cut/Copy/Paste/z-order | **Already dedicated** | Context-menu live. Not replayed. |
| UL-31 Continue pin | **Already dedicated** | Fresh editor + overlay + 390 **0** (overlay-gated). Dedicated slice not replayed. |
| UL-32 Pages menu | **Already dedicated** + **compile-hidden Extract** | Pages **1**. Mirror V / Reset / Cut / Copy / Paste dedicated. Extract **0** / missing-handler. |
| UL-33 Style picker | **Already dedicated** | Not replayed. |
| UL-34 Cloud bump | **Already dedicated** | Not replayed. |
| UL-35 Continue Count | **Already dedicated** | Fresh editor + 390 + kal441 **0**. Dedicated slice not replayed. |
| UL-36 Edit text | **Already dedicated** | Disabled-path dedicated. Not replayed. |
| UL-37 Forms | **compile-hidden** | Forms toolbar **0** on editor / overlay / 390 / kal441. `{false && (` stays. |
| UL-38 Form properties | **compile-hidden** | Dead without UL-37. Node-only. |
| UL-39–43 Print panel | **compile-hidden** + **dedicated fail-closed** | Print **0**. Custom panel flag-off. Cmd/Ctrl+P blob/OS already `e2e-print-panel-failclosed`. Not replayed. |
| UL-44 Sync Retry | **Already dedicated** | Chip hidden on `?testPdf=`. Not replayed. |
| UL-45 Presence roster | **leftover-18** | Hidden on `?testPdf=`. Second-account lease still host-gated. |
| UL-46 Native mobile selects | **leftover-18** | Web 390 dedicated. Native Capacitor still host-gated. |

## Other inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Hosts still missing (`.env.local` absent). Dedicated fail-closed already. |
| X-05 kal441 widgets | **leftover-18** | Form layer **7** on `kal441-form-fields.pdf`. Cloud persist still needs `file.id`. Designer toolbar **0**. |
| Export annotated PDF | **leftover-18** | Save/export inventory. Not clicked. |
| Space CSV / PDF Pages | **leftover-18** | U-02. Not invented. |
| Stamp / measure / Group / Extract / Note-Link / Forms / Actual size / two-page / rotate-view | **compile-hidden** | Editor + zoom + overlay + 390 counts **0**. |
| Match case / Whole word | **compile-hidden / absent** | Opened Search: **0**. V-08 already recorded no case-toggle. |
| Theme / Notifications / Comments | **absent** | Hub + editor **0**. A-04 already: no such pane. |
| page-drop toast | **stub** | Live copy **0**. P-03 TabBar drop path stays a stub. Do not invent. |
| `handleRenamePage` / Rename page | **Zero UI callers** | Live field **0**. Do not invent. |
| empty New project | **stub** | `empty=1` New project **0** this pass (already classified `console.log` stub). |
| category Move/Copy | **stub** | Hidden until Select. Not invented. |
| 390 checklist Y/N/N-A | **Parked** | No compiled-in items. |
| isolated `partialEraserComplexity` crossing500 | **8448 standing** | Official `npm test` fail-stop `12283.13 MiB` > **8448.00 MiB**. Cap **not** loosened. Not this leftover. Do not rewrite crossing-cuts. |
| History / Bookmarks / Search / Pages / Spaces / Survey / Templates / Projects / Documents / Archive | **Already dedicated** | Not replayed. |

## Unique leftover this hunt

**None** that is not leftover-18, not compile-hidden / stub, and not already a dedicated slice.

Opening Search (the last hunt’s miss) proved V-08 chrome only: field + Next + Previous; no Match case / Whole word. That is already dedicated, not a new leftover.

Next leftover-18 live host remains **X-01** (needs `.env.local` — still missing; do not invent). Official next fail-stop is isolated **8448** (`partialEraserComplexity` crossing500 allocation). Leftover **18** stay parked. Goal stays open.

## Official baseline

Did **not** re-run official `npm test` (8448 standing fail-stop; cap not loosened; crossing-cuts not rewritten). Isolated 8448 remains **reached** from the keepActive contract pass. That file is **not** this leftover and was **not** skipped.

This hunt does **not** say unique unblocked GAP = 0.
