# Hunt after empty-module Create template contract fix — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice aligned the empty-module seed contract with the intended two-category Walls seed. This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live `/?hubPreview=1` + `?testPdf=clickable-link-test.pdf` + `surveyTransitionE2E=1` + unused query seams + 390. Did **not** copy the last hunt receipt as truth. Did **not** replay Continue pin / Continue Count / Print fail-closed / compile-hidden / leftover-18 fail-closed / Templates / Projects / Documents / Archive / PDF waves / empty-module Create template live E2E. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / Print panel / stamp / measure / Group / Extract / Note-Link.

## Hunt (what was actually opened)

Playwright `e2e-after-empty-create-template-hunt.spec.mjs` **1 / 1 (4.1s)** on reused Vite `http://127.0.0.1:5173`.

| Surface | Opened / counted | Class |
|---|---|---|
| `/?hubPreview=1` Documents | Account exact **0** (chip is `Open account menu`); Settings / Start trial / Connect **0**; Documents/Projects/Templates/Archive present | Families already dedicated. Settings leftover-18 not opened. |
| `?testPdf=` fresh | Export **1**; History **1**; Bookmarks **1**; Search **1**; Pages **1**; Actual size **0**; Rename page **0**; page-name field **0**; Print / stamp / Extract / Continue Count / Continue pin **0** | Export leftover-18. History / Bookmarks / Search / Pages already dedicated. Compile-hidden stay 0. |
| Zoom menu | Fit page **1**; Fit width **1**; Fit height **1**; Actual size **0** | UL-05 / V-04 already dedicated. Actual size compile-hidden. |
| Pages menu | Thumb right-click did not surface a menu this pass (`pagesMenu: {}`) | UL-32 already dedicated (Mirror V / Reset / Cut / Copy / Paste / Duplicate). Extract missing-handler. Not replayed. |
| `surveyTransitionE2E=1` → KAL-436 | Empty-module Create **0**; Move/Copy **0**; unplaced **0**; Excel actions **1**; EXPORT **1**; Create category **1**; Choose survey template **1**; checklist **0** | Empty-module button correctly absent on a Walls module. Excel / Create category / re-pick already dedicated. Move/Copy stub not shown without Select. Checklist parked. |
| `documentDeepLinkE2E=1` | Draw **0**; Continue Count **0** | Harness seam. No extra chrome. |
| leftover-18 hosts | `envLocalHint` false; `file.id` null | X-01 still absent. Not invented. |
| `handleRenamePage` | Hook exported from `usePageOperations.js`; PDFViewer destructure only; live field **0** | Zero UI callers. Do not invent a page-name field. |
| 390 `?testPdf=` | Continue pin / Continue Count / Print / stamp / Extract / Actual size / Rename page / empty-module Create **0** | Same parked / dedicated / compile-hidden classes. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Hosts still missing. Dedicated fail-closed already. |
| UL-31 Continue pin / UL-35 Continue Count | **Already dedicated** | Not replayed. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / Actual size | **Compile-hidden** | Fresh editor + zoom + 390 counts **0**. |
| History / Bookmarks / Search / Pages / Survey Create category / Excel / template re-pick | **Already dedicated** | A-07 / V-07 / V-08 / V-06 / U-01. |
| Export annotated PDF | **leftover-18** | Save/export inventory. Not clicked. |
| Empty-module Create template | **Already dedicated** | Button **0** on KAL-436 Walls. Live E2E not replayed. |
| category Move/Copy | **Stub** | Hidden until Select. Toast-only. Not invented. |
| 390 checklist Y/N/N-A | **Parked** | No compiled-in items. |
| `handleRenamePage` | **Zero UI callers** | Hook-only. Do not invent a page-name field. |
| Templates / Projects / Documents / Archive | **Already dedicated** | Not replayed. |

## Unique leftover this hunt

**None** that is not leftover-18, not compile-hidden / stub, and not already a dedicated slice.

Next leftover-18 live host remains **X-01** (needs `.env.local` — still missing; do not invent). Official next fail-stop is **`surveyKeepActive`** stale `note?.text` vs intended `noteHasContent` (Photo/Video). Leftover **18** stay parked. Goal stays open.

## Official baseline

`surveyEmptyCreateTemplate` contract held. Suite **fail-stop** on `surveyKeepActive` (`doesNotMatch` notes aria-label). Isolated 8448 still not reached. Cap not loosened. That file is **not** this leftover and was **not** skipped.

This hunt does **not** say unique unblocked GAP = 0.
