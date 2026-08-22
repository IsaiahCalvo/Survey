# Hub Archive row Preview / Close preview + Show documents — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last Archive Search hunt (`fix-logs/archive-search-hunt-2026-08-22.md`) named Archive **row Preview / Close preview** (click a seeded row). Search / filter / sort was just proven; empty chrome was catalog-completeness live; Restore stays leftover-18. This is **local chrome**, **not** leftover-18, **not** Documents Preview extras / Open file.

Sibling leftover proved on the same pass: project **Show documents** expand (`ledgerDisclosure` / `title="Show documents"`). Independent of the preview tree (`previewCollapsedIds`).

| Control | Class |
|---|---|
| Row click / child `Preview {name}` | Real. `setPreviewId` + `setPreviewOpen(true)` / `resolveArchivePreviewItem`. Document / project Contents / template Modules+Entities. |
| Close preview | Real. `setPreviewOpen(false)`. Icon-only; now `aria-label="Close preview"` to match Documents. |
| Show documents / Hide documents | Real. Ledger `expandedIds` starts closed. `stopPropagation` so expand does not steal Preview. |
| Preview-tree Hide documents | Real. Opposite default (starts open). Independent of ledger expand. |
| `empty=1` Archive | Existing empty contrast. No pane, no Close preview, no Show documents. |
| Restore / Delete forever | Host-blocked leftover-18. Preview callbacks are `previewBlocked`. Not invented. |
| 390 Preview pane | Absent (desktop card hidden). Card click does not open Preview. Show documents still expands. |
| `mobileProjectLayout` | Unreachable. Not invented. |

Did **not** replay Archive Search / filter / sort; Archive empty chrome; TabBar Close tab; Documents Preview extras / Open file; Projects extras + file family; Templates family; Spaces; Survey-rail; PDF waves.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav | Families **already proven**. Documents Close preview / Open file present. |
| `/?hubPreview=1&tab=archive` | Heading Archive; Show documents **2**; Close preview **0** until a row click; seed Atrium / Site plan / Bravo; host UUID error **0** | Preview / Close preview + Show documents is this slice. |
| `/?hubPreview=1&empty=1&tab=archive` | Nothing in Archive; Close preview **0**; Show documents **0**; Restore **0** until Select | Empty contrast. |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |
| `mobileProjectLayout` rail/teams/drive/browse | — | Unreachable |

## Live proof

**Intended**

- Seeded `/?hubPreview=1&tab=archive`: no pane until a row click. Site plan → Preview + Document + Tower 5 — Security + MB + Archived + Time remaining. No Open file.
- Close preview hides the pane. Re-click reopens.
- Atrium → Contents + Level 1 / Level 2 (preview tree starts open; ledger stays Show documents).
- Bravo checklist → Modules Walk-through / Cameras + Entities GC.
- Show documents on Atrium lists Preview Level 1 / Level 2 and does **not** steal a Site plan preview.
- Preview-tree Hide documents hides pane children; ledger children stay.
- Child Preview Level 1 switches the pane to the document (Atrium as projectName). Ledger Hide documents does not close that pane.

**Break**

- `/?hubPreview=1&empty=1&tab=archive`: Nothing in Archive; Close preview **0**; Show documents **0**; Restore **0**; no UUID host error.
- Documents isolation: SE-011 Preview pane has Open file; Archive Site plan pane has neither SE-011 nor Open file.
- Filter Documents while Bravo is previewed stale-resolves the pane (`resolveArchivePreviewItem` against visible rows).

**Edge**

- Escape / heading click keep Bravo preview (no dismiss barrier on the pane).
- Select hides the pane; row click checks; Done restores the last `previewId` (Select does not clear it). Restore stays visible only in Select.
- 390: Close preview **0**; Site plan card click stays list; Show documents / Hide documents toggles Level 1 / Level 2. Empty fixture: Close preview **0**, Show documents **0**.

## Product

Archive Close preview was `title` only. Documents already ships `title="Close preview" aria-label="Close preview"`. **Fix:** Archive's icon-only close now has the same `aria-label`. Restore / Delete forever stay `previewBlocked`.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-archive-preview.spec.mjs` **1 / 1 (5.2s)**
- Node `tests/archivePreview.test.mjs` **3 / 3** (plus `tests/archiveScreen.test.mjs` still **43 / 43** in the same earlier run: **46 / 46**)
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `ARCHIVE_PREVIEW_PROOF` `defaultOrder: ["ap1","ad1","at1"]`, `archiveHostError: 0`, `emptyRestore: 0`, `desktopClosePreviewAria: true`, `showDocumentsIndependent: true`, `documentsIsolation: true`, `mobilePreviewAbsent: true`, `mobileShowDocuments: true`, `mobileEmpty: true`

## What is not claimed

This is **not** unblocked GAP = 0. Hunt after this slice: `fix-logs/archive-preview-hunt-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.
