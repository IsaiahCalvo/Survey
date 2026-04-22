---
phase: 4
slug: pal-zoom-simplification
status: draft
shadcn_initialized: false
preset: none
created: 2026-03-19
---

# Phase 4 -- UI Design Contract

> Visual and interaction contract for PAL Zoom Simplification. This phase is an internal refactor with no new user-facing components. The contract defines visual invariants and interaction guarantees that must be preserved through the simplification.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | none (plain React + inline styles) |
| Icon library | none (no new icons in this phase) |
| Font | System stack: `-apple-system, BlinkMacSystemFont, Inter, SF Pro Display, SF Pro Text, Segoe UI, Roboto, sans-serif` |

Source: Codebase scan -- no `components.json`, no tailwind, no shadcn. Plain CSS in `src/styles.css` and `src/index.css`. Existing system font stack from `styles.css`.

---

## Spacing Scale

This phase does not introduce new UI elements. The following overlay div spacing is inherited from Phase 1 and must be preserved exactly:

| Token | Value | Usage |
|-------|-------|-------|
| overlay-inset | 0px | Overlay div position: `top:0; left:0` flush to page div |
| overlay-size | 100% | Overlay div dimensions: `width:100%; height:100%` matching page div |

Exceptions: none -- no new spacing values introduced in this phase.

Source: CONTEXT.md (overlay div styling established in Phase 1, line 12056-12057 of App.jsx).

---

## Typography

No new typography introduced in this phase. All text rendering (callout text, search highlight labels) is handled by existing components that are not modified in Phase 4.

Existing baseline (preserve, do not change):

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Callout text | 14px | 400 | 1.4 |
| Search highlight | inherits from SearchHighlightLayer (no change) | -- | -- |

Source: Codebase scan of `index.css` and `styles.css`.

---

## Color

No new colors introduced in this phase. The overlay div debug styling (Phase 1 debug mode only) is preserved as-is.

Existing baseline (preserve, do not change):

| Role | Value | Usage |
|------|-------|-------|
| App background | #1E1E1E | Main application surface |
| App text | #FFFFFF | Default text color |
| Overlay div (production) | transparent | Overlay is invisible -- only canvas children are visible |
| Overlay div (debug) | rgba(0, 128, 255, 0.1) background + 1px dashed rgba(0, 128, 255, 0.5) border | Debug visualization only, never shown in production |
| Canvas selection | #3b82f6 | Fabric.js object selection handles (existing, no change) |

Accent reserved for: not applicable -- no new accent usage in this phase.

Source: Codebase scan of `styles.css` line 8 and `App.jsx` lines 12062-12063.

---

## Visual Invariants (Phase-Specific)

These are the visual contracts that must hold true after Phase 4 implementation. This replaces the standard "Copywriting Contract" section because Phase 4 has no user-facing copy.

### Zoom State Transitions

The user sees exactly three visual states during a zoom operation. Each state has strict visual requirements:

| State | Visual Appearance | Duration | Pointer Events |
|-------|-------------------|----------|----------------|
| 1. Pre-zoom (idle) | Crisp annotations at native resolution. Canvas dimensions match page dimensions at current scale. No CSS transforms on overlay div. | Until zoom starts | Enabled -- user can draw, select, interact |
| 2. Mid-zoom (CSS transform active) | Blurry but visible annotations. CSS `transform: scale(ratio)` with `transform-origin: top left` on overlay div. Annotations stay positioned relative to PDF content. | From zoom start until App.jsx settle timer fires (1000ms after last zoom input) | Disabled -- `pointer-events: none` on overlay div prevents coordinate corruption |
| 3. Post-zoom (settle) | Crisp annotations at new native resolution. Canvas redrawn with `setWidth/setHeight/setZoom/renderAll`. CSS transform removed. Annotations appear sharp, not blurry. | From settle completion onward | Enabled -- `pointer-events` restored after transform removal |

### Post-Zoom Redraw Sequence (Visual Contract)

The transition from State 2 to State 3 MUST follow this exact ordering to prevent visual pop (a frame where annotations disappear or jump):

1. **Redraw canvas at new native scale** -- `fabricRef.current.setWidth(w)`, `setHeight(h)`, `setZoom(s)`, `renderAll()`. Fresh crisp pixels are now painted on the canvas but still CSS-scaled.
2. **Remove CSS transform** -- `overlay.style.transform = ''`. The blurry CSS-scaled version is swapped for the crisp native render. Because fresh pixels are already painted, there is no visible flash or pop.
3. **Restore pointer events** -- `overlay.style.pointerEvents = ''` (or remove the `none` value). User can now interact with annotations at correct coordinates.

**Critical invariant:** Step 2 MUST NOT execute before Step 1 completes. If transforms are removed before fresh pixels are ready, the user sees a frame of wrong-scale annotations (visual pop).

### Center-Page-First Priority

When multiple pages are visible during zoom settle:

| Priority | Pages | Timing |
|----------|-------|--------|
| Immediate | Center page (most visible) | Redraws first, blocking |
| Deferred | Other visible pages | Redraws after center page, staggered via `enqueueZoomResize()` |
| Lazy | Off-screen pages | Redraws when scrolled into view via `viewportObserverRef` IntersectionObserver |

Source: CONTEXT.md -- tiered rendering pattern preserved from existing implementation.

---

## Interaction Contracts (Phase-Specific)

These replace the standard "Copywriting Contract" section's CTA/empty/error elements because Phase 4 has no new UI interactions -- it must preserve existing ones.

### Drawing Tool Accuracy

After zoom settles (State 3), all drawing tools must produce strokes that land where the cursor is:

| Tool | Verification |
|------|-------------|
| Pen / freehand | Stroke path follows mouse movement within 1px tolerance |
| Shapes (rectangle, ellipse) | Bounding box corners match mousedown/mouseup positions within 1px |
| Callouts | Callout anchor and text box position match click target within 1px |
| Regions | Region rectangle corners match drag start/end within 1px |

**Root cause of potential failure:** If `Fabric.js calcOffset()` is not called after CSS transform removal, the canvas coordinate system is stale and all pointer events land at wrong positions. Phase 4 must call `calcOffset()` after step 3 of the redraw sequence.

### Selection Accuracy

After zoom settles, clicking on an existing annotation selects it (hit detection is correct). Drag-to-select (rubber band) selects annotations within the drawn rectangle.

### Search Highlights

SearchHighlightLayer renders as a child of the overlay div. After zoom settles:
- Highlights are visible at all zoom levels
- Highlight position matches the text they annotate (no offset drift)
- No changes to SearchHighlightLayer component code required -- it inherits transforms from parent overlay div

### Undo/Redo

After zoom operations:
- Ctrl+Z undoes the last annotation action (not the zoom itself)
- Ctrl+Shift+Z / Ctrl+Y redoes the last undone action
- Undo/redo stack is not corrupted by zoom state changes

### LightweightAnnotationOverlay (Proxy Rendering)

Pan/scroll proxy rendering continues to work at all zoom levels:
- Proxy overlays appear for off-screen annotated pages when scrolled into view
- Proxy overlay positions match their page positions
- No changes to LightweightAnnotationOverlay component code required

---

## Props and Callback Contract

These props/callbacks are treated as follows in this phase:

| Prop / callback | Status in Phase 4 | Why |
|-----------------|-------------------|-----|
| `onScaleApplied` | KEEP | This is still the explicit PAL -> App sequencing hook for transform release / reveal timing |
| `presentationApiRegistry` | Optional cleanup only if proven unused | Not part of the load-bearing zoom path, but should not be removed casually during timing repair |
| `isHidden` | Optional cleanup only if proven unused | Not part of the load-bearing zoom path, but should not distract from the sequencing repair |

Source: refreshed CONTEXT.md + `CLAUDE.md` repo-level zoom rules.

---

## State Signal Contract

| Signal | Owner | Direction | Mechanism |
|--------|-------|-----------|-----------|
| `isInteracting` | App.jsx | App -> PAL (prop) | Primary guard for expensive canvas work during active zoom / scroll interactions |
| `isZooming` | App.jsx | App -> PAL (prop) | Secondary signal only; useful context but not reliable enough to be the sole redraw trigger |
| `inZoomModeRef` | PAL | Internal | Latch for deferred redraw sequencing |
| `pendingScaleRef` | PAL | Internal | Stores deferred scale until PAL performs the settled redraw |
| `zoomSettleTimerRef` | PAL | Internal | Existing 300ms redraw debounce; keep while repairing sequencing |
| `deferredZoomScaleRef` | PAL | Internal | Stores pending scale for delayed/off-screen pages |
| `onScaleApplied` | PAL -> App | Callback | Explicit callback phases tell App when a page is visually ready versus still waiting |
| Overlay settle cleanup | App.jsx | N/A | Removes temporary overlay transforms only after the repaired callback sequence says it is safe |

Source: refreshed CONTEXT.md decisions and RESEARCH.md timing analysis.

---

## Error States (Phase-Specific)

No user-visible error states are introduced. Internal error handling:

| Error Condition | Handling | Visual Result |
|-----------------|----------|---------------|
| `fabricRef.current` is null when zoom settles | Skip redraw for that page, log warning to console | Page shows blurry CSS-scaled version until next render cycle |
| Overlay div missing for a page | Skip transform removal for that page | No visual change -- page renders without overlay |
| `calcOffset()` throws | Catch and log, pointer events may be offset until next zoom | Annotations visible but interaction coordinates may be wrong |

Source: CONTEXT.md -- Claude's Discretion notes on error handling edge cases.

---

## Console Error Contract

**PRES-05 requirement:** Zero console errors during any zoom operation. This means:
- No React warnings from removed props (safe defaults in destructuring prevent this)
- No null reference errors from `fabricRef.current` access during zoom transitions
- No DOM errors from overlay div manipulation

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| N/A | none | not applicable -- no design system, no component registry |

This phase uses only existing project code. No external component registries are involved.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: N/A (internal refactor -- visual invariants documented instead)
- [ ] Dimension 2 Visuals: PASS (zoom state transitions, redraw sequence, visual pop prevention)
- [ ] Dimension 3 Color: PASS (no new colors, existing preserved)
- [ ] Dimension 4 Typography: PASS (no new typography, existing preserved)
- [ ] Dimension 5 Spacing: PASS (overlay div positioning preserved)
- [ ] Dimension 6 Registry Safety: PASS (no registries used)

**Approval:** pending

---

*Generated: 2026-03-19 by gsd-ui-researcher*
*Sources: CONTEXT.md (7 decisions), REQUIREMENTS.md (7 requirements: ZOOM-09, OVLY-04, PRES-01-05), ROADMAP.md (Phase 4 definition), codebase scan (styles.css, index.css, App.jsx overlay styling, PageAnnotationLayer.jsx canvas operations)*
