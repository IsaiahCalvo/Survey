# Annotation Fix 23 - Space/Region Export Sanity Log

Date: 2026-05-13

## Current Space CSV behavior

- Entry point: `handleExportSpaceToCSV` in `src/App.jsx`.
- Exports one CSV row per matching Fabric annotation in each assigned Space page.
- Headers: Space Name, Page, Mode, Region Count, Annotation Type, Annotation ID, Left, Top, Width, Height, Stroke Color, Fill Color, Stroke Width, Notes, Checklist Items, Status, Attachments.
- Adds category summary rows when `space.categories` exists.
- Whole-page Space entries use `Mode=full` and include annotations on that assigned page, except annotations explicitly tied to a different `spaceId`.
- Region Space entries use `Mode=region` and include annotations whose computed center point is inside any stored page region.
- Fix applied: region membership now compares stored page-coordinate annotation centers against stored page-coordinate regions with scale `1`. It no longer depends on current viewer zoom.

## Current Space PDF behavior

- Entry point: `handleExportSpaceToPDF` in `src/App.jsx`.
- Creates a new `PDFDocument`.
- For each assigned page, loads the source PDF page through `pdfDoc.getPage(pageNumber)`, renders that page into a canvas at PDF scale `1`, embeds the canvas as a PNG image, and adds it as a page in the new PDF.
- For region Space entries, applies `applyRegionMaskToCanvasContext` before embedding the PNG.
- This path does not call `savePDFWithAnnotationsPdfLib`.
- This path is separate from File menu Export, which is the annotated-PDF export path.

## Annotation inclusion/exclusion

Space CSV:

- Regular Fabric annotations: included when on an assigned page and not explicitly scoped to another Space.
- Survey Fabric annotations: included by the same page/region geometry rules.
- Region Fabric annotations: included when their center point falls inside the assigned region.
- Survey-region Fabric annotations: included when their center point falls inside the assigned region.
- Survey highlights: excluded; they live in `highlightAnnotations`, not `annotationsByPage`.
- Callouts: excluded; they live in `callouts`, not `annotationsByPage`.
- Counters: included when represented as Fabric objects in `annotationsByPage`.
- Imported native PDF annotation copies: included in CSV if present in `annotationsByPage` and matching the page/region rules. CSV is metadata output, so this does not create PDF duplication.

Space PDF:

- Base PDF page: included as a raster image.
- Regular app annotations: excluded.
- Survey app annotations: excluded.
- Region app annotations: excluded.
- Survey-region app annotations: excluded.
- Survey highlights: excluded.
- Callouts: excluded.
- Counters: excluded unless already part of the source/native PDF rendering.
- Imported native PDF annotations: likely included only to the extent pdf.js renders them into the base page canvas. This path does not explicitly inspect, preserve, or deduplicate native annotations.

## Region clipping/masking

- CSV region filtering is now page-coordinate correct for center-point inclusion.
- Space PDF region behavior is masking, not true clipping/cropping.
- The output page remains full size. Content outside the selected region is dimmed and hatched by `applyRegionMaskToCanvasContext`; selected region areas are left clear.
- This is technically valid only as "masked base PDF pages", not as a cropped region PDF or annotated region export.

## Misleading behavior decision

- The old Space PDF menu label was simply `PDF`, which was misleading because it did not export app annotations even though the normal File menu Export does.
- No new export dialog, scope chooser, print panel, or UI mockup was added.
- The existing action remains enabled, but it is now labeled `PDF Pages` and has a tooltip: "Exports base PDF pages only; app annotations are not embedded."
- This makes the current action honest without building a new UI-heavy export flow.

## Files changed

- `src/App.jsx`
  - Fixed Space CSV region filtering to use page-coordinate scale `1`.
- `src/sidebar/SpacesPanel.jsx`
  - Renamed Space export menu item from `PDF` to `PDF Pages`.
  - Added tooltip explaining that app annotations are not embedded.
- `tests/pdfSaveExportContract.test.mjs`
  - Added regression coverage for Space CSV region filtering scale.
  - Added regression coverage for honest Space PDF menu copy.
- `ANNOTATION_FIX_23_SPACE_REGION_EXPORT_SANITY_LOG.md`
  - Added this audit log.

## Tests run and exact results

Command:

```bash
node --test tests/pdfSaveExportContract.test.mjs tests/annotationVisibilityRules.test.mjs tests/annotationContractRegression.test.mjs
```

Result:

```text
1..29
# tests 45
# suites 7
# pass 45
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 348.867875
```

Notes:

- Node emitted existing `MODULE_TYPELESS_PACKAGE_JSON` warnings.
- One expected negative-path test logged `Refusing to overwrite the original PDF path without explicit allowOriginalOverwrite=true`.

Command:

```bash
npm run build
```

Result:

```text
✓ 1721 modules transformed.
✓ built in 33.02s
```

Notes:

- Vite emitted existing warnings about the deprecated CJS Node API, pdf.js `eval`, mixed static/dynamic imports, and large chunks.

## Remaining gaps

- Space PDF still does not export app-created annotations, survey highlights, callouts, or explicit native-annotation metadata handling.
- Space PDF region output is a full-page masked raster export, not a cropped vector/PDF annotation export.
- A complete annotated Space/Region PDF export would need a scoped export implementation that reuses `savePDFWithAnnotationsPdfLib` semantics while filtering pages and annotation scopes. That was intentionally not built here because the task forbids a new export scope chooser or UI-heavy export work.
