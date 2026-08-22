# Hunt after surveyKeepActive noteHasContent contract fix — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice aligned official Keep-active notes chrome with intended `noteHasContent` (photos/videos count). This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live `/?hubPreview=1` + `?testPdf=clickable-link-test.pdf` + opened History / Bookmarks / Spaces panels (prior hunts only counted rail buttons) + `surveyTransitionE2E=1` + unused seams + 390. Did **not** copy the last hunt receipt as truth. Did **not** replay Continue pin / Continue Count / Print fail-closed / compile-hidden / leftover-18 fail-closed / Templates / Projects / Documents / Archive / PDF waves / Survey Keep active / Photo-Video live E2E. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / Print panel / stamp / measure / Group / Extract / Note-Link.

## Hunt (what was actually opened)

Playwright `e2e-after-keepactive-contract-hunt.spec.mjs` **1 / 1 (5.2s / 6.0s wall)** on reused Vite `http://127.0.0.1:5173`.

| Surface | Opened / counted | Class |
|---|---|---|
| `/?hubPreview=1` | Account exact **0**; Settings / Start trial / Connect **0**; Documents/Projects/Templates/Archive present | Families already dedicated. Settings leftover-18 not opened. |
| History panel | Opened. `No history yet` **1**; Save version / Restore / Open read-only / Restore this region **0** | A-07 empty `?testPdf=` (no `file.id`). Already dedicated. Not replayed. |
| Bookmarks panel | Opened. Add bookmark **1**; Add to group / rename / move **0** | V-07 empty outline. Already dedicated. Add not clicked. |
| Spaces panel | Opened. Create space **1**; Add pages **0**; CSV **0** | U-02 Create already dedicated. Space CSV leftover-18. Not replayed. |
| `?` overlay | Stamp / Measure / Extract / Forms / Continue **0** | Compile-hidden stay 0. UL-01 already dedicated. |
| `surveyTransitionE2E=1` → KAL-436 | Expand marker details **0** (no placed row); Keep active **1** (not toggled); Add notes / Photo / Video **0**; empty-module Create **0**; Move/Copy **0**; unplaced **0** | Keep-active / Photo-Video already dedicated — not replayed. Expand is setup for Entity picker (already dedicated). |
| `surveyTemplateWorkflowE2E=1` | Draw **0**; Continue Count **0**; Print **0** | Harness seam. No extra chrome. |
| `?spike=features` | survey-hub **0**; Draw **0**; body empty | Throwaway DEV FeatureSpike. Not product chrome. |
| leftover-18 hosts | `envLocalHint` false; `file.id` null | X-01 still absent. Not invented. |
| 390 `?testPdf=` | Continue pin / Continue Count / Print / stamp / Extract **0**; Keep active / Add notes **0**; History **1** | Same parked / dedicated / compile-hidden classes. |

Search tab was not opened this pass (`/^Search$/` miss after History/Bookmarks). V-08 is already a dedicated slice; last hunts already counted Search **1**. Not treated as a new leftover.

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Hosts still missing. Dedicated fail-closed already. |
| UL-31 Continue pin / UL-35 Continue Count | **Already dedicated** | Not replayed. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Overlay + 390 counts **0**. |
| History / Bookmarks / Search / Spaces / Survey Create / Excel / template re-pick | **Already dedicated** | A-07 / V-07 / V-08 / U-02 / U-01. |
| Keep active / Photo-Video notes | **Already dedicated** | Live E2E not replayed. Official Node contract now matches `noteHasContent`. |
| Expand marker details | **Setup** | Entity picker / choose-template already use it. Zero until a row is placed. |
| Space CSV / empty New project | **leftover-18 / stub** | Not invented. |
| category Move/Copy | **Stub** | Hidden until Select. |
| 390 checklist Y/N/N-A | **Parked** | No compiled-in items. |
| Templates / Projects / Documents / Archive | **Already dedicated** | Not replayed. |

## Unique leftover this hunt

**None** that is not leftover-18, not compile-hidden / stub, and not already a dedicated slice.

Next leftover-18 live host remains **X-01** (needs `.env.local` — still missing; do not invent). Official next fail-stop is isolated **8448** (`partialEraserComplexity` crossing500 allocation). Leftover **18** stay parked. Goal stays open.

## Official baseline

`surveyKeepActive` contract held. Suite proceeded through the main file list. **Fail-stop** on isolated `partialEraserComplexity` (`12283.13 MiB` > **8448.00 MiB**). Isolated 8448 **reached**. Cap **not** loosened. That file is **not** this leftover and was **not** skipped.

This hunt does **not** say unique unblocked GAP = 0.
