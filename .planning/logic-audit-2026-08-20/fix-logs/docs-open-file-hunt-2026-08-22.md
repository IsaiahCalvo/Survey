# Hunt after Documents Open file — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

After proving Documents Open file (`fix-logs/hub-docs-open-file-2026-08-22.md`), this is the falsify hunt — not a second live replay.

## Hunt (live inventory + source, not a copy of “0”)

Playwright `HUNT_INVENTORY` on this pass opened Documents / Projects / Templates / Archive nav plus `?testPdf=clickable-link-test.pdf` chrome before the leftover. `archiveEmpty: 0`. DocumentsLedger clickables were then classified against receipts:

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. Documents **Upload** is `handleUpload` console.log unless `workflowE2E`; native picker is UL-03. Preview / Select / detail **Share** stay A-03 / UL-24 inbox. Cloud `lockDocument` stays leftover-18. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| UL-31 Continue pin | **Parked** | Already proven as UL-31; stay parked. |
| Templates category / module / entity Move/Copy | **Dead stub** | Copy / Move / Cancel / Close only `closeMoveModal`. Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | Zero callers / no compiled-in items. |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | **Unreachable** | `setMobileProjectLayout` has zero callers; stays `'drill'`. Not invented. |
| Documents Search / rename / delete | **Catalog-completeness live** | Do not replay. |
| Documents Copy/Paste / Select Duplicate / Move/Copy / column Sort / Preview | **Extras live** | `e2e-hub-docs-extras.spec.mjs`. Mobile filter is the same `onHeaderClick` / `sortKey` as desktop Sort. Do not replay. |
| Documents Lock persist | **Proven fail-closed** | Cloud persist leftover-18. |
| Documents **Open file** | **Proven this pass** | Preview-pane button + row double-click; 390 `openMobileDoc` + detail Open file; `returnTab=documents`. |
| Projects extras / catalog / thin chrome / file Search / file-row reorder / file Delete / file-row Open | **Proven** | Do not replay. |
| Templates family through entity opacity/border | **Proven** | Do not replay. |
| Spaces / Survey-rail / PDF waves | **Proven** | Do not replay. |
| Archive empty chrome | **Catalog-completeness live** | Not mounted this session (`archiveEmpty: 0`). Archive restore host-blocked. Do not invent. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height. After Documents Open file, the remaining reachable set in this catalog is leftover-18 + compile-hidden + dead stubs + unreachable `mobileProjectLayout`. That is an exhausted *this-catalog* hunt, not a goal-complete claim and not a re-claim of unblocked GAP = 0.

Leftover-18 still blocks `/goal` complete. No new unique unblocked leftover is named.
