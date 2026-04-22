/**
 * Debug Bridge Module
 *
 * Exposes `window.__debugBridge` with `snapshot()`, DOM mutation tracking via
 * ring buffer, and `debugMark()` for hot-path instrumentation.
 *
 * Also exposes `window.__debugReady` with `waitFor()` promise-based readiness
 * signal system. Four signals: pdfLoaded, zoomSettled, domSettled,
 * annotationsMounted. Cascading invalidation ensures Playwright waits for
 * full DOM settle + React/Fabric.js remount before proceeding.
 *
 * Everything is compile-time guarded via `import.meta.env.DEV`.
 * Vite dead-code-eliminates all function bodies in production builds,
 * leaving zero overhead.
 */

// ── RingBuffer ──────────────────────────────────────────────────────────
// Fixed-capacity circular array for storing DOM mutation records.
// Overwrites oldest entries when full. Supports atomic drain (read + clear).

class RingBuffer {
  constructor(capacity = 100) {
    this.buffer = new Array(capacity);
    this.capacity = capacity;
    this.head = 0;
    this.size = 0;
    this.seq = 0;
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

// ── Module-level state ──────────────────────────────────────────────────

let registered = null;
let mutationObserver = null;
const mutationBuffer = new RingBuffer(100);

// ── Readiness Signal State ──────────────────────────────────────────────
// Four signals tracked for the waitFor() system. zoomSettled and domSettled
// start true because no zoom/mutation is in progress at init.

const signals = {
  pdfLoaded: false,
  zoomSettled: true,
  domSettled: true,
  annotationsMounted: false,
};

const perPageAnnotationStatus = {};
const debounceTimers = {};
const DEBOUNCE_MS = 75;
const DEFAULT_TIMEOUT_MS = 10000;

// Pending waitFor() promises: array of { condition, page, resolve, reject, startMs, timeoutId }
const pendingWaiters = [];

// ── Signal Management ───────────────────────────────────────────────────

function getDomVisiblePages() {
  // Query the DOM directly for page divs that have data-page-number set.
  // This avoids relying on potentially stale React state (visiblePages from
  // useVisiblePages can lag behind actual DOM after Syncfusion page navigation).
  const pageDivs = document.querySelectorAll('.e-pv-page-div[data-page-number]');
  const pages = [];
  for (const div of pageDivs) {
    const num = Number(div.dataset.pageNumber);
    if (Number.isFinite(num) && num > 0) pages.push(num);
  }
  return pages;
}

function isConditionMet(condition, page) {
  if (condition === 'ready') {
    if (!signals.pdfLoaded || !signals.zoomSettled || !signals.domSettled || !signals.annotationsMounted) {
      return false;
    }
    if (page != null) {
      return perPageAnnotationStatus[page] === true;
    }
    // All DOM-present pages with canvas containers must be tracked as mounted
    const domPages = getDomVisiblePages();
    if (domPages.length === 0) return false;
    // Only check pages that have canvas containers (PAL-rendered pages)
    const pagesWithCanvas = domPages.filter(p => {
      const div = document.querySelector(`.e-pv-page-div[data-page-number="${p}"]`);
      return div && div.querySelector('.canvas-container');
    });
    if (pagesWithCanvas.length === 0) return false;
    return pagesWithCanvas.every(p => perPageAnnotationStatus[p] === true);
  }

  if (condition === 'annotationsMounted') {
    if (page != null) {
      return perPageAnnotationStatus[page] === true;
    }
    // Check DOM-present pages that have canvas containers
    const domPages = getDomVisiblePages();
    if (domPages.length === 0) return false;
    const pagesWithCanvas = domPages.filter(p => {
      const div = document.querySelector(`.e-pv-page-div[data-page-number="${p}"]`);
      return div && div.querySelector('.canvas-container');
    });
    if (pagesWithCanvas.length === 0) return false;
    return pagesWithCanvas.every(p => perPageAnnotationStatus[p] === true);
  }

  // Single signal check: pdfLoaded, zoomSettled, domSettled
  return signals[condition] === true;
}

function checkPendingWaiters() {
  for (let i = pendingWaiters.length - 1; i >= 0; i--) {
    const waiter = pendingWaiters[i];
    if (isConditionMet(waiter.condition, waiter.page)) {
      const waitMs = performance.now() - waiter.startMs;
      clearTimeout(waiter.timeoutId);
      pendingWaiters.splice(i, 1);
      waiter.resolve({
        condition: waiter.condition,
        signals: { ...signals },
        perPageAnnotationStatus: { ...perPageAnnotationStatus },
        waitMs,
      });
    }
  }
}

function invalidateSignal(name, pageNumber) {
  signals[name] = false;
  clearTimeout(debounceTimers[name]);

  // Cascading invalidation: domSettled invalidation also invalidates
  // annotationsMounted for the affected page
  if (name === 'domSettled' && pageNumber != null) {
    perPageAnnotationStatus[pageNumber] = false;
    signals.annotationsMounted = false;
    clearTimeout(debounceTimers.annotationsMounted);
  }

  checkPendingWaiters();
}

function settleSignal(name, debounceMs) {
  const delay = debounceMs != null ? debounceMs : DEBOUNCE_MS;
  clearTimeout(debounceTimers[name]);

  if (delay === 0) {
    signals[name] = true;
    checkPendingWaiters();
    return;
  }

  debounceTimers[name] = setTimeout(() => {
    signals[name] = true;
    checkPendingWaiters();
  }, delay);
}

function checkPageAnnotationComplete(pageNumber) {
  // Check if the page has Fabric.js canvas (created by PAL after mount).
  // Fabric.js wraps the PAL's <canvas> element in a .canvas-container div,
  // so its presence proves both PAL mounted AND Fabric.js initialized.
  const pageDiv = document.querySelector(
    `.e-pv-page-div[data-page-number="${pageNumber}"]`
  );
  if (!pageDiv) return false;

  return !!pageDiv.querySelector('.canvas-container');
}

function markPageAnnotationMounted(pageNumber) {
  if (!checkPageAnnotationComplete(pageNumber)) return;

  perPageAnnotationStatus[pageNumber] = true;

  // Check if ALL DOM-present pages with canvas containers have annotations tracked
  const domPages = getDomVisiblePages();
  const pagesWithCanvas = domPages.filter(p => {
    const div = document.querySelector(`.e-pv-page-div[data-page-number="${p}"]`);
    return div && div.querySelector('.canvas-container');
  });
  if (pagesWithCanvas.length > 0 && pagesWithCanvas.every(p => perPageAnnotationStatus[p] === true)) {
    settleSignal('annotationsMounted');
  }
}

// ── debugMark ───────────────────────────────────────────────────────────
// Centralized performance.mark() wrapper. Vite strips the function body
// in production via dead-code elimination on the import.meta.env.DEV guard.
// Also triggers readiness signal updates based on mark name.

export function debugMark(name, detail) {
  if (import.meta.env.DEV) {
    performance.mark(name, detail != null ? { detail } : undefined);
    // Temporary: log to console with timestamps for zoom lifecycle timing
    const t = performance.now().toFixed(1);
    console.log(`[DebugBridge +${t}ms] ${name}`, detail ?? '');

    // Wire marks into readiness signals
    switch (name) {
      case 'pdf_loaded':
        settleSignal('pdfLoaded', 0);
        break;

      case 'zoom_start':
        invalidateSignal('zoomSettled');
        break;

      case 'zoom_end':
        settleSignal('zoomSettled');
        break;

      case 'pal_mount':
        if (detail?.page != null) {
          // Defer check slightly so DOM is fully settled
          setTimeout(() => markPageAnnotationMounted(detail.page), 10);
        }
        break;

      case 'fabric_renderEnd':
        if (detail?.page != null) {
          // Defer check slightly so DOM is fully settled
          setTimeout(() => markPageAnnotationMounted(detail.page), 10);
        }
        break;

      case 'pal_unmount':
        if (detail?.page != null) {
          perPageAnnotationStatus[detail.page] = false;
          signals.annotationsMounted = false;
          clearTimeout(debounceTimers.annotationsMounted);
        }
        break;

      default:
        break;
    }
  }
}

// ── waitFor ─────────────────────────────────────────────────────────────
// Promise-based readiness signal system. Resolves when condition is met.
// Rejects on timeout with descriptive error including current signal state.

export function waitFor(condition, options) {
  if (import.meta.env.DEV) {
    const opts = options || {};
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    const page = opts.page ?? null;

    // Validate condition
    const validConditions = ['ready', 'pdfLoaded', 'zoomSettled', 'domSettled', 'annotationsMounted'];
    if (!validConditions.includes(condition)) {
      return Promise.reject(new Error(`Invalid condition: ${condition}. Valid: ${validConditions.join(', ')}`));
    }

    // Check if already satisfied
    if (isConditionMet(condition, page)) {
      return Promise.resolve({
        condition,
        signals: { ...signals },
        perPageAnnotationStatus: { ...perPageAnnotationStatus },
        waitMs: 0,
      });
    }

    // Create pending waiter
    return new Promise((resolve, reject) => {
      const startMs = performance.now();

      // Supersede existing waiter for same condition+page
      for (let i = pendingWaiters.length - 1; i >= 0; i--) {
        const existing = pendingWaiters[i];
        if (existing.condition === condition && existing.page === page) {
          clearTimeout(existing.timeoutId);
          pendingWaiters.splice(i, 1);
          existing.reject(new Error('superseded'));
        }
      }

      const timeoutId = setTimeout(() => {
        // Remove this waiter
        const idx = pendingWaiters.findIndex(w => w.timeoutId === timeoutId);
        if (idx !== -1) pendingWaiters.splice(idx, 1);

        const elapsed = performance.now() - startMs;
        reject(new Error(
          `Timeout waiting for ${condition}. Current state: ${JSON.stringify({
            signals,
            perPageAnnotationStatus,
            elapsed: Math.round(elapsed),
          })}`
        ));
      }, timeout);

      pendingWaiters.push({
        condition,
        page,
        resolve,
        reject,
        startMs,
        timeoutId,
      });
    });
  }
  return Promise.resolve(null);
}

// ── MutationObserver setup ──────────────────────────────────────────────

function extractPageNumber(node) {
  // Try data-page-number attribute first
  const dataPageNum = node.dataset?.pageNumber;
  if (dataPageNum != null) return Number(dataPageNum);

  // Fall back to ID parsing: e.g. "viewer_pageDiv_5" (0-indexed)
  const idMatch = node.id?.match(/_pageDiv_(\d+)$/);
  if (idMatch) return Number(idMatch[1]) + 1;

  return null;
}

function handleMutations(mutations) {
  let hadPageDivChanges = false;
  const affectedPages = new Set();

  for (const mutation of mutations) {
    if (mutation.type !== 'childList') continue;

    const processNodes = (nodeList, type) => {
      for (const node of nodeList) {
        if (!node.classList?.contains('e-pv-page-div')) continue;

        const pageNumber = extractPageNumber(node);
        if (pageNumber == null) continue;

        hadPageDivChanges = true;
        affectedPages.add(pageNumber);

        const hasAnnotationLayer = !!(
          node.querySelector('.annotation-layer') ||
          node.querySelector('[data-annotation-layer]')
        );
        const hasFabricCanvas = !!node.querySelector('.canvas-container');

        const record = {
          type,
          pageNumber,
          sessionMs: performance.now(),
          hasAnnotationLayer,
          hasFabricCanvas,
          pairSeq: null
        };

        // For 'removed' events, find the last 'added' record for this page
        // and link them via pairSeq for destroy-to-recreate gap analysis
        if (type === 'removed') {
          const existing = mutationBuffer.toArray();
          for (let i = existing.length - 1; i >= 0; i--) {
            if (existing[i].type === 'added' && existing[i].pageNumber === pageNumber) {
              record.pairSeq = existing[i].seq;
              existing[i].pairSeq = record.seq ?? (mutationBuffer.seq + 1);
              break;
            }
          }
        }

        mutationBuffer.push(record);
      }
    };

    processNodes(mutation.addedNodes, 'added');
    processNodes(mutation.removedNodes, 'removed');
  }

  // Wire mutations into readiness signals
  if (hadPageDivChanges) {
    for (const pageNumber of affectedPages) {
      invalidateSignal('domSettled', pageNumber);
    }
    // After processing all mutations in this batch, start settle timer
    settleSignal('domSettled');
  }
}

function attachObserver() {
  if (mutationObserver || !registered?.getPageLayerContainer) return false;

  const container = registered.getPageLayerContainer();
  if (!container) return false;

  mutationObserver = new MutationObserver(handleMutations);
  mutationObserver.observe(container, { childList: true, subtree: true });
  return true;
}

function detachObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

// ── register / unregister ───────────────────────────────────────────────

export function register(sources) {
  if (import.meta.env.DEV) {
    registered = sources;

    // Attempt immediate observer attachment. If the container isn't in DOM
    // yet, lazy attachment happens on first snapshot() call.
    attachObserver();
  }
}

export function unregister() {
  if (import.meta.env.DEV) {
    detachObserver();
    registered = null;

    // Clear all pending waiters
    for (const waiter of pendingWaiters) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error('unregistered'));
    }
    pendingWaiters.length = 0;

    // Clear debounce timers
    for (const key of Object.keys(debounceTimers)) {
      clearTimeout(debounceTimers[key]);
      delete debounceTimers[key];
    }

    if (typeof window !== 'undefined') {
      if (window.__debugBridge) delete window.__debugBridge;
      if (window.__debugReady) delete window.__debugReady;
    }
  }
}

// ── snapshot ────────────────────────────────────────────────────────────

export function snapshot(options) {
  if (import.meta.env.DEV) {
    if (!registered) return null;

    const opts = options || {};
    const { refs, getState } = registered;

    // Lazy observer attachment (container may not have been in DOM at register time)
    if (!mutationObserver) {
      attachObserver();
    }

    const state = getState ? getState() : {};
    const sessionMs = performance.now();

    try {
      const result = {
        sessionMs,
        zoomLevel: refs?.scale?.current ?? state.scale ?? null,
        renderedScale: state.renderedScale ?? null,
        targetScale: state.cssScale ?? null,
        portalHostCount: Object.keys(refs?.portalHosts?.current || {}).length,
        freezeState: {
          zoomOverlayTransformActive: refs?.zoomOverlayTransformActive?.current ?? false,
          scaleConfirmPending: refs?.scaleConfirmPending?.current ?? false
        },
        canvasContainerCount: document.querySelectorAll('.canvas-container').length,
        isZooming: state.isZooming ?? false,
        currentPage: state.pageNum ?? null,
        visiblePages: state.visiblePages ?? [],
        signals: { ...signals },
        perPageAnnotationStatus: { ...perPageAnnotationStatus },
      };

      // Per-visible-page 4-layer status
      const visiblePages = state.visiblePages || [];
      result.pageStatus = visiblePages.map((page) => {
        const pageDiv = document.querySelector(
          `.e-pv-page-div[data-page-number="${page}"]`
        );
        const syncfusionDom = !!pageDiv;
        const palMounted = syncfusionDom
          ? !!(pageDiv.querySelector('.annotation-layer') || pageDiv.querySelector('[data-annotation-layer]'))
          : false;
        const fabricCanvas = syncfusionDom
          ? !!pageDiv.querySelector('.canvas-container')
          : false;

        return {
          page,
          visible: true,
          syncfusionDom,
          palMounted,
          fabricCanvas
        };
      });

      // Optional enrichment: include debug data from window.pdfDebug
      if (Array.isArray(opts.include)) {
        if (opts.include.includes('debug')) {
          const debugData = typeof window.pdfDebug?.dump === 'function'
            ? window.pdfDebug.dump()
            : typeof window.pdfDebug?.getDebugSnapshot === 'function'
              ? window.pdfDebug.getDebugSnapshot()
              : null;
          if (debugData) result.debug = debugData;
        }
        if (opts.include.includes('perf')) {
          const perfData = typeof window.pdfPerf?.getSummary === 'function'
            ? window.pdfPerf.getSummary()
            : null;
          if (perfData) result.perf = perfData;
        }
      }

      // Mutations: drain (read+clear) or peek (read only)
      if (opts.drainMutations === true) {
        result.mutations = mutationBuffer.drain();
      } else {
        result.mutations = mutationBuffer.toArray();
      }

      // Ensure JSON-serializability (catches circular refs, DOM nodes, etc.)
      return JSON.parse(JSON.stringify(result));
    } catch (err) {
      return { error: 'snapshot serialization failed', sessionMs, message: err?.message };
    }
  }
  return null;
}

// ── Window global setup ─────────────────────────────────────────────────
// Assigned at module import time so Playwright can access it immediately.

if (import.meta.env.DEV) {
  if (typeof window !== 'undefined') {
    window.__debugBridge = { snapshot, debugMark, waitFor };
    window.__debugReady = { waitFor };
  }
}
