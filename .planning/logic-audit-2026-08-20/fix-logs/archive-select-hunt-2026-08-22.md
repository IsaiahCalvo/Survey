# Hunt after Archive Select / All / None / Done — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

After proving Archive Select / All / None / Done (`fix-logs/archive-select-2026-08-22.md`), this is the falsify hunt — not a second live replay.

## Hunt (live inventory + source, not a copy of “0”)

Playwright `HUNT_INVENTORY` on this pass opened Documents / Projects / Templates / Archive nav on seeded hubPreview. `archiveEmpty: 0` (list is seeded). `archiveSearch: 2`. `selectCount: 1`. `restoreBeforeSelect: 0`. `archiveHostError: 0`. Editor / TabBar Close tab / Archive Search / Preview / Show documents were **not** reopened as the GAP.

ArchiveScreen buttons that remain after this slice:

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. Archive **Restore / Delete forever** stay `previewBlocked` / `ArchiveScreenContainer` service calls — fail-closed this slice, not invented writeback. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms / text-markup create | **Compile-hidden** | Flags / `false &&` / omitted. Not invented. |
| UL-31 Continue pin | **Parked** | Already proven as UL-31; stay parked. |
| Templates category / module / entity Move/Copy | **Dead stub** | Copy / Move / Cancel / Close only `closeMoveModal`. Not invented. |
| Copy-to-Spaces / survey checklist Y/N/N-A | **Stub / parked** | Zero callers / no compiled-in items. |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | **Unreachable** | `setMobileProjectLayout` has zero callers; stays `'drill'`. Not invented. |
| TabBar Close tab / page drop / reorder | **Proven / stub / needs two PDF tabs** | Close tab proven. Page-drop toast stub. Do not invent a second document. |
| Documents Search / rename / delete / extras / Lock persist / Open file / Preview extras | **Proven** | Do not replay. Isolation this slice: Documents Select has Duplicate / Move/Copy; Archive has Restore / Delete forever. |
| Projects extras / thin chrome / file Search / file-row reorder / file Delete / file-row Open | **Proven** | Do not replay. |
| Templates family through entity opacity/border | **Proven** | Do not replay. |
| Spaces / Survey-rail / PDF waves | **Proven** | Do not replay. |
| Archive empty chrome | **Catalog-completeness live** | Now on `/?hubPreview=1&empty=1&tab=archive`. Do not replay as the GAP. |
| Archive Search / filter / sort | **Proven** | Do not replay. Filter Documents was used only as Select's visible-set edge. |
| Archive **row Preview / Close preview** | **Proven** | Do not replay. |
| Archive project **Show documents** + preview-tree Hide documents | **Proven** | Same `disclosureButton`. Template **Hide categories** is the same helper with `label='categories'` — not a new leftover. |
| Archive **Select / All / None / Done** | **Just proven** | Local chrome. Restore / Delete forever stay leftover-18 fail-closed. |
| Open account menu / Account settings | **A-04 / auth** | HubShell profile. HubPreview `onSettings` is `console.log`. Not invented on hubPreview. Distinct from leftover-18, but parked last hunt — do not invent account/billing. |
| Open navigation | **Proven mobile chrome** | Do not replay. |
| Documents / Projects **Upload** | **leftover-18 / UL-03** | Host picker / `handleUpload` log. Not invented. |
| Documents Preview / Select **Share** | **A-03 / UL-24** | Inbox leftover-18. Not invented. |

## What is not claimed

This hunt does **not** say unique unblocked GAP = 0. A prior “0” was falsified by Fit height; a later exhausted hunt missed Projects extras; the hunt after Documents Open file missed TabBar Close tab; the hunt after Close tab named Archive Search; the hunt after Search named Preview; the hunt after Preview named this Select leftover.

After Select / All / None / Done, the remaining reachable set in **this catalog** (hubPreview Archive + sibling hub tabs + already-proven editor waves) is leftover-18 + compile-hidden + dead stubs + unreachable `mobileProjectLayout` + parked A-04 account menu. That is an exhausted *this-catalog* hunt, not a goal-complete claim and not a re-claim of unblocked GAP = 0.

Leftover-18 still blocks `/goal` complete. No new unique unblocked leftover is named.
