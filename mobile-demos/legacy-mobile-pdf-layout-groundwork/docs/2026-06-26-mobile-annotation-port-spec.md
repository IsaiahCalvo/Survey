# Spec: Desktop → Mobile annotation port (everything under the PDF viewer)

**Date:** 2026-06-26
**Scope:** Everything *under* the PDF viewer — annotation tools, Survey Markers, spaces & regions, editing chrome, persistence/sync. EXCLUDES the home surface (templates/projects/documents lists, auth, navigation).
**Status:** SPEC / ROADMAP. Derived from a 5-agent sweep of the desktop codebase + the current mobile spike.
**Mobile app:** `mobile-expo-go/` (Expo SDK 54, RN 0.81, New Arch, Skia + Reanimated + Gesture Handler). Renderer foundation is device-confirmed (Approach C: PDF rasterized into Skia, tiling, crisp glued vector ink, pen + dots + select + delete).

---

## 0. The one rule that governs the whole port

**Mobile renders differently (Skia, not SVG/Fabric) but must STORE identically.** Desktop persistence is the contract; mobile is a second client on the *same* Supabase backend and the *same* `@survey/shared` types. So for every tool:

- **Store byte-identical `fabricObject` JSON** in `document_annotations.annotation_data.fabricObject` (or the callout/survey-marker shapes for those types). Desktop deserializes it back into Fabric.js; if a field is wrong, desktop breaks.
- **Reuse the pure JS** from desktop unchanged where possible: `@survey/shared` (types, `isSurveyMarkerType`, `ANNOTATION_TYPES`, `SurveyMarkerCore`), and pure geometry/serializer helpers (`annotationTypeSerializers`, arrowhead math, callout connection math, fingerprint hashing). These have no DOM/Fabric runtime dependency.
- **Render via a per-type Skia function** — the mobile-only code. Each desktop SVG renderer (`renderRect`, `renderLine`, `renderCounter`, `renderCallout`, …) becomes a Skia draw function over the same JSON.

**Coordinate reconciliation (CRITICAL — verify first).** Desktop stores most Fabric objects in **page-point coordinates, y-down/top-left** (Fabric canvas convention; the unscaled PDF page space, e.g. 612×792). Callouts store **normalized 0..1**. Survey markers store **page-point**. The mobile spike currently stores strokes **normalized**. Bridge: on serialize, mobile converts `norm → (norm.x * pageW, norm.y * pageH)` in **y-down page-point** space to match desktop Fabric JSON (NOT `normToPdfUserSpace` — that y-up flip is only for true pdf-lib export). `pageW/pageH` = the page MediaBox size in points (from `getPageSize`). **Action: write a `toFabricObject(stroke, pageW, pageH)` / `fromFabricObject(...)` bridge and prove a draw-on-mobile → load-on-desktop round-trip before building more tools.**

---

## 1. Data contract & persistence (the spine — build first)

### Tables / shape
- One table: **`document_annotations`** — `{ id, document_id, user_id, annotation_id, annotation_type, page_number, bounds JSONB, annotation_data JSONB, + survey columns, + collab metadata }`. UNIQUE`(document_id, annotation_id)`; upsert on conflict.
- `annotation_data.fabricObject` = the full Fabric JSON blob (source of truth). `bounds` = projected bbox `{x,y,width,height,rotation?}` for indexing only.
- `annotation_type` ∈ `@survey/shared` `ANNOTATION_TYPES` = `[survey-marker, ink, freetext, square, circle, line, polyline, polygon, stamp, sticky_note, callout, counter, eraser, form-field]`.
- **Callout** rows: payload in `annotation_data.callout` (normalized 0..1), NOT `fabricObject`. **Survey-marker** rows: dedicated columns (`module_id, category_id, name, notes, entity_id, entity_name, checklist_responses, color, opacity`) + `annotation_data` overflow.

### Sync
- **Supabase upsert + Realtime** (debounced ~800ms; echo-filtered by `clientSessionId`). Read via keyset pagination (`loadAllTypesOwnedRowsForDocument`).
- **CRDT (Yjs) dual-write** exists on desktop (`crdtAnnotationBridge.applyFabricCommit` → `Y.Doc` maps `annotations`/`callouts`). **Decision (mobile v1): Supabase-only**; add Yjs realtime later (see §8 open decisions). Supabase upsert alone is a correct, durable client.

### Author attribution & permissions (non-negotiable)
- Canonical author chain (`permissionScope.getAnnotationAuthorId`): `meta.authorId ?? authorId ?? data.authorId ?? data.userId`.
- **Write-once on CREATE**: stamp `meta.authorId = currentUserId` only if empty; never overwrite on edit. `last_modified_by` updates every edit. Row `user_id` pinned to original author.
- **Roles**: owner > editor > commenter > viewer. `canModify` = owner OR author-match. Viewers read-only. RLS enforces this server-side (insert requires `auth.uid() = user_id` + editor access). Mobile MUST gate delete/edit through the same `canModify` check before writing, and show the cross-author confirm for bulk deletes.

### Mobile obligations
Reuse `@survey/shared` + `annotationTypeSerializers` (`serializeFabricObjectToRow`, `deserializeRowToFabricObject`, dedupe keys, author invariant) verbatim. CRUD = build/parse the row, upsert/delete to Supabase, respect `canModify`.

---

## 2. Tool inventory & desktop→mobile mapping

Status legend: ✅ desktop-complete · ⚠️ desktop divergent/WIP · ❌ desktop stub. **M-effort** = mobile build size given the renderer foundation already exists.

| Tool | Fabric/DB type | Create gesture (mobile) | Skia render | Store | M-effort | Notes |
|---|---|---|---|---|---|---|
| **Pen** | path / `ink` | 1-finger drag (DONE) | polyline path (DONE) | norm→page-pt path | — | shipped |
| **Dot** | path / `ink` | tap (DONE) | zero-len round-cap (DONE) | `[p,p]` | — | shipped |
| **Highlighter** | path / `ink` | 1-finger drag | path + multiply blend, low opacity | same as pen + `tool:'highlighter'` | S | distinguished only by `tool` meta + opacity/blend |
| **Rectangle** | rect / `square` | drag bbox | `drawRect` (+ fill-bleed clip when stroked) | page-pt `left/top/width/height/angle` | S | |
| **Ellipse/Circle** | circle\|ellipse / `circle` | drag bbox | `drawOval` | `rx/ry` or `radius` | S | both collapse to DB `circle`; blob preserves sub-kind |
| **Line** | line / `line` | drag (or 2-tap) | `drawLine` (+ optional curve) | `x1,y1,x2,y2` | S | optional linear snap; curved variant |
| **Arrow** | line / `line` | drag | line + arrowhead path | `data.arrowheadStyle` | S | 6 arrowhead styles (`ARROWHEAD_STYLES`); reuse arrowhead math |
| **Polygon** | polygon / `polygon` | multi-tap, tap-to-close | `Path` closed | `points[]` | M | multi-point creation gesture |
| **Polyline** | polyline / `polyline` | multi-tap, double-tap end | `Path` open | `points[]` | M | |
| **Text** | textbox / `freetext` | tap or drag-bbox → keyboard | Skia `Paragraph`/text | `text, fontSize, fontFamily(single-name!), fill, align, width…` | M | single-name fonts only (Fabric 400px gotcha); OS keyboard; edit overlay |
| **Text markup** (highlight/underline/strikeout/squiggly) | rect\|path / `ink` | needs a text layer (pdf.js text) | rect/path | `pdfAnnotationType` | L | requires a selectable text layer mobile doesn't have yet — defer |
| **Counter** | circle group / `counter` | tap-to-place, auto-number | badge path + number text (`renderCounter`) | `data.{displayNumber,pointerAngle,numberColor}` | M | ⚠️ desktop WIP (dual edit mechanism) — see §8 |
| **Callout** | group / `callout` | 3-point (tip→knee→box) + keyboard | leader+knee+arrowhead+box+text | normalized 0..1 `callout` shape | L | ⚠️ divergent fork (separate state/sync/history). Port geometry; store on the same row. See §8 |
| **Survey Marker** | rect / `survey-marker` | drag bbox + template/checklist panel | colored alpha rect | dedicated columns + `excelSync` | XL | domain centerpiece + Excel binding — see §4 |
| **Stamp/image** | image / `stamp` | — | — | — | — | ❌ desktop silent no-op. Decide in/out (§8); do NOT ship silent-drop |
| **Sticky note** | — / `sticky_note` | — | — | — | — | ❌ dead reserved type — skip |
| **Eraser** | tool (mutates) | drag over ink | n/a (clips paths) | rewrites target path | M | partial-erase clips geometry (`geometryEraser`); or whole-object delete (simpler v1) — §8 |

**Reusable pure helpers (import unchanged):** arrowhead spec/angle math, curved-line path, callout connection routing, counter badge path math, fill-bleed clip logic, `geometryHitTest`/`marqueeSelection` (lasso), fingerprint hashing.

---

## 3. Editing chrome → touch (locked decisions exist)

The mobile gesture model is **already locked** in `docs/superpowers/specs/2026-06-24-mobile-gesture-adaptation-design.md` (§0.6 live-test verdicts). Honor it:

- **CORE LAW**: 1 finger = active tool; 2 fingers ALWAYS navigate (pan+pinch), in every mode. (DONE in renderer.)
- **Tool palette**: on-screen buttons replace desktop hotkeys (V/P/H/E/T/Q/L/A/C). Need an active-tool indicator + sub-menus for multi-option tools (highlighter/eraser/counter-series). The current Draw/Select/Pan mode SV is the seed.
- **Properties** (color, stroke width, opacity, fill, border style, font, arrowhead, text styles): desktop = floating panel; mobile = **bottom sheet** (tap-to-open color modal, ≥44px steppers). Needed *early* because ink is hardcoded blue/3px.
- **Selection/transform**: single-tap select → proprietary handles per type (counter rotation-nub; rect border-flush handles; line endpoints+curve; callout part-handles). **Multi-select = tap-toggle + freeform LASSO** (NOT rectangular marquee — locked). Double-tap swaps to bbox handles for the 5 types (counter/line/arrow/polygon/polyline). Handle hit-targets ≥44px.
- **Context menu**: **long-press only** (Cut/Copy/Paste/Delete/z-order/Properties). DROP the floating quick-bar (locked). Lock-aspect + 15°-rotation-snap live *inside* the menu/settings, not a formatting bar (locked).
- **Undo/redo**: explicit buttons (no hotkeys); per-operation checkpoints. Reuse `annotationLocalHistory` + `undoRedoHotkeys` predicates (the key-event predicates are desktop-only; the history engine is reusable).
- **Text editing**: OS keyboard + an edit overlay; track live bounds; single-name fonts.
- **Z-order / copy-paste-duplicate / delete**: menu items; reuse desktop clipboard + bulk-delete-plan logic.

---

## 4. Survey Marker (domain centerpiece)

The signature, Excel-bound tool. Build after the contract + simple tools are proven.

- **Create**: drag a rectangle → colored semi-transparent rect (alpha ~0.4, multiply blend), dashed border while dragging.
- **Storage**: separate `surveyMarkers` slice (id-keyed) → `document_annotations` row with **dedicated columns** + `annotation_data`. Page-point `bounds {x,y,width,height,angle}`. NOT in the generic fabric pipeline.
- **Template/checklist UI**: a marker links to a `SurveyModule`/`category` and carries `checklistResponses {[itemId]:{selection:'Y'|'N'|'N/A', note?}}`, `name`, `notes`, `entity`. Reuse `@survey/shared` `SurveyTemplate/SurveyModule/SurveyCategory/SurveyChecklistItem/Entity/ChecklistResponses` types. Needs a mobile panel (bottom sheet / side drawer) for the checklist.
- **Excel two-way binding (must honor, do NOT reinvent)**: each marker carries opaque `excelSync { assignedToken (signed Row-ID HMAC), origin, fingerprints (identityVector/full/perField via FNV-1a), pendingRowIdWriteback, lastSeenRowNumber, … }`. Mobile MUST: preserve `excelSync` untouched on read/edit; **recompute fingerprints from new visible values** on content change; carry `assignedToken` through edits; never let the user edit `excelSync`. Reuse `excelIdentityRecord`/`excelSyncDirtyState` hashing. (The actual export/import flow can stay desktop-only for v1; mobile just must not corrupt the binding.)
- **Permissions**: creator-ownership preserved across collaborator edits; delete uses the author chain (desktop has a divergent ownership read here — use canonical `getAnnotationAuthorId`). Deletes can cascade to Excel rows.

---

## 5. Spaces & regions

Page-grouping + area-of-interest scoping. **Currently client-side localStorage only (NOT cloud-synced)** on desktop; `@survey/shared` has `SpaceConfig`/`RegionConfig` types but the live desktop shape is richer (`space.assignedPages[].regions[]` with `coordinates[], shapeType, operation add/subtract, rotation, show{Canvas,Survey}Annotations` lightbulb flags).

- **Spaces**: named page-set containers; activating one filters visible pages and scopes annotations. UI = a panel (mobile: drawer/sheet) with create/rename/reorder/toggle.
- **Regions**: ≤1 region per page per space; each is a set of additive/subtractive polygons (page-point coords) drawn with rect/freehand tools; a grey hashed overlay dims outside the region; a per-region "lightbulb" toggles background-annotation visibility.
- **Visibility rules** (`annotationVisibilityRules`): 4 scopes (CANVAS / SURVEY / REGION / SURVEY_REGION) decide what's visible+interactive given the active space + lightbulb + survey panel. **Port this logic verbatim** — it gates the whole canvas.
- **Mobile challenges**: touch polygon drawing (replace `RegionSelectionTool`), polygon boolean ops (replace `martinez-polygon-clipping` + SVG `<mask>` with Skia path ops / a JS clipper), rotation handle, and a **persistence choice** (localStorage → SQLite/AsyncStorage, or finally cloud them — §8).
- **Sequencing**: after Survey Markers (regions scope markers). This is a large, self-contained chunk.

---

## 6. Real PDF + multi-page + offline

- Replace the hardcoded tracemonkey URL with **a real survey PDF from Supabase storage** (download → `file://` → `openDocument`). Wire to the actual document id so annotations attach to the right `document_id`.
- **Multi-page**: the spike renders page 0 only. Need page navigation + per-page raster/tiling + per-page annotation layers. The rasterizer already takes a `pageIndex`.
- **Page operations** (add/delete/reorder/rotate/mirror) + **annotation reindex** (annotations stay pinned to their page). Likely a later phase; reuse desktop `pageTransformations` + reindex util.
- **Offline**: `expo-sqlite`/AsyncStorage cache of rows for field use (the native-vs-webview decision cited offline durability as a reason to go native). Sync on reconnect.

---

## 7. Recommended build order (each phase = a shippable increment)

1. **Contract spine** — serialize the existing pen ink to a real `document_annotations` row (coordinate bridge §0), read it back, prove desktop round-trip; author attribution + `canModify` + Supabase auth/session. *Highest risk, lowest visible change — do it first on the tool that already works.*
2. **Palette + properties + simple tools** — tool bar, color/width/opacity bottom sheet, then rectangle, ellipse, line, arrow, highlighter. (All JS-only, Fast-Refresh.)
3. **Selection/transform/edit chrome** — tap-toggle + lasso multi-select, long-press context menu, move/resize/rotate handles, delete, undo/redo, copy/paste, z-order.
4. **Text** — creation, OS-keyboard edit overlay, single-name fonts, styling.
5. **Survey Marker** — rect create + template/checklist panel + dedicated-column storage + `excelSync` preservation + ownership. (§4)
6. **Spaces & regions** — page grouping, region drawing, visibility rules, overlay, persistence. (§5)
7. **Callout + Counter + Stamp decision** — the divergent/WIP/stub trio, pending §8 answers.
8. **Real PDF + multi-page + page ops + offline + (optional) Yjs realtime.** (§6)

Polygon/polyline can slot into Phase 2/3 when the multi-tap gesture lands.

---

## 8. Open decisions that genuinely need an owner call

I can proceed on everything else with the recommendations above. These few are forks where I want your steer (defaults I'll take if you don't object):

- **Counter** — desktop is mid-debug (dual edit mechanism, "DO NOT TOUCH" flag). *Default: defer counter to Phase 7 and port the stable render only, no edit, until desktop settles.*
- **Callout** — port the divergent fork as-is, or wait for the desktop unification migration? *Default: port the geometry now but store it on the unified `document_annotations` row (don't replicate the separate sync/history forks on mobile).*
- **Stamp/image** — in scope or explicitly out? *Default: out of scope for v1, with an explicit "stamp not supported on mobile" skip (never silent-drop).*
- **Eraser** — partial-erase (clip path geometry, matches desktop) or whole-object delete (simpler)? *Default: whole-object erase for v1, partial-erase later.*
- **Yjs/CRDT realtime** — match desktop's dual-write now, or Supabase-only for v1? *Default: Supabase-only v1; add Yjs when live multi-user mobile editing is needed.*
- **Spaces/regions persistence** — keep client-local (SQLite) like desktop, or finally cloud them? *Default: SQLite-local to match desktop semantics; revisit clouding as a cross-cutting improvement.*
- **Spaces/regions in v1 at all?** — they're a power feature. *Default: include (Phase 6) since they scope Survey Markers, but they can slip if you want tools shipped sooner.*

---

## 9. Sources
5-agent desktop sweep (tool inventory, spaces/regions, data/persistence, interaction/chrome, mobile current-state) — see `docs/ANNOTATION-CONTRACT.md`, `packages/shared/src/`, `src/services/annotationTypeSerializers.js`, `src/services/annotationCloudSync.js`, `src/lib/collab/{permissionScope,crdtAnnotationBridge}.js`, `src/services/{documentSurveyMarkerMapper,excelIdentityRecord}.js`, `src/utils/{svgAnnotationRenderers,annotationVisibilityRules,regionMath,calloutEditAdapter}.js`, `src/{RegionSelectionTool,SpaceRegionOverlay}.jsx`, `src/components/{SVGAnnotationLayer,AnnotationPropertiesPanel}.jsx`, `src/PDFViewer.jsx`, and the mobile `2026-06-24/25-*` design docs.
