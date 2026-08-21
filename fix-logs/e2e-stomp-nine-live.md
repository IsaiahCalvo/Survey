# E2E live-prove — nine restored stomps (P1-02/42/43/54/44/47/55, P2-06/07)

**Date:** 2026-08-21  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open  
**Prior receipt:** `.planning/logic-audit-2026-08-20/fix-logs/fixlog-stomp-sweep.md` (Node 40/40, no Vite)

Did **not** replay P1-12/38/53, wave7, or leftover 18. No prod SQL. No budget loosen. No secrets.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs debug/scenarios/e2e-stomp-nine-live.spec.mjs
```

**Result: 9 passed (25.5s)**

`?testPdf=` / `?hubPreview=1` as fits. Each case: intended + break + edge.

## Extra product fix (min-diff)

`src/home/HubPreview.jsx` — preview user had no `id`; projects/docs used `user_id: 'u1'`, so restored owner gates hid Manage Team / Manage Access.

- SurveyHub `user` now includes `id: mockUser.id` (`dev-hubpreview-user`).
- Project **Tower 5 — Security** (`p1`) stamped `user_id: mockUser.id`.
- Doc **SE-011 Security Shop Drawings.pdf** (`d1`) stamped `user_id: mockUser.id`.
- **Package 2** (`d2`) and **Lab Reno / MEP Phase 2** left unstamped so leftover A-03 ShareModal stays.

High-risk files not edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).  
`zoomGeneration`, SVG viewBox, container-aware canvas, single-name `fontFamily`, CORS `*` untouched.

## Verdicts

| ID | Verdict | Live proof | Node-only / leftover |
|---|---|---|---|
| **P1-02** `resolveExportedLineEnding2` | **pass** | Draw Arrow → Export → `/LE [ /None /ClosedArrow ]`. Plain Line export adds no extra ClosedArrow. | Arrowhead **None** picker did not change stored style (`solidTriangle` stayed). Default `/LE` still proved. |
| **P1-42** PagesPanel IndexedDB cache | **pass** | `?testPdf=spike-120-pages.pdf` Pages panel; IndexedDB `survey-thumbnail-cache-v1` keys `pages-panel::<stamp>::<n>::fast/crisp::r0`; survive reload. Break: null stamp / page 0 → no key. | — |
| **P1-43** `canReorderVisiblePages` | **pass** | Full 1..n gate true. Assign pages 2,5. Page-only **Turn on space** toasts “no regions yet” (`spaceHasActivatableRegions`). **Edit region** activates. Pages rail shows `[2,5]`; drag does not reorder. | Must activate via region-edit, not page-only toggle. |
| **P1-54** black-thumbnail probe | **pass** | Live thumbs accepted (not black). Vite-imported `isLikelyBlackThumbnailPixels`: solid black reject; white / contrast / empty accept. | Image onload retry loop not driven (no black-page fixture). |
| **P1-44** `nextBookmarkOrder` | **pass** | Bookmarks stomp-a/b/c append in order. Folder + child. Helper: root 6, nested 10, empty 0, missing order 1. | — |
| **P1-47** `collectBookmarkTreePersistUpdates` | **pass** | Drag ☰ handle: mid above top. Helper: noop `[]`; nest only updates `b`. | First `dragTo` on whole row failed; use handle + keyboard fallback. |
| **P1-55** `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false` | **pass** | Live module `=== false`; RETIRED comments; no `ALWAYS fires the legacy upsert`; draw rect → no `document_annotations` writes. | Dual-write helpers still exported, unused. |
| **P2-06** `userCanManageProjectTeam` | **pass** | Tower 5 → Manage team → Manage Team + Invite. Lab Reno: no Team. Guest: no Team. | Needed HubPreview stamp. |
| **P2-07** `userCanManageDocumentAccess` | **pass** | SE-011 Share → Document Access (not Share document). Package 2 Share → ShareModal (A-03 path). Guest Share → ShareModal. | Needed HubPreview stamp. |

## Leftover 18 — unchanged

Not replayed. Still open: P1-01, P1-03, P1-04, P1-10, P1-13, P1-23, P1-25, P1-27, P1-32, P1-33, P1-41, P1-45, P1-46, P1-48, P2-02, P2-05, P2-10, A-03.

## Spec

`debug/scenarios/e2e-stomp-nine-live.spec.mjs`
