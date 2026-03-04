# Annotation Rendering Performance & Flicker Fix Plan

## Root Cause Analysis

### Why annotations flicker and render at wrong positions (2-3 bounces)

There are **5 compounding timing issues** causing the flickering:

1. **Scale measurement from live DOM during zoom** (`measureSyncfusionPageHostScale` at App.jsx:402) reads `pageHost.clientWidth` which is out of sync with Syncfusion's internal zoom state during rapid zoom events. The DOM dimensions lag behind the actual zoom target.

2. **One-frame-late page container updates** - `schedulePageContainerRefresh` uses `requestAnimationFrame`, so annotations render with stale page positions, then reposition one frame later when the new containers arrive.

3. **Proxy payload switching geometry jump** - During interaction, annotations use `proxyPayload` (simplified data). When interaction settles and switches to real annotations, there's a visible geometry recalculation jump because the two data sources compute positions differently.

4. **CSS transform ratio oscillation** - `applySyncfusionOverlayTransformSync` (App.jsx:9811) runs in a `requestAnimationFrame` loop during interaction, measuring the live DOM scale ratio each frame. Because Syncfusion's page div resize and the overlay transform measurement happen in different frames, the ratio bounces between values - causing 2-3 visible position changes.

5. **Annotation layer re-renders during every zoom step** - `LightweightAnnotationOverlay` receives a new `scale` prop on every zoom change, causing React to re-render all annotation elements with new pixel coordinates. Each re-render is a full DOM update across potentially hundreds of elements.

### Why annotations kill zoom/scroll/pan performance

The current approach **recalculates and re-renders every annotation element** on every scale change. For a page with 100+ annotations, this means:
- 100+ `useMemo` recalculations scaling coordinates
- 100+ React virtual DOM diffs
- 100+ real DOM style updates
- All of this happens **on every frame** during continuous zoom/scroll

## Solution: Two-Phase Rendering with CSS Transform Bridge

This is the universal pattern used by every professional PDF viewer:

| Application | Strategy Name |
|---|---|
| Mozilla PDF.js | `zoomLayer` + CSS transform, re-render after settle |
| Bluebeam Revu | "Iterative Draw with Sweetener" - low-res during interaction, sweeten after |
| Adobe Acrobat | Progressive rendering with page cache |
| Drawboard PDF | Annotation caching + pre-render nearby pages |
| Nutrient/PSPDFKit | Dynamic SVG precision based on zoom level |

### The Pattern

**Phase 1 - During Interaction (instant, GPU-accelerated):**
- Keep annotation overlay rendered at its LAST STABLE scale
- Apply a CSS `transform: scale(newZoom / frozenZoom)` to the entire overlay container
- GPU does the scaling - zero React re-renders, zero coordinate recalculations
- Annotations appear slightly blurry at extreme zoom but positioned correctly relative to page content

**Phase 2 - After Settle (full quality):**
- Detect interaction end (300ms after last zoom/scroll/pan event)
- Re-render annotations at the new scale with full precision
- Atomic swap: keep old overlay visible until new one is ready

## Implementation Plan

### Step 1: Create `useAnnotationZoomBridge` hook

New file: `src/hooks/useAnnotationZoomBridge.js`

This hook encapsulates the two-phase zoom logic for annotation overlays:
- Tracks `frozenScale` (the scale at which annotations were last fully rendered)
- Computes `bridgeTransform` CSS transform to visually match current zoom
- Provides `isSettled` boolean and `commitScale()` to trigger Phase 2
- Uses 300ms debounce after last interaction event to detect settle
- Returns a `bridgeStyle` object to apply to the overlay container

### Step 2: Modify `LightweightAnnotationOverlay` to support frozen rendering

Changes to `src/components/LightweightAnnotationOverlay.jsx`:
- Add a `frozenScale` prop - when provided, render annotations at this scale instead of `scale`
- The parent applies CSS transform bridge to match visual zoom
- This means React **never re-renders** annotations during zoom - only the container's CSS transform changes
- Remove the per-frame `safeScale` recalculation during interaction

### Step 3: Simplify the overlay transform system in `App.jsx`

The current system has ~500 lines of complex transform loop management (`applySyncfusionOverlayTransformSync`, `queueSyncfusionOverlayTransformSync`, `startSyncfusionOverlayTransformLoop`, etc.) that measures DOM dimensions every frame.

Replace with the simpler `useAnnotationZoomBridge` approach:
- Instead of measuring DOM on every frame, compute bridge transform from `targetScale / frozenScale`
- This is a pure math operation (no DOM reads) - eliminates the scale measurement oscillation
- The overlay content div gets `transform: scale(ratio)` applied directly, same as now, but computed from known values rather than DOM measurements
- Remove the `measureSyncfusionPageHostScale` calls from the animation frame loop

### Step 4: Fix the proxy payload switching to eliminate geometry jump

In the overlay rendering section (~App.jsx:23187-23342):
- During the `committing` phase, don't switch from proxy to real annotations immediately
- Instead, keep showing the frozen overlay (with CSS transform bridge) until the full re-render at the new scale is complete
- Only swap to the full `PageAnnotationLayer` once it has rendered at the correct scale
- This eliminates the visible geometry jump between proxy and real data

### Step 5: Add `will-change` management for interaction lifecycle

In `src/utils/layerPerformance.js`:
- Add an `ANNOTATION_LAYER_ZOOMING_STYLES` constant that adds `will-change: transform` only during active zoom
- Remove `will-change` after settle to free GPU memory
- This gives the browser advance notice that transforms are coming

## Files Changed

| File | Change Type | Description |
|---|---|---|
| `src/hooks/useAnnotationZoomBridge.js` | **New** | Two-phase zoom bridge hook |
| `src/components/LightweightAnnotationOverlay.jsx` | **Modify** | Accept `frozenScale`, skip re-render during zoom |
| `src/App.jsx` | **Modify** | Use bridge hook, simplify transform loop, fix proxy swap |
| `src/utils/layerPerformance.js` | **Modify** | Add zooming-specific layer styles |

## Expected Results

- **During zoom/scroll/pan**: Annotations are a single CSS-transformed layer (GPU-only), zero React re-renders, zero DOM measurements. Same approach as PDF.js and Bluebeam.
- **After settle (300ms)**: Full-quality re-render at correct scale. Single atomic update, no intermediate positions.
- **Flicker eliminated**: No more 2-3 position bounces because there are no intermediate DOM measurements or scale recalculations during interaction.
- **Performance**: From O(n) DOM updates per frame (n = annotation count) to O(1) CSS transform per frame.
