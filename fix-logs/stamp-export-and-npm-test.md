# Stamp / image export hunt + official npm test — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Text-flatten product:** `99478f57` (live-proved `403db578`)  
**Goal:** stays open

Did **not** replay text/ink/polygon/line specs.  
Did **not** replay leftover 18. No prod SQL. No budget loosen (8448 / 75/250). No secrets.  
Did **not** invent an image/stamp flatten or export writer.

High-risk files **not** edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## 1. Stamp / image verdict — not a user-facing tool; not invented

The product does **not** let a user place a stamp or image on `?testPdf=` and print/export it. There is no affine miss of this class. No writer added.

### `?testPdf=` toolbar — no stamp / image control

`src/PDFViewer.jsx` `activeCategoryDropdown` sub-toolbar (`#chrome-sub-toolbar-host`):

| Category | Tools offered |
|---|---|
| `draw` | pen, highlighter, eraser |
| `shape` | rect, ellipse, line, arrow, counter |
| `review` | text, callout (note / underline / strikeout commented out) |
| `survey` | survey-marker |
| `forms` | form-textbox, form-checkbox, form-radio, form-signature |

No `stamp`, `image`, `photo`, or `picture` tool id exists in `src/` (`id: 'stamp'|…` grep empty). Mobile chrome has no stamp/image either. Survey-note photo upload is a marker **note attachment**, not a page annotation (`PDFViewer.jsx` note dialog) and does not go through flatten/export writers.

### Native PDF `/Stamp` — unsupported import, preserved in file

`src/utils/pdfAnnotationImporter.js` lists Stamp with Link/Widget/Popup/FileAttachment as **unsupported** (not converted to Fabric). Counts feed `unsupportedAnnotationNotice.js`:

> "N stamps … aren't displayed. They're not deleted — they stay in the file and will still be included when you export."

That path is **native-copy preservation**, not an app writer. Unedited imported natives skip the Fabric plan as `imported-pdf-native-preserved` (`pdfAnnotationsPdfLib.js` `buildPdfExportAnnotationPlan`). Not a vanish/transform miss of a user-placed stamp.

### Fabric `image` / DB `stamp` — serializer + hit-test only

Existing paths **outside** a flatten writer:

| Path | What it is | Writer? |
|---|---|---|
| `annotationTypeSerializers.js` `image → 'stamp'` | Cloud row type map if a Fabric image ever existed | No PDF writer |
| `annotationCloudSync.js` / `crdtBackfill.js` `'stamp'` in type lists | Same DB enum | No |
| `geometryHitTest.js` `case 'image'` | Hit-test stub | No |
| `SVGAnnotationLayer.jsx` dispatch | path / rect / line / group / circle / ellipse / polygon / polyline / textbox / text / i-text / counter / callout — **no `image`** | No renderer |
| `EXPORTABLE_FABRIC_TYPES` | path, rect, circle, ellipse, polygon, polyline, line, textbox, text, i-text — **no image/stamp** | Hypothetical image → `unsupported-type` skip |
| `drawFlattenedObject` | path, rect, circle, ellipse, polygon, polyline, line, text, counter, callout — **no image** | No print flatten |
| `pdfNativeExport/adapters` | ink / square / circle / line / polygon / polyline / freeText / text markup — **no stamp adapter**; flag-off / not live export | Not invented |
| `PageAnnotationLayer.jsx` | no `fabric.Image` / stamp create | No |

No create/commit path writes `type: 'image'` or `type: 'stamp'` into `annotationsByPage`. Do **not** invent a writer for a type the toolbar cannot place and the SVG layer cannot draw.

### Not this class (already documented; not replayed)

Text/ink/polygon/line flatten affine. Survey markers excluded from export + regular print. Text `angle`. Flag-off `pdfNativeExport`.

## 2. Official `npm test`

Pending — receipt committed before the suite; results appended after.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Goal

Stays **open**.
