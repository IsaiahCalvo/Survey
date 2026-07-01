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

## Priority 2 — split PDFViewer.jsx into modules (PENDING)
Leaf-first, behavior identical, one extraction/commit, full gate (+smoke) each.

## Priority 3 — split other >1k-line files (PENDING)
28 files >1k lines; largest-first. PageAnnotationLayer, SVGAnnotationLayer, useSVGInteraction, FabricEditCanvas,
RegionSelectionTool, SurveySpacesRail, useAnnotationCloudSync, pdfAnnotationImporter, AppShell, BookmarksPanel,
TemplatesEditor, viewerShared, geometryHitTest, SearchTextPanel, Dashboard, ...

## Out of scope (owner-parked)
- PrintPanel removal (KAL-315). Mobile useDocumentState hook step-12 (device test). Manual overlay recorder tooling.
