# Hunt after Documents Share Access — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved Documents More → Share → Document Access. This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live hubPreview + `?testPdf=`. Did **not** copy the prior exhausted receipt as truth.

## Hunt (what was actually opened / clicked)

Playwright `debug/scenarios/e2e-after-share-access-independent-hunt.spec.mjs` **1 / 1 (5.3s)**. Vite reused `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1` every tab | Documents / Projects / Templates / Archive buttons + More / Select / Upload / Team / New project counts | Families already dedicated-sliced except Documents All/None. Not replayed as filler. |
| Documents More (SE-011) | Preview & details / Rename / Copy / Paste / Delete / Share / Lock document | Already dedicated: extras, catalog-completeness, Share Access, Lock persist. No extra More item. |
| Documents column sort | Project / Last edited / File each changed row order | extras already dedicated **column Sort** (File / Size). Same `onHeaderClick`. Not a new leftover. |
| Documents Preview SE-011 | Team label **1**; Team buttons **0**; name Isaiah Calvo; Collaborators **0**; Recent activity **0**; Open file **1**; Share **1**; Last edited **1**; Uploaded **1** | Preview Team is **display-only**. Collaborators / Recent activity are comment-only — not compiled. Open file / Share already dedicated. |
| Documents Select | All **1** / None after All / Done **1** / Duplicate / Move/Copy / Share / Delete. All checked `d4,d5,d2,d3,d1,d6`. None cleared. 390 All **1** | **Unique leftover** — extras used Select only for Duplicate / Move/Copy. Archive Select is a different family. |
| Projects Team | List Team **1**. After Tower open: Manage team **1**. Modal Invite / Edit / More / Done + Isaiah Calvo creator | Already dedicated thin-chrome **Team write** fail-closed. Not Preview Team. |
| Account menu | Settings / Sign out | A-04 already dedicated. |
| Settings tabs | General / Connected / Subscription. No Theme / Appearance / Notifications. | General / Usage already dedicated. |
| Connected services | Microsoft + Google `Not connected…`; Connect **2**; Disconnect **0** | leftover-18 A-02 / UL-21 / UL-22. Connect **not** clicked. |
| Subscription | Start trial **1**; Usage **1**; Monthly/Annual **0**; Manage **1** | leftover-18 A-05 / UL-20. Start trial **not** clicked. |
| `?testPdf=` editor rest | Close tab / Export / Undo/Redo / Draw / Shapes / Text / Pages / Search / Bookmarks / Spaces / History / Survey / Fit / zoom. Font **0**. More **0**. | Families already proven. Export leftover-18. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. |
| Upload | **leftover-18 UL-03** | HubPreview `console.log('[hub preview] upload')` unless `workflowE2E`. Native chooser parked. |
| Preview Team | **Display-only** | Owner avatar + name. No control. Distinct from Projects Manage team. |
| Projects Team vs Preview Team | **Already proven / display-only** | Projects Manage team is thin-chrome Team write. Preview Team has no button. |
| A-03 live mint | **leftover-18** | Share Access fail-closed Copy link / Send. Do not invent mint. |
| Documents More besides Share/Lock/Open | **Already proven** | Preview / Rename / Copy / Paste / Delete. |
| Connect / Start trial | **leftover-18** | Not clicked. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Flags / `false &&` / omitted. |
| Templates category Move/Copy / Copy-to-Spaces / checklist Y/N/N-A | **Stub / parked** | Not invented. |

## What is claimed

Documents Select **All / None / Done** is the unique unblocked leftover from this hunt. Live-proved in `e2e-hub-docs-select-all.spec.mjs`. This hunt does **not** say unique unblocked GAP = 0.

Leftover-18 still blocks `/goal` complete.
