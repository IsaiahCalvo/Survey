# Imported PDF Ink — Provenance & Parity Audit (KAL-91)

_2026-06-10, overnight loop. Investigation audit (read-only; the ticket's regression-
fixture/test work is the follow-up slice). Every claim carries file:line evidence;
Codex adversarial fact-check applied. One question is runtime-only and flagged as such._

## The five required confirmations

**1. Partial eraser PRESERVES provenance.** The eraser's serialization property list
includes all four flags (`FabricEraserCanvas.jsx:46-52`: isPdfImported,
pdfAnnotationId, pdfAnnotationType, layer — plus pdfInkRenderMode), they are
re-stamped on enliven (`:805-812`), and the partial-erase branch mutates only
path/stroke/position (`:398-489`). Survivors are NOT re-minted as app strokes.

**2. Sync classification: pushed fine, logged wrong, one duplicate risk.** The push
path has NO provenance filter — the edited Ink upserts normally. The ticket's
"treated as user-drawn" symptom is the diagnostic heuristic `obj.left == null`, which
exists in BOTH `useAnnotationCloudSync.js:180` AND `annotationCloudSync.js:278` —
and imported Ink carries left/top from import onward, so the diag log misclassifies
imported ink GENERALLY, not just after erasing (Bug B1, LOW; fix = check
`isPdfImported || pdfAnnotationId`). Real risk: identity resolution differs between
layers — `safeSnapshot.js:40` resolves `id ?? data.id ?? pdfAnnotationId`, while the
sync resolver prefers `annotationId || id || data.id || ... || pdfAnnotationId`, and
DB serialization mints a `data.id` for id-less imports — so an edited copy can live
under a minted id while the preserve-merge looks up a different one, letting hydrate
re-insert the STALE original beside the edited copy (Bug B2, MED; fix = one shared
imported-identity resolver comparing both the app id and pdfAnnotationId).

**3. Dashed-during-drag: most likely the selection chrome; runtime confirm needed.**
The PATH renderer never applies a dash (`svgPathAttrs.js:464-513` — non-scaling
stroke, closed-outline fill, no dash; importer dash patterns are honored only by the
non-path line/polyline/polygon renderers). The dashed visual during drag is therefore
almost certainly the SELECTION chrome — whose dash lives in
`SVGSelectionOverlay.jsx:123` — riding the dragged annotation. Confirming on the
actual SE-011 page-1 squiggle (inspect the selected object's type + strokeDashArray
at runtime) is the one RUNTIME-ONLY item.

**4. Selectability: imported Ink is fully interactive by default — and the survey-mode
selection leak is real.** Eraser eligibility explicitly includes imported Ink
(`FabricEraserCanvas.jsx:359-364`); SVG-layer interactivity has no layer/provenance
gate (`SVGAnnotationLayer.jsx:1741-1746`); `canModify` checks authorId only
(`useSVGInteraction.js:427-432`). In survey mode canvas-scoped annotations are
filtered from RENDERING (`SVGAnnotationLayer.jsx:1684-1690`) — but the selection
overlay reads `annotations.objects[selectedIndex]` directly, BYPASSING the filter
(`:4420-4423`), so a selection made before entering survey mode keeps its dashed
chrome over an invisible annotation. That is the ticket's "selection box in survey
mode" and it is KAL-89's mode-leak, affecting ALL canvas annotations (Bug B5, MED).

**5. Export after partial erase: EXPORT is likely fine; PRINT drops the edit.**
The export gate lets edited-imported objects through when
`pdfImportedEditState === 'edited'` (`pdfAnnotationsPdfLib.js:342-350`), and that
field IS set — not by the eraser itself, but by the save pipeline
(`viewerShared.js:1874,1880`, invoked from `PDFViewer.jsx:21166` before saves;
eraser commits route through it). CAVEAT: the eraser's own serializer does not carry
the top-level edit-marker metadata (`pdfImportedEditedAt/By/Source` are not in its
property list) — the chain works only because the save-path stamping runs later, and
no test proves the full erase→save→export journey (Bug B3 revised: MED — add the
regression test; if it fails, the original HIGH claim revives). The PRINT path is
unambiguous: it excludes imported objects UNCONDITIONALLY (`:160-163`) — an edited
imported squiggle prints as its original (real, user-visible). Separately, the
Phase-D bake engine has no imported exclusion of its own
(`pdfNativeExport/index.js:103-154`) — safe only while every caller routes through
`buildPdfExportAnnotationPlan` first (the imported-planner gate is pinned by
`pdfSaveExportContract.test.mjs`; the bake contract test pins SCOPE filtering only),
a double-bake landmine for any future direct caller (Bug B4, MED).

## Confirmed bug list

| # | Bug | Where | Severity |
|---|---|---|---|
| B1 | Diag logs call imported ink "user-drawn" (`left==null` heuristic, two copies) | `useAnnotationCloudSync.js:180` + `annotationCloudSync.js:278` | LOW |
| B2 | Hydrate can resurrect the stale original via mismatched identity resolvers (DB-minted `data.id`) | `safeSnapshot.js:40-56` + sync resolver | MED |
| B3 | PRINT drops edited imports unconditionally; export relies on save-path edit-stamping that no test proves end-to-end (eraser serializer also omits the edit-marker metadata) | `pdfAnnotationsPdfLib.js:160-163` + `viewerShared.js:1874,1880` + eraser props | MED (HIGH if the untested chain breaks) |
| B4 | Bake engine itself has no imported exclusion (upstream-filter reliance) | `pdfNativeExport/index.js:103-154` | MED |
| B5 | Selection chrome bypasses the survey-mode visibility filter (KAL-89) | `SVGAnnotationLayer.jsx:4420-4423` | MED |

## Policy decision for Isaiah (the ticket asks for an explicit policy)

Today's de-facto policy: imported ink is fully editable like app ink, provenance
survives edits, export carries edits IF the save-path stamping holds (unproven),
and PRINT always reverts to the original (B3). Two coherent options:
**(P1) "edits count"** — eraser/move set `pdfImportedEditState:'edited'`; exports
carry the edited version and suppress the original (the export gate already supports
this — B3 becomes a two-line eraser fix + suppression check); or **(P2) "imported is
read-only"** — gate selection/eraser on `isPdfImported` until an explicit
edit-imported mode. P1 matches current UX and is the small change; P2 is the bigger
product shift. Recommend P1.

## Slice plan (after the policy call)

1. **K91-1 (with P1):** prove + harden the edit chain: erase→save→export regression
   test (the missing proof for B3); add the edit-marker metadata to the eraser's
   serializer property list; decide print-path behavior for edited imports
   (currently: always the original).
2. **K91-2:** fix the B1 heuristic to read `isPdfImported` directly.
3. **K91-3:** id-unification test (B2): pin push-key === pdfAnnotationId for imported
   objects, or make mergePreservingImportedMarks check both ids.
4. **K91-4:** selection-overlay visibility check (B5) — belongs to KAL-89; cross-filed.
5. **K91-5:** the ticket's regression fixture: a reduced PDF with one native Ink
   (fixtures exist: debug/fixtures/se011.pdf) + tests; rides K91-1.
6. **Runtime check** (needs the app running): confirm dashed-drag mechanism (a) vs (b).

## Existing coverage / gaps
Importer flags + svgPathAttrs branches + export-gate edited/unedited cases are tested
(`pdfAnnotationImporter.test.mjs`, `pdfAnnotationNormalization.test.mjs`,
`pdfSaveExportContract.test.mjs:473-520`). NOT tested: eraser provenance survival,
the edited-flag lifecycle, mixed-input bake, B2's id mismatch, B5's leak.
