# Annotation / Callout Ownership Audit

Date: 2026-05-26
Linear: KAL-80
Follow-up implementation: KAL-81
Scope: docs-only ownership audit. Do not implement callout/annotation unification from this document alone.

## Purpose

This audit maps the current ownership of regular annotations, callouts, imported PDF annotations, survey marks, region/space-scoped annotations, undo/redo, sync, import/export, print flattening, selection, style editing, and context menus.

The goal is to give a future implementation agent enough detail to unify callouts with the main annotation model safely in KAL-81 without asking the user for missing context.

Important known concerns that must be preserved during KAL-81:

- Callouts have their own text style flags: `bold`, `italic`, `underline`, and `strikethrough`.
- Callouts currently show a different right-click context menu than other annotations.
- App-level and PageAnnotationLayer-level context menu paths both exist, and they are not identical.

Related architecture context: `docs/audits/ARCHITECTURE_HOTSPOT_REFACTOR_MAP_2026-05-26.md`.

## High-Signal Source Map

These line anchors were captured with targeted `rg -n` checks on 2026-05-26:

- `src/App.jsx:12080` owns `callouts`; `src/App.jsx:12108` owns `selectedCalloutIds`; `src/App.jsx:12120` owns `annotationContextMenu`; `src/App.jsx:12215` owns `handlePatchSelectedCallout`.
- `src/App.jsx:12325` registers `window.__onAnnotationContextMenu`; `src/App.jsx:33580` starts the App-level context menu portal.
- `src/App.jsx:15346` through `src/App.jsx:15446` route toolbar stroke/fill/opacity/line/arrowhead changes to `handlePatchSelectedCallout` when a callout is selected.
- `src/App.jsx:18797` owns `handleDeleteSelectedCallouts`; `src/App.jsx:18853` owns `handleCreateCallout`; `src/App.jsx:18904` owns `handleUpdateCallout`; `src/App.jsx:18960` owns `handleRequestCalloutEditMode`.
- `src/components/Callout/types.js:115` defines `defaultCalloutStyle`; `src/components/Callout/types.js:138` through `src/components/Callout/types.js:141` define `bold`, `italic`, `underline`, and `strikethrough`; `src/components/Callout/types.js:224` defines `createCallout`.
- `src/components/FabricEditCanvas.jsx:1124` documents callout text-style mapping; `src/components/FabricEditCanvas.jsx:1515` through `src/components/FabricEditCanvas.jsx:1518` map Fabric text fields to callout style flags.
- `src/utils/calloutEditAdapter.js:192` maps callout `style.bold` into Fabric `fontWeight` for the transient edit path.
- `src/services/annotationTypeSerializers.js:99` excludes callout rows from Fabric deserialization; `src/services/annotationTypeSerializers.js:363` serializes callouts; `src/services/annotationTypeSerializers.js:410` and `src/services/annotationTypeSerializers.js:544` deserialize callouts.
- `src/services/annotationCloudSync.js:263` owns `upsertCallouts`; `src/services/annotationCloudSync.js:364` owns `loadAllNonSurveyMarkerAnnotations`; `src/services/annotationCloudSync.js:602` routes realtime callout rows through `deserializeRowToCallout`.
- `src/hooks/useAnnotationCloudSync.js:758` owns `fanOutCrdtForCallouts`; `src/hooks/useAnnotationCloudSync.js:2258` pushes callout deltas with `upsertCallouts`; `src/hooks/useAnnotationCloudSync.js:3014` fan-outs force-flushed callouts to CRDT.
- `src/lib/collab/crdtAnnotationBridge.js:349` owns `applyCalloutCommit`; `src/lib/collab/crdtAnnotationBridge.js:397` owns `applyCalloutDelete`; `src/lib/collab/crdtAnnotationBridge.js:408` owns `materializeCalloutFromYMap`.
- `src/utils/pdfAnnotationImporter.js:3055` normalizes imported app callouts; `src/utils/pdfAnnotationImporter.js:3112` owns `importAnnotationsFromPdf`.
- `src/utils/calloutImportAdapter.js:16` converts imported PDF callout-like textboxes; `src/utils/calloutImportAdapter.js:177` splits imported callouts out of page objects.
- `src/utils/pdfCalloutMetadata.js:17` builds `SurveyAppCallout` metadata.
- `src/utils/pdfAnnotationsPdfLib.js:112` builds the printable regular payload; `src/utils/pdfAnnotationsPdfLib.js:272` converts callouts to export objects; `src/utils/pdfAnnotationsPdfLib.js:309` builds the export plan; `src/utils/pdfAnnotationsPdfLib.js:922` creates native PDF callout annotations; `src/utils/pdfAnnotationsPdfLib.js:1288` draws flattened callouts; `src/utils/pdfAnnotationsPdfLib.js:1322` owns print flattening; `src/utils/pdfAnnotationsPdfLib.js:1391` owns save/export.

## Executive Summary

Callouts are not just another Fabric annotation today. They are stored as a separate `callouts[]` state slice in `src/App.jsx`, rendered and manipulated through SVG interaction code, edited through a transient Fabric adapter, synced through dedicated callout serializers and a dedicated Yjs `callouts` map, and exported through callout-specific PDF metadata.

Regular annotations are primarily Fabric JSON objects in `annotationsByPage[page].objects`. Survey marks are another source of truth. Region and space membership is carried as scope metadata on these objects and callouts, then enforced by visibility, cascade delete, and PDF app-layer metadata code.

KAL-81 should therefore not simply move callout objects into `annotationsByPage` without a compatibility plan. The implementation must preserve callout geometry, text styling, context menu behavior, history, Supabase rows, Yjs state, localStorage, imported PDF callout metadata, and print/export behavior.

## Ownership Matrix

| Area | Current source of truth | Primary files / symbols | Notes for KAL-81 |
| --- | --- | --- | --- |
| Regular Fabric annotations | `annotationsByPage[page].objects` in `src/App.jsx` | `handleSaveAnnotations`, `handlePatchSelectedAnnotation`, `selectedToolbarAnnotation`, `src/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/components/AnnotationPropertiesPanel.jsx` | Existing annotation model is Fabric-object-shaped. Unification must decide whether callouts become canonical Fabric-like objects or whether both become a higher-level annotation model. |
| Callouts | `callouts[]` in `src/App.jsx` | `src/App.jsx:12079` `callouts`, `src/components/Callout/types.js`, `src/components/SVGAnnotationLayer.jsx`, `src/hooks/useSVGInteraction.js` | Separate state, geometry, selection, style fields, sync, PDF metadata, and context menu paths. |
| Imported PDF annotations | Fabric objects plus imported app callouts | `src/utils/pdfAnnotationImporter.js`, `src/utils/calloutImportAdapter.js`, `src/App.jsx` import path around PDF load, `markEditedImportedPdfAnnotationsOnPage` | Native PDF annotations imported to Fabric must not be duplicated on export unless edited. Imported app callouts become entries in `callouts[]`. |
| Survey marks | `surveyMarkers` state, not `annotationsByPage` | `src/services/documentAnnotationService.js`, `src/components/SVGAnnotationLayer.jsx`, `src/App.jsx`, `src/utils/pdfAnnotationsPdfLib.js` | Survey marks are intentionally excluded from regular print/export annotation payloads and have separate sync ownership. |
| Region / space scoped annotation state | Scope fields on objects/callouts plus app-layer state | `moduleId`, `spaceId`, `regionId`, `layer`, `src/utils/annotationVisibilityRules.js`, `cascadeDeleteScopedAppState`, `src/SpaceRegionOverlay.jsx` | Scope fields must survive unification and keep visibility/cascade-delete semantics. |
| Selection and hit testing | Split regular selection and callout selection | `selectedIds`, `selectedCalloutId`, `selectedCalloutIds`, `pendingSvgSelection`, `src/utils/annotationHitTest.js`, `src/hooks/useSVGInteraction.js` | KAL-81 should introduce one identity model, likely `{ id, kind/type, pageNumber }`, before consolidating commands. |
| Style editing | Regular annotations use Fabric fields; callouts use `callout.style` | `handlePatchSelectedAnnotation`, `handlePatchSelectedCallout`, `handleCalloutTextStyleChange`, `src/components/FabricEditCanvas.jsx` | Must preserve callout-specific text flags and map them to/from Fabric edit fields. |
| Context menus | App-level menu plus PageAnnotationLayer legacy menu | `src/App.jsx` `annotationContextMenu` portal, `window.__onAnnotationContextMenu`, `src/PageAnnotationLayer.jsx` `handleContextMenu` and menu portal | Callouts currently have a different menu. App-level callout Delete is present as a menu item but has no action in the observed menu item switch. PAL callout Delete directly mutates callouts. |
| Undo / redo | App local history plus Yjs undo manager plus legacy helpers | `getHistorySnapshot`, `restoreHistoryState`, `addHistoryCheckpoint`, `handleUndo`, `handleRedo`, `src/utils/annotationLocalHistory.js`, `src/utils/historyStacks.js`, `src/utils/calloutHistoryScope.js`, `src/lib/collab/crdtUndoManager.js` | Callout create/update/delete use explicit checkpoints. Mixed shape/callout delete has special batch handling. |
| Local persistence | Separate localStorage keys | `saveAnnotationsByPage`, `loadAnnotationsByPage`, `saveCallouts`, `loadCallouts` in `src/App.jsx` | Unification needs a migration/read compatibility layer for `annotationsByPage_${pdfId}` and `callouts_${pdfId}`. |
| Supabase sync | Fabric rows and callout rows share `document_annotations`, but use different serializers | `src/services/annotationTypeSerializers.js`, `src/services/annotationCloudSync.js`, `src/hooks/useAnnotationCloudSync.js` | Callout rows use `annotation_type: 'callout'` and `annotation_data.callout`. `shouldDeserializeAsFabricObject` explicitly excludes callouts. |
| CRDT sync | Regular annotations in Yjs `annotations`; callouts in Yjs `callouts` | `src/lib/collab/crdtAnnotationBridge.js`, `src/hooks/useAnnotationCloudSync.js`, `src/lib/collab/crdtUndoManager.js` | KAL-81 must support existing `callouts` map during migration or provide a durable backfill. |
| PDF import | Fabric annotation import plus callout-specific adapters | `src/utils/pdfAnnotationImporter.js`, `src/utils/calloutImportAdapter.js`, `src/utils/pdfCalloutMetadata.js` | App callouts are reconstructed from `SurveyAppCallout` metadata; Acrobat-style `FreeTextCallout` imports convert to callout state. |
| PDF export and print flattening | Separate planning branches for Fabric objects, survey markers, and callouts | `src/utils/pdfAnnotationsPdfLib.js`, `src/utils/pdfAppAnnotationMetadata.js`, `src/utils/saveAnnotatedPDFFile.js` | Regular callouts are exported as three PDF annotations with app metadata; print flattening draws callout lines/text directly. |

## Regular Annotation Ownership

Regular annotations are Fabric object JSON grouped by page in `annotationsByPage`.

Primary ownership points:

- `src/App.jsx` owns `annotationsByPage`, `setAnnotationsByPage`, `handleSaveAnnotations`, selected annotation state, toolbar style values, local persistence, history snapshots, sync hook wiring, import hydrate, export payloads, and context menu command dispatch.
- `src/PageAnnotationLayer.jsx` owns the main Fabric canvas lifecycle, hit handling, Fabric object selection, page-level context menu, and integration points with the SVG annotation layer.
- `src/components/SVGAnnotationLayer.jsx` renders and manipulates SVG-backed shapes and callouts; it also bridges selection and deletion into App handlers.
- `src/components/FabricEditCanvas.jsx` owns modal/transient Fabric editing for text-like objects and callout text editing.
- `src/components/AnnotationPropertiesPanel.jsx` edits annotation properties for the App-level properties panel.

Regular style editing uses Fabric-style fields such as `stroke`, `fill`, `strokeWidth`, `opacity`, font fields, and object-specific data. The App toolbar routes non-callout selections through `handlePatchSelectedAnnotation`. Properties panel patches are applied back into `annotationsByPage`.

## Callout Ownership

### Source-of-Truth State

Callouts are stored separately from Fabric annotations:

- `src/App.jsx:12079` defines `const [callouts, setCallouts] = useState([])`.
- `src/App.jsx` also owns `lastSavedCalloutsFingerprintRef`, `setCalloutsIfPersistedChanged`, `selectedCalloutId`, `selectedCalloutIds`, callout clipboard state, and callout edit state.
- `src/utils/calloutSyncPayload.js` defines the normalized callout payload and fingerprint used to avoid redundant persistence/sync updates.

Canonical callout fields currently include:

- Identity and page: `id`, sometimes `annotationId`, and `pageNumber`.
- Geometry: `arrowTip`, `knee`, `textBoxPosition`, `textBoxWidth`, `textBoxHeight`.
- Content: `text`.
- Style: `style`.
- Scope and grouping: `moduleId`, `regionId`, `spaceId`, `layer`, `groupId`.
- Authorship/sync/import metadata: `meta.authorId`, `meta.deviceId`, `meta.createdAt`, `meta.updatedAt`, `lastEditorId`, `isPdfImported`, `pdfAnnotationId`, `pdfAnnotationType`, `pdfAnnotationSubject`.
- Transient UI fields such as `isSelected` are excluded from sync normalization.

### Callout Style Fields

`src/components/Callout/types.js` defines `defaultCalloutStyle` and `createCallout`.

Callout-specific style fields include:

- Border/line: `borderColor`, `borderOpacity`, `lineThickness`, `arrowheadStyle`.
- Fill: `fillColor`, `fillOpacity`.
- Text: `fontFamily`, `fontSize`, `fontColor`, `textAlign`.
- Text flags: `bold`, `italic`, `underline`, `strikethrough`.

These text flags are a critical preservation requirement. They do not match regular Fabric field names directly. `src/components/FabricEditCanvas.jsx` bridges Fabric edit fields to callout style patches, for example:

- `fontWeight` -> `style.bold`.
- `fontStyle` -> `style.italic`.
- `underline` -> `style.underline`.
- `linethrough` -> `style.strikethrough`.
- `fill` / text color -> `style.fontColor`.

### Creation, Rendering, Selection, and Editing

Callout creation starts in the SVG layer:

- `src/components/SVGAnnotationLayer.jsx` owns callout creation gesture state and calls `createCallout`.
- `src/components/Callout/types.js` creates default callout state.
- `src/App.jsx:18852` `handleCreateCallout` stamps current toolbar colors, opacity, line thickness, and arrowhead style into the new callout style, adds a `callouts:create` history checkpoint, and appends to `callouts[]`.

Callout rendering and interaction are SVG-based:

- `src/components/Callout/index.jsx` is a compatibility stub; the visible callout UI is not rendered there.
- `src/components/SVGAnnotationLayer.jsx` filters page callouts, applies visibility rules, renders callout SVG elements, and emits invisible hit targets with `data-callout-id` and `data-callout-part`.
- `src/hooks/useSVGInteraction.js` handles pointer-down, drag, resize, group move, marquee selection, and pointer-up commit paths for callouts.
- `src/utils/annotationHitTest.js` detects callout targets using `data-callout-id` and returns `kind: 'callout'`.

Callout text editing is adapter-based:

- `src/App.jsx:18959` `handleRequestCalloutEditMode` converts a React/SVG callout into a transient Fabric group/textbox for editing.
- `src/utils/calloutEditAdapter.js` owns `toFabricGroup`, `fromFabricGroup`, and render-spec helpers for this edit bridge.
- `src/components/FabricEditCanvas.jsx` emits callout text/style changes through `onCalloutTextStyleChange`.
- `src/App.jsx` `handleCalloutTextStyleChange` and `handlePatchSelectedCallout` write patches back into `callout.style`.

### Context Menu Paths

There are two relevant context menu implementations:

1. App-level context menu in `src/App.jsx`
   - `window.__onAnnotationContextMenu` sets `annotationContextMenu`.
   - The portal around `annotationContextMenu` renders different menus for `kind === 'callout'`, `kind === 'annotation'`, `kind === 'group'`, `kind === 'textMarkup'`, and `kind === 'counter'`.
   - The callout branch shows `Cut`, `Copy`, `Paste`, and `Delete`.
   - The annotation branch shows `Cut`, `Copy`, `Paste`, `Delete`, and z-order commands.
   - Observed concern: the App-level callout `Delete` item is present, but the menu item dispatch switch does not contain an actual `delete` action for callouts in the inspected path.

2. PageAnnotationLayer-level context menu in `src/PageAnnotationLayer.jsx`
   - `handleContextMenu` first detects Fabric targets, then manually hit-tests callouts with `isPointOnCallout`.
   - The callout menu includes `Cut`, `Copy`, `Paste`, `Properties`, and `Delete`.
   - `handleDeleteCalloutFromMenu` directly filters `callouts[]` and clears selection.
   - `handleEditCalloutFromMenu` builds modal style state including callout text and style fields.

This split is one of the highest-risk KAL-81 areas. A future implementation should converge these onto a single command registry before changing storage.

### Persistence and Sync

Local persistence:

- `src/App.jsx` `saveAnnotationsByPage` and `loadAnnotationsByPage` use `annotationsByPage_${pdfId}`.
- `src/App.jsx` `saveCallouts` and `loadCallouts` use `callouts_${pdfId}`.
- `src/utils/calloutSyncPayload.js` normalizes callouts for persistence and sync and removes transient keys.

Supabase serialization:

- `src/services/annotationTypeSerializers.js` keeps Fabric and callout serializers separate.
- `shouldDeserializeAsFabricObject(row)` returns false for `annotation_type === 'callout'`.
- `serializeCalloutToRow(callout, opts)` writes `annotation_type: 'callout'` and stores the object under `annotation_data.callout`.
- `deserializeRowToCallout(row)` and `deserializeRowsToCallouts(rows)` hydrate callout rows into `callouts[]`.

Cloud sync:

- `src/services/annotationCloudSync.js` owns non-survey `document_annotations` rows, including callouts.
- `upsertAnnotationsByPage` handles Fabric annotations.
- `upsertCallouts` handles callouts.
- `loadAllNonSurveyMarkerAnnotations` returns both `annotationsByPage` and `callouts`.
- Realtime subscription callbacks route callout rows to callout insert/update/delete handlers instead of Fabric handlers.

CRDT/Yjs sync:

- `src/hooks/useAnnotationCloudSync.js` accepts both `annotationsByPage` and `callouts`.
- `fanOutCrdtForAnnotationsByPage` skips callouts.
- `fanOutCrdtForCallouts` writes current callouts into `ydoc.getMap('callouts')` and deletes legacy callout entries from the annotation map when needed.
- `src/lib/collab/crdtAnnotationBridge.js` implements `applyCalloutCommit`, `applyCalloutDelete`, and `materializeCalloutFromYMap`.
- `src/lib/collab/crdtUndoManager.js` tracks both `ydoc.getMap('annotations')` and `ydoc.getMap('callouts')`.

KAL-81 must preserve both durable Supabase rows and existing Yjs `callouts` map content during any model migration.

## Imported Annotation Ownership

PDF import has three important paths:

- Native or app metadata annotations converted into Fabric objects in `src/utils/pdfAnnotationImporter.js`.
- App callout metadata reconstructed into callout state via `SurveyAppCallout` metadata.
- Acrobat-style `FreeTextCallout` objects converted through `src/utils/calloutImportAdapter.js`.

Relevant symbols:

- `src/utils/pdfAnnotationImporter.js` `importAnnotationsFromPdf` returns `annotationsByPage`, `calloutsByPage`, `appLayerState`, unsupported diagnostics, and native layer policy.
- `normalizeImportedAppCallout` parses app callout metadata and builds a callout object with style, scope, group, and imported-native fields.
- `src/utils/calloutImportAdapter.js` `isImportedCalloutTextbox`, `convertImportedCalloutToCalloutState`, and `splitImportedCalloutsFromPage` split native callout-like textboxes out of regular Fabric import results.
- `src/App.jsx` PDF import hydrate path preserves non-imported current state and replaces imported PDF-derived objects/callouts.
- `src/App.jsx` `markEditedImportedPdfAnnotationsOnPage` marks edited imported PDF annotations so export can distinguish edited copies from preserved native annotations.

Import/export correctness depends on not duplicating unedited native annotations. A unified model must keep `isPdfImported`, `pdfAnnotationId`, and edited-state semantics intact.

## Survey Mark Ownership

Survey marks are not regular annotations:

- `src/services/documentAnnotationService.js` owns `surveyMarker` rows.
- `src/services/annotationCloudSync.js` explicitly excludes survey-marker ownership except for legacy Fabric survey marker rows.
- `src/components/SVGAnnotationLayer.jsx` renders survey marker elements separately from regular SVG/Fabric annotation objects.
- `src/utils/contextMenuDiagnostics.js` suppresses or handles right-click behavior differently for survey markers.
- `src/utils/pdfAnnotationsPdfLib.js` excludes survey markers from the regular printable annotation payload.

KAL-81 should avoid pulling survey markers into the callout unification unless a separate survey-mark model decision is made.

## Region and Space Scoped State

Region and space behavior is metadata-driven:

- Callouts and Fabric annotations can carry `moduleId`, `spaceId`, `regionId`, and `layer`.
- `src/utils/annotationVisibilityRules.js` classifies visibility for canvas, survey, region, and survey-region contexts.
- `src/SpaceRegionOverlay.jsx` owns overlay/dimming UI, not annotation storage.
- `src/App.jsx` `cascadeDeleteScopedAppState` removes scoped entries from `annotationsByPage`, `callouts`, survey markers, spaces, and cloud rows.
- `src/utils/pdfAppAnnotationMetadata.js` app-layer metadata embeds scoped annotations, scoped callouts, survey markers, and spaces into exported PDF state.

Any unified annotation model must retain scope metadata and cascade delete behavior for both regular annotations and callouts.

## Undo / Redo Ownership

Undo/redo is split across local history and CRDT history:

- `src/App.jsx` `getHistorySnapshot` captures `annotationsByPage`, `surveyMarkers`, `spaces`, and `callouts`.
- `restoreHistoryState` restores all of those slices, including callouts.
- `addHistoryCheckpoint` is used for callout create/update/delete and mixed delete batches.
- `handleDeleteSelectedCallouts`, `handleCreateCallout`, `handleUpdateCallout`, and `handleBeginBatchDelete` are the main App-level callout history entry points.
- `src/utils/annotationLocalHistory.js` and `src/utils/historyStacks.js` support local annotation history behavior.
- `src/utils/calloutHistoryScope.js` scopes legacy/callout restore operations so undo does not stomp unrelated state.
- `src/lib/collab/crdtUndoManager.js` includes both `annotations` and `callouts` maps in the Yjs UndoManager.

KAL-81 must verify mixed shape/callout operations still produce one coherent checkpoint. It should also prevent duplicate local and Yjs history events during migrations.

## Import / Export / Print Ownership

PDF export and print flattening treat callouts as a peer-but-separate annotation family:

- `src/utils/pdfCalloutMetadata.js` defines `PDF_CALLOUT_METADATA_KEY`, `PDF_CALLOUT_SUBJECT`, and `buildPdfCalloutMetadata`.
- `src/utils/pdfAppAnnotationMetadata.js` `buildPdfAppAnnotationMetadata` skips counters and callouts because callouts have separate metadata.
- `src/utils/pdfAppAnnotationMetadata.js` `buildPdfAppLayerStateMetadata` embeds scoped callouts in app-layer state.
- `src/utils/pdfAnnotationsPdfLib.js` `buildPrintableRegularAnnotationPayload` includes regular-scope callouts and excludes survey/scoped state from print flattening.
- `src/utils/pdfAnnotationsPdfLib.js` `calloutToExportObject` converts callout state to export objects.
- `src/utils/pdfAnnotationsPdfLib.js` `buildPdfExportAnnotationPlan` plans Fabric annotations, survey markers, and callouts separately.
- `src/utils/pdfAnnotationsPdfLib.js` `createCalloutAnnotations` exports each callout as line/line/free-text PDF annotations with app metadata.
- `src/utils/pdfAnnotationsPdfLib.js` `drawFlattenedCallout` draws callout lines, border, fill, and text directly into page content for print flattening.
- `src/utils/saveAnnotatedPDFFile.js` passes `callouts`, `surveyMarkers`, and `spaces` into `savePDFWithAnnotationsPdfLib`.

A unified annotation model must either keep these adapters or replace them with equivalent export branches. Removing callout-specific metadata would break PDF round-trip import.

## Callout-Specific Adapters and Compatibility Shims

Current adapter boundaries that KAL-81 should preserve or replace deliberately:

- `src/utils/calloutEditAdapter.js`: React/SVG callout state <-> transient Fabric edit group.
- `src/utils/calloutImportAdapter.js`: imported PDF FreeTextCallout-like Fabric textbox <-> callout state.
- `src/utils/calloutSyncPayload.js`: callout normalization/fingerprint.
- `src/utils/pdfCalloutMetadata.js`: PDF metadata for callout multi-annotation export.
- `src/services/annotationTypeSerializers.js`: Supabase row serialization for callouts.
- `src/lib/collab/crdtAnnotationBridge.js`: Yjs `callouts` map commit/delete/materialization.
- `src/components/Callout/types.js`: default callout style, arrowhead styles, and state constructor.

These should be treated as public migration contracts until all old data paths are retired.

## Divergences to Resolve in KAL-81

1. Callouts use `callout.style.*`; Fabric annotations use Fabric object fields.
2. Callouts have `bold`, `italic`, `underline`, and `strikethrough`; regular annotation style patches do not share this schema directly.
3. Callouts have a different context menu from annotations.
4. App-level and PageAnnotationLayer-level context menus can both act on callouts.
5. App-level callout menu shows `Delete`, but the inspected App-level dispatch path does not implement the callout delete action.
6. PageAnnotationLayer callout Delete directly filters `callouts[]`, which risks bypassing the App-level history/sync/delete-intent path if that menu path is active.
7. `annotationTypeSerializers` has legacy compatibility for Fabric groups with `data.type === 'callout'`, but callout rows are intentionally not deserialized as Fabric objects.
8. Yjs stores regular annotations and callouts in different maps.
9. PDF export writes callouts as multiple native PDF annotations with shared app metadata, not as one generic Fabric annotation.
10. Imported PDF callouts can come from app metadata or native FreeTextCallout-like objects and need dedupe/edit preservation.

## KAL-81 Implementation Checklist

1. Choose the canonical unified annotation model first.
   - Decide whether the canonical model is Fabric-shaped, domain-shaped, or a discriminated union such as `{ id, type, pageNumber, geometry, style, scope, meta }`.
   - Do not use the transient Fabric edit group as canonical storage unless every callout field and PDF metadata round-trip has explicit tests.

2. Add pure converters before changing state ownership.
   - Legacy `callouts[]` -> unified annotation.
   - Unified callout annotation -> existing SVG callout renderer.
   - Unified callout annotation -> transient Fabric edit group and back.
   - Unified callout annotation -> Supabase row and back.
   - Unified callout annotation -> Yjs commit/materialize and back.
   - Unified callout annotation -> PDF export/import metadata and back.

3. Unify selection identity.
   - Replace split selection assumptions with one identity contract that can represent regular annotations, callouts, survey markers if needed, groups, and text markup.
   - Keep existing `data-callout-id` and `data-annotation-index` hit targets working during migration.

4. Unify context menu command routing.
   - Build one command registry for Cut, Copy, Paste, Delete, Properties, and z-order.
   - Make unsupported commands explicitly disabled instead of silently absent.
   - Fix the App-level callout Delete stub if that menu remains.
   - Route PageAnnotationLayer callout actions through App-level handlers so history, sync, and delete-intent tracking stay consistent.

5. Unify style editing without losing callout text flags.
   - Add a shared style contract that can represent `bold`, `italic`, `underline`, `strikethrough`, `textAlign`, font family/size/color, border, fill, opacity, line thickness, and arrowhead style.
   - Keep mapping tests for Fabric fields such as `fontWeight`, `fontStyle`, `underline`, and `linethrough`.

6. Preserve history semantics.
   - Keep one checkpoint for mixed annotation/callout delete.
   - Verify callout create, drag, resize, text edit, style edit, delete, undo, and redo.
   - Avoid double-applying local history and Yjs history during migration.

7. Preserve sync compatibility.
   - Continue reading existing Supabase rows with `annotation_type: 'callout'`.
   - Continue reading existing Yjs `callouts` map content.
   - Decide whether writes dual-write during a transition or migrate in place.
   - Preserve author metadata and same-account echo filtering.
   - Keep localStorage read compatibility for `callouts_${pdfId}`.

8. Preserve import/export compatibility.
   - Keep `SurveyAppCallout` metadata round-trip.
   - Preserve app-layer scoped callouts.
   - Preserve unedited imported native annotation skip behavior.
   - Export edited imported callouts exactly once.
   - Keep print flattening behavior for regular-scope callouts.

9. Preserve visibility and cascade delete.
   - Keep `moduleId`, `spaceId`, `regionId`, `layer`, and `groupId` through every converter.
   - Re-run visibility and scoped delete tests against regular annotations and callouts.

10. Ship behind a migration boundary.
   - Prefer an adapter layer that allows old state and new state to coexist during verification.
   - Add diagnostics around any destructive delete or conversion path.
   - Only remove legacy callout paths after durable data compatibility is proven.

## Acceptance Tests for KAL-81

At minimum, add or update tests for:

1. Create a callout, select it, drag the arrow tip, drag the knee, resize the text box, edit text, reload, and verify geometry/content persists.
2. Toggle Bold, Italic, Underline, and Strikethrough for a callout through the toolbar/Fabric edit path; verify SVG render, edit reopen, Supabase row, Yjs hydrate, PDF export, and PDF reimport.
3. Right-click a regular annotation and a callout; verify the unified menu shows the intended command set and that Delete, Cut, Copy, Paste, Properties, and z-order are implemented or explicitly disabled by design.
4. Delete a mixed selection of regular annotations and callouts; verify one undo restores all deleted objects and redo removes them again.
5. Multi-device sync: create/edit/delete a callout on one client and verify convergence on another client without echo-loop or same-account filtering regressions.
6. Import a PDF containing native FreeTextCallout-style annotations; verify app callout conversion, no duplicate export of unedited native annotations, and correct export after edit.
7. Export a PDF with regular callouts; verify three native PDF annotations are created with shared `SurveyAppCallout` metadata and reimport as one app callout.
8. Print/flatten a PDF with regular callouts; verify lines, arrowhead, fill, border, and text render in the flattened page content.
9. Scoped region/space callouts: verify visibility filtering, app-layer metadata export/import, and cascade delete.
10. Regression suites to keep green: `tests/calloutEditAdapter.test.mjs`, `tests/calloutRenderer.test.mjs`, `tests/calloutSyncPayload.test.mjs`, `tests/cloudSyncAllTypes/serializers.test.mjs`, and `tests/pdfSaveExportContract.test.mjs`.

## Risk Register

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Losing callout text flags | `bold`, `italic`, `underline`, and `strikethrough` are callout-style fields, not generic Fabric fields. | Add style round-trip tests before migration. |
| Context menu regression | Callouts and annotations currently expose different menus through multiple code paths. | Centralize commands and test right-click paths. |
| Delete bypassing history/sync | PAL callout delete directly mutates `callouts[]`; App delete has richer checkpoint/delete-intent behavior. | Route every delete through App command handlers. |
| Data loss during sync migration | Supabase and Yjs currently store callouts separately. | Read old and new stores during transition; dual-write if needed. |
| PDF round-trip breakage | Callouts export as multiple PDF annotations with app metadata. | Keep `SurveyAppCallout` metadata tests and import/export contract tests. |
| Imported native duplication | Unedited imported native annotations must be preserved, not exported again as duplicates. | Preserve `isPdfImported` / `pdfAnnotationId` and edited-state checks. |
| Scoped visibility regressions | Region/space/survey-region visibility is metadata-driven. | Keep scope fields in canonical model and test cascade delete. |
| Undo/redo corruption | Local and Yjs history both know about callouts. | Test local and CRDT undo/redo across create/update/delete/style changes. |

## Suggested File Touch Points for KAL-81

Likely implementation files:

- `src/App.jsx`
- `src/PageAnnotationLayer.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `src/hooks/useSVGInteraction.js`
- `src/components/FabricEditCanvas.jsx`
- `src/components/AnnotationPropertiesPanel.jsx`
- `src/components/Callout/types.js`
- `src/utils/calloutEditAdapter.js`
- `src/utils/calloutSyncPayload.js`
- `src/utils/calloutImportAdapter.js`
- `src/utils/pdfCalloutMetadata.js`
- `src/utils/pdfAnnotationsPdfLib.js`
- `src/utils/pdfAppAnnotationMetadata.js`
- `src/services/annotationTypeSerializers.js`
- `src/services/annotationCloudSync.js`
- `src/hooks/useAnnotationCloudSync.js`
- `src/lib/collab/crdtAnnotationBridge.js`
- `src/lib/collab/crdtUndoManager.js`
- `src/utils/annotationHitTest.js`
- `src/utils/annotationVisibilityRules.js`

Likely test files:

- `tests/calloutEditAdapter.test.mjs`
- `tests/calloutRenderer.test.mjs`
- `tests/calloutSyncPayload.test.mjs`
- `tests/cloudSyncAllTypes/serializers.test.mjs`
- `tests/pdfSaveExportContract.test.mjs`
- New unified annotation model tests for selection, commands, sync conversion, and PDF round-trip.

## KAL-80 Verification Notes

This audit was produced by reading the existing architecture refactor map and source files with `rg` and targeted file inspection. It intentionally makes no source-code changes.

Docs-safe verification expected for this task:

- Check this file contains callout-specific ownership, style flags, context menu divergence, sync, import/export, undo/redo, and KAL-81 checklist coverage.
- Review `git diff` and ensure only this markdown audit is changed.
