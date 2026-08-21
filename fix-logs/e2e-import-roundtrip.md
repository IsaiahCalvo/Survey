# E2E import roundtrip — annotated export via web file control

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave9, leftover 18, or Electron native File→Open (`UL-03`).  
No prod SQL. No budget loosen. No secrets. No `.bot-credentials.json` / `.env*`.  
Did **not** invent a guest-local importer.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

Wave9 download was **not** on disk. Created a fresh annotated export (pen + rect + text) on `?testPdf=clickable-link-test.pdf`, then left that route. Import used the **hub web file control** only.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-import-roundtrip.spec.mjs
```

**Live: 1 / 1 passed (1.0m).** Receipt `IMPORT_ROUNDTRIP`.

## Web open paths hunted

| Path | What it is | Used? |
|---|---|---|
| Hub `<input type="file" accept="application/pdf">` (Dashboard, 2 inputs: documents + project) | Real web file control. Upload click opens the browser picker, then `handleFileUpload`. Guest → `Please sign in to upload documents.` + auth modal. Signed-in → `createSupabaseDocument` (cloud). | **Yes** — this hunt |
| In-editor open | PDFViewer file inputs are note photos/videos (`image/*` / `video/*`). No PDF open. | None |
| Drag-drop on hub | `Dashboard.handleDrop` only appends PDFs to the create-project modal. Does not open an editor. | None |
| `?testPdf=` | DEV fixture loader (`/debug-fixtures/` → `window.__devTestPdf`). Not a user file control. Used only to **create** the export, never to import it back. | Export only |
| `?hubPreview=1` upload | Mock `console.log` unless `workflowE2E`, which then opens a hardcoded fixture, not the selected file. | None |
| Electron File → Open / `dialog:openFile` | Leftover `UL-03`. `window.electronAPI` was **false** on this Vite page. | **Not used** |

## Verdicts

| Hunt | What | Verdict | Live proof |
|---|---|---|---|
| **Intended** | Export pen + rect + text (`20957` bytes, `clickable-link-test-annotated.pdf`), then `setInputFiles` on the hub PDF input | **blocked** | Guest. `Please sign in to upload documents.` + Welcome-back modal. Editor did **not** open. No invented importer. |
| **Break** | Cancel the web picker; feed a `.txt` | **pass** | Cancel: filechooser fired, abandoned, stayed on `/`, no editor. Non-PDF: silent reject (`file.type !== application/pdf`), no editor, no sign-in error. |
| **Edge** | Same web control + `debug/fixtures/kal412-mixed-import-e2e.pdf` (native annots) | **blocked** | Same leftover auth gate. Did **not** fall back to `?testPdf=kal412-mixed-import-e2e.pdf`. Live draws were not stomped because the file never opened. |

`signedIn: false`. `electronApi: false`. `fileInputCount: 2`. Drawn ids: pen `ea8acf0e-…`, rect `b8945c65-…`, text `a1c90e8d-…` (`rt-import`).

## Product fix

**None.** The web file control exists. Opening through it requires leftover-18 sign-in (`A-01` Turnstile) and then cloud persist (`X-05`). Guest upload is an intentional product gate (`AGENTS.md`), not a missing importer. High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-import-roundtrip.spec.mjs`

## Goal

Stays **open**.
