# Hunt after TabBar Close tab — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

After proving desktop TabBar Close tab (`fix-logs/tab-close-2026-08-22.md`), this is the falsify hunt — not a second live replay.

## Hunt (live inventory + source, not a copy of “0”)

Playwright `HUNT_INVENTORY` on this pass opened Documents / Projects / Templates / Archive nav plus `?testPdf=clickable-link-test.pdf` chrome before the leftover. `docsCloseTab: 0`. `archiveEmpty: 0`. `archiveSearch: 2`. Editor `Close tab: 1`.

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. Documents **Upload** is `handleUpload` console.log unless `workflowE2E`; native picker is UL-03. Preview / Select / detail **Share** stay A-03 / UL-24 inbox. Cloud `lockDocument` stays leftover-18. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| UL-31 Continue pin | **Parked** | Already proven as UL-31; stay parked. |
| Templates category / module / entity Move/Copy | **Dead stub** | Copy / Move / Cancel / Close only `closeMoveModal`. Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | Zero callers / no compiled-in items. |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | **Unreachable** | `setMobileProjectLayout` has zero callers; stays `'drill'`. Not invented. |
| TabBar **page drop** | **Stub** | `handlePageDrop` toasts “being implemented”. Not invented. |
| TabBar **reorder** | **Needs two PDF tabs** | Home is pinned. `?testPdf=` has one PDF tab. Do not invent a second document. |
| 390 Back | **Already proven** | `handleBack` / `returnToDevHubPreview`. Not Close tab. |
| Documents Search / rename / delete / extras / Lock persist / Open file | **Proven** | Do not replay. |
| Projects extras / thin chrome / file Search / file-row reorder / file Delete / file-row Open | **Proven** | Do not replay. Add files on hubPreview hits `onUpload` console.log unless `workflowE2E` — leftover-18, not invented. |
| Templates family through entity opacity/border | **Proven** | Do not replay. |
| Spaces / Survey-rail / PDF waves | **Proven** | Do not replay. |
| Archive empty chrome | **Catalog-completeness live** | Not mounted this session (`archiveEmpty: 0`). Search archive **was** mounted (`archiveSearch: 2`). Restore host-blocked. |
| Archive **Search / filter / sort** | **Next leftover to classify** | Live chrome on `/?hubPreview=1&tab=archive` this session (placeholder `Search archive...`, sort “Most recently archived”). Empty copy still not mounted. Do **not** treat as leftover-18 without a dedicated intended/break/edge. Do not invent Restore writeback. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; a later exhausted hunt missed Projects extras; the hunt after Documents Open file missed TabBar Close tab.

After Close tab, the next named leftover to classify is Archive **Search / filter / sort** (mounted this session; empty copy still 0; Restore stays host-blocked). Leftover-18 still blocks `/goal` complete.
