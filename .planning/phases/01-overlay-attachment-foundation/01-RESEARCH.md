# Phase 1: Overlay Attachment Foundation - Research

**Researched:** 2026-03-17
**Domain:** DOM manipulation, React refs, Syncfusion PDF Viewer page div lifecycle
**Confidence:** HIGH

## Summary

Phase 1 creates persistent overlay divs as direct children of Syncfusion `e-pv-page-div` elements, establishing the foundation for the entire direct-child canvas architecture. This is purely additive work: overlay divs are appended to the DOM but the existing portal host system continues to drive annotation rendering unchanged. No rendering, zoom handling, or PAL changes are in scope.

The codebase already contains all the patterns needed. The `resolveSyncfusionLivePageHost()` function (App.jsx ~line 11980) provides the page div lookup strategy. The `syncfusionStablePortalHostsRef` pattern (App.jsx ~line 9013) demonstrates how to store persistent per-page DOM references in a ref object keyed by page number. The `syncfusionPageContainers` state (fed by MutationObserver in SyncfusionPDFContainer.jsx) signals when page divs exist and are available for child attachment.

**Primary recommendation:** Create `attachOverlayToPageDiv(pageNumber)` as a `useCallback` in App.jsx that follows the existing `resolveSyncfusionLivePageHost` lookup pattern, stores overlay divs in a new `overlayDivsRef`, and uses a create-once guard. Call it from a `useEffect` that reacts to `syncfusionPageContainers` changes to attach overlays to all currently tracked page divs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None explicitly locked -- all implementation details fall under Claude's discretion.

### Claude's Discretion
- **Overlay lifecycle:** Claude decides which pages get overlay divs (visible, annotated, or all loaded) and whether/when to clean up overlay divs for pages no longer in view. The create-once guard per page number is required per design spec.
- **Coexistence strategy:** Overlays should be purely inert in Phase 1 -- added to the DOM but not used for rendering. The existing portal host system (`syncfusionStablePortalHostsRef`, `resolveSyncfusionOverlayPortalHost()`, etc.) continues to drive annotation rendering unchanged.
- **Verification approach:** Claude decides how to verify overlays are correctly placed -- DevTools inspection, visual indicators during dev, Playwright tests, or manual protocol. Must confirm: overlay divs exist as direct children of page divs, have correct styling, and don't break existing rendering.
- **`attachOverlayToPageDiv()` implementation details:** Function signature, error handling, logging. Design spec provides the shape; Claude handles edge cases.
- **Cleanup of overlay divs for pages scrolled far out of view:** Performance vs simplicity tradeoff -- Claude's call.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OVLY-01 | Canvas overlays are direct children of Syncfusion page divs (not via portal host system) | `attachOverlayToPageDiv()` function creates overlay divs and appends them directly to `e-pv-page-div` elements. Lookup pattern copied from `resolveSyncfusionLivePageHost()`. Stored in `overlayDivsRef` with create-once guard. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | (existing project version) | useRef, useCallback, useEffect for overlay lifecycle | Already in use throughout App.jsx |
| DOM API | Native | document.createElement, appendChild, element.isConnected | Direct DOM manipulation is the established pattern for stable portal hosts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Playwright | ^1.58.2 | E2E verification that overlay divs exist correctly | Verification step after implementation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct DOM manipulation | React refs with JSX-rendered divs | DOM manipulation matches existing `syncfusionStablePortalHostsRef` pattern and is required because overlay divs must persist across React re-renders without unmounting |

**No new packages required.** This phase uses only existing project dependencies and native DOM APIs.

## Architecture Patterns

### Where the New Code Lives

All new code lives in `src/App.jsx`. Specifically:

1. **New ref declaration** (~line 9013 area, near other stable portal refs):
   - `overlayDivsRef = useRef({})` -- keyed by page number, stores persistent overlay div elements

2. **New function** (`attachOverlayToPageDiv`):
   - Declared as a `useCallback` near the existing `resolveSyncfusionLivePageHost` (~line 11980 area)
   - Follows the same lookup strategy but adds overlay div creation

3. **New effect** (attachment trigger):
   - `useEffect` that watches `syncfusionPageContainers` and calls `attachOverlayToPageDiv` for each tracked page

### Pattern 1: Page Div Lookup (Copy from Existing)
**What:** Multi-strategy lookup to find the Syncfusion page div for a given page number
**When to use:** Whenever you need to find the DOM element for a specific page
**Source:** `resolveSyncfusionLivePageHost()` at App.jsx line 11980-12022

The lookup order is:
1. Check `syncfusionPageContainers` state map (from MutationObserver)
2. Check `pageContainersRef.current` (fallback ref)
3. Try `viewer.getPageContainer(pageNumber)` (Syncfusion API)
4. Query by CSS selector: `.e-pv-page-div[data-page-number="${pageNumber}"]`
5. Query by ID: `#${viewerElementId}_pageDiv_${pageNumber - 1}` (Syncfusion uses 0-based indexing)

For Phase 1, strategies 1-2 are sufficient since we trigger from `syncfusionPageContainers` changes. The pageDiv is already available in the state map.

### Pattern 2: Create-Once Guard (Copy from Existing)
**What:** Check if ref already has an entry for this page before creating
**When to use:** Every call to `attachOverlayToPageDiv`
**Source:** Used throughout App.jsx for stable portal hosts

```javascript
// Pattern from syncfusionStablePortalHostsRef usage at line 24448-24453
const stableHosts = syncfusionStablePortalHostsRef.current;
if (!stableHosts[pageNumber]) {
  const div = document.createElement('div');
  // ... configure div
  stableHosts[pageNumber] = div;
}
```

### Pattern 3: Overlay Div Styling (From Design Spec)
**What:** CSS properties that make the overlay div sit exactly on top of the page div
**When to use:** When creating the overlay div element

```javascript
// Source: Design spec Step 1
div.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';
```

This matches the existing `liveRoot` styling at line 9638:
```javascript
liveRoot.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';
```

### Pattern 4: Reactive Attachment via useEffect
**What:** Watch `syncfusionPageContainers` state and attach overlays when page divs appear
**When to use:** To ensure overlays exist whenever Syncfusion creates or recreates page divs

```javascript
useEffect(() => {
  if (!useSyncfusionRenderer) return;
  Object.entries(syncfusionPageContainers).forEach(([pageKey, pageDiv]) => {
    const pageNumber = Number(pageKey);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0 || !pageDiv?.isConnected) return;
    attachOverlayToPageDiv(pageNumber);
  });
}, [useSyncfusionRenderer, syncfusionPageContainers, attachOverlayToPageDiv]);
```

This mirrors the existing pattern at line 23418-23425 where `syncfusionPageContainers` drives side effects.

### Pattern 5: Data Attribute for Identification
**What:** Mark overlay divs with a data attribute for debugging and selector targeting
**When to use:** When creating overlay divs

```javascript
div.setAttribute('data-overlay-page', String(pageNumber));
```

This follows the pattern of `data-stable-portal`, `data-stable-live-root`, `data-stable-snapshot-root` used by the current stable portal system.

### Anti-Patterns to Avoid
- **Creating overlay divs in the render function:** DOM manipulation must happen in effects or callbacks, not during render. The existing codebase creates portal host divs at render time (line 24448-24453) but that pattern causes unnecessary coupling. Using a useEffect is cleaner.
- **Using React.createElement for overlay divs:** These divs are imperative DOM nodes used as portal targets, not React-managed elements. They must be created with `document.createElement` like the existing stable portal hosts.
- **Cleaning up overlay divs on every scroll:** The create-once guard means overlay divs persist forever once created. This is intentional -- destroying and recreating them would defeat the "persistent" requirement. Later phases depend on these divs being stable references.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Page div lookup | New querySelector logic | Copy from `resolveSyncfusionLivePageHost()` | Handles all edge cases (ID patterns, data attributes, disconnected nodes) |
| Page container change detection | New MutationObserver | `syncfusionPageContainers` state from SyncfusionPDFContainer.jsx | Already observed and debounced, feeds through React state |
| Page number coercion | Inline Number() calls | Copy `coercePositiveInt` pattern or use the existing `Number.isFinite && > 0` guard | Consistent with rest of codebase |

**Key insight:** This phase requires zero new concepts. Every building block already exists in the codebase. The task is composing existing patterns into the new `attachOverlayToPageDiv` function and its trigger effect.

## Common Pitfalls

### Pitfall 1: Overlay Div Detached from DOM After Syncfusion Recreation
**What goes wrong:** Syncfusion may destroy and recreate `e-pv-page-div` elements during zoom or document reload. The overlay div (as a child) gets removed from the DOM.
**Why it happens:** Syncfusion internally manages page divs and can replace them.
**How to avoid:** The `useEffect` watching `syncfusionPageContainers` re-fires when the MutationObserver detects page div changes. The effect checks `overlayDiv.parentElement !== pageDiv` and re-appends. Phase 1 only needs to handle the "attach to current page div" case -- full re-attachment robustness is Phase 5's scope.
**Warning signs:** `overlayDiv.isConnected === false` or `overlayDiv.parentElement !== expectedPageDiv`.

### Pitfall 2: Z-Index Conflict with Existing Portal Hosts
**What goes wrong:** The new overlay div (z-index:20) could stack on top of the existing `liveRoot` (also z-index:20), causing visual interference.
**Why it happens:** Both are absolutely positioned children of the same page div with the same z-index.
**How to avoid:** Since Phase 1 overlays are empty (no children rendered into them), there is no visual conflict. The overlay div will be transparent and pass through pointer events. Later phases will handle the transition from old system to new system. Optionally, use `z-index:21` for the new overlay to keep stacking order unambiguous, or add it before the existing portal host in DOM order.
**Warning signs:** Visual artifacts (doubled annotations, shifted layers) after adding overlay divs.

### Pitfall 3: Creating Overlay Divs for Invalid Page Numbers
**What goes wrong:** `syncfusionPageContainers` could contain invalid keys (NaN, 0, negative, non-numeric strings).
**Why it happens:** The MutationObserver in SyncfusionPDFContainer.jsx tries to resolve page numbers from various sources, but edge cases exist.
**How to avoid:** Apply the same guard used everywhere in App.jsx: `const safePageNumber = Number(pageKey); if (!(Number.isFinite(safePageNumber) && safePageNumber > 0)) return;`
**Warning signs:** `overlayDivsRef.current[NaN]` or `overlayDivsRef.current[0]` entries.

### Pitfall 4: Memory Leak from Unbounded Overlay Div Creation
**What goes wrong:** If overlay divs are created for every page ever scrolled past, memory grows with document size.
**Why it happens:** Create-once guard prevents recreation but never cleans up.
**How to avoid:** For Phase 1, this is acceptable. The overlay divs are lightweight DOM elements (empty divs with minimal styling). Even a 500-page document would create 500 divs at ~100 bytes each = ~50KB. This is negligible. If cleanup is desired later, it belongs in Phase 5 or 6.
**Warning signs:** Object.keys(overlayDivsRef.current).length growing monotonically with no bound.

### Pitfall 5: Overlay Div Appended Multiple Times
**What goes wrong:** If `attachOverlayToPageDiv` is called multiple times for the same page (from effect re-runs), the overlay div could be appended multiple times.
**Why it happens:** `appendChild` on an already-connected child moves it (no duplicate), but if the create-once guard is bypassed, duplicates could form.
**How to avoid:** The create-once guard (`if (overlayDivsRef.current[pageNumber]) return overlayDivsRef.current[pageNumber]`) prevents duplicate creation. For re-attachment, check `overlayDiv.parentElement !== pageDiv` before calling `appendChild`. Note: `appendChild` with an already-connected child safely moves it -- no duplicate is created. This is standard DOM behavior.
**Warning signs:** Multiple `[data-overlay-page]` children on the same page div.

## Code Examples

Verified patterns from the existing codebase:

### attachOverlayToPageDiv Function Shape
```javascript
// Source: Design spec Step 1 + existing patterns from App.jsx
const overlayDivsRef = useRef({});

const attachOverlayToPageDiv = useCallback((pageNumber) => {
  const safePageNumber = Number(pageNumber);
  if (!(Number.isFinite(safePageNumber) && safePageNumber > 0)) {
    return null;
  }

  // Create-once guard (pattern from line 24448-24453)
  let overlayDiv = overlayDivsRef.current[safePageNumber];
  if (!overlayDiv) {
    overlayDiv = document.createElement('div');
    overlayDiv.setAttribute('data-overlay-page', String(safePageNumber));
    overlayDiv.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';
    overlayDivsRef.current[safePageNumber] = overlayDiv;
  }

  // Find the Syncfusion page div
  const pageDiv =
    syncfusionPageContainersStateRef.current?.[safePageNumber] ||
    pageContainersRef.current?.[safePageNumber] ||
    null;

  if (!pageDiv?.isConnected) {
    return overlayDiv; // Div created but not attached (page not in DOM)
  }

  // Attach if not already a child of this page div
  if (overlayDiv.parentElement !== pageDiv) {
    pageDiv.appendChild(overlayDiv);
  }

  return overlayDiv;
}, []);
// Note: refs don't need to be in dependency array (they are stable)
```

### Trigger Effect Shape
```javascript
// Source: Pattern from line 23418-23425 (existing syncfusionPageContainers effect)
useEffect(() => {
  if (!useSyncfusionRenderer) return;
  Object.entries(syncfusionPageContainers).forEach(([pageKey, pageDiv]) => {
    const pageNumber = Number(pageKey);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) return;
    if (!pageDiv?.isConnected) return;
    attachOverlayToPageDiv(pageNumber);
  });
}, [useSyncfusionRenderer, syncfusionPageContainers, attachOverlayToPageDiv]);
```

### Verification: Querying Overlay Divs in DevTools or Playwright
```javascript
// Check overlay divs exist as direct children of page divs
document.querySelectorAll('[data-overlay-page]').forEach(div => {
  const pageNum = div.getAttribute('data-overlay-page');
  const parent = div.parentElement;
  const isDirectChild = parent?.classList?.contains('e-pv-page-div');
  const style = div.style;
  console.log(`Page ${pageNum}: direct-child=${isDirectChild}, connected=${div.isConnected}, ` +
    `pos=${style.position}, w=${style.width}, h=${style.height}, pe=${style.pointerEvents}, z=${style.zIndex}`);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deep portal host nesting (stablePortalHost > liveRoot > snapshotHost) | Direct overlay div as page div child | This refactor (Phase 1) | Eliminates portal host indirection. Overlay div IS the portal target. |
| `resolveSyncfusionOverlayPortalHost()` with freeze logic | `attachOverlayToPageDiv()` with create-once guard | This refactor (Phase 1) | No freeze needed -- overlay div is persistent and never changes |
| Portal hosts created at render time (line 24448) | Overlay divs created in useEffect/useCallback | This refactor (Phase 1) | Cleaner separation of concerns -- DOM mutation in effects, not render |

**Coexistence note:** In Phase 1, BOTH systems exist side-by-side. The old portal host system continues to drive rendering. The new overlay divs are inert placeholders. Phases 2-3 will transition rendering to use overlay divs, and Phase 6 will remove the old system.

## Open Questions

1. **Should overlay divs use z-index:20 or z-index:21 to avoid stacking ambiguity with existing liveRoot?**
   - What we know: Both the design spec and existing `liveRoot` use z-index:20. Having two siblings at the same z-index means DOM order determines stacking (later = on top).
   - What's unclear: Whether the overlay div stacking on top of the liveRoot could cause any subtle click/hover issues during the coexistence period (Phases 1-5).
   - Recommendation: Use z-index:20 as specified in the design doc. The overlay div has `pointer-events:none` and is empty, so stacking order is irrelevant during Phase 1. If issues arise during later phases, adjust then.

2. **Should overlay divs be created only for pages in `syncfusionPageContainers` or also preemptively?**
   - What we know: `syncfusionPageContainers` tracks pages detected by the MutationObserver. It typically contains pages currently in the viewport plus a few buffered pages.
   - What's unclear: Whether Syncfusion loads page divs well ahead of the viewport or on-demand.
   - Recommendation: Create only for pages in `syncfusionPageContainers`. This matches the "visible/loaded pages" scope. The create-once guard means they persist even after a page scrolls out of view, so scrolling back doesn't recreate them.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright ^1.58.2 |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test --config debug/playwright.config.mjs --grep "overlay"` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OVLY-01 | Overlay divs are direct children of `e-pv-page-div` elements with correct styling | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "overlay-attachment"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** Manual DevTools verification (inspect page div children, check data attributes and styles)
- **Per wave merge:** Playwright overlay attachment test
- **Phase gate:** Playwright test green + manual regression check (existing annotations still render)

### Wave 0 Gaps
- [ ] `debug/scenarios/overlay-attachment.spec.mjs` -- Playwright test covering OVLY-01: navigates to a page with annotations, waits for page load, verifies `[data-overlay-page]` elements exist as direct children of `.e-pv-page-div`, verifies correct CSS properties, verifies existing annotation canvases still render
- [ ] No framework install needed -- Playwright is already a project dependency

## Sources

### Primary (HIGH confidence)
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` -- Step 1 defines `attachOverlayToPageDiv()` function shape, overlay div styling, and what it replaces
- `src/App.jsx` lines 11980-12022 -- `resolveSyncfusionLivePageHost()` page div lookup pattern
- `src/App.jsx` lines 9010-9015 -- `syncfusionStablePortalHostsRef` persistent portal host pattern
- `src/App.jsx` lines 9620-9657 -- `ensureSyncfusionStablePortalChildren()` live root/snapshot host creation pattern
- `src/App.jsx` lines 24448-24460 -- Current stable portal host creation in render loop
- `src/components/SyncfusionPDFContainer.jsx` lines 198-254 -- `computePageContainerMap()` and MutationObserver page tracking

### Secondary (MEDIUM confidence)
- `src/App.jsx` lines 24330-24412 -- Render loop page filtering logic (freeze/window/overlay pages) -- provides context for what NOT to touch in Phase 1

### Tertiary (LOW confidence)
- None -- all findings verified directly from codebase and design spec

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, only existing patterns
- Architecture: HIGH -- design spec is prescriptive, existing code provides all patterns
- Pitfalls: HIGH -- identified from direct code reading and understanding of Syncfusion's page div lifecycle

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable -- codebase-specific, no external dependency changes expected)
