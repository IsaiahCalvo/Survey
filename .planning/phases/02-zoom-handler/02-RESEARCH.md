# Phase 2: Zoom Handler - Research

**Researched:** 2026-03-17
**Domain:** CSS transform-based zoom scaling for annotation overlay divs in a Syncfusion PDF Viewer + Fabric.js canvas system
**Confidence:** HIGH

## Summary

Phase 2 adds CSS `transform: scale(ratio)` with `transform-origin: top left` to the overlay divs created in Phase 1 during all zoom operations. The core pattern is straightforward: when zoom begins, capture the base scale; on each zoom event, compute `ratio = newScale / baseScale` and apply it as a CSS transform to overlay divs; after 1000ms of inactivity (debounce), remove transforms and update scale state. This is a well-understood browser rendering pattern with no exotic APIs.

The primary complexity is not in the CSS transform itself but in correctly intercepting all 4 zoom entry points in App.jsx, applying transforms to the right DOM nodes (`overlayDivsRef` vs the current `syncfusionOverlayContentRefs`), and ensuring the new system coexists with the old freeze/snapshot/confirm-pending machinery without interference. The old system continues to operate on its own nodes (`syncfusionStablePortalHostsRef` / `syncfusionOverlayContentRefs`); the new system operates independently on `overlayDivsRef` nodes.

**Primary recommendation:** Implement a single `applyOverlayZoomTransform(newScale)` function that handles all CSS transform logic for overlay divs, and call it from all 4 zoom entry points. Use a single shared `useRef`-based settle timer (reuse the existing `zoomOverlaySettleTimerRef` pattern but pointed at overlay divs). Add temporary visual indicators (colored border/background) on overlay divs so transforms are visible during testing despite overlays being empty.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Settle timer behavior:** Use 1000ms settle timer per design spec (not the current 3000ms confirm-pending timer). Standard debounce pattern: reset the timer on each new zoom action so it only fires 1000ms after zooming has completely stopped. On settle: remove CSS transforms from overlay divs, update scale state for canvas redraw.
- **Coexistence with old system:** Leave old zoom code largely intact -- do not remove freeze/snapshot/confirm-pending machinery yet (that's Phase 6). Apply new CSS transforms independently to the new overlay divs (`overlayDivsRef`). Both systems run in parallel without interfering -- old system continues to render annotations through old portal hosts, new system applies transforms to (currently empty) overlay divs. This means Phase 2 adds the new zoom handler logic alongside the existing code, not replacing it.
- **Transform scope & application:** Apply CSS transforms only to visible or currently annotated pages (not all overlay divs) for performance. Global base-scale tracking: capture the starting scale when zoom begins, compute `ratio = newScale / baseScale`. Pointer event coordination: disable pointer events on overlay divs while zoom is actively occurring, restore when settle timer completes. PAL's existing pointer-event management on its own canvas element is unchanged.
- **Testing & verification:** Add temporary visual indicators on overlay divs (faint semi-transparent colored background or border) so CSS transforms are visible during zoom even though overlays are empty. Add Playwright assertions on computed styles to verify transforms are applied/removed correctly. Visual indicators removed in Phase 3 when real rendering moves into overlays.

### Claude's Discretion
- Exact implementation of the debounce timer (useRef-based vs separate utility)
- How to capture base scale for ratio calculation (on first zoom event vs tracking continuously)
- Which zoom entry points need modification vs which can be left alone because they flow through `handleSyncfusionZoomChange`
- Whether keyboard/toolbar and ctrl+key handlers need separate transform logic or can rely on the main handler

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OVLY-02 | CSS transform: scale(ratio) applied to overlay divs during zoom transition | Core deliverable: `applyOverlayZoomTransform()` function applies transforms to `overlayDivsRef` nodes |
| ZOOM-03 | Ctrl+scroll wheel zoom works without annotation flicker | Ctrl+scroll flows through `handleSyncfusionZoomChange` (line 12375); new transform logic in that handler covers this |
| ZOOM-04 | Toolbar zoom in/out buttons work without annotation flicker | Toolbar zoom flows through `setScaleWithViewportPreservation` (line ~21190) then `handleSyncfusionZoomChange`; pre-activation at line 21209 needs parallel overlay div transform |
| ZOOM-05 | Zoom percentage dropdown works without annotation flicker | Dropdown uses Syncfusion's internal zoom -> fires `onZoomChanged` -> `handleSyncfusionZoomChange` |
| ZOOM-06 | Fit-to-page works without annotation flicker | Uses Syncfusion's `fitToPage()` -> fires `onZoomChanged` -> `handleSyncfusionZoomChange` |
| ZOOM-07 | Fit-to-width works without annotation flicker | Uses Syncfusion's `fitToWidth()` -> fires `onZoomChanged` -> `handleSyncfusionZoomChange` |
| ZOOM-08 | Pinch-to-zoom (trackpad) works without annotation flicker | Trackpad pinch fires wheel events -> flows through ctrl+scroll path -> `handleSyncfusionZoomChange` |
| ZOOM-10 | Rapid consecutive zooms handled gracefully (no stuck transforms or stale state) | Debounce timer resets on each zoom action; settle callback clears all transforms and state |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | UI framework, useRef/useCallback for timer management | Already in project |
| Fabric.js | 5.5.2 (existing) | Canvas annotations -- NOT modified in this phase | Already in project |
| Syncfusion PDF Viewer | 32.1.19 (existing) | PDF rendering, fires onZoomChanged events | Already in project |
| Playwright | existing (debug/playwright.config.mjs) | E2E testing of CSS transform application | Already in project |

### Supporting
No new libraries needed. This phase uses only native browser APIs:

| API | Purpose | When to Use |
|-----|---------|-------------|
| `element.style.transform` | Apply `scale(ratio)` CSS transform | During zoom (every zoom event) |
| `element.style.transformOrigin` | Set `top left` origin for scaling | During zoom (on first zoom event) |
| `element.style.pointerEvents` | Disable/enable pointer events during zoom | Zoom start (disable) / settle (enable) |
| `window.getComputedStyle()` | Playwright assertions on transform values | Testing only |

### Alternatives Considered
None -- the CSS transform approach is locked by the design spec and CONTEXT.md decisions.

## Architecture Patterns

### Recommended Project Structure
No new files needed. All changes are in existing files:
```
src/
  App.jsx           # Zoom handler modifications (4 entry points + overlay div transform logic)
debug/
  scenarios/
    zoom-handler.spec.mjs   # NEW: Playwright test for Phase 2 CSS transforms
```

### Pattern 1: Centralized Transform Application Function
**What:** A single function `applyOverlayZoomTransform(newScale)` that handles all CSS transform logic for overlay divs. Called from all zoom entry points rather than duplicating transform logic.
**When to use:** Every zoom event from any of the 4 entry points.
**Example:**
```javascript
// Centralized transform application for overlay divs
// Uses overlayDivsRef (Phase 1 overlay divs), NOT syncfusionOverlayContentRefs (old system)
const applyOverlayZoomTransform = useCallback((newScale) => {
  const baseScale = overlayZoomBaseScaleRef.current;
  if (!(baseScale > 0)) return;

  const ratio = newScale / baseScale;
  const overlayDivs = overlayDivsRef.current;
  const keys = Object.keys(overlayDivs);
  for (let i = 0; i < keys.length; i++) {
    const div = overlayDivs[keys[i]];
    if (div && div.isConnected) {
      div.style.transform = `scale(${ratio})`;
      div.style.transformOrigin = 'top left';
      div.style.pointerEvents = 'none'; // Already none, but reinforce during zoom
    }
  }
}, []);
```

### Pattern 2: Debounce Settle Timer (useRef-based)
**What:** A single shared settle timer ref that resets on every zoom event. When it fires (1000ms after last zoom), it removes CSS transforms, restores pointer events, and updates scale state.
**When to use:** Zoom settle detection.
**Example:**
```javascript
// New refs for the overlay div zoom system (parallel to existing zoomOverlay* refs)
const overlayZoomBaseScaleRef = useRef(1);
const overlayZoomActiveRef = useRef(false);
const overlayZoomSettleTimerRef = useRef(null);

// Settle handler -- called from all zoom entry points
const startOverlayZoomSettleTimer = useCallback(() => {
  if (overlayZoomSettleTimerRef.current) {
    clearTimeout(overlayZoomSettleTimerRef.current);
  }
  overlayZoomSettleTimerRef.current = setTimeout(() => {
    overlayZoomSettleTimerRef.current = null;
    overlayZoomActiveRef.current = false;

    // Remove CSS transforms from all overlay divs
    const overlayDivs = overlayDivsRef.current;
    Object.values(overlayDivs).forEach(div => {
      if (div && div.isConnected) {
        div.style.transform = '';
        div.style.transformOrigin = '';
      }
    });

    // Signal for Phase 3+: scale state can be updated for canvas redraw
    // (Phase 2 just removes transforms; Phase 4 adds canvas redraw logic)
  }, 1000);
}, []);
```

### Pattern 3: Pre-activation for Keyboard/Toolbar Zoom
**What:** The keyboard/toolbar handler (line ~21204) and ctrl+key handler (line ~21691) pre-activate overlay zoom protection BEFORE Syncfusion processes the zoom. This prevents a gap where transforms aren't applied while Syncfusion is mid-zoom.
**When to use:** Zoom entry points that fire before `handleSyncfusionZoomChange`.
**Example:**
```javascript
// In keyboard/toolbar handler (before viewer.zoomTo()):
if (Math.abs(safeScale - previousScale) > 0.0005) {
  if (!overlayZoomActiveRef.current) {
    overlayZoomBaseScaleRef.current = previousScale;
    overlayZoomActiveRef.current = true;
  }
  startOverlayZoomSettleTimer();
}
```

### Pattern 4: Visual Test Indicators
**What:** Temporary colored background/border on overlay divs so CSS transforms are visible during testing (overlays are empty in Phase 2).
**When to use:** Phase 2 only. Removed in Phase 3 when real content renders into overlays.
**Example:**
```javascript
// In attachOverlayToPageDiv() or via a Phase 2 debug flag:
overlayDiv.style.background = 'rgba(0, 128, 255, 0.1)';
overlayDiv.style.border = '1px dashed rgba(0, 128, 255, 0.5)';
```

### Anti-Patterns to Avoid
- **Modifying old system nodes:** DO NOT apply transforms to `syncfusionOverlayContentRefs` or `syncfusionStablePortalHostsRef` nodes. The new system operates exclusively on `overlayDivsRef` nodes. The two systems must not interfere.
- **Removing old zoom code:** DO NOT remove `beginSyncfusionScaleConfirmPending`, `cancelSyncfusionScaleConfirmPending`, `handlePALScaleApplied`, or any freeze/snapshot logic. That is Phase 6 work.
- **Using React state for transform tracking:** CSS transforms are applied synchronously via DOM manipulation for performance. Using `useState` would cause unnecessary re-renders. Use `useRef` for all zoom tracking state.
- **Applying transforms to ALL overlay divs unconditionally:** Only apply to visible/annotated pages. Use `overlayDivsRef` entries that correspond to pages in `syncfusionPageContainers` or `syncfusionOverlayWindowPages`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounce timer | Custom debounce utility class | `useRef` + `setTimeout`/`clearTimeout` | Already the pattern used throughout App.jsx (see lines 12470-12512, 21239-21254, 21726-21741). Consistent with codebase. |
| Scale clamping | Manual min/max checks | `clampScale()` from `utils/zoomController.js` | Already exists and handles NaN, non-number, and range clamping (0.1-5.0) |
| Page div lookup | New DOM query logic | `overlayDivsRef` (already populated by Phase 1's `attachOverlayToPageDiv()`) | Phase 1 already handles the DOM lookup and caching |

**Key insight:** Phase 2's job is applying CSS transforms to DOM nodes that already exist (created in Phase 1). No new DOM creation or lookup logic is needed -- just iterate `overlayDivsRef.current` entries and set style properties.

## Common Pitfalls

### Pitfall 1: Stale Base Scale on Rapid Zoom
**What goes wrong:** If base scale captures the wrong value during rapid consecutive zooms, the CSS transform ratio drifts and annotations appear at wrong sizes.
**Why it happens:** Base scale should only be captured on the FIRST zoom event of a sequence. If it's recaptured on subsequent events, the ratio calculation breaks.
**How to avoid:** Use the `overlayZoomActiveRef` guard: only set `overlayZoomBaseScaleRef` when `overlayZoomActiveRef.current === false`. This is exactly the pattern already used by the old system at lines 12393-12395.
**Warning signs:** Annotations visually "jump" between zoom levels instead of smoothly scaling.

### Pitfall 2: Stuck Transforms After Error
**What goes wrong:** If an error occurs during zoom handling, CSS transforms may remain on overlay divs permanently, causing annotations to appear at wrong sizes.
**Why it happens:** The settle timer never fires (error prevents timeout scheduling), or the cleanup callback throws.
**How to avoid:** Add a safety timeout (e.g., 5000ms) that forcibly clears transforms regardless of zoom state. The existing system has this pattern at line 10218 (3000ms safety timeout). Also clear transforms in the `overlayZoomActiveRef` setter whenever it transitions to `false`.
**Warning signs:** Overlay divs have `transform: scale(...)` in DevTools after zoom has clearly finished.

### Pitfall 3: Transform Applied to Disconnected Nodes
**What goes wrong:** Overlay divs that are in `overlayDivsRef` but not in the DOM (page scrolled far away, Syncfusion destroyed the page div) get transforms applied, wasting cycles.
**Why it happens:** `overlayDivsRef` stores all ever-created overlay divs. Some may be detached from the DOM.
**How to avoid:** Check `div.isConnected` before applying transforms. The existing codebase already uses this guard pattern (line 12458: `if (node && node.isConnected)`).
**Warning signs:** No visible symptoms, but unnecessary DOM style writes could impact rapid zoom performance.

### Pitfall 4: Pointer Event Conflict with PAL
**What goes wrong:** Disabling pointer events on overlay divs during zoom could conflict with PAL's internal pointer event management on its canvas element.
**Why it happens:** PAL sets `pointer-events: auto` on its canvas when drawing tools are active.
**How to avoid:** Overlay divs already have `pointer-events: none` from Phase 1 (line 12039). PAL's canvas sits inside the old portal system (`syncfusionStablePortalHostsRef`), not inside the overlay divs. The two don't overlap in Phase 2. No conflict is possible until Phase 3 moves PAL rendering into overlay divs.
**Warning signs:** Drawing tools don't respond to clicks during zoom (won't happen in Phase 2 since overlays are empty).

### Pitfall 5: Two Settle Timers Racing
**What goes wrong:** The new overlay div settle timer (1000ms) and the old `zoomOverlaySettleTimerRef` (also 1000ms at line 12473) could fire at different times, causing visual inconsistency.
**Why it happens:** Both systems run in parallel. If one settles before the other, the old system might remove old transforms while new transforms persist (or vice versa).
**How to avoid:** Since the two systems operate on different DOM nodes (old: `syncfusionOverlayContentRefs`, new: `overlayDivsRef`), they don't visually conflict. They can safely race. However, for cleanliness, use the SAME timer duration (1000ms) so they settle approximately together.
**Warning signs:** None in Phase 2 (overlays are empty). Could matter in Phase 3+ when content moves to overlay divs.

## Code Examples

### Zoom Entry Point Analysis

Based on code analysis, here is exactly which entry points need modification:

**Entry Point 1: `handleSyncfusionZoomChange` (line 12375)**
- Fires for: ALL zoom methods (ctrl+scroll, toolbar, dropdown, fit-to-page, fit-to-width, pinch)
- Current behavior: Applies CSS transforms to `syncfusionOverlayContentRefs` nodes (lines 12450-12464)
- Phase 2 change: ADD parallel transform application to `overlayDivsRef` nodes
- This is the MAIN entry point -- if only one handler is modified, this is the one

**Entry Point 2: Keyboard/toolbar pre-activation (line ~21204)**
- Fires for: Toolbar zoom buttons, keyboard shortcuts
- Current behavior: Pre-activates `zoomOverlayTransformActiveRef` BEFORE `handleSyncfusionZoomChange` fires
- Phase 2 change: ADD parallel pre-activation of `overlayZoomActiveRef` and `overlayZoomBaseScaleRef`
- Also has its own settle timer (line 21242) that needs a parallel overlay version

**Entry Point 3: Ctrl+key pre-activation (line ~21691)**
- Fires for: Ctrl+= / Ctrl+- keyboard zoom
- Current behavior: Pre-activates `zoomOverlayTransformActiveRef` before Syncfusion's internal handler
- Phase 2 change: ADD parallel pre-activation of `overlayZoomActiveRef` and `overlayZoomBaseScaleRef`
- Also has its own settle timer (line 21729) that needs a parallel overlay version

**Entry Point 4: Finalize-idle handler (line ~10663)**
- Fires for: Interaction idle transition (after zoom finishes)
- Current behavior: Calls `beginSyncfusionScaleConfirmPending('finalize_idle')`
- Phase 2 change: NO CHANGE NEEDED. The finalize-idle handler operates on the old system. The new overlay system has its own settle timer that handles cleanup independently.

### Recommendation: Which Entry Points Need Modification

Based on the analysis above:

1. **`handleSyncfusionZoomChange` -- MUST modify.** This is the universal handler. Add `applyOverlayZoomTransform()` call + settle timer restart. All 6 zoom methods flow through here.

2. **Keyboard/toolbar handler -- SHOULD modify.** Pre-activation is needed because Syncfusion may process the zoom BEFORE `handleSyncfusionZoomChange` fires. Without pre-activation, there's a window where transforms aren't applied.

3. **Ctrl+key handler -- SHOULD modify.** Same race condition as #2. Syncfusion's own keydown handler may fire first.

4. **Finalize-idle handler -- NO CHANGE.** The overlay system's settle timer handles cleanup independently.

### Settle Timer Implementation

The settle timer should be a single shared timer across all entry points:

```javascript
// In handleSyncfusionZoomChange:
applyOverlayZoomTransform(nextScale);
startOverlayZoomSettleTimer();

// In keyboard/toolbar handler:
if (!overlayZoomActiveRef.current) {
  overlayZoomBaseScaleRef.current = previousScale;
  overlayZoomActiveRef.current = true;
}
startOverlayZoomSettleTimer();
// Note: don't call applyOverlayZoomTransform here because we don't have
// the new scale yet -- handleSyncfusionZoomChange will fire and do that.

// In ctrl+key handler:
if (!overlayZoomActiveRef.current) {
  overlayZoomBaseScaleRef.current = prevScale;
  overlayZoomActiveRef.current = true;
}
startOverlayZoomSettleTimer();
// Same as above: handleSyncfusionZoomChange does the actual transform.
```

### Visible Page Filtering for Transform Application

Apply transforms only to pages that are currently in the DOM (visible or buffered by Syncfusion):

```javascript
const applyOverlayZoomTransform = useCallback((newScale) => {
  const baseScale = overlayZoomBaseScaleRef.current;
  if (!(baseScale > 0)) return;

  const ratio = newScale / baseScale;
  const overlayDivs = overlayDivsRef.current;

  // Only iterate pages that have overlay divs AND are connected to DOM
  const keys = Object.keys(overlayDivs);
  for (let i = 0; i < keys.length; i++) {
    const div = overlayDivs[keys[i]];
    if (div && div.isConnected) {
      div.style.transform = `scale(${ratio})`;
      div.style.transformOrigin = 'top left';
    }
  }
}, []);
```

The `div.isConnected` check naturally filters to only visible/buffered pages because Syncfusion removes page divs (and their children, including our overlay divs) for pages scrolled far out of view.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Freeze/snapshot/confirm-pending zoom handling | CSS transform scaling during zoom, redraw on settle | Phase 2 (this phase) | Eliminates multi-step timing-sensitive zoom pipeline for new overlay system |
| `syncfusionOverlayContentRefs` for transform targets | `overlayDivsRef` for transform targets | Phase 1 created the refs; Phase 2 uses them | Direct-child attachment means transforms track page div sizing automatically |
| 3000ms confirm-pending timer | 1000ms debounce settle timer | Phase 2 decision | Faster settle = quicker crisp redraw (in Phase 4) |

**Deprecated/outdated (but NOT yet removed -- Phase 6):**
- `beginSyncfusionScaleConfirmPending()` -- replaced conceptually by settle timer, but old calls stay in place
- `handlePALScaleApplied()` -- per-page confirmation callback, replaced by global settle
- `zoomOverlayTransformActiveRef` + `zoomOverlayBaseScaleRef` -- old system's tracking refs, still active on old nodes

## Open Questions

1. **Base Scale Capture: First Event vs Continuous Tracking?**
   - What we know: The existing system captures base scale on first zoom event (lines 12393-12395). This works correctly for ratio calculation.
   - What's unclear: Whether tracking continuously (updating base scale on every event) would be more robust for edge cases.
   - Recommendation: **Use first-event capture** (match existing pattern). Continuous tracking would make the ratio always 1.0, which defeats the purpose. The `overlayZoomActiveRef` guard ensures base scale is only captured once per zoom sequence.

2. **Visual Indicator Persistence Across Phase 3 Transition**
   - What we know: Phase 2 adds temporary colored background/border to overlay divs for testing visibility.
   - What's unclear: Whether Phase 3 needs to explicitly remove these or if they'll naturally be overwritten.
   - Recommendation: Add visual indicators via a flag/constant (`PHASE_2_DEBUG_INDICATORS = true`) that Phase 3 can simply set to `false`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (via @playwright/test) |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-handler"` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OVLY-02 | CSS transform applied to overlay divs during zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "overlay divs have CSS transform during zoom"` | No -- Wave 0 |
| ZOOM-03 | Ctrl+scroll zoom without flicker | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "ctrl scroll zoom"` | No -- Wave 0 |
| ZOOM-04 | Toolbar zoom without flicker | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "toolbar zoom"` | No -- Wave 0 |
| ZOOM-05 | Dropdown zoom without flicker | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "dropdown zoom"` | No -- Wave 0 |
| ZOOM-06 | Fit-to-page without flicker | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "fit to page"` | No -- Wave 0 |
| ZOOM-07 | Fit-to-width without flicker | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "fit to width"` | No -- Wave 0 |
| ZOOM-08 | Pinch zoom without flicker | e2e/manual-only | Manual: pinch-to-zoom requires physical trackpad input | No -- manual |
| ZOOM-10 | Rapid consecutive zooms handled | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "rapid zoom"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test --config debug/playwright.config.mjs --grep "zoom-handler"`
- **Per wave merge:** `npx playwright test --config debug/playwright.config.mjs`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `debug/scenarios/zoom-handler.spec.mjs` -- NEW test file covering OVLY-02, ZOOM-03 through ZOOM-07, ZOOM-10
  - Tests CSS transform application during zoom via `page.evaluate(() => getComputedStyle(overlayDiv).transform)`
  - Tests transform removal after 1000ms settle
  - Tests rapid zoom (multiple zoomTo() calls in quick succession)
  - Tests all 5 automatable zoom methods (ctrl+scroll via wheel event, toolbar buttons, dropdown, fit-to-page, fit-to-width)
  - Tests that old system still functions (canvas containers present after zoom -- existing smoke test assertion)
- [ ] ZOOM-08 (pinch-to-zoom) is manual-only -- Playwright cannot synthesize multi-touch trackpad gestures. Test with physical trackpad after implementation.

### Playwright Test Pattern for Transform Verification
```javascript
// Verify CSS transform is applied during zoom
const overlayTransform = await page.evaluate(() => {
  const overlay = document.querySelector('[data-overlay-page]');
  if (!overlay) return null;
  return window.getComputedStyle(overlay).transform;
});
// transform should be a matrix(...) representing scale(ratio)
expect(overlayTransform).not.toBe('none');

// Verify transform is removed after settle (wait 1500ms > 1000ms settle)
await page.waitForTimeout(1500);
const settledTransform = await page.evaluate(() => {
  const overlay = document.querySelector('[data-overlay-page]');
  if (!overlay) return null;
  return window.getComputedStyle(overlay).transform;
});
expect(settledTransform).toBe('none');
```

## Sources

### Primary (HIGH confidence)
- `src/App.jsx` lines 12375-12512 -- `handleSyncfusionZoomChange` implementation showing current transform pattern
- `src/App.jsx` lines 21190-21254 -- Keyboard/toolbar pre-activation pattern
- `src/App.jsx` lines 21691-21741 -- Ctrl+key pre-activation pattern
- `src/App.jsx` lines 12028-12060 -- `attachOverlayToPageDiv()` (Phase 1 output)
- `src/App.jsx` lines 9004-9006 -- Existing zoom overlay refs
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` -- Design spec Step 2

### Secondary (MEDIUM confidence)
- `.planning/phases/02-zoom-handler/02-CONTEXT.md` -- User decisions constraining implementation
- `.planning/phases/01-overlay-attachment-foundation/01-CONTEXT.md` -- Phase 1 context for overlay div creation

### Tertiary (LOW confidence)
None -- all findings verified against source code and design spec.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries, uses existing browser APIs and project patterns
- Architecture: HIGH -- All 4 zoom entry points identified and analyzed against actual source code; transform pattern verified from existing implementation
- Pitfalls: HIGH -- Pitfalls derived from actual code analysis (stale base scale, stuck transforms, disconnected nodes); patterns for mitigation already exist in the codebase
- Validation: HIGH -- Playwright infrastructure already exists; test patterns follow existing `overlay-attachment.spec.mjs` and `zoom-flicker.spec.mjs`

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable -- no external dependency changes expected)
