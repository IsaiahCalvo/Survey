# Handoff — Imported annotations: close the last non-native gaps
Written: 2026-07-19 (rewritten after worktree recycle; original 2026-07-17). Self-contained brief. Repo: /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2. SMALL, partly investigative — closing footnotes, not a migration.

## Context (verified audit 2026-07-17)
Owner's rule: EVERY imported PDF annotation becomes NATIVE unless we genuinely have no equivalent, in which case the unsupported-annotation notice covers it. This is ALREADY ~95% true. Native on import: Ink (open AND filled/pressure/marker — converged to native `paperInkGeometry:'v1'`), Square, Circle, Line, Arrow, Polygon, PolyLine, FreeText, foreign FreeText-callouts (→ native callouts), Caret. Highlight + sticky-note Text import as fully-editable native rect/note proxies. All non-displayable types (Stamp, Sound, Movie, FileAttachment, 3D, Watermark, Redact, unknowns) are caught and announced by the notice. Importer: `src/utils/pdfAnnotationImporter.js`.

## Gap 1 — Underline / StrikeOut / Squiggly import LOCKED (select + delete only)
Visible but hard-locked: no move/scale/rotate, no handles. Cites: importer ~2873-2983 + PAL gate `isSelectDeleteOnlyPdfMarkupObject` / `lockSelectDeleteOnlyPdfMarkupObject` (`PageAnnotationLayer.jsx` 68, 76-99). The ONLY surviving behavior branch on the `isPdfImported` flag.
- Why: text markup anchors to WORDS; we have no text-run/word-geometry engine, so a movable underline would detach from its text. Prior research: JUSTIFIED divergence.
- **DECISION NEEDED — surface to owner, do NOT guess:** (a) accept the lock as correct-by-nature and document as intentional (recommended; matches Acrobat/Bluebeam), or (b) commit to a text-selection/word-geometry engine so these become fully native — a real multi-session feature. **Never unlock without that engine.**

## Gap 2 — Imported form fields (Widgets) bypass the annotation path
`Widget` is in `SILENT_IGNORE_SUBTYPES` (importer :3075) — the annotation importer drops them; a SEPARATE form-field subsystem in `PDFViewer.jsx` (~2844-2872, form mode) owns them. Likely intentional, but flagged as "neither native nor noticed."
- **DO:** verify the form subsystem ROUND-TRIPS imported fields — open a PDF with form fields, confirm they appear/work, survive save/export. If yes: document that Widgets are deliberately owned by the form subsystem. If no: that's a real bug — fix or file it with evidence.

## Cleanup (trivial, do it)
`UNSUPPORTED_SUBTYPES` array (importer :107) is DEAD CODE — declared, never referenced (the notice is a true catch-all via `categorizeAnnotations`). Verify zero references, delete it.

## Hard constraints
- Do NOT unlock text markup without a real text-anchoring engine.
- Provenance flags (`isPdfImported`, `pdfAnnotationId`, `pdfImportedEditState`) survive as PROVENANCE (export preserve/remove, hydrate protection, re-import dedupe). "Native" = no BEHAVIOR branches on them (except the justified text-markup gate) — not deleting flags.
- The unsupported notice keeps catching everything it catches today.
- `src/PDFViewer.jsx` high-risk: minimal scoped edits.

## Verification
- `node scripts/run-node-tests.mjs` 0 fail + `npx vite build` green.
- Import a PDF with form fields → the Gap-2 round-trip check (construct one with pdf-lib if no fixture exists).
- Import underline/strikeout → still visible, select/delete works (unchanged if left locked).
- Stamp PDF → notice still fires after the dead-array deletion.

## Linear
KAL-91 carries the audit findings.
