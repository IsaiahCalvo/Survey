/**
 * Debug Bridge Module
 *
 * Exposes `window.__debugBridge` with `snapshot()`, DOM mutation tracking via
 * ring buffer, and `debugMark()` for hot-path instrumentation.
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

// ── debugMark ───────────────────────────────────────────────────────────
// Centralized performance.mark() wrapper. Vite strips the function body
// in production via dead-code elimination on the import.meta.env.DEV guard.

export function debugMark(name, detail) {
  if (import.meta.env.DEV) {
    performance.mark(name, detail != null ? { detail } : undefined);
  }
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
  for (const mutation of mutations) {
    if (mutation.type !== 'childList') continue;

    const processNodes = (nodeList, type) => {
      for (const node of nodeList) {
        if (!node.classList?.contains('e-pv-page-div')) continue;

        const pageNumber = extractPageNumber(node);
        if (pageNumber == null) continue;

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
    if (typeof window !== 'undefined' && window.__debugBridge) {
      delete window.__debugBridge;
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
        visiblePages: state.visiblePages ?? []
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
    window.__debugBridge = { snapshot, debugMark };
  }
}
