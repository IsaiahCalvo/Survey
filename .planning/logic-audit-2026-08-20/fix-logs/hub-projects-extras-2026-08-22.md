# Hub Projects extras — Search / Pin / Duplicate / file Copy-Paste — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Independent catalog vs E2E-STATUS + FEATURE-MATRIX + E2E-UNLISTED + live hubPreview + `?testPdf=` chrome. Prior hunt `opacity-border-lock-hunt-2026-08-22.md` parked leftover-18 / compile-hidden / stubs and treated **Projects catalog-completeness** as done. That slice was only rename / delete / create + Manage-team open/Esc — the Fit-height class of miss.

Reachable chrome that is **not** leftover-18, **not** compile-hidden, **not** a dead stub, and **not** already a dedicated slice:

| Control | Why unique |
|---|---|
| `Search projects...` | Catalog-completeness never filtered |
| More → **Pin / Unpin project** | Local `pinnedIds`; floats the row |
| Select → **Duplicate** | `{name} (copy)` + file copies |
| File More **Copy / Paste** | Distinct from Documents extras clipboard |

Did **not** replay Documents extras / Lock persist / Templates family / Spaces / survey-rail / PDF waves. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy. Share send / Upload picker / Team writeback / cloud `lockDocument` stay leftover-18.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; Select; Upload; More; Preview Close; Share | Documents extras + Lock persist **proven**. Nav click to Projects from an open preview did not switch — later `tab=projects` did. |
| `/?hubPreview=1&tab=projects` | Search / Pin / Duplicate / file Copy-Paste **this slice**. New project / Manage team / rename / delete = catalog-completeness (not replayed). Add member / Get link / Upload files / Share = leftover-18 fail-closed (not invented). File Move/Copy + card reorder left as later leftovers. |
| `/?hubPreview=1&tab=templates` | New template / module tabs / New category / Add item / New entity / Edit color / More | Templates family **proven** |
| `/?hubPreview=1&tab=archive` | Heading Archive; sort “Most recently archived”; Search archive; Select | Empty copy **not** mounted this session (`archiveEmpty: 0`). Restore / Delete forever still host-blocked. |
| `/?testPdf=clickable-link-test.pdf` | Export / Undo / Redo / Draw / Shapes / Text / Pages / Search text / Bookmarks / Spaces / History / Survey / Zoom / Fit options | PDF waves **proven**. Fit menu offered Fit page / width / height only (MANUAL omitted; **no Actual size / rotate-view**). |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |

## Live proof (`/?hubPreview=1&tab=projects`)

**Intended**

- Search `lab` keeps Lab Reno; `TOWER` keeps Tower 5.
- Pin Lab Reno floats it first; Unpin restores Tower 5 first.
- Select Lab Reno → Duplicate → `Lab Reno — MEP (copy)` with `Door Hardware Schedule — A.601-copy.pdf`.
- File More Copy SE-011 → Paste on RFI → `SE-011 Security Shop Drawings-copy.pdf`; original stays.

**Break**

- `?empty=1`: Duplicate **0**, Pin menu **0**, file More **0**.
- Search `xyzzy` → `No projects match your search.`
- Select Duplicate disabled until a row is checked.
- File Paste disabled until Copy.

**Edge**

- Duplicate does not delete Tower 5 / MEP Phase 2 / original Door Hardware.
- SE-011 copy does not appear on Lab Reno.
- 390: Search `mep` hides Tower; Duplicate `MEP Phase 2 (copy)`; Pin Lab shows `title="Pinned"`.

## Product

Projects More / file More `PopupMenu` mounted `DismissBarrier` without the trigger — the opening click counted as outside (same class as Documents More). Now `insideRefs={[ref, trigger]}`. Search-focus still consumes the first outside tap (harness blurs). Not a high-risk file.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened.

## Evidence

- Playwright `debug/scenarios/e2e-hub-projects-extras.spec.mjs` **1 / 1 (5.2s)**
- Node `tests/projectsExtras.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)

## What is not claimed

This is **not** unblocked GAP = 0. Remaining reachable after this slice includes leftover-18, compile-hidden tools, dead stubs, and thinner Projects chrome (file Move/Copy, card reorder, Team modal write). Goal stays open.
