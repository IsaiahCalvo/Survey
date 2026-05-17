# KAL-9 Real PDF Edge-Case Validation Plan

Date: 2026-05-15

Scope: validate imported PDF-native annotation edge cases with real PDFs. This is intentionally separate from thumbnail, team data, and project-file persistence work.

## Why This Still Exists

`b20fcc08` improved the export/import contract and added broad synthetic coverage. That does not replace real PDFs from Acrobat, Bluebeam, Drawboard, Preview, or other tools. Real PDFs can differ in annotation subtype naming, `/NM` ids, object refs, appearance streams, border styles, rotations, and vendor-specific metadata.

## Existing Fixture Inventory

| File | Size | Useful for KAL-9? | Notes |
| --- | ---: | --- | --- |
| `debug/fixtures/Package 2 - Rev 4 -- IC.pdf` | 6.0 MB | Maybe | Real package PDF. Needs inspection to confirm whether it contains native PDF annotations. Good candidate for smoke open/render tests. |
| `debug/fixtures/text-search-glyph-lab.pdf` | 3.2 KB | No | Search glyph fixture from `4f2b276a`; useful for text search, not native annotation import. |

## Existing Automated Coverage

| Coverage | Source | Status |
| --- | --- | --- |
| Imported Squiggly conversion participates in sync/history/Y.Doc contract | `tests/annotationContractRegression.test.mjs` | Synthetic object coverage only |
| Imported Polygon conversion participates in sync/history/Y.Doc contract | `tests/annotationContractRegression.test.mjs` | Synthetic object coverage only |
| Imported PolyLine conversion participates in sync/history/Y.Doc contract | `tests/annotationContractRegression.test.mjs` | Synthetic object coverage only |
| General importer mapping and export/reimport contracts | `tests/pdfAnnotationImporter.test.mjs`, `tests/pdfSaveExportContract.test.mjs` | Strong baseline, but not enough for KAL-9 real-PDF signoff |

## Needed Real PDF Fixtures

Place fixtures under `debug/fixtures/pdf-native-edge-cases/` or another agreed ignored/private fixture directory if files are customer-sensitive.

| Fixture | Required contents | Source target | Pass criteria |
| --- | --- | --- | --- |
| `native-squiggly.pdf` | At least one PDF-native Squiggly text markup annotation | Acrobat or Preview preferred | Imports as editable app annotation with `pdfAnnotationType: "Squiggly"`, correct page/position, no duplicate native chrome. |
| `native-polygon.pdf` | At least one PDF-native Polygon annotation, preferably with fill and stroke | Bluebeam/Drawboard preferred | Imports as polygon/polyline-compatible app object, keeps vertices, selectable/evented, no bounding-box-only geometry loss. |
| `native-polyline.pdf` | At least one PDF-native PolyLine annotation, preferably multi-segment | Bluebeam/Drawboard preferred | Imports as open polyline app object, keeps vertices, selectable/evented. |
| `native-ink.pdf` | At least one PDF-native Ink annotation from an external PDF app | Acrobat/Preview/Drawboard | Imports as app pen/path, not as Squiggly, keeps provenance `pdfAnnotationType: "Ink"`. |
| `unsupported-native-types.pdf` | One or more unsupported types: FileAttachment, Sound, Movie, 3D, RichMedia, Redact | Any producer | Unsupported warning appears only for truly unsupported types; supported types do not trigger the warning. |
| `mixed-native-supported-unsupported.pdf` | Supported and unsupported annotations together | Any producer | Supported annotations import/edit normally; unsupported warning identifies remaining unsupported native annotations without blocking import. |
| `edited-imported-native.pdf` | Native annotation that is imported, edited in Survey, exported, and reopened | Generated from any native fixture | Edited app copy survives; original native duplicate is removed when identifiable; no duplicate visual annotation. |

## Manual Validation Steps

For each real fixture:

1. Open the PDF in Survey.
2. Save logs immediately after import.
3. Confirm the import summary and native layer policy logs:
   - `[PDFImport] native layer policy`
   - `[PDFAppLayerStateImport] summary`
4. Inspect app state or UI:
   - imported supported annotations are visible once
   - supported annotations are selectable and evented
   - Syncfusion red native handles/adorner layer do not appear for imported supported annotations
   - unsupported warning appears only when unsupported annotations exist
5. Edit one supported imported annotation.
6. Export the PDF.
7. Reopen the exported PDF.
8. Confirm:
   - no duplicate native/app copy
   - edited geometry/style survives
   - logs include `[PDFImportedEditExport] summary`
   - `editedImportedCopiesExported` increments for the edited case

## Specific Checks By Type

### Squiggly

- Must not be mistaken for app pen/highlighter.
- Must keep the text-markup bounds close to the source text.
- Must not trigger unsupported warning.

### Polygon

- Must keep all vertices.
- Closed shape should remain closed.
- Fill and stroke should survive when available.
- Selection should use app chrome, not red native handles.

### PolyLine

- Must keep all vertices.
- Open shape should remain open.
- Curved producer output is acceptable as tessellated segments, but should not collapse to one bounding box.

### Native Ink

- Must import as `pdfAnnotationType: "Ink"`.
- Must remain visually close to source.
- Must be treated separately from Squiggly.
- Known backlog: smooth curves from `/AP` streams and ink-dot detection are still tracked in `.planning/FEATURE-BACKLOG.md`.

### Unsupported Native Types

- Supported native types should not trigger the unsupported warning.
- Unsupported warning should fire for the truly unsupported list only: FileAttachment, Sound, Movie, 3D, RichMedia, Redact.
- Unsupported native annotations should not crash import or block supported annotations from loading.

## Current Gaps

- No checked-in real fixture is proven to contain Squiggly, Polygon, PolyLine, native Ink, or unsupported native annotations.
- Existing tests use synthetic annotation objects, not PDFs produced by external tools.
- No fixture matrix records producer app/version. Add that when collecting real PDFs.

## Recommended Linear Status

Keep `KAL-9` open until:

- at least one real fixture exists for Squiggly, Polygon, PolyLine, and native Ink
- unsupported warning behavior is verified with a real unsupported annotation fixture
- results are recorded with log folder paths and pass/fail notes
