# Hunt after Archive Search / filter / sort — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

After proving Archive Search / filter / sort (`fix-logs/archive-search-2026-08-22.md`), this is the falsify hunt — not a second live replay.

## Hunt (live inventory + source, not a copy of “0”)

Playwright `HUNT_INVENTORY` on this pass opened Documents / Projects / Templates / Archive nav on seeded hubPreview. `archiveEmpty: 0` (list is seeded). `archiveSearch: 2`. `archiveHostError: 0`. `Show documents` **2** (Atrium disclosure). Editor / TabBar Close tab were **not** reopened (just proven).

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. Archive **Restore / Delete forever** stay `previewBlocked` / `ArchiveScreenContainer` service calls. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| UL-31 Continue pin | **Parked** | Already proven as UL-31; stay parked. |
| Templates category / module / entity Move/Copy | **Dead stub** | Copy / Move / Cancel / Close only `closeMoveModal`. Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | Zero callers / no compiled-in items. |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | **Unreachable** | `setMobileProjectLayout` has zero callers; stays `'drill'`. Not invented. |
| TabBar Close tab / page drop / reorder | **Proven / stub / needs two PDF tabs** | Close tab just proven. Page-drop toast stub. Do not invent a second document. |
| Documents Search / rename / delete / extras / Lock persist / Open file | **Proven** | Do not replay. |
| Projects extras / thin chrome / file Search / file-row reorder / file Delete / file-row Open | **Proven** | Do not replay. |
| Templates family through entity opacity/border | **Proven** | Do not replay. |
| Spaces / Survey-rail / PDF waves | **Proven** | Do not replay. |
| Archive empty chrome | **Catalog-completeness live** | Now on `/?hubPreview=1&empty=1&tab=archive`. Do not replay as the GAP. |
| Archive Search / filter / sort | **Just proven** | Do not replay. |
| Archive **row Preview / Close preview** | **Next leftover to classify** | Clicking a seeded row opens the preview pane (`previewId` / `Close preview`). Distinct from Search / filter / sort and from Documents Preview extras. Restore stays host-blocked. Do not invent Restore writeback. |
| Archive project **Show documents** expand | Sibling leftover | Live this session (`Show documents` **2**). Not this slice. Classify after Preview or with it — do not treat as leftover-18. |
| Archive Select / All / None | Local chrome | Exists so Restore / Delete forever can be aimed. Those actions stay leftover-18. Do not invent a local restore. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; a later exhausted hunt missed Projects extras; the hunt after Documents Open file missed TabBar Close tab; the hunt after Close tab named this Archive Search leftover.

After Search / filter / sort, the next named leftover to classify is Archive **row Preview / Close preview** (seeded list; Restore stays host-blocked). Leftover-18 still blocks `/goal` complete.
