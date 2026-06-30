# Graph Report - wonderful-cori-1d5fad  (2026-06-30)

## Corpus Check
- 1367 files · ~2,963,464 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 127 nodes · 163 edges · 12 communities (9 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ad564d67`
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

## God Nodes (most connected - your core abstractions)
1. `summarizeHistoryActionForLog()` - 8 edges
2. `getHistoryAnnotationVisualBounds()` - 4 edges
3. `buildHistoryRestoreAction()` - 4 edges
4. `normalizeHistoryActionType()` - 4 edges
5. `resolveBookmarkPageFromOutlineLookup()` - 4 edges
6. `createItem()` - 4 edges
7. `getSelectDeleteOnlyTextMarkupBounds()` - 3 edges
8. `isPointOnSelectDeleteOnlyTextMarkup()` - 3 edges
9. `hexToRgba()` - 3 edges
10. `roundHistoryDebugNumber()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `summarizeHistoryActionForLog()` --calls--> `getHistoryAnnotationVisualBounds()`  [EXTRACTED]
  src/viewerShared.js → src/viewerShared.js  _Bridges community 4 → community 1_

## Import Cycles
- None detected.

## Communities (12 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (10): NATIVE_TEXT_MARKUP_TOOLS, OVERLAY_LAG_RECORDER_WORK_CATEGORIES, PDF_IMPORTED_EDIT_MARKER_KEYS, PDFJS_PDF_SURFACE_SELECTOR, REVIEW_TOOL_IDS, SELECT_DELETE_ONLY_IMPORTED_TEXT_MARKUP_TYPES, ZOOM_MODE_DESCRIPTIONS, ZOOM_MODE_LABELS (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.27
Nodes (10): buildHistoryRestoreAction(), cloneHistoryPayloadValue(), compactHistoryEventForLog(), getHistoryAnnotationId(), getHistoryAnnotationType(), inferHistoryUpdateType(), normalizeHistoryActionType(), normalizeHistoryLaneLabel() (+2 more)

### Community 2 - "Community 2"
Cohesion: 0.33
Nodes (6): createAnnotation(), createItem(), generateUUID(), getCategoryName(), getItemType(), getModuleName()

### Community 3 - "Community 3"
Cohesion: 0.50
Nodes (4): extractSourceLeafFromBookmark(), normalizeOutlineLooseKey(), normalizeOutlinePathSegments(), resolveBookmarkPageFromOutlineLookup()

### Community 4 - "Community 4"
Cohesion: 0.50
Nodes (4): getHistoryAnnotationVisualBounds(), getHistoryPathVisualBounds(), roundHistoryDebugNumber(), toHistoryObjectDebug()

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

## Knowledge Gaps
- **10 isolated node(s):** `NATIVE_TEXT_MARKUP_TOOLS`, `SELECT_DELETE_ONLY_IMPORTED_TEXT_MARKUP_TYPES`, `REVIEW_TOOL_IDS`, `PDFJS_PDF_SURFACE_SELECTOR`, `ZOOM_ONLY_INTERACTION_REASONS` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `summarizeHistoryActionForLog()` connect `Community 1` to `Community 0`, `Community 4`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Why does `getHistoryAnnotationVisualBounds()` connect `Community 4` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `normalizeHistoryActionType()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `NATIVE_TEXT_MARKUP_TOOLS`, `SELECT_DELETE_ONLY_IMPORTED_TEXT_MARKUP_TYPES`, `REVIEW_TOOL_IDS` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.024096385542168676 - nodes in this community are weakly interconnected._