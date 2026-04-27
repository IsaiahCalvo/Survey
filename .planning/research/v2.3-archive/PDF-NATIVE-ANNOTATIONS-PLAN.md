# PDF-Native Annotations Migration — Plan

**Author:** Claude · **Date:** 2026-04-25
**Status:** Draft for review · **Target milestone:** v3.0 (proposed)
**Estimated scope:** 4–6 weeks of focused work, broken into 7 sub-phases

---

## 1. Goal

Eliminate the architectural gap that makes printing, exporting, and round-tripping annotations slow and lossy in this app today. After this migration, the user's highlights, drawings, shapes, and text live **inside the PDF document itself** as standard PDF spec annotations — readable by Acrobat, Foxit, Preview, and any other PDF tool — and printing the document is instant because the operating system already knows how to print a PDF that contains its own annotations.

### Success criteria (must all hold at v3.0 close)

1. **Instant print path** — `Cmd/Ctrl+P` on a 100-page document opens the OS print dialog in under 1 second, with all of the user's markup baked in. No per-page rasterization. No iframe pre-render.
2. **Round-trip with Adobe Acrobat** — open a document, mark it up, save, open the saved file in Adobe Acrobat → every annotation is present, editable, and visually faithful. Open it back in our app → the annotation set is identical to what was saved.
3. **No regression on the 16 existing annotation tools** — pen, highlighter, eraser, rectangle (outline + filled), circle/ellipse, line, arrow (all 6 head styles + curvature), free text, callout (with knee), counter (with chains), polygon, polyline, and stamp all behave the same as today from the user's perspective. UAT script at 50% / 100% / 200% zoom passes for each.
4. **Existing user data migrated lossless** — every annotation already saved by every existing user round-trips through the new system without visual or semantic change. Migration runs in the background on first open of a document and completes within 5 seconds for the largest documents tested (validated against Package 2 — Rev 4 — IC.pdf, 99 pages, ~200 annotations).

---

## 2. Current architecture (what we're replacing)

The app currently keeps annotations in a JavaScript object called `annotationsByPage`, keyed by page number, holding Fabric.js JSON. This object is held in React state, mirrored to localStorage as a backup, and only written into the PDF file at save time via a custom converter (pdfAnnotationsPdfLib.js). Counters and callouts are stored as Fabric groups with custom `data.type` markers; on save they're decomposed lossily into PDF primitives, so callout knee handles and counter chain semantics only survive *inside* our app — open the saved file in Acrobat and counters become static numbers, callouts become disconnected text + line pairs.

### Display vs edit
- **Display:** SVGAnnotationLayer renders most types as inline SVG with a single page-sized viewBox (vector, sharp at any zoom).
- **Edit:** A Fabric.js canvas (FabricEditCanvas) mounts only when the user enters edit mode for a single annotation. Pen and eraser drawing happen on FabricDrawingCanvas / FabricEraserCanvas during the stroke itself.

### Storage shape (page-space points, 72 DPI)
Each page entry is a Fabric.js JSON envelope containing an `objects` array. Custom annotation kinds are tagged via `data.type` (`counter`, `arrow`, `callout`). Region/module/space metadata rides on every object.

### What's load-bearing today (must keep working)
- The `zoomGeneration` signal contract (any breakage causes the flicker bug we already shipped fixes for).
- SVG `viewBox` owns all zoom scaling. JavaScript zoom coordination must NOT come back.
- Container-aware canvas sizing (`containerEl.offsetWidth / pageSize.width`).
- Fabric Textbox `fontFamily` must remain a single-name font (no CSS fallback stacks).
- The 30-second auto-save cadence and the manual `Cmd/Ctrl+S` save path.

---

## 3. Target architecture (what we're building)

### Storage = PDF itself

Annotations move from the in-memory `annotationsByPage` state into the PDF document's `/Annots` arrays — one array per page, native to the PDF format. The Fabric.js + custom-overlay world becomes a *display + edit projection* over that PDF data, not the source of truth. When the user edits an annotation, the change is written directly into the PDF model. Saving = serializing the modified PDF bytes back to localStorage and (for surveys) Supabase. Printing = handing those exact bytes to the OS.

### Editor: Syncfusion's native annotation toolkit

Syncfusion's React PDF Viewer already ships native creation, editing, and persistence for every PDF spec annotation type we need (highlight, underline, strikethrough, squiggly, ink, free text, rectangle, circle, line, arrow, polygon, polyline, stamp, sticky note, signature, measurement). It also fires events (`annotationAdd`, `annotationRemove`, `annotationPropertiesChange`, `annotationMove`, `annotationResize`) so we can mirror state into our store and keep our existing region/module/space tagging. Today we run with `enableAnnotation={false}` and the `Annotation` service un-injected — flipping those on is the entry point.

### Custom-overlay holdouts

Two annotation kinds have **no native PDF equivalent** and must stay as a custom layer:

1. **Counter chains** — PDF can store the visual circle and number, but the chain semantics (auto-increment, renumber on insert/delete, multi-list seriesId) are application-only. We store each counter as a `Stamp` annotation in the PDF (so it's visible in any reader) and keep chain metadata in a parallel sidecar (`counter-chain` data on the stamp's `/NM` field). The custom overlay renders only when the user is *editing* a counter; otherwise the native PDF stamp renders.
2. **Callouts with knee handles** — PDF's `FreeTextCallout` supports a leader line with at most one bend, which matches our knee handle exactly. The complication is our combined-tools target UX (curved leaders, rotation handles, hover-reveal handles from upcoming v2.3 phases). We persist the *baseline* callout as a spec-compliant `FreeTextCallout` so it round-trips with Acrobat, and layer our edit-mode UI on top when selected.

### Library stack

- **pdf-lib** — keep what's already integrated (form fields, page manipulation).
- **annotpdf (highkite/pdfAnnotate)** — add as the high-level annotation creation/round-trip layer. It generates the appearance streams pdf-lib won't, so non-Adobe viewers (Preview, Foxit, Syncfusion itself in some modes) render correctly.
- **Syncfusion's built-in `Annotation` service** — primary editor UI.

These three coexist by operating on the same Uint8Array PDF bytes — no architectural conflict.

---

## 4. Annotation type mapping

| Tool today | PDF spec target | Editor | Notes |
|------------|----------------|--------|-------|
| Highlight | `/Highlight` (text-markup) | Syncfusion native | Free-floating rectangles work via QuadPoints |
| Pen / freehand | `/Ink` | Syncfusion native | Variable-width strokes need a custom appearance stream — annotpdf handles this |
| Eraser | (no PDF type) | Custom — destructive edit on commit | Eraser strokes mutate the underlying Ink's InkList at commit and are then discarded |
| Rectangle outline / filled | `/Square` (with `/IC` for filled) | Syncfusion native | Rotation > 0° needs an appearance stream |
| Circle / ellipse outline / filled | `/Circle` (with `/IC` for filled) | Syncfusion native | Same rotation caveat |
| Line | `/Line` | Syncfusion native | Native |
| Arrow (6 head styles + curvature) | `/Line` with `/LE` ending | Syncfusion native + custom AP for curvature | Standard heads native; curved bezier arrows need an appearance stream we generate |
| Free text | `/FreeText` | Syncfusion native | Single-name fonts only (existing rule); embed font program as Type0/CIDFont for Unicode |
| Callout with knee | `/FreeText` + `/IT /FreeTextCallout` + `/CL` | Syncfusion native + custom edit-mode UI | One-knee leader matches our model exactly |
| Counter | `/Stamp` + `/NM` chain ID | Custom edit-mode UI on top of Stamp | Chain semantics live in app state, sync'd to stamps on edit |
| Polygon | `/Polygon` | Syncfusion native | Native |
| Polyline | `/PolyLine` | Syncfusion native | Native |
| Stamp / image | `/Stamp` | Syncfusion native | JPG only for custom images (Syncfusion limitation — document for users) |
| Sticky note | `/Text` | Syncfusion native | Native |

### What gets lost or approximated

- **Variable pen width** — PDF spec stores one width per Ink. Mitigation: appearance stream generated at commit time renders the width modulation faithfully; the underlying `InkList` is the smoothed centerline. Round-trip into Acrobat and back keeps the appearance.
- **Eraser** — destructive at commit; you can't "un-erase" a save later (matches current behavior).
- **Curved arrows** — bezier curvature lives in the appearance stream; non-Acrobat viewers that don't honor `/AP` will show the straight base line. Document the trade-off.
- **Rotation > 90° increments on shapes** — possible via appearance stream but Acrobat may strip the AP on edit. Recommendation: restrict free-rotation to text and callouts (where it's natural) and snap shape rotation to 90° steps.

---

## 5. Sub-phase breakdown (proposed v3.0 milestone)

Each sub-phase ships behind a feature flag (`ENABLE_PDF_NATIVE_ANNOTATIONS`) so we can roll forward and back per environment and per beta cohort.

### Phase A — Foundations (week 1)

Add the annotpdf library. Wire Syncfusion's `Annotation` service into the viewer (currently disabled). Build the **bidirectional sync layer** that listens to Syncfusion's annotation events and mirrors changes into our existing `annotationsByPage` state — so during this phase, the existing UI keeps working and we just gain a parallel PDF-native copy that we can validate against. No user-visible change; flag stays off in production.

**Acceptance:** every annotation event from Syncfusion produces a matching update in our state, round-trip lossless on 50 random sample annotations from existing user data. Build clean, no regressions to existing flows.

**Boundaries:** no changes to Fabric.js components; no changes to SVG render layer; PrintPanel stays untouched.

### Phase B — Type adapters (week 2)

Build the converters: Fabric/SVG annotation JSON ↔ PDF annotation dict + appearance stream. One adapter per type. Unit-tested in isolation. Output validated by re-loading via annotpdf's reader and comparing to expected dicts.

**Acceptance:** all 16 tool types convert in both directions with byte-comparable round-trip on a 100-annotation fixture set covering the full UAT script.

**Boundaries:** adapters live in a new module; no changes to existing read/write paths.

### Phase C — Custom overlays for counters and callouts (week 2–3)

Define the sidecar metadata model for counter chains. Define the callout edit-mode UI on top of `FreeTextCallout`. Verify Acrobat round-trip preserves the visual.

**Acceptance:** save a document with 3 counter chains and 5 callouts; open in Acrobat; counters appear as numbered stamps in correct positions and order; callouts render with correct knee positions; reopen in our app; chain semantics restored, callout edit handles work as before.

### Phase D — Migration tool (week 3)

Background migration runs on first open of a document under the flag. Reads existing `annotationsByPage` state, writes equivalent PDF annotations into the document, archives the old state to a backup key (`annotationsByPage_pre_v3_${pdfId}`), atomic — either fully migrated or fully rolled back. Migration is idempotent: running twice is a no-op.

**Acceptance:** every annotation already saved by every existing user round-trips; backup is recoverable; migration completes in under 5 seconds for the largest test document.

### Phase E — Print and export rewrite (week 4)

Replace the PDF.js-render-every-page print pipeline. New print path = hand the PDF blob to a hidden iframe, call `print()`. Same for "Save as PDF". The custom Print Panel can be re-enabled and now powers paper-size / orientation / scope flows on top of an instant pipeline.

**Acceptance:** `Cmd/Ctrl+P` on the 99-page test PDF opens the OS dialog in under 1 second with all markup visible. "Print with Markup" menu can be removed. The custom Print Panel re-enabled flag lights up cleanly.

**Boundaries:** keep the iframe + blob path; do not reintroduce per-page rasterization.

### Phase F — UAT + beta rollout (week 5)

Run the full UAT script at 50% / 100% / 200% zoom against every tool. Beta cohort opt-in via the feature flag. Collect telemetry on save round-trip integrity, migration success rate, and print latency. Hold for 1 week of soak.

**Acceptance:** 0 data-loss reports across the beta; print latency p95 < 1 second; migration success rate > 99.5%.

### Phase G — Cleanup + GA (week 5–6)

Remove the feature flag. Delete the legacy `annotationsByPage`-as-source-of-truth path. Archive the SVG-display-as-truth helpers. Update CLAUDE.md gotchas section. Cut v3.0 release.

**Acceptance:** clean codebase, no flag, no dead path, all integration tests green, RECONCILIATION.md written for each phase.

---

## 6. Migration strategy for existing user data

This is the highest-risk part of the project. Every user has documents with saved annotations. Losing or corrupting them is unacceptable.

### Strategy

1. **Backup first** — when a document is opened with `annotationsByPage` present and no migration marker, write the current state to `annotationsByPage_pre_v3_${pdfId}` in localStorage AND to a `_pre_v3_backup` key in Supabase before touching anything.
2. **Convert incrementally** — walk each page, convert via the type adapters, write the PDF annotations into the document. If any conversion throws, abort the migration, restore from backup, surface a non-blocking warning to the user, and keep them on the legacy path for that document.
3. **Mark migrated** — write a `pdfNativeMigrationVersion: 3` flag in document metadata. On subsequent opens, skip migration entirely.
4. **Verify before commit** — after migration, re-read the PDF annotations and compare them to the original `annotationsByPage` count + bounds + type for each annotation. Mismatch = abort + restore.
5. **Manual rollback path** — a hidden setting `Reset to v2 annotations` that restores from the backup key. Surface only via a debug menu; document it for support.
6. **No silent data loss** — if a tool type fails to convert (e.g., a future custom annotation kind we didn't anticipate), the migration aborts for THAT document, not for the user globally.

---

## 7. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Syncfusion's appearance-stream rendering differs subtly from our SVG renderer (visual regression) | High | Medium | Phase B includes a visual diff test harness — render same annotation in both old and new paths, compare pixel-bounded; flag regressions for hand-tuning |
| Existing user data has edge cases not covered by adapters | Medium | High | Pull a representative sample from production data on day 1; build adapter tests against that sample; backup + abort + restore on conversion failure |
| Counter chain semantics break after Acrobat round-trip | Medium | Medium | Sidecar metadata + idempotent re-attach on document open; test explicitly with Adobe Acrobat round-trip in Phase C |
| Eraser commit logic destroys ink in unexpected ways | Medium | High | Phase B isolates eraser into its own commit-time mutation function with snapshot-and-restore; full test fixture at commit boundaries |
| Rotation of shapes regresses (90°-only restriction) | Medium | Low | Document as known constraint; existing app already rotates rect/circle in 90° steps in most flows |
| Migration takes too long on large documents | Low | Medium | Phase D budget includes profiling on a 500-page worst-case fixture; if > 5s, chunk by page and surface a one-time progress indicator |
| Beta users hit save conflicts during a version where some users are migrated and some aren't | Low | High | Document version stamp prevents cross-version saves from clobbering; surface "this document was upgraded — reload" if version mismatch detected |
| Syncfusion's `enableAnnotation: true` introduces UX surprises (extra toolbar, right-click menu) | High | Low | Disable Syncfusion's built-in annotation toolbar; intercept context menu; route all UI through our existing toolbar |

---

## 8. Boundaries — DO NOT CHANGE

These are off-limits unless a phase explicitly owns them and gets a waiver:

- `src/App.jsx` — main file. Mirror state changes flow through new modules; App.jsx itself stays untouched outside of the Syncfusion config flip in Phase A and the print-pipeline rewrite in Phase E.
- `src/components/PageAnnotationLayer.jsx` — legacy PAL. Touched only if a phase explicitly says so.
- `src/components/SVGAnnotationLayer.jsx` — SVG renderer. Stays during the parallel-state phases (A–D); retired only at GA in Phase G.
- `src/components/FabricEditCanvas.jsx` / `FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` — `zoomGeneration` signal contract preserved end-to-end. These keep operating during edit; they retire only at GA.
- `package.json` / `vite.config.js` — adding `annotpdf` is the only allowed package.json change for the whole milestone.
- The 30-second auto-save cadence — preserve.
- `Cmd/Ctrl+S` save path — preserve.
- Region / module / space tagging on annotations — preserve through the adapter layer.

---

## 9. Out of scope (deferred)

- New annotation tool types (e.g., a measurement tool, signature flow rebuild, redaction). The migration is a *rewrite of how existing tools are stored*, not an expansion.
- Multi-user real-time collaboration on annotations. Keep the existing per-user save model.
- The combined-tools v2.3 callout polish (Phases 16–18 in the v2.3 roadmap) — finish those on the existing system first, then migrate the polished callout into the PDF-native model. This sequencing avoids re-doing callout logic mid-migration.
- Mobile / iPad annotation experience — out of scope for v3.0.
- Server-side PDF persistence layer — Syncfusion supports it but we keep client-side save for now.
- Annotation history / undo of arbitrary depth (current undo behavior preserved).

---

## 10. Open questions for next session

1. **Migration order with v2.3 callout polish** — proceed with v2.3 callout phases first (clean callout logic before migrating), or freeze callout polish at current state and migrate now? Trade-off: polished callouts mean more to port, but a cleaner port; freezing now means the migrated version may need follow-up polish.
2. **Beta rollout cohort** — opt-in via a setting, or auto-roll to a percentage? Affects Phase F.
3. **Variable pen width fidelity** — accept Acrobat showing a uniform stroke (spec-correct but visually different), or invest in appearance-stream regeneration that preserves the visual at the cost of more complex commit logic?
4. **Counter chain visibility outside our app** — when a document is opened in Acrobat, counters render as plain numbered stamps with no chain affordance. Acceptable, or do we need a sticker note explaining the chain to non-app readers?

---

## 11. References

- Current codebase audit — `.planning/research/CURRENT-REPO-AUDIT.md`
- v2.3 callout roadmap — `.planning/ROADMAP.md` Phases 14–18
- PDF 1.7 spec §12.5 (annotations) — ISO 32000-1
- annotpdf — github.com/highkite/pdfAnnotate
- Syncfusion React PDF Viewer annotations — help.syncfusion.com/document-processing/pdf/pdf-viewer/react/annotation
- Existing project annotation importer — `src/utils/pdfAnnotationImporter.js`
- Existing project annotation exporter — `src/utils/pdfAnnotationsPdfLib.js`

---

*End of plan. Review next session, then we register Phases A–G in the roadmap and begin with Phase A.*
