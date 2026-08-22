# Hunt after UL-31 Continue pin — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved overlay-gated **Continue pin**. This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live `/?hubPreview=1` every tab + `?testPdf=clickable-link-test.pdf` + unused query seams. Did **not** copy the last hunt receipt as truth. Did **not** replay Continue pin / Print fail-closed / compile-hidden / leftover-18 fail-closed / Templates / Projects / Documents / Archive / PDF waves.

## Hunt (what was actually opened)

Playwright `e2e-after-continue-pin-independent-hunt.spec.mjs` + dedicated proof `e2e-continue-count-toolbar.spec.mjs` **2 / 2 (12.8s)** on reused Vite `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1` every tab | Continue pin **0**; Continue Count **0**; Counter series **0**; overlay **0** | No editor chrome on hub. Families already dedicated. Not replayed. |
| `?testPdf=` fresh | Export **1**; History **1**; Bookmarks **1**; Search **1**; Edit text **0** (no selection); Print / stamp / measure / Extract / Forms **0**; Continue Count **0** | Export leftover-18 save/export. History / Bookmarks / Search already dedicated. Compile-hidden stay 0. |
| Counter armed, no pins | Counter series opens; **+ New Count** **1**; Continue Count **0**; series rows **0** | Empty-armed contrast. Continue Count heading is series-gated. |
| Counter + two series (proof spec) | Continue Count heading **1**; Count 1 / Count 2 rows; click Count 1 then place → A n=2 | **This leftover.** Toolbar series-row, not overlay Continue pin. |
| `documentDeepLinkE2E=1` / `surveyTemplateWorkflowE2E=1` | Draw **0**; Continue Count **0** | Harness seams. No extra chrome. Not invented. |
| leftover-18 hosts | `envLocalHint` false; `file.id` null | X-01 still absent. Not invented. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Hosts still missing. Dedicated fail-closed already. |
| UL-31 Continue pin | **Already dedicated** | Overlay context menu. Not replayed. |
| UL-35 Size / Start / series-list Delete | **Already dedicated** | Different controls. New Count used as **setup** only. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Fresh editor counts **0**. |
| History / Bookmarks / Search | **Already dedicated** | A-07 / V-07 / V-08. |
| Export annotated PDF | **leftover-18** | Save/export inventory. Not clicked. |
| Edit text Aa | **Already dedicated** | UL-36 disabled-path; pickers enable. Hidden with no selection. |
| Templates Move/Copy / Copy-to-Spaces / checklist Y/N/N-A | **Stub / parked** | Not invented. |

## Unique leftover this hunt

**Toolbar Continue Count series-row** (`onSwitchCounterSeries` + desktop `setActiveTool('counter')`). Cluster UL-35 listed “New Count / Continue / start # / Size / delete”. Size / Start / Delete were the dedicated slices. Continue pin receipt called the toolbar row “a different control” then lumped it as “already dedicated family” — same cluster-lumping Fit height / Continue pin already falsified.

Not leftover-18. Not compile-hidden. Not a stub.

Next leftover-18 live host remains **X-01**. Goal stays open.
