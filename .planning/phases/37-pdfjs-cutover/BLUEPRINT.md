# EXECUTION BLUEPRINT — Swapping the PDF Page-Drawing Engine (Syncfusion → owned pdf.js)

> Produced 2026-06-01 by a 9-agent planning workflow (read-only audit + synthesis). Planning only — no code changed. Execute one batch at a time, with `npm test` + a visual check between every batch.

## Overview for the Owner (plain English)

We are replacing **one thing only**: the part of the app that paints the actual PDF pages onto the screen. Today that painter is a third-party library called Syncfusion, which is fragile, slow to zoom, and expensive to license. We already built and proved our own painter on top of pdf.js — it zooms smoothly and we own all of it.

**What stays exactly the same:** every survey tool, every region, every Survey Marker, every annotation (pen, highlight, callout, shapes), thumbnails, page rotation, bookmarks, search, and saving. None of that work is rebuilt. Those features draw *on top of* the page, and they will keep drawing on top of the new painter just as they do on the old one.

**How we keep it safe:** we do not rip out the old painter. We build a single, well-defined "doorway" that everything in the app already talks through, make both painters fit that doorway, and add a one-line switch that chooses which painter is active. The old one stays in the building as an instant undo button. We flip the switch only after the new painter has passed a side-by-side checklist on real documents. The big cleanup (deleting Syncfusion, removing its license) happens in a *later* release, never on the day we flip the switch.

**Honest risk note:** this is a large, multi-week effort against the most fragile file in the codebase (~32,500 lines). The bulk of it is low-risk plumbing done in tiny, individually-tested steps. But there are three genuinely dangerous spots (the zoom-signal contract, the overlay render loop, and the interaction lifecycle) and a few real features the prototype never finished (printing, form display state, find-next, markup erase). Those are called out explicitly below. Anyone who tells you this is "just a swap" is wrong; the discipline of small batches with a test and a visual check between each is what makes it survivable.

---

## How to read this blueprint

- Each **STAGE** opens with one plain sentence for the owner.
- Inside each stage are **BATCHES**: the smallest unit a careful engineer should land, test, and visually verify before moving on.
- Every batch lists: **Goal**, **Scope**, **Proof** (test-suite expectation + concrete in-app visual check), **Reversible?**.
- The standing rule for *every* batch: run `npm test` and report the baseline before/after, plus the visual check. If either regresses, revert that single batch — they are sized so one revert never unwinds more than a few hours of work.

---

## STAGE 0 — Build the doorway and the engine switch (prerequisites; nothing visibly changes)

**Owner:** Before touching anything, we install a single "doorway" that all PDF-engine calls route through, and an off-by-default switch to choose the engine. After this stage the app looks and behaves identically — we've just built the frame the rest of the work hangs on.

This stage is the foundation. Until it exists, every later reroute is a guess. Do it first, in full, and prove it changes nothing.

### Batch 0.1 — Define the doorway interface (no behavior change)
- **Goal:** Write the single interface contract (the DOORWAY CONTRACT) as a typed module/JSDoc spec that both engines will satisfy.
- **Scope:** New file `src/components/pdfEngineContract.js` — pure documentation/types: the imperative methods (`goToPage`, `getPageContainer(s)`, `getViewerContainer`, `magnificationModule.*`, text-markup, search, bookmarks, load/save/print, thumbnails, form fields), the getters (`element`, `pageCount`, `currentPageNumber`, `zoomValue`), and the event-callback props. No imports into PDFViewer yet.
- **Proof:** Suite unchanged (no runtime code added). Visual: none — this is paper. Reviewer confirms every method PDFViewer currently calls on `syncfusionViewerRef.current` appears in the contract.
- **Reversible?** Yes (delete the file).

### Batch 0.2 — Introduce the engine-selection flag (separate from the overlay flag)
- **Goal:** Add `PDF_VIEWER_ENGINE` + `getPDFViewerEngine()` to `src/viewerShared.js`, defaulting to `'syncfusion'`, with a `window.__DEV_OVERRIDE_PDF_VIEWER_ENGINE` console escape hatch.
- **Scope:** `src/viewerShared.js` only. **Do NOT touch the existing `useSyncfusionRenderer = true` at `PDFViewer.jsx:768`** — that flag gates *overlay/zoom behavior*, not engine mounting. Conflating the two is the single most common way to break the zoom overlay. The new flag is the engine selector; the old flag stays meaning what it means.
- **Proof:** `npm test` green (run after editing `viewerShared.js` per the high-risk-file rule — both big files import it). Visual: app loads, `getPDFViewerEngine()` returns `'syncfusion'` in console.
- **Reversible?** Yes (remove the export).

### Batch 0.3 — Wrap the current mount in an engine selector (Syncfusion-only branch live)
- **Goal:** Insert `PDFViewerEngineSelector` around the existing `<SyncfusionPDFContainer>` mount, with only the Syncfusion branch wired; the pdf.js branch is a stub that throws if reached.
- **Scope:** New `src/components/PDFViewerEngineSelector.jsx`; one edit at the `<SyncfusionPDFContainer>` render site in `PDFViewer.jsx`. The selector passes **all existing props straight through** and forwards the existing `ref` (`syncfusionViewerRef`). No handler, no zoom-lifecycle, no prop renamed.
- **Proof:** `npm test` green at baseline. Visual: full smoke test — load a multi-page PDF, zoom, scroll, draw a pen stroke, place a region/Survey Marker, open bookmarks, search. Everything behaves exactly as before (because it *is* the same component, now one layer down).
- **Reversible?** Yes (inline the container back).

### Batch 0.4 — Build the doorway shim over the Syncfusion ref
- **Goal:** Make Syncfusion satisfy the doorway contract through a thin adapter, so callers can move to the contract without yet knowing which engine answers.
- **Scope:** A `useSyncfusionDoorway(ref)` adapter that exposes the contract methods by delegating to today's `syncfusionViewerRef.current`. No call sites migrated yet — this batch only proves the adapter returns identical values.
- **Proof:** Suite green. Visual: temporarily log `doorway.getZoomValue()` vs `syncfusionViewerRef.current.getZoomValue()` on zoom; confirm equal. Remove the log before committing.
- **Reversible?** Yes.

> **Gate to leave Stage 0:** the app runs unchanged, the engine flag exists and is off, the selector is live with only Syncfusion wired, and the doorway adapter returns values identical to direct Syncfusion calls. If any of these is shaky, do not proceed — the entire reroute funnel depends on this frame holding.

---

## STAGE 1 — Reroute the 929-connection funnel through the doorway (Syncfusion still the engine)

**Owner:** Now we move the app's ~929 direct calls into Syncfusion so they go through the doorway instead. This is the largest stage by volume but the lowest-drama: at every step the doorway still answers with Syncfusion, so the app keeps working. We're just changing *who the code talks to*, not *what answers*.

The whole point: by the end of this stage, the app no longer reaches into Syncfusion directly anywhere except inside the doorway adapter. Then swapping the engine becomes a localized change instead of 929 scattered edits. Batches are ordered safest-first across all four funnels (zoom, page-DOM, feature, lifecycle).

### Batch 1.1 — Zoom-state readers (read-only)
- **Goal:** Route the 9 pure-read zoom accessors through `doorway.getZoomPercent()`.
- **Scope:** `PDFViewer.jsx` lines ~449–451, 1075–1081, 5960–5996, 6008, 6294–6296. Reads only; no writes.
- **Proof:** Suite green. Visual: zoom to 150% via toolbar; zoom input + telemetry still read 150; reload reads initial zoom correctly.
- **Reversible?** Yes (per call site).

### Batch 1.2 — Viewer-container & live-page-host resolution (page-DOM, stateless)
- **Goal:** Route viewer-container access and per-page host lookups through `doorway.getViewerContainer()` / `doorway.getPageHost(pageNumber)`.
- **Scope:** Page-DOM Batches 10 (lines 5495, 5499, 8694) and 3 (lines 5620–5640). Defensive lookups already wrapped in `?.`.
- **Proof:** Suite green. Visual: navigate to page 10, draw an annotation, confirm it lands on page 10 (not 9/11); overlays appear on correct pages while scrolling 1–5.
- **Reversible?** Yes.

### Batch 1.3 — Cursor-to-page hit test & keyboard-paste target (read-only resolvers)
- **Goal:** Route cursor→page resolution and Ctrl/Cmd+V target resolution through `doorway.resolvePageAtPoint(clientX, clientY)`.
- **Scope:** Page-DOM Batches 1 (lines 4590, 4614–4623) and 7 (lines 19586–19595).
- **Proof:** Suite green. Visual: cursor over page 3, zoom — zoom centers on page 3; Ctrl/Cmd+V with cursor on page 4 pastes to page 4, on page 7 pastes to page 7.
- **Reversible?** Yes.

### Batch 1.4 — Text-layer click detection & native page-element IDs
- **Goal:** Route `isClickOnPdfText(target)` and native page/annotation-canvas ID construction through the doorway.
- **Scope:** Page-DOM Batches 8 (line 22525) and 14 (lines 1562, 5535, 25247, 25251–25282).
- **Proof:** Suite green. Visual: click PDF text → selects; click annotation → interacts with annotation; toggle custom annotation mode → native layer visibility toggles per page.
- **Reversible?** Yes.

### Batch 1.5 — Eraser canvas lookup
- **Goal:** Route eraser-canvas discovery through `doorway.getEraserCanvases()` / `getEraserWrapperFromCanvas()`.
- **Scope:** Page-DOM Batch 9 (lines 4071, 4184). Fabric overlay, not core Syncfusion — safe.
- **Proof:** Suite green. Visual: eraser on page 2 updates only that canvas; undo/redo matches stack.
- **Reversible?** Yes.

### Batch 1.6 — Page-container refresh + paste-offset (init-time + infrequent)
- **Goal:** Route container-map population and paste coordinate transform through `doorway.getPageContainers()` / `doorway.resolvePasteTarget()`; dedupe the two identical paste blocks.
- **Scope:** Page-DOM Batches 2 (5520–5556) and 6 (20909–20925, 20962–20971).
- **Proof:** Suite green. Visual: scroll 1–5, overlays pin correctly; copy annotation from page 2, paste on page 5 at 150% zoom — lands on page 5 at correct offset.
- **Reversible?** Yes.

### Batch 1.7 — Measured page scale utility (central, medium care)
- **Goal:** Wrap the existing `measureSyncfusionPageHostScale` utility as `doorway.measurePageScale(pageNumber)` and redirect its 6 call sites.
- **Scope:** Page-DOM Batch 11 (lines ~2045, 2499, 5961, 7621, 15875, 22960). Already a utility — minimal change, but it feeds all overlay transforms, so test alignment hard.
- **Proof:** Suite green. Visual: at 125/150/175% all overlays scale uniformly; annotation bboxes stay aligned on every page.
- **Reversible?** Yes.

### Batch 1.8 — Fit modes, zoom restore, and Electron-factor calibration
- **Goal:** Route fit-to-page/width/height, saved-zoom restore, and the Electron display-factor measurement through `doorway.setZoomMode()` / `restoreZoom()` / `calibrateZoomFactor()`.
- **Scope:** Zoom Batches 2 (6942–6965), 3 (6090–6102), 8 (6884–6903, 6923–6958, 5974–5985). **This touches the zoom-calibration no-go-adjacent code (page-DOM Batch 5 / zoom Batch 8).** Honor container-aware scaling: never substitute `pageSize * scale`. Test zoom convergence (fit 3× in a row must not ratchet).
- **Proof:** Suite green. Visual: Fit Page centers page; Fit Width matches viewport; reload restores saved 175%; on a 125%-scaled display Fit Page matches viewport ±2px; fit-page 3× converges.
- **Reversible?** Yes — but verify zoom extensively; this is the riskiest batch in Stage 1.

### Batch 1.9 — Feature subsystems that are pure pass-throughs (bookmarks, links, native markup creation, text select/copy, scroll mode)
- **Goal:** Route the framework-default and prop-driven features through the doorway's event props and getters.
- **Scope:** Feature Batches 1 (bookmarks/outline), 2 (hyperlinks), 5 (native markup creation props), 7 (text selection/copy), and lifecycle Batch 13 (scroll mode, engine-agnostic state). Mostly prop/event wiring; no custom logic.
- **Proof:** Suite green. Visual: click outline item → navigates; Ctrl/Cmd+Click link → opens URL; underline tool draws red 80% underline; drag-select text → Ctrl+C pastes; toggle continuous/single scroll → layout responds.
- **Reversible?** Yes.

### Batch 1.10 — Lifecycle event handlers (document load/unload/fail, page-change, render-complete, bookmarks-available, text-selection-end)
- **Goal:** Route the read-only lifecycle handlers so they fire from doorway events rather than Syncfusion-named events.
- **Scope:** Lifecycle Batches 1 (5998, 6129, 4975), 2 (6255), 3 (22380), 4 (6418), 12 (10822). **Page-render-complete (Batch 4) is medium-risk** — it triggers scale reconciliation; keep its reconciliation call intact.
- **Proof:** Suite green. Visual: load PDF → page count + zoom appear; navigate pages → page number tracks; load corrupt file → error UI; bookmarks populate sidebar.
- **Reversible?** Yes.

### Batch 1.11 — Form-field lifecycle handlers (KAL-47) routed (still Syncfusion-backed)
- **Goal:** Route the 7+2 form-field handlers and the 5 form API methods through `doorway.*FormField*`.
- **Scope:** Feature Batch 3 / lifecycle Batch 5 (PDFViewer 2766–2864, 2800–2864; API 2009–2093; props 25044–25049). Selection/state/delete confirmed working today; route as-is.
- **Proof:** Suite green. Visual: enable designer mode; add a TextBox; double-click → properties panel; edit name → Update; delete → removed. (Persistence-after-save is a known gap, addressed in Stage 4 — do not expect it here.)
- **Reversible?** Yes.

### Batch 1.12 — Audit and redirect direct ref-map reads (cleanup pass)
- **Goal:** Ensure no code reads `pageContainersRef.current[...]` directly; all go through `doorway.getPageContainer()`.
- **Scope:** Page-DOM Batch 12 (~30 sites). Audit only — the ref *store* itself stays; reads are redirected. Fallback chains (`state || ref`) preserved.
- **Proof:** Suite green. Visual: covered transitively — if the map were broken every overlay test fails; spot-check overlays pin during zoom/scroll.
- **Reversible?** Yes.

> **Explicitly NOT rerouted in Stage 1 (kept inline, Syncfusion-gated):**
> - **Overlay div positioning** (page-DOM Batch 4, lines 5710–5724) — the per-page portal render loop. Do not touch.
> - **Portal-host snapshot** (page-DOM Batch 13, lines 2483–2493) — interaction-lifecycle stabilizer. Do not touch.
> - **Interaction-phase state machine** (lifecycle Batch 7), **listener attach/detach** (lifecycle Batch 9), **wrapper interaction handlers** (lifecycle Batch 6), **zoom snapshots** (lifecycle Batch 14), **wheel/keyboard cursor-anchored zoom** (zoom Batches 4/5/7, the highest-risk interaction code). These are Syncfusion-specific optimizations. Wrap them so they only run when the **engine** is Syncfusion; do not try to make them generic. The pdf.js engine brings its own (simpler) interaction handling inside its container.

---

## STAGE 2 — Build the pdf.js engine container behind the doorway (off by default)

**Owner:** Now we package our proven prototype painter into a real component that fits the doorway, and wire it into the off-by-default branch of the switch. The live app is untouched; this is only reachable by a developer flipping the console override.

### Batch 2.1 — Promote the prototype to a container that implements the doorway
- **Goal:** Create `src/components/PdfjsViewerContainer.jsx` from `PdfjsArm.jsx`, exposing the doorway via `useImperativeHandle` (`goToPage`, `getPageContainer(s)`, `getViewerContainer`, `pageCount`, `currentPageNumber`, `zoomValue`, `load`, etc.).
- **Scope:** New file built on the spike's virtualization, cursor-anchored zoom, DPR-correct cancellable render, and deep-zoom detail tile. Fill the prototype's known gaps: imperative ref API, the event callbacks (`onDocumentLoaded`, `onPageChanged`, `onZoomChanged`, `onPageContainersChange`, `onDocumentLoadFailed`, `onPDFBookmarksAvailable`).
- **Proof:** Suite green (new component not yet on default path). Visual: set `window.__DEV_OVERRIDE_PDF_VIEWER_ENGINE='pdfjs'`, reload — pages render, scroll/zoom feel matches the spike. Flip back to Syncfusion — unchanged.
- **Reversible?** Yes (override defaults off).

### Batch 2.2 — Wire the pdf.js branch into the selector
- **Goal:** Connect `PdfjsViewerContainer` to the selector's `'pdfjs'` branch with the same prop interface and forwarded ref.
- **Scope:** `PDFViewerEngineSelector.jsx` only. Enforce the single-mount guarantee — exactly one engine mounts.
- **Proof:** Suite green default (Syncfusion). Visual under override: bookmarks navigate, links open, text selects, imported markup annotations render (appearance streams), form widgets display read-only.
- **Reversible?** Yes.

> Stage 2 deliberately stops at parity for what the prototype already proved. The genuine feature gaps (Stage 4) and the zoom-signal contract (Stage 3) are separated out because they carry the real risk.

---

## STAGE 3 — The zoom-signal contract (HIGHEST CARE — isolated on purpose)

**Owner:** This is the single most delicate step. The app's pen, eraser, and edit canvases listen for one specific "zoom is starting" signal so they can finish their work before the page resizes. The new painter must fire that exact same signal at the exact same moment. We isolate this into its own stage so it gets maximum attention and can be tested by itself.

This is one small, surgical change — but in the most load-bearing place. Do it alone, in one batch, with nothing else in flight.

### THREE NON-NEGOTIABLE NO-GO ZONES (from CLAUDE.md invariants)
1. **Never remove or rename the `zoomGeneration` signal.** It is set at `PDFViewer.jsx:1742` (inside `beginSyncfusionScaleConfirmPending`, `useCallback` at 1739), declared at 2954, and also bumped at 9135. All Canvas components depend on it.
2. **Do NOT edit the per-page overlay portal render loop** (the `SVGAnnotationLayer` / `FabricDrawingCanvas` / `FabricEraserCanvas` / `FabricEditCanvas` mounts, ~lines 25692–25878). The `zoomGeneration={zoomGeneration}` prop wiring there stays byte-for-byte.
3. **Keep container-aware scaling.** Canvas components compute `effectiveScale = containerEl.offsetWidth / pageSize.width` themselves. Never feed them `pageSize * scale`, and do not add a new scale prop to the portal loop.

### Batch 3.1 — Route pdf.js gesture phases into the existing zoom signal
- **Goal:** When the pdf.js engine starts a zoom gesture, fire the **existing** `zoomGeneration` signal — without renaming it, without timers, without touching the portal loop.
- **Scope (the entire change is signal-routing, ~3 small additions):**
  - The prototype already emits `onZoomPhase('gesture-start', …)` (`PdfjsArm.jsx:505`) and `onZoomPhase('settle', …)` (`483`); `onZoomPhaseRef` is wired (273–274). **No change to PdfjsArm.**
  - In `PDFViewer.jsx`: add `pdfJsZoomPhase` state; in the `onZoomPhase` callback set it; add a one-line effect: when `pdfJsZoomPhase === 'gesture-start'` **and the engine is pdf.js**, call `setZoomGeneration(prev => prev + 1)`.
  - Wrap the Syncfusion-specific portal-host freeze / snapshot machinery in `if (engine === 'syncfusion')` so it does not run under pdf.js (pdf.js does not destroy containers, so freeze is unnecessary and would misbehave).
- **Proof:** Suite green. Visual (the prototype's own verification sequence, run under the pdf.js override): pen strokes on p1, callouts on p2, a rectangle on p3.
  1. Ctrl/Cmd+wheel 100→50%: all marks stay pinned, no drift.
  2. 50→100%: marks return pixel-exact (sub-pixel rasterizer variance allowed per the 2026-04-10 gotcha).
  3. 100→300% deep zoom: detail tile renders crisp, marks pinned.
  4. Zoom 100→200% **while editing a callout**: Fabric edit canvas auto-commits (proves the signal fired), SVG re-renders the callout at new scale, no text corruption.
  5. Scroll to p5 and zoom: only mounted pages re-measure; off-screen pages stay placeholders; on-screen marks pinned.
- **Watch for these failure modes (from the re-emit plan):** signal fires but a Canvas doesn't re-measure (check backing buffer ≈ `round(containerWidth * DPR)`); SVG viewBox not scaling during gesture; callout drift if `liveCalloutEditBounds` not consumed; portal-host freeze accidentally running under pdf.js.
- **Reversible?** Yes — it's additive signal routing gated on the engine flag; reverting the effect restores prior behavior with zero impact on the Syncfusion path.

---

## STAGE 4 — Close the genuine feature gaps (so pdf.js reaches production parity)

**Owner:** The prototype proved the hard parts (rendering, zoom, overlays) but left four real features unfinished, plus one that's a business decision for you. We build the four; you decide on the fifth.

These can proceed in parallel with confidence once Stages 0–3 hold, since each is additive and behind the off-by-default engine. Sized smallest-first.

### Batch 4.1 — Find-in-document: match count + find-next/prev (Small)
- **Goal:** Add "X of Y", Find-Next/Prev, Ctrl/Cmd+G, Esc, and scroll-to-match.
- **Scope:** Reuse the existing search engine in `src/sidebar/SearchTextPanel.jsx` and `src/components/SearchHighlightLayer.jsx` (match count already computed). Build only UI + navigation + keyboard + center-scroll. ~120–150 lines.
- **Proof:** Suite green. Visual: type "survey" → "12 of 48"; Find-Next 3× advances counter and scrolls with bright glow; Ctrl/Cmd+G and Shift+Ctrl/Cmd+G cycle; highlight survives zoom/scroll.
- **Reversible?** Yes.

### Batch 4.2 — Text-markup selection + erase for imported annotations (Medium)
- **Goal:** Select an imported highlight/underline/strikeout/squiggly, show selection glow, Delete to erase, with undo/redo and sync.
- **Scope:** Build on `InteractiveOverlay.jsx` (renders appearance streams) + existing delete-key handler + Yjs history. Add selection state, erase handler, visual feedback. ~150–200 lines. (Markup *edit/resize handles* remain out of scope — that's an orphaned path even in Syncfusion; do not build it here.)
- **Proof:** Suite green. Visual: open PDF with embedded highlights; click → glow; Delete → gone, stays gone on reload; Ctrl+Z → returns.
- **Reversible?** Yes.

### Batch 4.3 — Form-field display state + interaction events (Medium)
- **Goal:** Make displayed form widgets track focus/filled/readonly and emit onFocus/onBlur/onChange, persisting values + Tab navigation.
- **Scope:** Build on `SpikeFormLayer.jsx` (renders widgets as real inputs) + `FormFieldPropertiesPanel.jsx`. Add display-state tracking, event emitters, value→AnnotationStorage→sync, `/ReadOnly` honoring, Tab focus. ~180–250 lines.
- **Proof:** Suite green. Visual: click text field → focus glow + onFocus; type → onChange + value persists on reload; Tab → next field; readonly field disabled.
- **Reversible?** Yes.

### Batch 4.4 — Printing (Large)
- **Goal:** Wire the existing print UI to a real render-and-print pipeline for the pdf.js engine.
- **Scope:** `src/components/PrintPanel.jsx` already emits `onPrint(jobSpec)`. Build: per-page render at target DPI with margins, annotation baking (uses existing `savePDFWithFlattenedRegularAnnotationsForPrint`), iframe/`window.print()` for browser, Electron IPC + printer enumeration for desktop, and a Print-to-PDF path. ~300–400 lines.
- **Proof:** Suite green. Visual: PrintPanel Letter/Landscape/pages 1–3 → Print-to-PDF produces correct pages with annotations baked; printer dropdown lists system printers on Electron; job reaches the queue.
- **Reversible?** Yes.

### Batch 4.5 — Form-field AUTHORING — **OWNER SCOPE DECISION, do not build by default**
- **Owner decision required:** Today the app can *fill and edit existing* form fields. It cannot *author brand-new* fields from scratch (draw a text box / checkbox / dropdown and define its properties). pdf.js has no field-creation API; building this means hand-constructing Widget annotation dicts + appearance streams (~400–600 lines, Large). **Question for you:** does your user base need to *create* forms in this app, or only fill/review imported forms? If only fill/review, this stays out of scope and the migration is unaffected. If create, schedule it as its own project after cutover.
- **Proof (only if authorized):** add-field tool → drag → properties → saves, persists on reload, opens correctly in Adobe Acrobat (round-trip).
- **Reversible?** Yes (it's purely additive).

---

## STAGE 5 — Parity validation, the flip, and deferred cleanup

**Owner:** Before we change the default, we run a side-by-side checklist on real documents. The flip itself is a one-line change with the old engine kept as an instant undo. Deleting Syncfusion and removing its license is a *separate, later* job — not part of flip day.

### Batch 5.1 — Side-by-side parity checklist (no code change)
- **Goal:** Prove pdf.js matches Syncfusion on real documents before any default change.
- **Scope:** Run the parity matrix on every test document, both engines (toggle via override): zoom feel, overlay alignment at 150/300%, annotation save round-trip (<1px drift at 100%), undo/redo, text search color + navigation, markup select/erase, bookmark navigation (0-based vs 1-based must not flip), thumbnails, rotation (no zoom/scroll reset), Survey Markers/regions click + post-zoom alignment. PASS if ≤1px / imperceptible; FAIL if user-visible.
- **Proof:** A completed checklist with PASS on every row. No suite change. This gate blocks the flip.
- **Reversible?** N/A (validation only).

### Batch 5.2 — The flip (one-line default change)
- **Goal:** Change the engine default to pdf.js, keeping Syncfusion mounted-on-demand as instant rollback.
- **Scope:** One line in `viewerShared.js`: `PDF_VIEWER_ENGINE = 'pdfjs'`. **Nothing else changes.** Syncfusion stays in the bundle; the override flips any user (or all users, via re-flip) back instantly.
- **Proof:** Suite green. Visual: fresh load defaults to pdf.js and passes the smoke test; setting the override to `'syncfusion'` instantly restores the old engine.
- **Reversible?** **Yes — instantly.** Revert the one line (or flip the override) and rebuild; users are back on Syncfusion on next reload. This is the entire safety net.

### Batch 5.3 — Deferred cleanup milestone (NOT part of the flip; schedule later)
- **Goal:** After the new engine has run as default and stable for a release cycle, remove the dead weight.
- **Scope (a *later, separate* ticket — explicitly not flip-day work):** delete `SyncfusionPDFContainer.jsx` and the selector; remove the Syncfusion license key, CSS imports, and theme variables; remove `@syncfusion/ej2-*` from `package.json`; run `npm install && npm prune`; inline the engine choice and drop the flag. Treat `package.json` / `vite.config.js` per the high-risk-file rule.
- **Proof:** Suite green; production build + Electron packager succeed with Syncfusion gone; bundle size drops.
- **Reversible?** Hard to reverse — which is exactly why it is deferred until the new engine is proven in the wild.

---

## Sequencing & risk — the honest version

- **Stage 0 is non-negotiable and must be perfect.** Every later batch assumes the doorway and the engine flag (kept *separate* from the overlay flag at line 768) exist and behave. Rushing this poisons everything downstream.
- **Stage 1 is ~929 connections but is the *safe* bulk** — the doorway keeps answering with Syncfusion, so regressions are localized to one batch and trivially reverted. Expect this stage to consume the most calendar time. Batch 1.8 (fit/restore/calibration) and 1.10's render-complete reconciliation are the two spots in Stage 1 that can break zoom; slow down there.
- **Stage 3 is the genuine cliff.** It is small in code and large in consequence. Land it alone, with nothing else uncommitted, and run the full zoom-during-edit sequence. The three no-go zones are where past pain lived; respect them literally.
- **The three permanently-inline regions** (overlay portal loop, portal-host snapshot, interaction-phase machine) are never made generic — they stay Syncfusion-gated, and pdf.js supplies its own simpler interaction handling. Trying to unify them is how you lose a week and break zoom.
- **Stage 4 features are real, unfinished work**, not polish. Printing especially is a large build, not a wire-up. Do not let "the prototype works" create the illusion these are done.
- **The flip is trivial; the cleanup is not.** Keep them far apart. The instant-rollback property only exists while both engines remain in the bundle — so do not let anyone bundle the cleanup into the flip "to save a release."

**File references that anchor this blueprint** (verified against the working tree): `src/PDFViewer.jsx` (32,489 lines; `useSyncfusionRenderer` at 768; `beginSyncfusionScaleConfirmPending` useCallback at 1739 setting `setZoomGeneration` at 1742; `zoomGeneration` declared 2954, bumped 9135), `src/viewerShared.js` (2,207 lines), `src/prototype/PdfjsArm.jsx` (`onZoomPhase` plumbing at 250/273–274, `'settle'` at 483, `'gesture-start'` at 505). New files to create: `src/components/pdfEngineContract.js`, `src/components/PDFViewerEngineSelector.jsx`, `src/components/PdfjsViewerContainer.jsx`.
