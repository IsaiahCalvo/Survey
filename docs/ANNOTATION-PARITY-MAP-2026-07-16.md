# Annotation Parity Map — verified 2026-07-16

> **Partly superseded 2026-09-28 (w52)** — the current per-type × per-action
> state is `docs/ANNOTATION-CAPABILITY-MATRIX.md`. Claims below that are no
> longer true:
> - `callouts[]` is no longer its own state: it is derived from
>   `annotationsByPage` (R2.2 flip), and callouts now sit in the page's ONE
>   stacking order (persisted per mark, `src/services/annotationStackOrder.js`).
> - The callout context menu is not "4 items, all z-order missing": it has
>   Cut / Copy / Paste / Delete + the four z-order items, same handlers as shapes.
> - The callout delete path now routes through the ownership gate and the
>   bulk-delete planner (cross-author confirm).
> - Print draws Survey Markers; legacy arrow groups export as lines.
> - Stamps DO exist now (imported PDF image stamps render as stamp proxies).

> Mapping pass only. No application code was modified.
> Supersedes the stale per-type table in `docs/ANNOTATION-CONTRACT.md` (verified 2026-05-29).
> Method: two independent read-only source-verification agents + graphify + fallow (audit:code/dead/dupes/health) + codegraph call-path analysis. Every claim below is source-cited; tool findings were validated against source and several were rejected as false positives.

## Scope

Linear: **KAL-81 — "Unify callouts with the main annotation model"** (Backlog). Related: KAL-125 (Done), KAL-297 (Done, keystone).

---

## 1. Headline

The callout **persistence keystone landed** (2026-06-29/30): callouts save and load as shared `.fabricObject` rows, `calloutsInSharedStore()` is a permanent `true`, all 11 prod rows were backfilled losslessly.

**But persistence was only 1 of 10 lifecycle stages.** Callouts remain forked in 8 of 10. The root cause is the in-memory `callouts[]` slice (`src/PDFViewer.jsx:3322`), which is still the source of truth and merely *projected* into `annotationsByPage` via `projectCalloutsIntoByPage` (`:18800`). Everything downstream forks off that slice.

**Correction to prior belief:** memory `project_callout_unification_status` implies mostly-done. Accurate for storage; **not** for create/undo/sync/render/erase/context-menu/text-styling/export.

---

## 2. Entry points & data flow

**Real annotation state engine:** `useState` hooks in `src/PDFViewer.jsx`. There is exactly one. (The parallel `AnnotationContext`/`AnnotationStore`/`OptimizedPDFPage` engine flagged in the old doc is **now deleted** — verified 0 matches.)

Three parallel state streams still exist and are hand-threaded at every export/save/print site:

| Stream | Owner | Note |
|---|---|---|
| `annotationsByPage` | `PDFViewer.jsx:3723`-era | The contract. 11 of 13 types. |
| `callouts[]` | `PDFViewer.jsx:3322` | Fork spine. Projected into the above. |
| `surveyMarkers` + `newSurveyMarkersByPage` | `:6699` / `:3989` | **Dual slice**, hand-synchronized. |

Fan-in sites: `pdfAnnotationsPdfLib.js:319-324`, `:1488`, `:1556`, `:1566`; `viewerShared.js:1645`; `PDFViewer.jsx:19073`, `:19096-19108`, `:19209`, `:26135-26152`.

---

## 3. Callout conformance (verified against current source)

| Stage | Verdict | Evidence |
|---|---|---|
| Create | **DIVERGENT** | `handleCreateCallout` `PDFViewer.jsx:10195-10211` → `setCallouts([...prev, new])`; never reaches `handleSaveAnnotations` (`:21625`). Paste same (`:3587`). |
| State | **DIVERGENT** | Separate slice `:3322`; dual-rep via projection. |
| Render | **DIVERGENT** | Shared dispatch *explicitly excludes* callout (`SVGAnnotationLayer.jsx:2098-2112`, sets `element = null`); parallel `filteredCallouts` loop `:3190`, sibling render `:4658` vs `:4666`. |
| Serialize | **ON CONTRACT** ✅ | Keystone. `.fabricObject` rows. |
| Sync | **DIVERGENT (reachable)** | `upsertCallouts` live via forceFlush `useAnnotationCloudSync.js:3210` ← manual save `PDFViewer.jsx:17313`; also `cloudSyncMigration.js:185`. Dedicated `getMap('callouts')` live via `fanOutCrdtForCallouts:839` → `applyCalloutCommit:880` (called `:1342`, `:3224`). `calloutSyncPayload.js` live. Only the two `callout-bulk` queue branches (`:3006`, `:3101`) are dead. |
| Undo/Redo | **DIVERGENT** | `isLegacyAnnotationHistoryMeta` (`historyHelpers.js:114-120`) matches `callouts:*` → bespoke snapshot lane. `calloutHistoryScope.js` live-imported `PDFViewer.jsx:164`, used `:10676`, `:10866`. |
| Edit | **DIVERGENT** | Sentinel `reactCalloutId` live (`:10319-10334`), masquerades as `type:'text'`. `loadCalloutAnnotation` is **gone** (tombstone `FabricEditCanvas.jsx:2819-2824`); host is `TextEditOverlay` (`:29045`). |
| Delete | **PARTIAL** | `canModify` gate **is real** (`:10082-10090`) — KAL-125 legitimately Done. Context menu routes to same gated handler. **But** `buildBulkDeletePlan` unreachable: `handleRequestBulkDelete` plans only from `annotationsByPage[...].objects` (`:17158-17165`) → no cross-author confirm modal for callouts. |
| Erase | **DIVERGENT** | Bespoke `getCalloutHitIds` (`FabricEraserCanvas.jsx:59-117`, called `:935-942`); shared `pageSpaceEraser.js` has zero callout awareness; forked delivery `onEraseCallout:989` → `PDFViewer.jsx:28693`. Gap is **space scoping** + `eraserMode` (partial-carve nukes whole callout) + preview ghosting, not ownership (re-checked downstream). |
| Text styling | **DIVERGENT** | Own vocab `bold/italic/underline/strikethrough` (`Callout/types.js:140-143`) vs Fabric-native for freetext. Translator **duplicated**: `TextEditOverlay.jsx:68-80` + `FabricEditCanvas.jsx:1485-1497`. |
| Context menu | **DIVERGENT** | `annotationHitTest.js:261-265` — callout wins routing outright. Callout menu = 4 items (`useAnnotationContextMenu.jsx:186-197`); annotation = 9 (`:203-303`). All z-order items missing. |
| Export | **DIVERGENT** | 3-stream hand-threading (see §2). |

---

## 4. Other types — who else is treated differently

**survey_marker — the only other type with real live divergence.**
- Dual slice: `newSurveyMarkersByPage` (`:3989`) + `surveyMarkers`; dual-write in one handler `:24073`/`:24093`; **28** write sites (old doc said ~20).
- Bespoke ownership chain `:24173` (`userId || annotationData?.userId || lastModifiedBy`) instead of `permissionScope.getAnnotationAuthorId`. **Two bugs the old doc missed:** (a) **fails open** — `if (!authorId || !user?.id) return true`; (b) **no `documentOwnerId` check**, so unlike `canModify` (`permissionScope.js:82`) **the document owner cannot delete another user's survey marker**.
- Own capture-phase Delete listener with `stopPropagation` (`SVGAnnotationLayer.jsx:2465`, registers per mounted page) + separate `selectedSurveyMarkerId` state.
- Much of its persistence fork (dedicated columns, Excel two-way sync) is **necessary** — that carve-out is by design.

**arrow — second place.** Two renderers: legacy `renderArrow` (`svgAnnotationRenderers.jsx:618-675`, dispatched `SVGAnnotationLayer.jsx:2131`, `:3545`, `:3694`) hard-codes `headSize = strokeWidth*3` + fixed triangle, bypassing the shared arrowhead spec `renderLine` uses → **legacy group arrows ignore all 6 arrowhead styles and the curved branch**.

**counter — now fully unified** ✅ (the `counterRotate` second mechanism is gone; 0 matches).

**stamp, sticky_note — unreachable vestiges, NOT live bugs.** No producer exists for stamp anywhere in `src/` (no `FabricImage`/`Image.fromURL`/`type:'image'`), and PDF import lists `Stamp` in `UNSUPPORTED_SUBTYPES` (`pdfAnnotationImporter.js:98-99`). **The old doc over-rates stamp at risk:high — a user cannot create one.**

**eraser — genuinely ON contract** ✅ for everything inside `annotationsByPage`. Canonical `canModify` (`FabricEraserCanvas.jsx:746`), generic `isPointOnObject` incl. `group` (`geometryHitTest.js:729-770`). Its only type branch (`path` = partial-carve vs whole-delete) is legitimate.

---

## 5. Live bugs found in passing (NOT yet app-verified — see §8)

1. **Right-click → Delete on a callout does nothing.** `useAnnotationContextMenu.jsx:196` — `item('Delete', 'delete')` omits the action arg → falls through to `logStub()` (`:157-168`). The annotation-kind Delete (`:284-303`) is fully wired. Same stub on counter's "Continue pin" (`:200`).
2. **Callout bold/italic/underline/strikethrough appear to never render.** `buildCalloutTextContentStyle` (`svgAnnotationRenderers.jsx:1019-1027`) accepts no weight/decoration fields; call site `:1523-1530` never reads them. State is stored and round-tripped; nothing on the render path consumes it.
3. **Print flatten silently drops survey markers.** `pdfAnnotationsPdfLib.js:1486-1490` hardcodes `surveyMarkers: {}` though `PDFViewer.jsx:26138` passes the real value one hop earlier. `spaces` likewise passed (`:26139`) into a signature that doesn't destructure it (`:122-126`). Direct symptom of the hand-threading.
4. **Text styling lost on BOTH output paths** (freetext + callout). PDF export hard-codes black regular Helvetica: `` `0 0 0 rg /Helv ${fontSize} Tf` `` (`pdfAnnotationsPdfLib.js:1044`) — **a red freetext exports with black text**, no bold/italic/underline. (`C:` at `:1051` is background/border, not glyph color.) Print-flatten always passes `fonts.regular` (`:1432`); `fonts.bold` is embedded (`:1484`) but used only for counter pins — color survives (`:1252`), weight/style/decoration do not.
5. **Legacy arrow groups render + print but are DROPPED from PDF export.** `EXPORTABLE_FABRIC_TYPES` has no `'group'` (`pdfAnnotationsPdfLib.js:43-53`) → `recordSkip(..., 'unsupported-type')` at `:362`, while print-flatten recurses group children fine (`:1354-1365`). Export and print disagree — and unlike stamp, **this data really exists in older saved documents**.
6. **Survey-marker ownership fails open + locks out the document owner** (§4).

---

## 6. Dead code (validated, not auto-trusted)

- **`FabricEditCanvas.jsx` / `FabricDrawingCanvas.jsx` — DELETED (2026-07).** See addendum 2026-07-19 below. Edit host is `TextEditOverlay`; freehand create is SVG-native; only `FabricEraserCanvas` remains.
- `Callout/index.jsx` null-render stub still mounted (verify line numbers before editing — they drift).
- `sticky_note` wiring, `image:'stamp'` mapping — vestigial.
- `callout-bulk` retry-queue branches (`useAnnotationCloudSync.js`) — no producer (re-grep before deleting).
- Two legacy PAL Delete listeners — parked; PAL only mounts under `?renderer=canvas`/Ctrl+Shift+V.
- **Fixed since old doc** ✅: `DB_TYPE_TO_FABRIC_DEFAULT`, `AnnotationContext`/`OptimizedPDFPage`, `saveAnnotatedPDFFile.js`, the three-way `onRequestEditMode` fork (now one handler + `TextEditOverlay`), Fabric Drawing/Edit file deletion.

---

## 7. Tooling notes

| Tool | Status | Value here |
|---|---|---|
| graphify | installed, `graphify-out/` current | **Low** — queries returned mostly unrelated nodes (audit scripts, bench harnesses). Better for broad navigation than this question. |
| fallow 3.6.0 | via `npx`, `.fallowrc.jsonc` current | **Low-to-none** — findings dominated by false positives, exactly as CLAUDE.md warns. Headline numbers (40,048 dup lines / 16.9%; maintainability 90.3) are mostly test/agent-cli harness clones. Did **not** surface any callout divergence. |
| codegraph | **was not installed/indexed — ran `codegraph init .`** (856 files) | **Medium** — `callers` was the one genuinely useful signal (e.g. proved `scopeHistoryStateForCalloutRestore` has only a test caller, and `upsertCallouts` has 4). |

**All three tools missed every finding in §5.** Direct source reading by the verification agents produced 100% of the real results. Recorded so future sessions don't over-invest in the tool sweep for questions of this shape.

---

## 8. What is NOT verified

Nothing in §5 has been driven in the running app. Per `feedback_verify_in_app_before_reporting`, build/unit gates ≠ verification. The context-menu Delete and the callout text-styling bugs in particular should be confirmed by hand before any fix is scoped.

The two agents **disagreed on callout erasing**: one found the bespoke `getCalloutHitIds` path (callouts *are* erasable, via a fork), the other concluded the eraser cannot touch callouts at all. The specific citation wins on evidence, but this is worth a hands-on check.

---

## 9. Recommended order (nothing started)

1. **App-verify §5.1, §5.2** — cheapest, highest-signal, both are user-facing and look genuinely broken.
2. **Survey-marker ownership gate** (§4) — small, self-contained, closes a fail-open security hole + an owner lockout. Independent of any migration.
3. **Text styling on export/print** (§5.4) — affects freetext today, not just callout.
4. **Legacy group-arrow export drop** (§5.5) — real data at risk.
5. **KAL-81 keystone remainder (R2.2 derive-model)** — retire `callouts[]` as the source; make `annotationsByPage` primary. This single change collapses create, undo, sync, render, context menu, and export forks at once. Per `.planning/callout-unification/PLAN.md` and the contract doc: **do NOT chip at this piecemeal** — the dependent forks are load-bearing until it lands. Then R2.3 (realtime/CRDT).
6. ~~Dead-file confirmation / Phase 8 deletion~~ — **done** for Fabric Drawing/Edit (see addenda).

---

## Addendum (2026-07-17): dead-file claims adversarially verified

- **FabricEditCanvas.jsx — DEAD as a render path, NOT inert as a module (at audit time).** Exhaustive setter audit: all `setEditingAnnotation` object literals carried `editType: 'text' | 'bbox'`; the EditHost ternary could never select FabricEdit. Deletion required relocating the `fabric.IText.prototype.renderCursor` import-time patch (legacy PAL still uses IText/Textbox) and updating source-text tests.
- **FabricDrawingCanvas.jsx — DEAD, zero importers, no module side effects (at audit time).**
- **zoomGeneration signal stays load-bearing** (3 live consumers: SVGAnnotationLayer, FabricEraserCanvas, PdfjsViewerContainer).

## Addendum (2026-07-19): deletion landed

- `src/components/FabricDrawingCanvas.jsx` and `src/components/FabricEditCanvas.jsx` are **gone from the tree**. Do not recreate them.
- Live edit host remains `TextEditOverlay.jsx`. Live Fabric overlay remains `FabricEraserCanvas.jsx` only.
- `CLAUDE.md` / `AGENTS.md` / `README.md` / `docs/ARCHITECTURE.md` high-risk lists updated to match (Drawing/Edit removed; pdf.js symbols named).
- Line numbers cited earlier in this map may have shifted after viewer churn — re-grep before using them as fix scope.
