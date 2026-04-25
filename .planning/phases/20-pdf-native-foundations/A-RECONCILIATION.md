# Phase A Reconciliation — PDF-Native Annotations Milestone (Foundations)

## Plan vs Actual

- **Planned:** Add `annotpdf` dependency (A.1), scaffold the feature flag with env + per-document override (A.2), pure coordinate-space helpers (A.3), public API surface for the bake pipeline (A.4), reconcile and tag the milestone (A.5). All five tasks follow failing-test-first → minimal implementation → passing test → commit.
- **Actual:** All four implementation tasks landed exactly as planned. Each was committed independently. Tests for every new module are green. No existing source file was modified except `package.json` (dependency add + test script update — see Deltas).
- **Deltas:**
  - The `annotpdf` library's actual exported surface in version 1.0.15 is class-based (`AnnotationFactory`, `AnnotationIcon`, `AnnotationState`, `FreeTextType`, `LineEndingStyle`, `PDFDocumentParser`, `TextJustification`, `Util`) rather than the standalone `createHighlightAnnotation` / `createInkAnnotation` / etc. that Phase A's verification step speculated about. This does not block Phase A — no adapter code lives in Phase A — but Phase B's adapter implementations will dispatch through `AnnotationFactory` and friends. Carry-forward note for B.0 fixture extraction work.
  - Test runner in `package.json` was updated from `node --test tests/*.test.mjs` (flat top-level only) to `node --test 'tests/**/*.test.mjs'` (recurse) so the new nested `tests/pdfNativeExport/` directory is picked up by `npm test`. The plan's File Structure assumed the nested path, so this update was implicitly required. Pre-existing tests still execute the same set (all 232 still found; 3 pre-existing failures in `pdfAnnotationImporter` remain — unrelated).

## Acceptance Criteria Results

- [x] **Given** the flag is OFF or ON, **when** the user opens a document and edits an annotation, **then** the experience is byte-identical to today (no Syncfusion annotation toolbar, no event bridge, no console churn, identical database writes). — **PASSED.** Evidence: a recursive `grep` of `src/` and `tests/` shows zero imports of any module under `src/utils/pdfNativeExport/` outside the new module's own folder. The flag, the coordinate helpers, the adapter registry, and the bake stub are all dormant code with no consumer. Manual smoke test deferred to user — by inspection there is no code path through which the flag state can affect runtime behavior.
- [x] **Given** the new public API surface exists, **when** unit tests are run, **then** the feature flag, coordinate-space, and adapter-registry skeletons all pass their tests. — **PASSED.** Evidence: `npm test` reports 240 tests, 237 passing, 3 pre-existing failures unrelated to this milestone (the same 3 that were red before Phase A started). The new Phase A test files report 3 + 2 + 3 = 8 passing tests.

## Boundaries Honored

- DO NOT CHANGE list (Phase A scope: every file in the project except `package.json` and the new files under `src/utils/pdfNativeExport/` and `tests/pdfNativeExport/`):
  - `src/App.jsx` — untouched ✓
  - `src/components/SyncfusionPDFContainer.jsx` — untouched ✓
  - `src/components/PageAnnotationLayer.jsx` — untouched ✓
  - `src/components/SVGAnnotationLayer.jsx` — untouched ✓
  - Fabric canvas trio (`FabricDrawingCanvas`, `FabricEditCanvas`, `FabricEraserCanvas`) — untouched ✓
  - `vite.config.js` — untouched ✓
  - `package.json` — touched in scope: dependency `annotpdf ^1.0.15` added, `test` script updated from flat-glob to recursive-glob to pick up nested test folder. No other `package.json` change.
- Cross-chunk invariants honored: bake pipeline is pure (it throws not-implemented; nothing writes to the database); feature-flag everything (every new module is dormant; the only env read is gated by the flag function); database remains source of truth (no database touch anywhere in Phase A); zoomGeneration signal contract preserved (no edit-pipeline file touched); container-aware sizing rule preserved (no canvas code touched); single-name font rule preserved (no FreeText annotation produced yet).

## Lessons / Carry-forward

- The `annotpdf` API in 1.0.15 is class-based, not function-based as the plan assumed. Phase B fixture-extraction tasks should sample the real `AnnotationFactory` method names before writing adapter test fixtures so the adapter task steps reference the right call shapes.
- Test runner glob update is now in place — every Phase B adapter file under `tests/pdfNativeExport/adapters/` will be picked up by `npm test` automatically.
- Manual smoke test under both flag states was not run in this session (no live app session). Recommend the user spend ~2 minutes opening the largest test PDF, drawing every tool, and confirming the experience is identical to v0.1.12 baseline — this should be a no-op given the dormant-code grep above, but a human eyeball is the final acceptance criterion.

## Status: DONE_WITH_CONCERNS

Concerns are minor and non-blocking for Phase B:
1. The `annotpdf` API surface deviation from the plan's speculative function names — needs to be reflected in Phase B fixture extraction.
2. Manual smoke test deferred to the user (every change is dormant, but the plan asked for the human-eyeball pass).
