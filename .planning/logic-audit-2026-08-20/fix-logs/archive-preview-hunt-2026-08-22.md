# Hunt after Archive Preview / Close preview + Show documents — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

After proving Archive row Preview / Close preview + sibling Show documents (`fix-logs/archive-preview-2026-08-22.md`), this is the falsify hunt — not a second live replay.

## Hunt (live inventory + source, not a copy of “0”)

Playwright `HUNT_INVENTORY` on this pass opened Documents / Projects / Templates / Archive nav on seeded hubPreview. `archiveEmpty: 0` (list is seeded). `archiveSearch: 2`. `showDocuments: 2`. `closePreviewCount: 0` until a row click. `archiveHostError: 0`. Editor / TabBar Close tab / Archive Search were **not** reopened as the GAP.

ArchiveScreen buttons that remain after this slice:

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. Archive **Restore / Delete forever** stay `previewBlocked` / `ArchiveScreenContainer` service calls. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| UL-31 Continue pin | **Parked** | Already proven as UL-31; stay parked. |
| Templates category / module / entity Move/Copy | **Dead stub** | Copy / Move / Cancel / Close only `closeMoveModal`. Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | Zero callers / no compiled-in items. |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | **Unreachable** | `setMobileProjectLayout` has zero callers; stays `'drill'`. Not invented. |
| TabBar Close tab / page drop / reorder | **Proven / stub / needs two PDF tabs** | Close tab proven. Page-drop toast stub. Do not invent a second document. |
| Documents Search / rename / delete / extras / Lock persist / Open file / Preview extras | **Proven** | Do not replay. Isolation this slice: Documents Preview has Open file; Archive does not. |
| Projects extras / thin chrome / file Search / file-row reorder / file Delete / file-row Open | **Proven** | Do not replay. |
| Templates family through entity opacity/border | **Proven** | Do not replay. |
| Spaces / Survey-rail / PDF waves | **Proven** | Do not replay. |
| Archive empty chrome | **Catalog-completeness live** | Now on `/?hubPreview=1&empty=1&tab=archive`. Do not replay as the GAP. |
| Archive Search / filter / sort | **Proven** | Do not replay. |
| Archive **row Preview / Close preview** | **Just proven** | Do not replay. |
| Archive project **Show documents** + preview-tree Hide documents | **Just proven** | Same `disclosureButton`. Template **Hide categories** is the same helper with `label='categories'` — not a new leftover. |
| Open account menu / Account settings | **A-04 / auth** | HubShell profile. Not invented on hubPreview. |
| Open navigation | **Proven mobile chrome** | Do not replay. |
| Archive **Select / All / None / Done** | **Next leftover to classify** | Local chrome. Exists so Restore / Delete forever can be aimed. Those two actions stay leftover-18. The select chrome itself (enter Select, All/None over visible rows, Done clears selection, Preview hides then restores last `previewId`) is unique and unblocked. Do not invent a local restore. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; a later exhausted hunt missed Projects extras; the hunt after Documents Open file missed TabBar Close tab; the hunt after Close tab named Archive Search; the hunt after Search named this Preview leftover.

After Preview / Close preview + Show documents, the next named leftover to classify is Archive **Select / All / None / Done** (local chrome; Restore / Delete forever stay host-blocked). Leftover-18 still blocks `/goal` complete.
