# De-Fragilize Campaign — Progress Ledger

Branch: `claude/magical-raman-95374e`. Governing doc: `HANDOFF-strengthen-codebase.md`.

Baseline gates (verified at kickoff): build clean · node tests **1685 pass / 0 fail / 84 skip** ·
render-smoke ✅ · callout-interaction-e2e 6/6 ✅. Dev server for smoke: `http://localhost:5185`.

Gate helper: `bash <scratchpad>/gate.sh [--smoke]`.

## Rules (from HANDOFF run-mode)
- Green means green. Never mark a batch done while build / node tests / smoke fail.
- Honest tests only — a deleted coverage gap gets a real replacement test.
- Small commits, one logical change each. Land on local `main` (here: the branch); push only after owner approval.
- Min-viable diff in PDFViewer / PageAnnotationLayer / Fabric canvases / SVGAnnotationLayer. No opportunistic refactor.
- Correctness invariants: container-aware canvas sizing; single-name fontFamily; zoomGeneration signal; SVG viewBox owns zoom.

## Status of prior work (verified this session)
- §1 small-dead-bits (dead icons, callout/excel/microsoft dead exports): **DONE in prior sessions** (grep-confirmed gone).
- §3a ID generators → crypto.randomUUID(): committed (86c19ec3).
- §3b deepClone routing (PDFViewer + inline): committed (a0a89807, 498add98, a7b9244f).
- §4a A+B (capturePdfjsZoomSnapshots + schedulePdfjsVisiblePagesRefresh bodies): DONE (b019ba7d).
- §4e JSX ternary collapses: DONE (63171da5).
- §4f broken auto-recorder rAF loop: **DONE 2026-06-28** (comment at PDFViewer.jsx:8967). Remaining manual
  recorder tooling is harmless + deeply entangled via overlayLagRecorderRef → OUT OF SCOPE (min-diff guardrail).

## Priority 1 — dead zoom/scroll clusters in PDFViewer.jsx (DONE ✅)
Read-only map+adversarial-verify workflow confirmed all 4 blocks SAFE (no live callers, no
source-assertion guards). Executed one committed batch each, full gate (build+tests+smoke+e2e) after each.
PDFViewer.jsx: 33,982 → 33,443 lines (539 dead lines gone).
- [x] 4a if(true)return dead bodies (bookmark-fallback + scroll re-attach) — 8acd9f7d
- [x] 4b small dead useEffects (interaction teardown, pageChange re-zoom, committed-scales branch) — 98a2cd06
- [x] 4c renderPage cluster (atomic ~210 lines) — 517b2e7b
- [x] 4d mouse/wheel cluster (handleWheel + pan handlers + native backup + JSX props, atomic) — 3f009198
- [x] orphan cleanup (5 declaration-only refs/state) — dfa8595d
Note: broken overlay auto-recorder rAF loop was already removed 2026-06-28; remaining manual recorder
tooling is harmless + entangled → left in place (min-diff guardrail).

## Priority 2 — split PDFViewer.jsx into modules (SAFE EXTRACTIONS DONE; bulk deferred)
Read-only 8-scanner + synthesis workflow ranked every seam. Executed the safe wins:
- [x] boundsMatch → utils/pdfViewerGeometry.js (+7-case test) — fbac4769
- [x] sanitizeTemplateConfig → utils/templateConfig.js (+test) — 3d96ac23
- [x] region-overlay visibility → hooks/useRegionOverlayVisibility.js (+pure parse/serialize tests) — 2cc4dcb9
PDFViewer.jsx: 33,443 → 33,385.
Skipped (deliberate): colLetter (would force a behavior-changing single→multi-char consolidation),
PAPER_DIM_INCHES (parked-PrintPanel-adjacent), invokeNavigation (trivial + risky-adjacent).

**Honest assessment (why the bulk is deferred):** the file's reducible mass lives in DEFER-RISKY
engines — the zoom/scale lifecycle, per-page overlay portal render loop, undo/redo + save/sync history
engine, the Excel sync/import/export engine, and document/survey-marker cloud realtime sync. These hit
the CLAUDE.md correctness invariants (zoomGeneration / SVG viewBox / container sizing) and/or are
load-bearing engines. There is NO React-hook test harness in the repo (and the handoff bars adding one),
so a hook's effect wiring can't be unit-tested and render-smoke/callout-e2e don't exercise these paths —
extracting them blind would be unverifiable. They need dedicated, adversarially-verified migrations with
owner-facing behavioral coverage, exactly like the callout unification is scoped as its own migration.
Remaining safe-ish hooks (form-field persistence, page-transformations, space CSV export, selection guard)
are lower-value and left as follow-ups. Full ranked seam map: workflow wtxzbbu8u output.

## Priority 3 — split other >1k-line files (STARTED)
- [x] pdfAnnotationImporter: pdf-lib value readers → utils/pdfLibValueReaders.js (+8-case test; still
      covered end-to-end by the existing import round-trip test) — dd72ac52. Importer 3418 → 3301.

## Session tally (all gates green every batch; zero regressions)
PDFViewer.jsx: 33,982 → 33,302 (−680). pdfAnnotationImporter: 3418 → 3301 (−117). 13 commits.
New tested modules: pdfViewerGeometry, templateConfig, useRegionOverlayVisibility,
usePdfjsFormFieldPersistence, pdfLibValueReaders. Node tests 1685 → 1716.

## Ceiling reached for CLEAN autonomous extraction — why, and what's next
The remaining safe extractions all hit friction that blocks honest verification:
- **No React-hook/component/Fabric test harness** in the repo (handoff bars adding one) → hook/component
  extractions are build+mount-verified only; behavior on uncovered paths (undo/redo, save, Excel, sync,
  most panels) isn't gate-checked.
- **viewerShared.js is NOT node-importable** (extensionless import `./utils/annotationPreviewDiag`), so any
  new util that imports from it can't be node-tested — this blocked a clean space-CSV export extraction.
  FIXABLE follow-up: add explicit `.js` extensions to viewerShared's local imports to unlock node testing.
- **hexToRgba name collision** between the importer's local copy and viewerShared's canonical one → the
  importer color cluster needs a de-dup decision, not a blind lift.
- The big-file **bulk lives in DEFER-RISKY engines** (zoom/scale lifecycle, overlay portal render loop,
  undo/redo+save history, Excel sync/import/export, cloud realtime sync) that hit the CLAUDE.md invariants
  and are load-bearing → dedicated, owner-verified migrations with behavioral coverage, not opportunistic lifts.

**Recommended next moves (each its own verified batch):**
1. Add `.js` extensions to viewerShared local imports → unlock node-testing → then extract space CSV/PDF
   export, and other viewerShared-dependent pure logic, WITH tests.
2. Build a minimal hook-render harness (owner call: is a tiny react test-renderer dev-dep acceptable? the
   handoff said no new frameworks — needs owner waiver) OR add targeted agent-cli e2e flows for form fields,
   undo/redo, survey markers, bookmarks, so hook/engine extractions become gate-verifiable.
3. With coverage in place, migrate the DEFER-RISKY engines one at a time (map → adversarial-verify → gate),
   same discipline as the P1 dead-code removal.
4. Continue P3 on the tractable UI panels (TemplatesEditor, BookmarksPanel, SearchTextPanel, Dashboard) as
   mechanical sub-component splits once a panel-level smoke flow exists to catch prop-wiring regressions.

## Priority 3 — split other >1k-line files (PENDING)
28 files >1k lines; largest-first. PageAnnotationLayer, SVGAnnotationLayer, useSVGInteraction, FabricEditCanvas,
RegionSelectionTool, SurveySpacesRail, useAnnotationCloudSync, pdfAnnotationImporter, AppShell, BookmarksPanel,
TemplatesEditor, viewerShared, geometryHitTest, SearchTextPanel, Dashboard, ...

## Out of scope (owner-parked)
- PrintPanel removal (KAL-315). Mobile useDocumentState hook step-12 (device test). Manual overlay recorder tooling.

---

# Engine-Extraction run (HANDOFF-engine-extraction.md) — safety-net-first

Branch: `claude/modest-montalcini-dd468e` (fast-forwarded from magical-raman's tip; landed here
because magical-raman is checked out in its own worktree). Governing doc: `HANDOFF-engine-extraction.md`.
Coverage decisions: `A1-COVERAGE.md`. Owner hands-on checklist: `OWNER-FINAL-TEST.md`.

## Phase A — safety net (DONE, green x2)
- A0: viewerShared.js node-importable (added `.js` extensions to 6 relative imports). c5e26572.
- A1: confirmed existing e2e. 10 reliable green gates. Fixed lock-document-e2e's stale Syncfusion
  `.e-pv-page-div` selector → pdf.js overlay (now fully green). Documented 3 pre-existing-drift/obsolete
  tests as NOT-gated with overlapping coverage (version-history spotlight, survey-roundtrip obsolete
  snapshot API, regress-idle 'Select Template' flow). 50ecf870.
- A2: 4 new honest e2e guards — undo-redo (all 4 redo chords), survey-marker data+mapper roundtrip,
  spaces CRUD+persist, form-field persist-across-reopen. fb738964.
- A3: agent-cli/full-e2e.sh (14-test suite, portable timeout, warm-retry); fixed an undo/redo
  load-flake (poll-for-count instead of check-once-then-redraw). Ran twice back-to-back → 14/14 both. 3fde9bde.

## Phase B — extract engines one at a time behind the net (each: map → verify vs live source →
## verbatim move → full gate 14/14 → commit)
- B1 bookmark/space: sidebar bookmark-normalization + space-region migration → utils/sidebarPersistence
  (migrateSidebarData, +8-case test). 4446ab9e.
- B2 survey-marker: KAL-309 entity-color resolver → utils/surveyMarkerEntityResolver (+9-case test). 600ff573.
- B3 undo/redo: keydown execution-site guard → undoRedoHotkeys.isUndoRedoBlocked (+8-case test). b8b2bc8f.
- B4 save/export: Space CSV row-builder → utils/spaceCSVExporter (+6-case test); updated the
  pdfSaveExportContract source-assertion guard to follow the moved code. cf5ceddb.
- B5 Excel, B6 cloud sync, B7 overlay/zoom: **already fully modularized by prior work** — pure logic
  in dedicated modules with unit tests; residual is scattered stateful wiring (B5/B6) or
  invariant-protected zoom/overlay lifecycle (B7). Moving it would be an unsafe restructure that
  violates the verbatim-only + CLAUDE.md-invariant rules → correctly LEFT IN PLACE. Each verified
  via a thorough map + backed by green e2e guards (excel-corruption/import-once, yjs-roundtrip,
  render-smoke/lock-document/zoom-math units). See task notes + A1-COVERAGE.

## Tally
PDFViewer.jsx 33,302 → 33,138 (−164 net; 4 pure engines lifted into tested modules). Node tests
1716 → 1747 (+31 across 4 new util test files). 8 commits (A0–A3 + B1–B4). Zero regressions; full
suite green after every step. Nothing DEFERRED: the un-extractable engines are un-extractable for
correctness/safety reasons (documented), not skipped; zoom FEEL + survey-marker UI CRUD (needs a
template fixture) are on OWNER-FINAL-TEST.md as the only hands-on items.
