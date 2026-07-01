# Graph Report - magical-raman-95374e  (2026-07-01)

## Corpus Check
- 1376 files · ~2,973,447 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 153 nodes · 282 edges · 16 communities (11 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `82c8c435`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]

## God Nodes (most connected - your core abstractions)
1. `summarizeHistoryActionForLog()` - 9 edges
2. `De-Fragilize Campaign — Progress Ledger` - 8 edges
3. `resolveBookmarkPageFromOutlineLookup()` - 5 edges
4. `createItem()` - 5 edges
5. `isPointOnSelectDeleteOnlyTextMarkup()` - 4 edges
6. `hexToRgba()` - 4 edges
7. `getHistoryAnnotationId()` - 4 edges
8. `getHistoryAnnotationVisualBounds()` - 4 edges
9. `buildHistoryRestoreAction()` - 4 edges
10. `normalizeHistoryActionType()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `PDFViewer()` --calls--> `useRegionOverlayVisibility()`  [EXTRACTED]
  src/PDFViewer.jsx → src/hooks/useRegionOverlayVisibility.js

## Import Cycles
- None detected.

## Communities (16 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (30): buildOutlinePageLookup(), cloneOverlayRecorderPayload(), escapeCSVValue(), filterAnnotationsByModule(), getModuleDataKey(), getNormalizedWheelDeltas(), getPDFId(), getPdfjsTextMarkupMode() (+22 more)

### Community 1 - "Community 1"
Cohesion: 0.18
Nodes (14): buildHistoryRestoreAction(), cloneHistoryPayloadValue(), compactHistoryEventForLog(), getHistoryAnnotationId(), getHistoryAnnotationType(), getHistoryAnnotationVisualBounds(), getHistoryPathVisualBounds(), inferHistoryUpdateType() (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.33
Nodes (6): createAnnotation(), createItem(), generateUUID(), getCategoryName(), getItemType(), getModuleName()

### Community 3 - "Community 3"
Cohesion: 0.50
Nodes (4): extractSourceLeafFromBookmark(), normalizeOutlineLooseKey(), normalizeOutlinePathSegments(), resolveBookmarkPageFromOutlineLookup()

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (40): applyRegionMaskToCanvasContext(), categoryExists(), clampWheelDelta(), coercePageNumber(), coercePdfjsZoomPercent(), countAnnotationPageObjects(), dataURLToUint8Array(), getCategoryGlyphLabel() (+32 more)

### Community 5 - "Community 5"
Cohesion: 0.50
Nodes (4): getPathPointDistance(), getSelectDeleteOnlyTextMarkupBounds(), isPointOnSelectDeleteOnlyTextMarkup(), isSelectDeleteOnlyImportedTextMarkupType()

### Community 6 - "Community 6"
Cohesion: 0.50
Nodes (4): getPdfImportedEditComparable(), isPdfImportedAnnotationObject(), sanitizePdfImportedObjectForEditCompare(), shouldStampPdfImportedEditStateForSource()

### Community 7 - "Community 7"
Cohesion: 0.67
Nodes (3): cloudRenderCacheKey(), loadCloudRenderAnnotationsByPage(), saveCloudRenderAnnotationsByPage()

### Community 8 - "Community 8"
Cohesion: 0.67
Nodes (3): ensureRgbaOpacity(), hexToRgba(), normalizeSurveyMarkerColor()

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (8): De-Fragilize Campaign — Progress Ledger, Out of scope (owner-parked), Priority 1 — dead zoom/scroll clusters in PDFViewer.jsx (DONE ✅), Priority 2 — split PDFViewer.jsx into modules (SAFE EXTRACTIONS DONE; bulk deferred), Priority 3 — split other >1k-line files (IN PROGRESS), Priority 3 — split other >1k-line files (PENDING), Rules (from HANDOFF run-mode), Status of prior work (verified this session)

### Community 15 - "Community 15"
Cohesion: 0.39
Nodes (6): parseRegionOverlayStates(), readRegionOverlayStates(), serializeRegionOverlayStates(), storageKeyFor(), useRegionOverlayVisibility(), PDFViewer()

## Knowledge Gaps
- **12 isolated node(s):** `Rules (from HANDOFF run-mode)`, `Status of prior work (verified this session)`, `Priority 1 — dead zoom/scroll clusters in PDFViewer.jsx (DONE ✅)`, `Priority 2 — split PDFViewer.jsx into modules (SAFE EXTRACTIONS DONE; bulk deferred)`, `Priority 3 — split other >1k-line files (IN PROGRESS)` (+7 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `summarizeHistoryActionForLog()` connect `Community 1` to `Community 0`, `Community 4`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `sanitizeTemplateConfig()` connect `Community 14` to `Community 4`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `boundsMatch()` connect `Community 13` to `Community 4`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `Rules (from HANDOFF run-mode)`, `Status of prior work (verified this session)`, `Priority 1 — dead zoom/scroll clusters in PDFViewer.jsx (DONE ✅)` to the rest of the system?**
  _12 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._