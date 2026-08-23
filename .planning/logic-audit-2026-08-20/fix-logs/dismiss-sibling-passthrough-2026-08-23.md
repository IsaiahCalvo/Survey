# Product bug: Style / Search dismiss ate Width / Upload — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `09a0aca9` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The color-picker Width/Style inspect (`ffe7a892` / `f8370978`) parked remaining click-eat dismiss. This pass found two sibling holes of the same class: 390 `MobileStyledSelect` (Style / Arrowhead) had no strip passthrough, so the first Width tap only closed the menu; Documents / Projects Search had no header-action passthrough, so the first Upload / New project click only blurred the field (Templates / Archive already passthroughed theirs). Distinct from leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

Inspected and **not** the same hole:

- Desktop Style / Font / Width — Radix; first sibling click already opens
- Desktop CompactColorPicker — already `COLOR_PICKER_SIBLING_PASSTHROUGH`
- 390 color takeover — modal backdrop; strip chrome stays underneath
- Hub More / document-row dismiss — first outside click is consumed on purpose
- Bookmarks create / History / page-thumb — no sibling chrome of this class
- Canvas / document-row dismiss — still consumed

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` / `.env.test` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

Min-viable:

- `src/mobile/MobilePdfViewerChrome.jsx` — `MOBILE_SELECT_SIBLING_PASSTHROUGH` (`[data-mobile-tool-properties]`) on `MobileStyledSelect` + counter series menu
- `src/home/DocumentsLedger.jsx` — Search `dismissActionSelector` for Upload
- `src/home/ProjectsFolderTree.jsx` — Search `dismissActionSelector` for New project

Canvas / document-row clicks stay consumed. Color swatch on the desktop picker is still not in that list.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-dismiss-sibling-passthrough.spec.mjs` **2 / 2 (6.8s)** on Vite `http://127.0.0.1:5199`. Focused Node `mobileSelectSiblingPassthrough` + `viewerDismissBarrierContracts` + `leftover18FailClosed` + hub upload/projects extras **30 / 30**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

390 Rectangle: open Style + first Width tap opens presets; Cloud gone. Arrow: open Arrowhead + first Width tap opens presets. Documents Search focused + first Upload click logs `[hub preview] upload` and blurs.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Canvas dismiss | 390 Style open, tap page with Pen available | menu closes; ink count unchanged |
| Document row | Search focused, click a ledger row | search blurs; editor does not open |

### Edge

| Slice | Evidence |
|---|---|
| 390 | Style / Arrowhead first Width |
| hubPreview | first Upload while Search focused; row does not open |
| testPdf | Draw visible; `file.id` null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
