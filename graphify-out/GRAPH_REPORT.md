# Graph Report - magical-raman-95374e  (2026-07-01)

## Corpus Check
- 1378 files · ~2,973,786 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 238 nodes · 523 edges · 21 communities (16 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dd72ac52`
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
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]

## God Nodes (most connected - your core abstractions)
1. `convertPdfAnnotationToFabric()` - 16 edges
2. `convertFreeTextToFabricTextbox()` - 15 edges
3. `pdfColorToHex()` - 14 edges
4. `extractAnnotationOpacity()` - 13 edges
5. `hexToRgba()` - 13 edges
6. `convertPdfRectToViewportRect()` - 12 edges
7. `convertPolygonToFabricPolygon()` - 12 edges
8. `getBorderWidth()` - 11 edges
9. `buildRawAnnotationMetadataById()` - 11 edges
10. `convertPolyLineToFabricPolyline()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `buildRawAnnotationMetadataById()` --calls--> `normalizePdfLineEndings()`  [EXTRACTED]
  src/utils/pdfAnnotationImporter.js → src/utils/pdfLibValueReaders.js
- `buildRawAnnotationMetadataById()` --calls--> `normalizePdfNameToken()`  [EXTRACTED]
  src/utils/pdfAnnotationImporter.js → src/utils/pdfLibValueReaders.js
- `applyRawMetadataToAnnotation()` --calls--> `normalizePdfLineEndings()`  [EXTRACTED]
  src/utils/pdfAnnotationImporter.js → src/utils/pdfLibValueReaders.js
- `convertFreeTextToFabricTextbox()` --calls--> `normalizePdfNameToken()`  [EXTRACTED]
  src/utils/pdfAnnotationImporter.js → src/utils/pdfLibValueReaders.js
- `convertTextToFabricNote()` --calls--> `normalizePdfNameToken()`  [EXTRACTED]
  src/utils/pdfAnnotationImporter.js → src/utils/pdfLibValueReaders.js

## Import Cycles
- None detected.

## Communities (21 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (28): applyRegionMaskToCanvasContext(), countAnnotationPageObjects(), escapeCSVValue(), getNormalizedWheelDeltas(), getOpacityFromEntityColor(), getPDFId(), getPdfjsZoomAwareScrollGain(), getSmoothPdfjsWheelZoom() (+20 more)

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
Cohesion: 0.04
Nodes (42): buildOutlinePageLookup(), categoryExists(), clampWheelDelta(), cloneOverlayRecorderPayload(), coercePageNumber(), coercePdfjsZoomPercent(), dataURLToUint8Array(), filterAnnotationsByModule() (+34 more)

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

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (20): applyRawMetadataToAnnotation(), clamp01(), convertAppearancePathToFabricPath(), convertAutoCadShxTextToFabricProxy(), coordinateArrayToPoints(), getAnnotationContents(), getAnnotationTitle(), getInkPathEndpoint() (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (14): buildRawAnnotationMetadataById(), decodeStreamBytesToLatin1(), extractAppearanceMetadataForAnnotation(), importAnnotationsFromPdf(), loadPdfLibCore(), parseAppearanceStream(), pdfImportDebug(), readAppLayerStateFromPdf() (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.42
Nodes (15): convertCaretToFabricPolyline(), convertCircleToFabricCircle(), convertInkToFabricPath(), convertPdfAnnotationToFabric(), convertPdfRectToViewportRect(), convertSquareToFabricRect(), convertSquigglyToFabricPath(), convertSurveyMarkerToFabricRect() (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (11): buildCloudPathCommands(), convertLineToFabricLine(), convertPdfPointListToViewportPoints(), convertPdfPointToViewport(), convertPolygonToFabricPolygon(), convertPolyLineToFabricPolyline(), extractAnnotationDashArray(), getAnnotationPolylinePoints() (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (7): computeAppearanceRotationTransform(), convertFreeTextToFabricTextbox(), extractCalloutTextBoxRectFromAppearance(), getShapeFillHex(), isNearWhiteHexColor(), parseDefaultAppearanceString(), parseDefaultStyleString()

## Knowledge Gaps
- **18 isolated node(s):** `SUPPORTED_SUBTYPES`, `SELECT_DELETE_ONLY_TEXT_MARKUP_TYPES`, `LINE_CAP_MAP`, `LINE_JOIN_MAP`, `UNSUPPORTED_SUBTYPES` (+13 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `summarizeHistoryActionForLog()` connect `Community 1` to `Community 0`, `Community 4`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `normalizePdfNameToken()` connect `Community 19` to `Community 16`, `Community 17`, `Community 18`, `Community 20`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `sanitizeTemplateConfig()` connect `Community 14` to `Community 4`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `SUPPORTED_SUBTYPES`, `SELECT_DELETE_ONLY_TEXT_MARKUP_TYPES`, `LINE_CAP_MAP` to the rest of the system?**
  _18 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._
- **Should `Community 16` be split into smaller, more focused modules?**
  _Cohesion score 0.08817204301075268 - nodes in this community are weakly interconnected._