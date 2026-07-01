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

## Priority 3 — split other >1k-line files (IN PROGRESS)
Strategy: safety×value order (not strictly largest-first, since the largest are the high-risk canvas/
overlay files). Do testable util splits + gate-verified UI component splits first; approach the big
canvas files (PageAnnotationLayer, SVGAnnotationLayer, useSVGInteraction, FabricEditCanvas) with the
same map→adversarial-verify→gate discipline used for PDFViewer P1.

## Priority 3 — split other >1k-line files (PENDING)
28 files >1k lines; largest-first. PageAnnotationLayer, SVGAnnotationLayer, useSVGInteraction, FabricEditCanvas,
RegionSelectionTool, SurveySpacesRail, useAnnotationCloudSync, pdfAnnotationImporter, AppShell, BookmarksPanel,
TemplatesEditor, viewerShared, geometryHitTest, SearchTextPanel, Dashboard, ...

## Out of scope (owner-parked)
- PrintPanel removal (KAL-315). Mobile useDocumentState hook step-12 (device test). Manual overlay recorder tooling.
