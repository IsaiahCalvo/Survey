# Hunt after UL-35 toolbar Continue Count + page-ops queue fix — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved toolbar **Continue Count**. This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live `/?hubPreview=1` every tab + `?testPdf=clickable-link-test.pdf` + unused query seams + 390. Did **not** copy the last hunt receipt as truth. Did **not** replay Continue pin / Continue Count / Print fail-closed / compile-hidden / leftover-18 fail-closed / Templates / Projects / Documents / Archive / PDF waves. Did **not** invent `.env.local` / Stripe / MSAL / Turnstile / accounts / Print panel / stamp / measure / Group / Extract / Note-Link.

## Hunt (what was actually opened)

Playwright `e2e-after-continue-count-independent-hunt.spec.mjs` **1 / 1 (4.3s)** on reused Vite `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1` every tab | Continue pin **0**; Continue Count **0**; Print / stamp / measure / Extract / Forms **0** | No editor leftover chrome on hub. Families already dedicated. Not replayed. |
| `?testPdf=` fresh | Export **1**; History **1**; Bookmarks **1**; Search **1**; Pages **1**; Spaces **1**; Survey **3**; Selection mode **2**; Edit text **0**; Counter colors / series **0**; Print / stamp / measure / Extract / Forms / Group / Note / Link **0**; Continue Count **0** | Export leftover-18 save/export. History / Bookmarks / Search / Pages / Spaces / Survey already dedicated. Compile-hidden stay 0. |
| Draw armed | Pen / Highlighter / Partial erase | D-01 / D-02 / D-04 already dedicated. Text-highlight split stays `false`. |
| Shapes armed | Rectangle / Ellipse / Line / Arrow / Counter | S-01…S-05 already dedicated. Continue Count not opened. |
| Text armed | Text + Callout; Note **0**; Link **0**; Edit text **1** (disabled path) | UL-36 disabled-path + T-01 / T-02. Note-Link compile-hidden. |
| Selection mode caret | Select annotations `V` / Select text `⇧V` | V-02 / V-03 already dedicated. |
| `?` overlay | Lists Select; no Stamp / Measure / Extract / Forms / Continue | UL-01 already dedicated. Compile-hidden stay unlisted. |
| `documentDeepLinkE2E=1` / `surveyTemplateWorkflowE2E=1` | Draw **0**; Continue Count **0** | Harness seams. No extra chrome. Not invented. |
| leftover-18 hosts | `envLocalHint` false; `file.id` null | X-01 still absent. Not invented. |
| 390 `?testPdf=` | Continue pin **0**; Continue Count **0**; Print / stamp / Forms / Extract **0** | Same parked / dedicated classes. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Hosts still missing. Dedicated fail-closed already. |
| UL-31 Continue pin / UL-35 Continue Count | **Already dedicated** | Not replayed. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Fresh editor + overlay + 390 counts **0**. |
| History / Bookmarks / Search / Pages / Spaces / Survey | **Already dedicated** | A-07 / V-07 / V-08 / V-06 / U-02 / U-01. |
| Export annotated PDF | **leftover-18** | Save/export inventory. Not clicked. |
| Edit text Aa | **Already dedicated** | UL-36 disabled-path; pickers enable. Hidden with no selection. |
| Selection mode / Select text | **Already dedicated** | V-02 / V-03. |
| Draw / Shapes / Text sub-tools | **Already dedicated** | D / S / T rows + PDF waves. Not replayed. |
| Templates Move/Copy / Copy-to-Spaces / checklist Y/N/N-A | **Stub / parked** | Not invented. |
| `handleRenamePage` | **Zero UI callers** | Hook-only. Do not invent a page-name field. |

## Unique leftover this hunt

**None** that is not leftover-18, not compile-hidden / stub, and not already a dedicated slice.

Next leftover-18 live host remains **X-01** (needs `.env.local` — still missing; do not invent). Leftover **18** stay parked. Goal stays open.

## Official baseline

`pageOperationsQueueMounted` rewrite held in official `npm test`. Suite **exit 1** on the next standing file `surveyEmptyCreateTemplate` (stale `doesNotMatch /name: 'Walls'/`). Isolated 8448 still not reached. Cap not loosened. That file is **not** a unique product leftover and was **not** skipped.

This hunt does **not** say unique unblocked GAP = 0.
