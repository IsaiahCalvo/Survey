# Phase 6: Debug Bridge + Readiness Signals - Research

**Researched:** 2026-03-12
**Domain:** Browser instrumentation, DOM mutation observation, async readiness signals, Vite compile-time guards
**Confidence:** HIGH

## Summary

Phase 6 adds three capabilities to the app: (1) a `window.__debugBridge` that exposes internal rendering state as flat JSON, (2) a `window.__debugReady` promise-based readiness signal system that Playwright can await, and (3) DOM mutation tracking for Syncfusion `e-pv-page-div` lifecycle events. All must be compile-time guarded via `import.meta.env.DEV` for zero production overhead.

The codebase already has established patterns for window globals (`window.pdfDebug`, `window.pdfPerf`, `window.__pdfHistoryDebug`, `window.__devTestPdf`), compile-time DEV guards, and a MutationObserver on the page layer container. The bridge consolidates these existing tools while adding the missing readiness signals and mutation tracking. The key challenge is wiring into App.jsx's ref-based state (a 1.3MB monolith) without altering timing-sensitive zoom behavior -- specifically the `shouldFreezePortalHost` computation and the 3000ms confirm-pending window.

**Primary recommendation:** Create a standalone `src/utils/debugBridge.js` module that reads existing refs/state via a registration pattern (App.jsx registers its refs once; bridge reads them on-demand), keeping bridge logic outside the monolith. Use `import.meta.env.DEV` guard at the module boundary and let Vite eliminate the entire module in production builds.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Layered architecture: `window.__debugBridge.snapshot()` returns lightweight core rendering state by default
- Optional enrichment via `snapshot({ include: ['perf', 'debug'] })` merges in pdfPerf timers and pdfDebug counters/rates
- Bridge is the single source of truth for all debug state capture
- Core snapshot includes per-visible-page 4-layer status: (1) Page visible from useVisiblePages, (2) Syncfusion e-pv-page-div exists in DOM, (3) PageAnnotationLayer React mounted, (4) Fabric.js canvas initialized
- Bridge stamps each snapshot with `sessionMs` via `performance.now()`
- Snapshot polling only -- no event subscription system
- Existing `window.pdfDebug`, `window.pdfPerf`, and `window.__pdfHistoryDebug` remain accessible but bridge consolidates them
- Promise-based public API: `window.__debugReady.waitFor(condition)` returns a Promise
- Four granular internal signals: `pdfLoaded`, `zoomSettled`, `domSettled`, `annotationsMounted`
- `waitFor('ready')` resolves only when ALL four signals are true
- Per-page targeting: `waitFor('annotationsMounted', { page: 6 })`
- Bridge-level timeout with state-in-rejection
- Fresh promise per `waitFor()` call: resolves on NEXT transition to settled; if already settled, resolves immediately
- Debounced settle detection: signals only flip to true after debounce period (50-100ms)
- Single root-level MutationObserver on Syncfusion viewer container with `{ childList: true, subtree: true }`
- Aggressive filtering: only record `e-pv-page-div` add/remove events
- Rich mutation records: `{ type, pageNumber, sessionMs, hasAnnotationLayer, hasFabricCanvas, seq, pairSeq }`
- Ring buffer storage (fixed size, e.g., last 100 mutations)
- Atomic drain operation: `snapshot({ drainMutations: true })`
- Cascading invalidation: MutationObserver IS the source of truth for `domSettled`; when `e-pv-page-div` is added/removed, `domSettled` flips to false AND `annotationsMounted` is immediately invalidated for that page
- Instrument ALL rendering events with `performance.mark()` via centralized `debugMark('category_event', { page: 6 })`
- Flat `category_event` naming convention
- Compile-time guarded via centralized function -- Vite dead-code elimination strips empty function body

### Claude's Discretion
- Ring buffer size (100 is a starting point -- tune based on testing)
- Default timeout value for waitFor() (reasonable default, configurable)
- Debounce period within 50-100ms range
- Exact MutationObserver target element selection (which container element to observe)
- How to wire readiness signals into existing App.jsx refs without restructuring the monolith
- Bridge module file location and internal architecture

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INST-01 | `window.__debugBridge` API exposes current zoom level, rendered scale, target scale, portal host count, freeze state, and canvas container count | Bridge reads from App.jsx refs: `scale`, `renderedScale`, `cssScale`, `zoomOverlayTransformActiveRef`, `syncfusionScaleConfirmPendingRef`, `syncfusionInteractionPortalHostsRef`, `syncfusionPageContainers` state, plus DOM query for `.canvas-container` elements |
| INST-02 | `window.__debugBridge.snapshot()` returns a flat, JSON-serializable object (no Fabric.js objects, no circular references) | All ref values are primitives/simple objects; deep-clone with `JSON.parse(JSON.stringify())` pattern already used by `pdfDebug.getDebugSnapshot()` |
| INST-03 | `window.__debugReady` exposes readiness signals: annotations rendered, zoom settled, page navigation complete | Four signals map to: `pdfLoaded` (document load event), `zoomSettled` (refs + useZoomState isZooming), `domSettled` (MutationObserver debounce), `annotationsMounted` (DOM query + cascading invalidation) |
| INST-04 | Debug bridge is compile-time guarded (`import.meta.env.DEV`) -- zero overhead in production | Vite statically replaces `import.meta.env.DEV` at build time; code inside `if (import.meta.env.DEV)` blocks is eliminated by esbuild minifier; pattern already proven in `src/main.jsx` and `src/DevTestRoute.jsx` |
| INST-05 | DOM mutation monitoring tracks Syncfusion `e-pv-page-div` container destroy/recreate events with timestamps, stored in state snapshots | MutationObserver on page layer container (`viewer.viewerBase.pageContainer` or `.e-pv-page-container`); existing observer pattern in `SyncfusionPDFContainer.jsx` line 311 proves approach; ring buffer stores last N mutations with `performance.now()` timestamps |
| INST-06 | Instrumentation uses `performance.mark()` (0.01ms) not `console.log` in hot paths to avoid altering timing-sensitive race conditions | `performance.mark(name, { detail })` widely supported in Chromium; centralized `debugMark()` function compiles to empty function body in production via Vite dead-code elimination |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `performance.mark()` / `performance.now()` | Web API (Chromium 86+) | Timing marks in hot paths, session timestamps | Native browser API; 0.01ms overhead per call; no imports needed; detail parameter supports structured metadata |
| `MutationObserver` | Web API | Track Syncfusion `e-pv-page-div` lifecycle | Native browser API; already used in project (SyncfusionPDFContainer.jsx:311); efficient callback batching by browser |
| `import.meta.env.DEV` | Vite built-in | Compile-time guard for zero production overhead | Static replacement at build time; esbuild eliminates dead branches; proven pattern in this codebase |

### Supporting (Existing -- consumed by bridge)
| Library | Version | Purpose | Integration |
|---------|---------|---------|-------------|
| `window.pdfDebug` | Existing | Counters, event rates, presence status | Bridge delegates via `snapshot({ include: ['debug'] })` calling `getDebugSnapshot()` |
| `window.pdfPerf` | Existing | Timer/mark/summary metrics | Bridge delegates via `snapshot({ include: ['perf'] })` calling `getSummary()` |
| `window.__pdfHistoryDebug` | Existing | Undo/redo debug state | Available but not merged into bridge by default |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `performance.mark()` | `console.log` | console.log is 10-100x slower and causes observer effects in timing-sensitive code; marks are collected passively |
| Custom Promise system | EventTarget/CustomEvent | Promises are simpler for one-shot "wait for condition"; EventTarget better for ongoing subscriptions (not needed per CONTEXT.md decision: polling only) |
| Per-page MutationObserver | Single root observer | Per-page observers cause memory leaks when Syncfusion destroys/recreates page divs in its virtualizer; single root observer with subtree:true + filtering is safer (CONTEXT.md locked decision) |

## Architecture Patterns

### Recommended Project Structure
```
src/
  utils/
    debugBridge.js        # Bridge module: snapshot(), waitFor(), mutation tracking, debugMark()
    pdfDebug.js           # Existing -- bridge reads from this
    performanceLogger.js  # Existing -- bridge reads from this
  App.jsx                 # Registers refs with bridge via debugBridge.register()
  PageAnnotationLayer.jsx # Calls debugMark() at mount/unmount/renderAll
  components/
    SyncfusionPDFContainer.jsx  # Bridge attaches MutationObserver here
```

### Pattern 1: Registration Pattern for Ref Access
**What:** App.jsx calls `debugBridge.register({ refs, state, hooks })` once during initialization. Bridge reads registered refs on-demand during `snapshot()` -- never stores stale copies.
**When to use:** When a module needs to read React refs from a monolith without receiving them as props.
**Why:** Avoids prop drilling through the 1.3MB App.jsx. Bridge reads `.current` at snapshot time, always getting fresh values. No risk of stale closures.

```javascript
// In debugBridge.js
let registered = null;

export function register(sources) {
  registered = sources;
}

export function snapshot(options = {}) {
  if (!registered) return null;
  const { refs, getState } = registered;

  return {
    sessionMs: performance.now(),
    zoomLevel: refs.scale?.current ?? null,
    renderedScale: getState('renderedScale'),
    targetScale: getState('targetScale'),
    portalHostCount: Object.keys(refs.portalHosts?.current || {}).length,
    freezeState: refs.zoomOverlayTransformActive?.current || refs.scaleConfirmPending?.current,
    canvasContainerCount: document.querySelectorAll('.canvas-container').length,
    // Per-page 4-layer status...
  };
}
```

### Pattern 2: Debounced Signal State Machine
**What:** Each readiness signal tracks a boolean state that flips to `false` immediately on invalidation but only flips to `true` after a debounce period of inactivity. Cascading invalidation: `domSettled=false` also sets `annotationsMounted=false` for affected pages.
**When to use:** For the four readiness signals (`pdfLoaded`, `zoomSettled`, `domSettled`, `annotationsMounted`).
**Why:** Prevents false positives from Syncfusion's intermediate layout passes during zoom where DOM elements flicker in/out.

```javascript
// Signal state machine (simplified)
const signals = {
  pdfLoaded: false,
  zoomSettled: false,
  domSettled: false,
  annotationsMounted: false,  // per-page tracked internally
};

const debounceTimers = {};

function invalidateSignal(name, pageNumber = null) {
  signals[name] = false;
  clearTimeout(debounceTimers[name]);

  // Cascading invalidation
  if (name === 'domSettled' && pageNumber != null) {
    invalidateSignal('annotationsMounted', pageNumber);
  }

  // Notify pending waitFor() promises
  checkPendingWaiters();
}

function settleSignal(name, debounceMs = 75) {
  clearTimeout(debounceTimers[name]);
  debounceTimers[name] = setTimeout(() => {
    signals[name] = true;
    checkPendingWaiters();
  }, debounceMs);
}
```

### Pattern 3: Ring Buffer for Mutation Records
**What:** Fixed-size circular array that overwrites oldest entries when full. Supports atomic drain (read + clear in one call).
**When to use:** Storing DOM mutation records where unbounded growth is unacceptable.
**Why:** Syncfusion fires 150+ mutations during fast scroll/zoom. Unbounded arrays cause memory pressure; ring buffer caps at N entries.

```javascript
class RingBuffer {
  constructor(capacity = 100) {
    this.buffer = new Array(capacity);
    this.capacity = capacity;
    this.head = 0;
    this.size = 0;
    this.seq = 0;  // Global sequence counter
  }

  push(item) {
    item.seq = ++this.seq;
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  drain() {
    const items = this.toArray();
    this.head = 0;
    this.size = 0;
    return items;
  }

  toArray() {
    if (this.size === 0) return [];
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    // Wrap around: oldest is at head, newest is at head-1
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head)
    ];
  }
}
```

### Pattern 4: Compile-Time Guard with Centralized No-Op
**What:** Single `debugMark()` function that wraps `performance.mark()`. In DEV, it calls the real API. In production, Vite replaces the `import.meta.env.DEV` check and esbuild eliminates the dead branch, leaving an empty function that gets inlined away.
**When to use:** Every hot-path instrumentation point (zoom, portal freeze, PAL mount, Fabric.js render).
**Why:** Avoids sprinkling `if (import.meta.env.DEV)` at every callsite. Single function = single dead-code-elimination target.

```javascript
// In debugBridge.js
export function debugMark(name, detail = null) {
  if (import.meta.env.DEV) {
    performance.mark(name, detail != null ? { detail } : undefined);
  }
}
```

### Anti-Patterns to Avoid
- **Reading refs in a timer/interval instead of on-demand:** Creates stale snapshot risk and unnecessary CPU usage. Bridge should read refs synchronously inside `snapshot()`.
- **Storing Fabric.js canvas objects in snapshots:** Fabric objects have circular references. Only store primitive summaries (object count, canvas dimensions, initialized boolean).
- **Adding event listeners inside the bridge for zoom/scroll:** This would alter timing behavior (Heisenbug risk). Bridge passively reads state; only the MutationObserver is an active listener, and it already exists in the codebase.
- **Using `setTimeout(0)` for debounce:** Too coarse. Use actual ms values (50-100ms as specified) for settle detection.
- **Making waitFor() resolve on current state without re-checking:** Race condition. If state changes between the check and the resolve, Playwright acts on stale data. Debounce ensures true settle.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Performance timing | Custom Date.now() tracking | `performance.mark()` + `performance.now()` | Native API is microsecond-precision, zero allocation, queryable via Performance Timeline API; Phase 7 captures via CDP |
| DOM change detection | Polling with setInterval | `MutationObserver` | Native API, browser-batched callbacks, no polling overhead, already used in this project |
| Promise coordination | Custom callback chains | Native `Promise` + `resolve`/`reject` stored as references | Standard pattern for deferred resolution; no library needed |
| Circular buffer | Array.push + Array.shift | RingBuffer class (see pattern above) | Array.shift is O(n) for reindexing; ring buffer is O(1) for both push and oldest-eviction |
| JSON serialization safety | Manual object traversal | `JSON.parse(JSON.stringify())` with try/catch | Already used in `pdfDebug.js` clone function; catches circular references; simple |

**Key insight:** Every tool needed for this phase is a native browser API. No npm packages required. The complexity is in wiring into the existing monolith's state, not in the instrumentation APIs themselves.

## Common Pitfalls

### Pitfall 1: Heisenbug -- Instrumentation Alters Timing
**What goes wrong:** Adding `console.log`, `setState`, or heavy callbacks in zoom/render paths changes timing enough to mask or create race conditions.
**Why it happens:** The zoom bug (fixed in v1.0) involves 50-200ms timing gaps between CSS transform removal and Fabric.js repaint. Any delay >10ms in the hot path can shift the race window.
**How to avoid:** Use `performance.mark()` (0.01ms overhead) for hot paths. The `debugMark()` function compiles to nothing in production. For bridge reads, only query refs -- never set them.
**Warning signs:** Tests pass with instrumentation enabled but fail without it (or vice versa). Zoom flicker appears/disappears when adding debug code.

### Pitfall 2: MutationObserver Callback Storm
**What goes wrong:** MutationObserver fires synchronously after DOM mutations. During Syncfusion's zoom reflow, 150+ mutations fire in rapid succession. Heavy callback processing blocks the main thread.
**Why it happens:** Syncfusion virtualizer destroys and recreates multiple page containers during zoom. Each destroy + recreate fires a mutation.
**How to avoid:** Keep callback minimal: extract page number, check if target has `e-pv-page-div` class, push to ring buffer, update `domSettled` signal. No DOM queries, no state updates beyond the signal flip.
**Warning signs:** Long tasks in Performance profiler traced to MutationObserver callback.

### Pitfall 3: Stale Ref Values in Closures
**What goes wrong:** Bridge captures ref values at registration time instead of reading `.current` at snapshot time, returning stale data.
**Why it happens:** JavaScript closure captures the value, not the reference. If you do `const val = ref.current` in register(), the value is frozen.
**How to avoid:** Always read `.current` inside `snapshot()`, never in `register()`. Registration stores the ref object itself, not its value.
**Warning signs:** `snapshot()` returns the same zoom level regardless of actual zoom changes.

### Pitfall 4: Promise Memory Leak in waitFor()
**What goes wrong:** Unresolved promises from `waitFor()` calls that are never satisfied accumulate, keeping their closures alive.
**Why it happens:** If Playwright calls `waitFor('annotationsMounted')` and then navigates away, the promise resolver is never called but the closure stays in memory.
**How to avoid:** Implement the "fresh promise per call" pattern from CONTEXT.md: previous unresolved promises reject with 'superseded' when a new `waitFor()` is called for the same condition. Also honor the timeout -- timeout rejection clears the resolver.
**Warning signs:** Memory grows over repeated test runs without page refresh.

### Pitfall 5: MutationObserver Target Selection
**What goes wrong:** Attaching observer to wrong DOM element causes either missed mutations or observing too many irrelevant mutations.
**Why it happens:** Syncfusion has nested containers: `.e-pv-viewer-container` > `.e-pv-page-container` > `.e-pv-page-div[data-page-number=N]`. Observing too high misses page-div-specific mutations; observing too low misses page destruction.
**How to avoid:** Observe `.e-pv-page-container` (the page layer container) with `{ childList: true, subtree: true }`. This is the same element `SyncfusionPDFContainer.jsx` already observes (line 311). Filter callback to only process nodes matching `.e-pv-page-div`.
**Warning signs:** Zero mutations recorded during zoom (wrong target) or thousands of irrelevant mutations (target too broad).

### Pitfall 6: Detecting annotationsMounted Across Virtualizer
**What goes wrong:** Checking if annotations are mounted on "all pages" when Syncfusion only keeps a few pages in DOM at a time.
**Why it happens:** Syncfusion PDF viewer virtualizes pages -- only visible pages + small buffer have actual DOM elements. Checking all pages would always fail for off-screen pages.
**How to avoid:** Per-page tracking: `annotationsMounted` status is checked against visible pages only (from `useVisiblePages` hook). The per-page `waitFor('annotationsMounted', { page: 6 })` API naturally handles this. Default (no page param) checks all currently visible pages.
**Warning signs:** `waitFor('annotationsMounted')` never resolves because off-screen pages don't have PAL/Fabric.js.

## Code Examples

### Existing Pattern: Window Global Registration (from App.jsx)
```javascript
// Source: src/App.jsx line 13735
// This pattern shows how window globals are created and cleaned up in effects
useEffect(() => {
  const api = {
    dump() { return getHistoryDebugRows(); },
    state() {
      return {
        consoleEnabled: historyDebugConsoleRef.current,
        undoDepth: undoHistoryRef.current.length,
        // ...
      };
    }
  };
  window.__pdfHistoryDebug = api;
  return () => {
    if (window.__pdfHistoryDebug === api) {
      delete window.__pdfHistoryDebug;
    }
  };
}, [getHistoryDebugRows]);
```

### Existing Pattern: Compile-Time DEV Guard (from main.jsx)
```javascript
// Source: src/main.jsx line 43
// Vite replaces import.meta.env.DEV with false in production builds
// esbuild eliminates the entire block as dead code
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  const testPdf = params.get('testPdf');
  if (testPdf) {
    devRouteActive = true;
    import('./DevTestRoute').then(({ DevTestRoute }) => {
      createRoot(document.getElementById('root')).render(
        <DevTestRoute pdfName={testPdf} />
      );
    });
  }
}
```

### Existing Pattern: MutationObserver on Page Layer (from SyncfusionPDFContainer.jsx)
```javascript
// Source: src/components/SyncfusionPDFContainer.jsx line 305-317
const connectPageObserver = useCallback(() => {
  disconnectPageObserver();
  const pageLayer = getPageLayerContainer(); // .e-pv-page-container
  if (!pageLayer) return;
  const observer = new MutationObserver(() => {
    emitDebugEvent('page_container_mutation');
    requestPageContainerRefresh('mutation');
  });
  observer.observe(pageLayer, { childList: true });
  pageObserverRef.current = observer;
}, [/* deps */]);
```

### Key Refs in App.jsx That Bridge Needs
```javascript
// Source: src/App.jsx lines 9003-9191
const zoomOverlayTransformActiveRef = useRef(false);      // line 9003
const syncfusionLastNonEmptyOverlayPagesRef = useRef([]); // line 9013
const syncfusionScaleConfirmPendingRef = useRef(false);    // line 9162
const syncfusionInteractionPortalHostsRef = useRef({});    // line 9191

// From useZoomState hook (line 9130):
const { renderedScale, cssScale, isZooming, zoomStyle, setAnchor } = useZoomState(scale);
// Note: renderedScale and cssScale are state values, not refs.
// Bridge needs App.jsx to expose these via a getter function.

// shouldFreezePortalHost computation (line 23521):
const shouldFreezePortalHost = (
  (useLiveStableOverlay || isZoomOnlyInteraction) && isInInteraction
) || zoomOverlayTransformActiveRef.current || syncfusionScaleConfirmPendingRef.current;
```

### Fabric.js Canvas Initialization (PAL mount detection point)
```javascript
// Source: src/PageAnnotationLayer.jsx line 5094
const canvas = new Canvas(canvasRef.current, {
  width: Math.floor(width * scale),
  height: Math.floor(height * scale),
  backgroundColor: 'transparent',
  // ... options
});
fabricRef.current = canvas;
// After this line, Fabric.js canvas is initialized for this page
// Bridge can detect this by: checking if .canvas-container exists inside the page div
// OR by having PAL call debugMark('fabric_init', { page: pageNumber }) here
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `console.log` in hot paths | `performance.mark()` with detail | Chrome 96+ (detail param) | Zero observer effects; marks collected passively via Performance Timeline |
| Per-page MutationObserver | Single root observer + subtree | Best practice | Avoids memory leaks from observers on destroyed DOM nodes |
| Callback-based readiness | Promise-based `waitFor()` | ES2015+, standard | Natural fit with Playwright's `page.evaluate()` which supports promise return |
| `Date.now()` timestamps | `performance.now()` sessionMs | Widely available | Microsecond precision, monotonic (no clock drift), aligns with performance marks |

**Deprecated/outdated:**
- `MutationEvents` (deprecated): Replaced by `MutationObserver`. Not relevant here but worth noting.
- `performance.timing` (deprecated): Replaced by `PerformanceNavigationTiming`. Not relevant to this phase.

## Discretion Recommendations

### Ring Buffer Size: 100 entries (start), configurable
**Rationale:** During a 5-step zoom operation, Syncfusion fires roughly 30-50 mutations. A buffer of 100 holds 2-3 zoom operations worth of history. If Phase 7 testing shows data loss, increase to 200. Expose as constructor parameter.

### Default waitFor() Timeout: 10000ms (10 seconds)
**Rationale:** The smoke test (Phase 5) uses 5000ms conservative waits. Syncfusion cold-start on page navigation can take 3-5s. With readiness signals, the actual wait should be much shorter, but the timeout needs headroom for worst-case. Match with a configurable option: `waitFor('ready', { timeout: 15000 })`.

### Debounce Period: 75ms
**Rationale:** Split the difference in the 50-100ms range. Syncfusion's intermediate layout passes during zoom complete within ~30-50ms. A 75ms debounce ensures we wait past the last intermediate pass but don't add perceptible delay to test execution.

### MutationObserver Target: `.e-pv-page-container` (page layer container)
**Rationale:** This is the direct parent of `e-pv-page-div` elements. Already used by `SyncfusionPDFContainer.jsx` for its existing observer (line 307-311). Observing with `{ childList: true, subtree: true }` catches both direct child adds/removes (page divs) and deeper changes. Filter callback checks `node.classList?.contains('e-pv-page-div')` to ignore noise.

**How to obtain the element:** Use the same resolution chain as `getPageLayerContainer()`:
```javascript
viewer?.viewerBase?.pageContainer ||
viewer?.element?.querySelector('.e-pv-page-container')
```

### Wiring Into App.jsx: Registration + useEffect
**Rationale:** Add a single `useEffect` in App.jsx that calls `debugBridge.register()` with refs and a state-getter function. This is minimal intrusion -- one effect, one import (compile-time guarded). The effect cleanup calls `debugBridge.unregister()`.

```javascript
// In App.jsx, near other window global effects (~line 13735)
useEffect(() => {
  if (!import.meta.env.DEV) return;
  const { register, unregister } = require('./utils/debugBridge');
  // Or: dynamic import pattern
  register({
    refs: {
      zoomOverlayTransformActive: zoomOverlayTransformActiveRef,
      scaleConfirmPending: syncfusionScaleConfirmPendingRef,
      portalHosts: syncfusionInteractionPortalHostsRef,
      lastNonEmptyOverlayPages: syncfusionLastNonEmptyOverlayPagesRef,
    },
    getState: () => ({
      renderedScale,
      cssScale,
      isZooming,
      scale,
      pageNum,
      visiblePages: Array.from(visiblePagesSet),
      syncfusionPageContainers,
    }),
  });
  return () => unregister();
}, [/* stable deps */]);
```

### Bridge Module Location: `src/utils/debugBridge.js`
**Rationale:** Consistent with existing utils (`pdfDebug.js`, `performanceLogger.js`). Single file keeps the module self-contained. All exports are compile-time guarded.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.x (from Phase 5) |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test debug/scenarios/smoke.spec.mjs --project=chromium` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INST-01 | `snapshot()` returns zoom level, rendered scale, target scale, portal host count, freeze state, canvas container count | integration | `npx playwright test debug/scenarios/bridge-snapshot.spec.mjs --project=chromium -x` | No -- Wave 0 |
| INST-02 | `snapshot()` returns flat JSON-serializable object | integration | Same as INST-01 (validate with `JSON.stringify` round-trip) | No -- Wave 0 |
| INST-03 | `waitFor()` readiness signals: annotations rendered, zoom settled, page navigation complete | integration | `npx playwright test debug/scenarios/readiness-signals.spec.mjs --project=chromium -x` | No -- Wave 0 |
| INST-04 | Bridge compile-time guarded, zero production overhead | unit (build check) | `npx vite build && grep -c '__debugBridge' dist/assets/*.js` (expect 0) | No -- Wave 0 |
| INST-05 | DOM mutation monitoring tracks e-pv-page-div events with timestamps | integration | `npx playwright test debug/scenarios/mutation-tracking.spec.mjs --project=chromium -x` | No -- Wave 0 |
| INST-06 | `performance.mark()` in hot paths, zero production overhead | integration + build check | Combined with INST-01 test + build grep for `debugMark` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** Quick smoke test: `npx playwright test debug/scenarios/smoke.spec.mjs --project=chromium`
- **Per wave merge:** Full suite: `npx playwright test --config debug/playwright.config.mjs`
- **Phase gate:** All bridge + readiness tests green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `debug/scenarios/bridge-snapshot.spec.mjs` -- covers INST-01, INST-02: load PDF, call `window.__debugBridge.snapshot()`, assert all required fields present and JSON-serializable
- [ ] `debug/scenarios/readiness-signals.spec.mjs` -- covers INST-03: load PDF, navigate to page 6, verify `window.__debugReady.waitFor('ready')` resolves, verify `waitFor('annotationsMounted', { page: 6 })` resolves
- [ ] `debug/scenarios/mutation-tracking.spec.mjs` -- covers INST-05: load PDF, trigger zoom, verify `snapshot({ drainMutations: true })` returns mutation records with pageNumber and sessionMs
- [ ] Build check script for INST-04/INST-06: run `vite build`, verify `__debugBridge` and `debugMark` do not appear in production bundle

## Open Questions

1. **How to expose `renderedScale` and `cssScale` from useZoomState to bridge?**
   - What we know: These are React state values, not refs. App.jsx destructures them from `useZoomState(scale)` at line 9130.
   - What's unclear: Whether to pass them via the `getState()` getter in `register()` (re-registers on every render) or create a dedicated ref that mirrors the state.
   - Recommendation: Use the `getState()` getter pattern. The bridge calls `getState()` inside `snapshot()`, which always returns current values. The `register()` call does need to re-run when the getter closure updates, but since it just swaps a reference, this is O(1) with zero overhead. Alternatively, add a `useRef` that mirrors `renderedScale`/`cssScale` and register that ref once.

2. **Should the bridge observer coexist with SyncfusionPDFContainer's existing observer?**
   - What we know: `SyncfusionPDFContainer.jsx` already has a MutationObserver on `.e-pv-page-container` with `{ childList: true }` (no subtree). The bridge needs `{ childList: true, subtree: true }` to catch deeper adds/removes.
   - What's unclear: Whether two MutationObservers on the same target cause any performance issue.
   - Recommendation: Two observers on the same target is fine -- the browser batches mutations and delivers them to each observer's callback independently. This avoids modifying the existing observer in SyncfusionPDFContainer which could introduce regressions. The bridge observer is DEV-only so production is unaffected.

3. **When exactly does the bridge get the Syncfusion viewer reference for observer attachment?**
   - What we know: Syncfusion viewer is rendered inside SyncfusionPDFContainer which uses `useImperativeHandle` to expose methods.
   - What's unclear: The exact timing of when `.e-pv-page-container` first appears in DOM.
   - Recommendation: Bridge should lazily attach the observer -- on first `snapshot()` call or via explicit `init()` call from App.jsx after viewer is ready. Include a `MutationObserver` on the viewer container itself to detect when `.e-pv-page-container` appears if needed.

## Sources

### Primary (HIGH confidence)
- Project source files: `src/utils/pdfDebug.js`, `src/utils/performanceLogger.js`, `src/App.jsx`, `src/PageAnnotationLayer.jsx`, `src/components/SyncfusionPDFContainer.jsx`, `src/hooks/useVisiblePages.js`, `src/hooks/useZoomState.js`, `src/main.jsx`, `src/DevTestRoute.jsx`
- [Vite Env Variables and Modes](https://vite.dev/guide/env-and-mode) -- static replacement of `import.meta.env.DEV`, dead code elimination
- [MDN: performance.mark()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/mark) -- detail parameter, browser compatibility
- [MDN: MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) -- observe options, callback behavior

### Secondary (MEDIUM confidence)
- [Vite GitHub Issue #10886](https://github.com/vitejs/vite/issues/10886) -- confirms dead-code elimination pattern for DEV-guarded functions
- [Chrome DevTools Performance Extensibility](https://developer.chrome.com/docs/devtools/performance/extension) -- performance.mark detail with devtools metadata for custom tracks

### Tertiary (LOW confidence)
- None -- all critical findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all APIs are native browser Web APIs already used in the project; no new dependencies
- Architecture: HIGH -- registration pattern, ring buffer, and compile-time guards are straightforward; integration points verified against actual source code
- Pitfalls: HIGH -- Heisenbug risk, MutationObserver storms, and stale ref patterns are documented from the project's own zoom-fix history (STATE.md)
- Readiness signals: MEDIUM -- promise-based waitFor() with debounced settle detection is well-understood but the cascading invalidation pattern needs careful implementation and testing

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable -- native Web APIs, no library version concerns)
