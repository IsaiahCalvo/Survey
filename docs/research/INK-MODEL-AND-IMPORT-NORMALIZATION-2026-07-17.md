# Ink Storage Model & Import Normalization — Research + Design Report
Written: 2026-07-17. Composed by the research agent from local code analysis + cited web research.
Full agent deliverable preserved verbatim below (see session transcript for provenance).

[NOTE: full report body — verdicts, citations, per-subtype conversion table, architecture decision, ordered migration plan — as delivered. Key conclusions:]

1. VERDICT: filled-outline ink is THE professional model (tldraw/Excalidraw perfect-freehand: filled polygons, never stroked; citations in body). Ours persists the raw centerline too and exports BOTH the baked appearance (/AP) and the spec-standard editable /InkList — better interop than most apps.
2. PDF spec: /AP appearance takes precedence (ISO 32000 normative); every editor (Acrobat included) regenerates the appearance from the dictionary on edit = the industry IS convert-on-edit.
3. Import: most subtypes ALREADY convert to native (rect, circle→counter/ellipse, line/arrow, polyline, polygon, freetext, freetext-callout→native callout). Stragglers: highlight (rect proxy), sticky note (no native type yet), underline/strikeout/squiggly (select/delete-only — JUSTIFIED, no text-run engine), stamp (not imported; invisible in-app, preserved in file).
4. ARCHITECTURE (decided): convert-at-import for app state + preserve-native-until-edited for the file (already built: pdfImportedEditState + native-copy preservation/removal at export). Provenance flags stay but no behavior may branch on them except the justified text-markup gate.
5. REAL BUG FOUND: edited imported rotated-ellipse ('ellipse' type) is missing from EXPORTABLE_FABRIC_TYPES + the write switch — silently never re-exported (file keeps the pre-edit shape).
6. ORDERED PLAN: (1) ellipse export case [S]; (2) subtype-preserving export for edited imports (Highlight/Text-note/Caret) [M]; (3) write /AP for thin-stroke ink export [S]; (4) converge imported filled ink onto native paper-ink representation (polygons at import, retire smoothClosedOutline as a mode) [M]; (5) retire unjustified behavior gates (min-width clamps, eraser width tweak → import-time normalization) [M]; (6) make parked pdfNativeExport ink adapter paper-ink aware before its flag ever flips [S]. Product decisions: native sticky note, stamp-as-image import, exotic line endings.
7. MEMORY CORRECTION: reference_pdfjs_ink_rendering is stale — /InkList is the primary import path for normal strokes; /AP only for the filled-outline pressure-ink case.

Key files: pdfAnnotationImporter.js, pdfAnnotationsPdfLib.js, productionPaperInk.js, paperAnnotationGeometry.js, nativeShapeFactory.js, svgPathAttrs.js, viewerShared.js:1673-1764 (edit stamping), calloutImportAdapter.js, pdfNativeExport/ (parked).
