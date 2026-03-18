# Project Research Summary

**Project:** Zoom Flicker Fix -- Direct Child Canvas (Option 3)
**Domain:** PDF viewer canvas annotation overlay — zoom transition architecture refactor
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

This project is a surgical refactor of an existing Syncfusion + Fabric.js PDF annotation viewer. The goal is to eliminate the multi-frame annotation flicker that occurs during zoom by replacing the current freeze/snapshot/confirm-pending architecture with a direct-child overlay model. Industry research confirms that the recommended approach — CSS `transform: scale(ratio)` on the overlay div during zoom, followed by a full Fabric.js redraw after zoom settles — is the same two-phase pattern used by Mozilla's pdf.js, Adobe Acrobat, and every major commercial PDF viewer. The technology stack requires no new dependencies; this is a refactor of existing React portals, Fabric.js canvases, and DOM manipulation patterns.

The recommended architecture reduces the system from a 5-layer portal indirection chain (with 30+ refs, 14+ functions, and a 3000ms confirm-pending timer) to a 2-layer chain: Syncfusion page div -> persistent overlay div -> React portal -> PageAnnotationLayer. Persistent overlay divs stored in a ref survive Syncfusion's page div destruction/recreation cycles without triggering React portal unmount/remount, preserving Fabric.js canvas state. CSS transforms on the overlay div handle zoom transitions at near-zero cost on the GPU compositor thread, eliminating the need for canvas snapshots or frozen state. A critical source-code-verified finding: Fabric.js 5.5.2's `getPointer()` already uses `getBoundingClientRect()` on the canvas element, which automatically accounts for all ancestor CSS transforms — no pointer math corrections needed.

The primary implementation risk is the sequential dependency between the 6 implementation steps: overlay attachment must be solid before zoom handlers or the render loop can be built, and dead code removal must be last. The highest-risk individual step is page container re-attachment (Step 5), where Fabric.js coordinate caching can silently corrupt pointer interactions after `appendChild()` reparenting — this must be caught with explicit testing of annotation selection and drawing after each zoom cycle. The second-highest risk is the dual settle timer coordination between App.jsx (1000ms, releases scale state) and PAL (300ms, handles canvas redraw and CSS transform removal) — these are sequential by design but the handoff semantics require care.

## Key Findings

### Recommended Stack

No new technologies are introduced. The refactor uses existing React 18.2, Fabric.js 5.5.2, Syncfusion React PDF Viewer 32.1.19, and DOM APIs already present in the codebase. Key mechanisms are verified directly against Fabric.js 5.5.2 source at `node_modules/fabric/dist/fabric.js`: `getPointer()` uses `getBoundingClientRect()` (line 12515) making CSS parent transforms transparent to pointer handling; `setWidth()`/`setHeight()` clear the canvas backstore on every call (browser behavior) making them too expensive to call during rapid zoom events.

**Core technologies:**
- **React 18.2 + ReactDOM.createPortal:** Annotation layers rendered as portals into persistent overlay divs. Portal target reference must never change — React unmounts/remounts all children if the target DOM node is replaced, destroying Fabric.js canvas state.
- **Fabric.js 5.5.2:** Canvas annotation drawing/editing. CSS `transform: scale()` on parent div is compatible with pointer math (verified in source). `setWidth`/`setHeight`/`setZoom`/`renderAll` called only after zoom settles (5-30ms per canvas, clears backstore on every call).
- **CSS `transform: scale(ratio)` + `transform-origin: top left`:** The zoom visual bridge. Applied to the overlay div (not the Fabric.js canvas element directly, not the CSS `zoom` property). Free GPU compositor operation. `transform-origin: top left` is mandatory — default `center center` causes visible shift relative to Syncfusion's page resize.
- **`element.appendChild(overlayDiv)`:** Re-attachment mechanism when Syncfusion destroys and recreates page divs. Moves overlay div to new parent without React seeing a portal container change.
- **`will-change: transform`:** Optional GPU layer promotion on overlay divs during zoom. Apply to visible pages only — each page that has this active gets its own compositor layer plus a Fabric.js canvas backstore buffer.

**What gets removed:** ~30 refs, ~14 functions, ~200 lines of render loop logic for freeze/snapshot/confirm-pending/stable-portal-host machinery. These are the root cause of the flicker bug, not mitigation of it.

**What gets added:** `overlayDivsRef` (1 ref), `attachOverlayToPageDiv()` (~15 lines), re-attachment useEffect (~10 lines), simplified zoom handler (~30 lines), simplified render loop (~50 lines).

### Expected Features

**Must have (table stakes — the refactor goal):**
- Annotations stay visible during zoom — users currently see annotations disappear and jump. This is the #1 priority.
- CSS-transform visual stability during zoom transition — blurry-but-stable is the industry standard and is acceptable. Absent annotations are not acceptable.
- Post-zoom canvas re-render at correct resolution — annotations must become crisp after zoom settles (1000ms settle timer is the starting estimate; may need tuning).
- All 6 zoom input methods work identically — Ctrl+scroll, toolbar buttons, dropdown presets, fit-to-page, fit-to-width, and keyboard shortcuts must all produce the same stable behavior.
- Rapid consecutive zoom handling — debounce with timer restart; each new zoom event cancels the previous settle timer.
- Drawing tools work correctly after zoom — coordinate mapping must be correct at the new canvas resolution.

**Defer to post-launch:**
- Zero-frame annotation gap during Syncfusion page div recreation — 1-2 frame gap is acceptable and far better than current multi-frame flicker.
- Zoom-to-cursor (anchor point zoom) — viewer-level feature, not annotation layer concern.
- Animated zoom transitions — not needed; CSS transform already provides visual continuity.
- High-resolution partial rendering at extreme zoom levels (400%+) — future optimization.

**Explicitly remove (these are anti-features that cause the bug):**
- Freeze/snapshot/confirm-pending machinery — ~14 refs, ~7 functions, 3000ms confirm timer. This IS the bug.

### Architecture Approach

The target architecture uses a persistent overlay div per page (stored in `overlayDivsRef`) as the React portal target. This div is created once, attached to the Syncfusion page div, and reused for the document's lifetime. During zoom, App.jsx applies `transform: scale(ratio)` directly to overlay divs via CSS (compositor thread, no React re-renders). After zoom settles (1000ms App.jsx timer releases scale state via `setScale()`), PAL receives the new scale prop, waits 300ms via its own settle timer, then performs the expensive Fabric.js `setWidth`/`setHeight`/`setZoom`/`renderAll` sequence and removes the CSS transform from its wrapper. The scale computation collapses from 20+ lines of frozen/committed/fallback logic to 2 lines.

**Major components:**
1. **App.jsx (Overlay Manager)** — Creates/stores persistent overlay divs in `overlayDivsRef`, attaches them to Syncfusion page divs, re-attaches via `useEffect` watching `syncfusionPageContainers` state when page divs are recreated.
2. **App.jsx (Zoom Orchestrator)** — Applies CSS transforms during zoom, manages 1000ms settle timer, calls `setScale()` on settle. Replaces the entire freeze/snapshot/confirm-pending system. Does NOT remove CSS transforms — that is PAL's job.
3. **App.jsx (Render Loop)** — Creates React portals into persistent overlay divs. Simplified from ~400 lines to ~50 lines by removing all portal host resolution and frozen scale logic. Freezes `layerScale` at pre-zoom value during CSS transform phase (prevents double-scaling on sibling layers).
4. **SyncfusionPDFContainer** — Unchanged. MutationObserver detects page container changes, surfaces them as `syncfusionPageContainers` state via `requestAnimationFrame`-debounced update.
5. **PageAnnotationLayer (PAL)** — Retains `isZooming` latch, 300ms settle timer, and tiered redraw priority (center-first, visible-deferred at 800ms, offscreen via IntersectionObserver). Removes `onScaleApplied` callback, `presentationApiRegistry`, and `isHidden` prop. Responsible for removing CSS transform from canvas wrapper after canvas redraws.

**Build order (hard sequential dependencies):** Step 1 (overlay attachment) → Step 2 (zoom handler) → Step 3 (render loop) → Step 4 (PAL simplification) → Step 5 (page recreation re-attachment) → Step 6 (dead code removal). Steps 2 and 3 can proceed in parallel but must be tested together.

### Critical Pitfalls

1. **Fabric.js pointer coordinates corrupted after DOM reparenting (Pitfall 1 — silent, critical)** — After `appendChild()` moves the overlay div to a new Syncfusion page div, Fabric.js's cached `_offset` becomes stale. Selection hit-testing and drawing tools silently produce wrong coordinates — no console errors. Prevention: call `fabricRef.current.calcOffset()` + `canvas.forEachObject(obj => obj.setCoords())` immediately after every re-attachment in Step 5. Expose this via `useImperativeHandle` on PAL. Test by: zoom, wait for settle, attempt to select existing annotations and draw new ones.

2. **React portal target change triggers full canvas destruction (Pitfall 3 — critical)** — If `createPortal()` receives a different DOM node reference (e.g., because a new overlay div was created instead of reusing the existing one), React destroys the Fabric.js canvas instance and all in-memory annotation objects. Prevention: `overlayDivsRef.current[pageNumber]` is eternal — never delete or recreate entries, never overwrite. The guard "check ref first, only create if absent" must be in `attachOverlayToPageDiv()` and must never be removed.

3. **Dual settle timer race condition (Pitfall 4 — critical)** — App.jsx 1000ms timer and PAL 300ms timer are sequential by design, but incorrect implementation creates a 300ms window where the CSS transform is removed but the canvas has not yet redrawn at the new resolution (showing old-resolution content at new zoom). Prevention: App.jsx settle timer calls `setScale()` ONLY. PAL's settle timer handles both the canvas `renderAll()` AND the CSS transform removal from the wrapper, in that order. The `onScaleApplied` callback chain is eliminated.

4. **Incomplete dead code removal causes zombie ref conflicts (Pitfall 5 — critical)** — App.jsx is 25,000+ lines. Refs and functions targeted for removal are each referenced from 4-8 call sites. Missing a single reference causes the old code path to execute against refs that no longer mean what it expects. Prevention: grep every identifier before deleting, delete call sites first then functions then refs, test all 6 zoom methods after each removal batch. Rewrite the render loop section (lines ~24330-24700) as a complete block replacement — surgical removal of 370 intertwined lines is not safe.

5. **CSS transform pointer-events window (Pitfall 2 — critical)** — While Fabric.js 5.5.2 pointer math is theoretically correct under static CSS transforms, the `_offset` cache uses `offsetWidth`/`offsetHeight` (not transform-aware). If `calcOffset()` fires while the CSS transform is active and then the transform is removed, coordinates become wrong. Prevention: use the existing `isZooming` prop to disable `pointer-events` on PAL's canvas during the CSS transform phase. Ensure CSS transform is removed BEFORE PAL performs its canvas `renderAll()` and subsequent `calcOffset()`.

## Implications for Roadmap

Based on research, the architecture's sequential build order maps directly to 6 phases with defined inputs, outputs, and test criteria. The research is unusually specific about implementation order because of hard dependencies — do not reorder phases.

### Phase 1: Overlay Attachment Foundation
**Rationale:** All other phases depend on `overlayDivsRef` and `attachOverlayToPageDiv()`. This is the load-bearing foundation — Steps 2, 3, and 5 cannot be built without overlay divs existing and being attached to Syncfusion page divs.
**Delivers:** `attachOverlayToPageDiv()` function, `overlayDivsRef` ref, overlay divs correctly attached to Syncfusion page divs for all currently visible pages, styled `position:absolute; width:100%; height:100%; pointer-events:none; z-index:20`.
**Addresses:** Foundation for all table stakes features.
**Avoids:** Pitfall 3 (portal target identity) — write the "check ref, create only if absent, never overwrite" guard here.

### Phase 2: Simplified Zoom Handler
**Rationale:** Once overlay divs exist, the zoom handler can apply CSS transforms to them. This is the core of the user-visible fix. Must coordinate with Phase 4 on timer semantics — App.jsx timer releases scale state only; PAL handles canvas redraw and CSS transform removal.
**Delivers:** `handleSyncfusionZoomChange` simplified to ~30 lines. CSS `transform: scale(ratio)` with `transform-origin: top left` applied to all overlay divs on zoom. 1000ms settle timer calling `setScale()` only. Old freeze/snapshot flow coexists but is bypassed.
**Addresses:** CSS-transform visual stability (table stakes #2), rapid zoom handling (table stakes #5), all 6 zoom methods (table stakes #3).
**Avoids:** Pitfall 4 (dual timer race — App.jsx does NOT remove CSS transform), Pitfall 2 (pointer events disabled during transform phase via `isZooming`), Pitfall 14 (no CSS `transition` added to overlay transform — Syncfusion resizes instantly, overlay must match instantly).

### Phase 3: Simplified Render Loop
**Rationale:** The render loop creates portals and computes `layerScale` for all overlay components. Rewrite as a complete block replacement — the existing 400 lines are too entangled for surgical edits. Requires Phase 1 (portal targets) and Phase 2 (scale state freeze behavior).
**Delivers:** React portals created into persistent `overlayDivsRef.current[pageNumber]` divs via `createPortal()`. Scale computation collapsed to 2 lines. `layerScale` frozen to pre-zoom scale during CSS transform phase. Portal creation limited to annotated/visible pages only (memory management).
**Addresses:** Drawing tools work after zoom (table stakes #6), sibling layer scaling correctness.
**Avoids:** Pitfall 12 (sibling layer double-scaling — `layerScale` stays frozen until CSS transform is removed), Pitfall 9 (memory growth — filter portals to annotated/visible pages only).

### Phase 4: PAL Zoom Handling Simplification
**Rationale:** PAL already has a well-tested settle mechanism. This phase removes the outbound `onScaleApplied` coupling while preserving all PAL-internal zoom logic. Must be coordinated with Phase 2's timer semantics — the two phases share the CSS transform/scale commit handoff. The `inZoomModeRef` latch and settle callback re-check pattern must be preserved exactly.
**Delivers:** PAL without `onScaleApplied`, `presentationApiRegistry`, `isHidden`. PAL's settle timer handles CSS transform removal from canvas wrapper (after canvas redraws). Tiered redraw (center-immediate, visible-800ms-deferred, offscreen-IntersectionObserver) preserved unchanged.
**Addresses:** Post-zoom re-render at correct resolution (table stakes #4).
**Avoids:** Pitfall 10 (isZooming flicker — preserve `inZoomModeRef` latch AND settle callback re-check, not just the boolean), Pitfall 11 (double transform-origin — remove PAL wrapper CSS transform code, only App.jsx applies transforms to overlay div), Pitfall 8 (wasted `renderAll` during zoom — audit all `renderAll()` trigger paths, guard with zoom latch).

### Phase 5: Page Container Re-attachment
**Rationale:** When Syncfusion destroys and recreates page divs (during zoom or scroll to distant pages), overlay divs become DOM orphans. The re-attachment `useEffect` restores them. This is the highest-risk step because Fabric.js coordinate caching silently breaks after `appendChild()`.
**Delivers:** `useEffect` watching `syncfusionPageContainers`. For each page: if overlay div exists and parent !== new page div, call `pageDiv.appendChild(overlayDiv)`. After each re-attachment: call `calcOffset()` + `setCoords()` on all Fabric.js objects via PAL's `useImperativeHandle` imperative handle. `attachOverlayToPageDiv()` returns `null` if overlay div is disconnected and no page div exists yet.
**Addresses:** Annotation visibility after Syncfusion page div recreation.
**Avoids:** Pitfall 1 (Fabric.js coordinate corruption — MUST test annotation selection/drawing after zoom cycles), Pitfall 7 (MutationObserver timing — rely on state-driven `useEffect` with existing rAF debounce), Pitfall 13 (orphan state — return `null` for portal if overlay div disconnected).

### Phase 6: Dead Code Removal
**Rationale:** Only safe after Phases 1-5 are fully verified with all 6 zoom methods. The 30+ refs and 14+ functions targeted for removal are each referenced from multiple locations in a 25,000+ line file. Partial removal is worse than no removal.
**Delivers:** ~260 lines of dead code removed. Target refs: `zoomOverlayTransformActiveRef`, `syncfusionStablePortalHostsRef`, `syncfusionScaleConfirmPendingRef`, `syncfusionPendingZoomScaleRef`, `syncfusionFrozenOverlayPagesRef`, and 25+ others. Target functions: `ensureSyncfusionStablePortalChildren`, `beginSyncfusionScaleConfirmPending`, `handlePALScaleApplied`, `syncSyncfusionZoomPresentationPage`, `prepareSyncfusionZoomPresentationSwap`, `queueSyncfusionOverlayTransformSync`, and 8+ others.
**Avoids:** Pitfall 5 (incomplete removal — grep every identifier before deleting, delete in dependency order: call sites first then functions then refs, test all 6 zoom methods after each batch, rewrite render loop section as a block).

### Phase Ordering Rationale

- Phase 1 is the hard prerequisite: `overlayDivsRef` is a shared dependency for Phases 2, 3, and 5. Cannot skip or parallelize with Phase 1.
- Phases 2 and 3 share the scale-freeze design decision and must be tested together, but can be developed in parallel once Phase 1 is stable.
- Phase 4 must know Phase 2's final timer semantics before its handoff can be implemented correctly.
- Phase 5 requires Phase 1 (overlay divs must exist to re-attach) and Phase 4 (PAL's `useImperativeHandle` must expose `recalcOffset()`).
- Phase 6 must be the final step with all preceding phases verified. No exceptions. Premature dead code removal destroys the safety net.

### Research Flags

Phases needing deeper design decisions before coding:
- **Phase 4 (PAL zoom handling):** The timer handoff semantics need a precise sequence diagram. Specifically: at what point does App.jsx's timer fire and call `setScale()`, and at what point does PAL remove the CSS transform from the wrapper? The research describes this but has not been prototyped. Resolve before starting Phase 4 coding.
- **Phase 5 (Page container re-attachment):** The mechanism for exposing `calcOffset()` from PAL to App.jsx (via `useImperativeHandle` vs prop toggle vs internal detection) requires a design decision. Check `src/PageAnnotationLayer.jsx` for any existing `useImperativeHandle` before implementing — if it already exists, extend it; if not, add it.

Phases with standard patterns (additional research not needed):
- **Phase 1 (Overlay attachment):** Standard DOM operations with HIGH-confidence React portal behavior verified against official docs.
- **Phase 2 (Zoom handler):** CSS `transform: scale()` on a div — GPU compositor operation, well-documented, no library-specific edge cases.
- **Phase 3 (Render loop rewrite):** `createPortal` rewrite is straightforward once Phase 1 provides the portal targets.
- **Phase 6 (Dead code removal):** Mechanical. Grep, delete, test. No new patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All mechanisms verified against Fabric.js 5.5.2 source code in `node_modules`. No new dependencies. React portal behavior confirmed against official docs and React issues #12247 and #10826. |
| Features | HIGH | CSS-transform-then-redraw is industry consensus (pdf.js, Adobe Acrobat). Table stakes features are unambiguous — they are the bug symptoms being fixed. |
| Architecture | HIGH | Build order has clear sequential dependencies. Component responsibilities are well-defined. Scale computation simplification is mathematically straightforward. |
| Pitfalls | HIGH | All 5 critical pitfalls verified against Fabric.js issues tracker, React issues tracker, and codebase analysis. Pitfall 1 (coordinate corruption) is the only silent failure mode — it must be explicitly tested in Phase 5. |

**Overall confidence:** HIGH

### Gaps to Address

- **`calcOffset()` exposure mechanism (Phase 5):** PITFALLS.md lists 3 options. Recommended option is `useImperativeHandle` on PAL. Check `src/PageAnnotationLayer.jsx` for existing `useImperativeHandle` before deciding implementation approach.
- **Settle timer tuning:** The 1000ms App.jsx settle timer is a reasonable starting estimate based on pdf.js practice, rated MEDIUM confidence. Plan an explicit tuning pass at the end of Phase 4 with Syncfusion's actual zoom event cadence measured.
- **Memory behavior with large PDFs:** Pitfall 9 identifies potential Fabric.js canvas accumulation for pages that scroll far out of view. The existing page filtering logic may already handle this — verify with a large PDF during Phase 3 testing.
- **`will-change: transform` decision:** STACK.md rates this MEDIUM confidence. Decide during Phase 2 whether to apply permanently to visible overlay divs or only during the active zoom window. Document the decision; do not leave it as a TODO.
- **Syncfusion page-div destruction vs. resize:** Research acknowledges uncertainty about whether Syncfusion always destroys/recreates page divs during zoom or sometimes resizes them in place. This affects how often the re-attachment effect fires. Characterize during Phase 5 testing with the actual PDF.

## Sources

### Primary (HIGH confidence)
- Fabric.js 5.5.2 source: `node_modules/fabric/dist/fabric.js` — `getPointer()` line 12504, `setDimensions()` line 9467, `calcOffset()` line 9149, `_initRetinaScaling()` line 9125
- `src/App.jsx` lines 9580-9710, 12337-12487, 24330-24700 — current zoom handler and render loop
- `src/PageAnnotationLayer.jsx` lines 7788-8028, 8869-8873 — scale useEffect, tiered redraw, pointer events
- `src/components/SyncfusionPDFContainer.jsx` lines 198-317 — MutationObserver and page container map
- Design spec: `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md`
- [React createPortal docs](https://react.dev/reference/react-dom/createPortal)
- [React Issue #12247](https://github.com/facebook/react/issues/12247) — `appendChild()` of portal target does not cause unmount
- [React Issue #10826](https://github.com/facebook/react/issues/10826) — changing portal container causes unmount
- [fabricjs/fabric.js#778](https://github.com/fabricjs/fabric.js/issues/778) — coordinate corruption after DOM reparenting
- [fabricjs/fabric.js#748](https://github.com/fabricjs/fabric.js/issues/748) — `calcOffset`/`setCoords` requirement
- Reference app: `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App/packages/client/src/pages/Viewer.tsx` — SVG overlay pattern lines 144-285

### Secondary (MEDIUM confidence)
- [pdf.js smooth zoom (Bug 1659492)](https://bugzilla.mozilla.org/show_bug.cgi?id=1659492) — two-phase CSS-then-redraw pattern
- [pdf.js high-res partial rendering (PR #19128)](https://github.com/mozilla/pdf.js/pull/19128) — future optimization reference
- [react-pdf flickering during zoom (Issue #875)](https://github.com/wojtekmaj/react-pdf/issues/875) — community validation
- [react-reverse-portal library](https://github.com/httptoolkit/react-reverse-portal) — validates persistent-node pattern
- [Fabric.js CSS-scale issue #868](https://github.com/fabricjs/fabric.js/issues/868) — `getPointer` using `getBoundingClientRect`
- [Syncfusion React PDF Viewer magnification docs](https://help.syncfusion.com/document-processing/pdf/pdf-viewer/react/magnification)
- [Fabric.js Optimizing Performance Wiki](https://github.com/fabricjs/fabric.js/wiki/Optimizing-performance)
- [GPU acceleration with will-change (2025)](https://www.lexo.ch/blog/2025/01/boost-css-performance-with-will-change-and-transform-translate3d-why-gpu-acceleration-matters/)
- [MDN getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)
- [MDN CSS transform-origin](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-origin)

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
