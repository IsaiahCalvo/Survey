# Hub Projects thin chrome — file Move/Copy / card reorder / Team write — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last extras hunt (`hub-projects-extras-2026-08-22.md`) proved Search / Pin / Duplicate / file More Copy-Paste and left **file Move/Copy**, **card reorder**, and **Team modal write**. Those are **not** leftover-18, **not** the Templates category Move/Copy stub, and **not** Projects catalog-completeness (rename / delete / create + Manage-team open/Esc).

| Control | Class |
|---|---|
| File Select **Move/Copy** | Real local chrome. `moveCopyFiles` + `MoveCopyModal`. HubPreview `handleMoveCopy` re-parents / clones. Distinct from file More Copy/Paste and from Templates entity More Move/Copy stub. |
| Project **card reorder** | Real local chrome. `reorderProjects` + `SortableRearrangeList` + `onProjectPreferencesChange({ projectOrder })`. Distinct from Spaces card reorder and from file-row reorder. |
| **Team write** | Real cloud helpers (`createProjectInvite` / `updateProjectCollaboratorRole` / `removeProjectCollaborator`). hubPreview has a mock user id so the Invite UI is enabled, then Supabase/RLS fail-closed. Do **not** invent a backend. Manage-team open/Esc stays catalog-completeness. |

Did **not** replay Documents extras / Lock persist / Templates family / Spaces / survey-rail / PDF waves. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy. Share send / Upload picker / signed-in Team writeback / cloud `lockDocument` stay leftover-18.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; Upload; More; Preview Close; Share | Documents extras + Lock persist **proven**. Nav click to Projects from an open preview did not switch — later `tab=projects` did. |
| `/?hubPreview=1&tab=projects` | File Select Move/Copy / card reorder / Team write **this slice**. Search / Pin / Duplicate / file Copy-Paste = extras (not replayed). New project / rename / delete / Manage-team open/Esc = catalog-completeness (not replayed). Add member / Get link / Upload / Share = leftover-18 fail-closed (not invented). |
| `/?hubPreview=1&tab=templates` | New template / module tabs / New category / Add item / New entity | Templates family **proven** |
| `/?hubPreview=1&tab=archive` | Heading Archive; sort “Most recently archived”; Select | Empty copy **not** mounted this session (`archiveEmpty: 0`). Restore / Delete forever still host-blocked. |
| `/?testPdf=clickable-link-test.pdf` | Export / Undo / Redo / Draw / Shapes / Text / Pages / Search text / Bookmarks / Spaces / History / Survey / Zoom / Fit options | PDF waves **proven** |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |

## Live proof (`/?hubPreview=1&tab=projects`)

**Intended**

- File Select SE-011 → Move/Copy → Copy → Lab Reno: Lab gains SE-011; Tower keeps original + RFI.
- File Select RFI → Move → MEP Phase 2: Tower loses RFI; MEP has Coordination + RFI.
- Card reorder Tower handle → Lab: stored + rail `['Lab Reno — MEP','MEP Phase 2','Tower 5 — Security']`.
- Tower Manage team → Invite → Copy link / Send fail-closed (no `/invite/` mint). Activity **No recent activity.**

**Break**

- `?empty=1`: Move/Copy **0**, card handles **0**, Manage team **0**.
- File Select Move/Copy disabled until a file is checked.
- Move here disabled until a destination is picked.
- Cancel after picking dest leaves Tower files unchanged.
- Reopen after Cancel starts a fresh picker (dest cleared).
- Lab Reno (non-owner `u1`) Manage team **0**.
- Invite Send empty disabled; `not-an-email` enabled then `Enter at least one valid email.`
- Role-change triggers **0** (only the creator seed row; no invented collabs).

**Edge**

- Copy does not delete Tower SE-011 / RFI.
- Move does not put RFI on Lab.
- MEP Coordination stays. Escape / self-drag keep Tower first.
- 390: drill Tower → Move/Copy Cancel; Team Invite Copy link no mint; back then card reorder `mobileReordered: true` (handles **3**).

## Product

`MoveCopyModal` kept `destId` / `mode` across close, so a cancelled dest stayed selected on reopen. Reset dest + mode + submitting when `open` becomes true. Not a high-risk file.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened.

## Evidence

- Playwright `debug/scenarios/e2e-hub-projects-thin-chrome.spec.mjs` **1 / 1 (21.2s)**
- Node `tests/projectsThinChrome.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)

## What is not claimed

This is **not** unblocked GAP = 0. Remaining reachable after this slice includes leftover-18, compile-hidden tools, dead stubs, and thinner Projects chrome: **file Search** (`Search files...`) and **file-row reorder** (`reorderFiles` — distinct from project card reorder). Goal stays open.
