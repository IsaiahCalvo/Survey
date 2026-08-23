# Product bug: Color picker dismiss ate Width / Style — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `6436c11e` (fix + live proof).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The project-name Escape inspect (`b1ac6bcd` / `d9545613`) exhausted the remaining rename/INPUT chrome (file-row is display-only; Documents/Archive `RenameModal`; folder rename is project-name; Spaces / Templates / tab title already restore or are not inputs). This pass switched to click-outside dismiss that eats the next click. Annotation `CompactColorPicker` had no sibling passthrough, so the first Width / Style click after typing hex only closed the picker. Font color already passthroughed Font / Font size. Distinct from leftover-18 / X-01. Did **not** invent flatten / stamp / Forms.

Inspected and **not** the same hole:

- Hub file-row title — display text; Documents / Archive use `RenameModal`
- Hub folder rename — no distinct folder field (project-name already restored)
- Spaces space-name + region — already restore / cancel
- Templates existing-row — already restore-then-blur
- Tab title / mobile document name — display / marquee, not edit
- Canvas dismiss — still consumed (no next-draw stroke)
- 390 color takeover — modal backdrop; Escape closes; strip Width is underneath

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

Min-viable in `src/AppShell.jsx` (`COLOR_PICKER_SIBLING_PASSTHROUGH` on both CompactColorPicker mounts):

- Width / Style / Font / Font size / Arrowhead / Eraser type / Align receive the dismiss click.
- Color swatch is **not** in the list — one click closes, does not reopen.
- Canvas clicks stay consumed so dismiss cannot start a stroke.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-color-picker-width-passthrough.spec.mjs` **2 / 2 (10.4s)** on Vite `http://127.0.0.1:5219`. Focused Node `colorPickerSiblingPassthrough` + `viewerDismissBarrierContracts` + `leftover18FailClosed` + size/formatting contracts **25 / 25**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

Pen: type hex **00FF00** + first Width click opens presets; picker gone. Rectangle: type hex **FF0000** + first Style click opens Cloud; picker gone.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Canvas dismiss | click page with Pen armed | picker closes; ink count unchanged |
| Color swatch | click Color while open | closes, does not reopen |

### Edge

| Slice | Evidence |
|---|---|
| 390 | sheet → large swatch → hex; Escape closes; Width presets **0** |
| hubPreview | Width presets **0**; Hex color **0** |
| testPdf | Draw visible; `file.id` null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
