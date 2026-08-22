# Hunt after Documents Select All — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

Last slice live-proved Documents Select / All / None / Done. This pass independently hunted remaining reachable chrome vs E2E-STATUS / FEATURE-MATRIX / E2E-UNLISTED + live hubPreview + `?testPdf=`. Did **not** copy the prior exhausted receipt as truth. Did **not** replay Documents Select All as the GAP.

## Hunt (what was actually opened / clicked)

Playwright `debug/scenarios/e2e-after-docs-select-all-independent-hunt.spec.mjs` **1 / 1 (6.3s)**. Vite reused `http://localhost:5173`.

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1` every tab | Documents / Projects / Templates / Archive buttons + More / Select / Upload / Team / New project / New template counts | Families already dedicated-sliced except load-error Try again (not mounted on the seed). Not replayed as filler. |
| Documents More (SE-011) | Preview & details / Rename / Copy / Paste / Delete / Share / Lock document | Already dedicated: extras, catalog-completeness, Share Access, Lock persist. No extra More item. |
| Documents Preview SE-011 | Team label **1**; Team buttons **0**; Collaborators **0**; Recent activity **0**; Open file / Share / Close preview | Preview Team is **display-only**. Open file / Share already dedicated. |
| Documents Select (not All/None as the slice) | Share of `test.pdf` opens **Share document** (not Access). Delete of `test.pdf` immediate, no confirm, `d6` gone, stays in Select | Share = same `shareDocuments` as Share Access (Package 2 / non-owner). Delete = same `handleDelete` as catalog More Delete. Not this leftover. |
| empty=1 | `No documents yet`; Upload; Select; Try again **0** | EmptyState Upload leftover-18 UL-03. |
| guest=1 | Sign in + Welcome back AuthModal; Open account menu **0** | leftover-18 A-01 Turnstile. |
| `hubError=documents\|projects\|templates` | Alert + **Try again**. Click restores SE-011 / Tower 5 / Security Walk-Through and removes Try again | **Unique leftover** — never dedicated-sliced. Local `retryLoad`. |
| `hubLoading=documents` | Skeleton **70**; Try again **0**; SE-011 **0** | Display-only loading chrome. No control. |
| Account menu | Settings / Sign out | A-04 already dedicated. |
| Settings tabs | General / Connected / Subscription. No Theme / Appearance / Notifications. | General / Usage already dedicated. |
| Connected services | Microsoft + Google `Not connected…`; Connect **2**; Disconnect **0** | leftover-18 A-02 / UL-21 / UL-22. Connect **not** clicked. |
| Subscription | Start trial **1**; Usage **1**; Monthly/Annual **0**; Manage **1** | leftover-18 A-05 / UL-20. Start trial **not** clicked. |
| New project / New template | Tabs inventory New project **1** / New template **1** | Catalog-completeness / Templates create. HubPreview New project is `console.log` unless `workflowE2E`. Not invented. |
| Hub `?` | Keyboard shortcuts **0** | Overlay is editor-only. |
| `?testPdf=` editor rest | Close tab / Export / Undo/Redo / Draw / Shapes / Text / Pages / Search / Bookmarks / Spaces / History / Survey / Fit / zoom. Font **0**. More **0**. Print / stamp / measure **0**. | Families already proven. Export is X-02 (already download-pass). Print/stamp/measure compile-hidden. |
| 390 Documents | Open navigation; account Archive / Settings / Sign out; mobile sort File / Project / Last edited / Size; Select Delete / Share / Duplicate / All | Archive-in-menu is A-04 nav. Mobile sort is extras `onHeaderClick`. Select chrome already classified. |

## Other chrome in the inventory (not a new leftover)

| Candidate | Class | Why |
|---|---|---|
| leftover-18 (`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`) | **Parked** | Host / captcha / Stripe / MSAL / second account. Do not invent `.env.local`. |
| Upload | **leftover-18 UL-03** | HubPreview `console.log('[hub preview] upload')` unless `workflowE2E`. Native chooser parked. |
| Preview Team | **Display-only** | Owner avatar + name. No control. |
| Documents Select Share | **Already proven** | Same `shareDocuments` as Share Access. `test.pdf` opens Share document. |
| Documents Select Delete | **Same handler as catalog More Delete** | `handleDelete` filters session docs. More Delete of `test.pdf` already catalog-live. Not invented as this slice. |
| Connect / Start trial | **leftover-18** | Not clicked. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | **Compile-hidden** | Flags / `false &&` / omitted. |
| Templates category Move/Copy / Copy-to-Spaces / checklist Y/N/N-A | **Stub / parked** | Not invented. |
| hubLoading skeletons | **Display-only** | No Try again. |

## What is claimed

Hub load-error **Try again** is the unique unblocked leftover from this hunt. Live-proved in `e2e-hub-load-error-retry.spec.mjs`. This hunt does **not** say unique unblocked GAP = 0.

Leftover-18 still blocks `/goal` complete.
