# KAL-11 — Staged split plan for `src/App.jsx`

_Run: 2026-05-19. Branch: `isaiahcalvo123/kal-11-plan-safe-staged-split-of-oversized-appjsx`._

This is a written plan. Zero runtime code moves in this branch. Each stage below should land as its own narrow follow-up issue with the verification checklist met before the next stage starts.

---

## Current state

- `src/App.jsx` is **45,892 lines**.
- It contains 481 `useState`/`useRef`, 196 `useEffect`, 310 `useCallback`, 34 `useMemo` calls.
- It exports a single default `App` component plus a long tail of helper components defined inline.

The file mixes:
- Dashboard / home flows
- Drag-and-drop sortable rows for templates, modules, categories, and entities
- The Syncfusion PDF viewer wiring (loader, page-change/zoom/scroll handlers, overlay portals)
- Annotation lifecycle (Fabric canvas plumbing, SVG overlay coordination, properties panel, callouts)
- Survey marker workflows
- Print, export, OneDrive sync, Save Log
- Toolbar / rail layout state
- Cross-cutting refs and effects that thread through everything

`CLAUDE.md` lists `App.jsx` as Always-Protected. The standing waiver allows edits but requires "small, scoped, never refactor while you're in there" — the explicit goal of this plan is to make any future refactor a series of minimum-viable, atomic moves rather than one large rewrite.

---

## Major responsibility groups inside the file

(Approximate line ranges; the file is in active development so exact lines drift. Use the named functions as anchors.)

| Group | Anchor functions / lines | Approx. lines | Already isolated? |
|-------|--------------------------|--------------:|-------------------|
| Template/entity drag rows | `TemplateDragOverlayItem` (1716), `TemplateModuleSortableRow` (1738), `EntitySortableRow` (1828), `EntityDragOverlayItem` (1988), `TemplateCategorySortableRow` (2039) | ~500 | No |
| PDF thumbnail renderer | `PDFThumbnail` (2832) | ~200 | No |
| Dashboard / home shell | `Dashboard` (3027) | ~6,500 | Partially (some moved to `src/home/*`) |
| Bottom toolbar | `BottomToolbar` (9593) | ~300 | No |
| PDFViewer (everything below 9890) | `PDFViewer` (9890) → end | ~36,000 | No |
| ↳ Style state handlers | `handleStrokeColorChange` (15317) and the rest of the style cluster | ~150 | No |
| ↳ Syncfusion lifecycle | `handleSyncfusionDocumentLoad` (14735), `handleSyncfusionPageChange` (14984), `handleSyncfusionZoomChange` (15021), `handleSyncfusionPageContainersChange` (14569), `handleSyncfusionPageRenderComplete` (15150), `handleSyncfusionDocumentLoadFailed` (14866), `handleSyncfusionWrapper*` (15155-15190) | ~1,000 | No |
| ↳ Drag handlers (counter / callout / category / module / entity inside the viewer) | `handleCutCallout` / `handleCopyCallout` / `handlePasteCallout` (12333+), `handleNewCounterSeries` (12647), `handleSwitchCounterSeries` (12780), `handleSurveyToggle` (13489) | ~600 | No |
| ↳ Excel / OneDrive export, print, Save Log | scattered | ~3,000 | Save Log push UI is already in `SaveLogBanner.jsx` |
| ↳ Survey marker hydrate + subscribe + write paths | scattered around line 23800-24400 | ~1,500 | Partially (service layer exists in `src/services/documentAnnotationService.js`) |

Already-extracted neighbours: `src/hooks/useAnnotationCloudSync.js` owns the non-survey annotation cloud sync (very large hook), `src/lib/collab/*` owns CRDT + Y.Doc, `src/components/SyncfusionPDFContainer.jsx` wraps Syncfusion, `src/components/AnnotationPropertiesPanel.jsx` owns the properties panel.

---

## Risk model

Anything that touches the live PDF viewer, annotation canvas, or sync wiring is HIGH risk. Anything purely presentational, with props-only inputs and no callbacks back into shared refs, is LOW risk. The middle ground — handlers that read from App-scope refs or close over App-scope state — is MEDIUM risk and needs a clear ref/prop contract before the move.

The hidden lever in this file is the `useEffect` web. 196 effects share state through refs and closures; many of them implicitly depend on render order. Any move that re-roots a hook into a new file changes that order and can introduce subtle resubscribe/restart bugs. **The plan below intentionally extracts presentational / leaf code first** so the effect web is the last thing touched.

---

## Staged plan

Each stage = one follow-up Linear issue + one PR. Stages do not depend on each other except where noted; they can be parallelized if multiple people work the queue.

### Stage 1 — Drag overlay rows (LOW risk)

**Move:** `TemplateDragOverlayItem`, `TemplateModuleSortableRow`, `EntitySortableRow`, `EntityDragOverlayItem`, `TemplateCategorySortableRow`.

**Destination:** new directory `src/home/drag-rows/` (or `src/components/drag-rows/`), one file per component.

**Why first:** these are pure presentational, props-only, no refs into App scope, no side effects. The only risk is import-path churn; tests and build catch any miss.

**Verification:** `npm run build` clean; `npm test` no new failures; manual smoke = open the template editor, drag a row, confirm visuals identical.

**Suggested follow-up:** KAL-11a.

### Stage 2 — `PDFThumbnail` extraction (LOW risk)

**Move:** `PDFThumbnail` (around line 2832).

**Destination:** `src/home/PDFThumbnail.jsx` (lives next to `DocumentsLedger` etc.).

**Why early:** completely self-contained, props-only, used only by the dashboard.

**Verification:** same as Stage 1, plus visually confirm dashboard thumbnails render.

**Suggested follow-up:** KAL-11b.

### Stage 3 — `BottomToolbar` extraction (LOW-MEDIUM risk)

**Move:** `BottomToolbar` (around line 9593).

**Destination:** `src/components/BottomToolbar.jsx`.

**Why next:** it's a self-contained function but takes a wide `props` object. Risk is that some prop is silently coming from App-scope closure today; the extraction will surface that immediately as a missing prop. That's exactly the kind of thing the move should fix.

**Verification:** open a PDF, walk every toolbar control; build + test green.

**Suggested follow-up:** KAL-11c.

### Stage 4 — Style state cluster as a custom hook (MEDIUM risk)

**Extract:** the stroke-color / fill / opacity / width / eraser-size handlers (15317-15400 region) plus the underlying useState pairs.

**Destination:** new `src/hooks/useAnnotationStyleState.js`.

**Why now:** all the moves above are pure file-shuffling; this is the first real responsibility extraction. The handlers form a coherent cluster (they all read and write the same eight style slices). The risk is that some downstream code (the toolbar, the properties panel, the canvases) reads these style values via App-scope closure rather than props — every such consumer needs a clean wiring through the hook return value.

**Verification:** open a PDF, change pen color, change stroke width, change eraser size, change fill color/opacity; all canvases honor the change. Build + test green.

**Suggested follow-up:** KAL-11d.

### Stage 5 — `Dashboard` extraction (MEDIUM-HIGH risk)

**Move:** the `Dashboard` `forwardRef` block (around line 3027 to ~9590).

**Destination:** `src/home/Dashboard.jsx` (joins the existing `src/home/*` neighbours).

**Why later:** Dashboard is ~6,500 lines and likely closes over multiple App-scope refs and callbacks. The move is mostly mechanical but the surface for "I missed a closure" bugs is large. Better to do Stage 1–4 first so the file is already lighter when Dashboard moves.

**Verification:** full dashboard walk — open, create/rename a project, upload a document, link a template, open a document; auth modal still triggers correctly; build + test green.

**Suggested follow-up:** KAL-11e.

### Stage 6 — STOP before splitting `PDFViewer` (HIGH risk; needs harness first)

**Do not move** the `PDFViewer` body in a follow-up split issue without first:

1. Building a regression harness around the Syncfusion event lifecycle (page change, zoom, scroll, document load, container change). Most of the trickiest bugs the codebase has had — the zoom signal generation, the container-aware canvas sizing, the cursor-off-page scoping, the cross-device hydrate race fixed in KAL-24 — live in this 36k-line region.
2. Locking the `zoomGeneration` signal contract (per `CLAUDE.md` Enforced Rules) with a source-contract test.
3. Locking the container-aware canvas sizing contract with a source-contract test.
4. Locking the SVG `viewBox` zoom-scaling rule with a source-contract test.

Once those three contracts are tested in source-grep form, the PDFViewer body can be sub-split along the natural seams:

- **6a:** Syncfusion lifecycle handlers → `src/hooks/useSyncfusionLifecycle.js`.
- **6b:** Counter / callout cut-copy-paste handlers → `src/hooks/useAnnotationClipboard.js`.
- **6c:** Survey marker hydrate + subscribe + write paths → finish the migration into `src/services/documentAnnotationService.js` and a small App-side wrapper hook.
- **6d:** Excel / OneDrive export → `src/services/excelExportService.js` (or expand the existing service).
- **6e:** Save Log triggering → `src/hooks/useSaveLogTrigger.js`.

Each sub-stage is its own issue with its own verification gate.

---

## Cross-cutting hazards to call out

Anything that touches these MUST be tested live before merging:

- **`zoomGeneration` signal.** Lifting any Syncfusion handler into a hook risks accidentally re-creating the signal source on every render and breaking the canvas auto-commit contract.
- **Container-aware canvas sizing.** Anything that reads `containerEl.offsetWidth / pageSize.width` must keep that lookup; the Electron browser zoom factor mismatch is a permanent gotcha.
- **`useEffect` ordering.** Moving a `useEffect` into a hook silently changes mount order relative to its sibling effects in the original file. Any effect that depends on "X has subscribed before I run" (presence subscriptions, document open, focus rehydrate) needs explicit verification.
- **Cross-document race.** The fix for KAL-24 closed the survey-marker open-document race by adding an `onSubscribed` catch-up callback. The same race shape exists for any extracted hook that hydrates a per-document slice.

---

## Done definition

- Major responsibility groups inventoried with anchors and line counts ✓
- Each group classified low/medium/high risk to move ✓
- Six stages proposed, the first three at low or low-medium risk ✓
- Each stage names destination files and a verification checklist ✓
- Shared state/refs/effects called out as cross-cutting hazards ✓
- Follow-up Linear issues recommended (KAL-11a through KAL-11e plus the gated KAL-11/6a-e family) ✓

If this plan is accepted, open KAL-11a as the first concrete move and don't open KAL-11b until KAL-11a is merged and green.
