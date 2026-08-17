// Lightweight global network logger. Wraps window.fetch and XMLHttpRequest with
// a thin observer that records each request's URL, method, status, duration, and
// any thrown error into a fixed-size ring buffer. The buffer is read at log-save
// time (Cmd+Shift+L) so we ship a network trace alongside the console output.
//
// Side-effects deliberately scoped to one-time install on app startup. The wrap
// is no-op safe (idempotent install guard) and degrades silently if window/fetch
// don't exist (test environments).

const RING_CAPACITY = 200;
const ring = [];
let installed = false;

function pushEntry(entry) {
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.shift();
}

function safeUrl(input) {
  try {
    if (typeof input === 'string') return input;
    if (input?.url) return String(input.url);
    return String(input);
  } catch {
    return '<unparseable>';
  }
}

export function installNetworkLogger() {
  if (installed) return;
  if (typeof window === 'undefined') return;

  // Expose the snapshot getter on window so the bulletproof Cmd+Shift+L
  // handler in main.jsx (which runs outside React) can grab the trace
  // without an import dependency on this module's exports.
  try { window.__networkLogSnapshot = () => ring.slice(); } catch (_e) { /* swallow */ }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function instrumentedFetch(input, init) {
      const startedAt = Date.now();
      const url = safeUrl(input);
      const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      try {
        const response = await originalFetch(input, init);
        pushEntry({
          source: 'fetch',
          url,
          method,
          status: response?.status ?? null,
          ok: !!response?.ok,
          durationMs: Date.now() - startedAt,
          startedAtIso: new Date(startedAt).toISOString(),
        });
        return response;
      } catch (err) {
        pushEntry({
          source: 'fetch',
          url,
          method,
          status: null,
          ok: false,
          durationMs: Date.now() - startedAt,
          startedAtIso: new Date(startedAt).toISOString(),
          error: err?.message || String(err),
        });
        throw err;
      }
    };
  }

  const XHR = window.XMLHttpRequest;
  if (typeof XHR === 'function') {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    XHR.prototype.open = function instrumentedOpen(method, url) {
      this.__netlog_method = String(method || 'GET').toUpperCase();
      this.__netlog_url = String(url || '');
      return originalOpen.apply(this, arguments);
    };
    XHR.prototype.send = function instrumentedSend(body) {
      const startedAt = Date.now();
      const url = this.__netlog_url || '';
      const method = this.__netlog_method || 'GET';
      const onSettle = (errorMessage) => {
        pushEntry({
          source: 'xhr',
          url,
          method,
          status: this.status || null,
          ok: this.status >= 200 && this.status < 400,
          durationMs: Date.now() - startedAt,
          startedAtIso: new Date(startedAt).toISOString(),
          error: errorMessage || undefined,
        });
      };
      this.addEventListener('loadend', () => onSettle(null));
      this.addEventListener('error', () => onSettle('xhr-error'));
      this.addEventListener('abort', () => onSettle('xhr-abort'));
      return originalSend.apply(this, arguments);
    };
  }

  installed = true;
}

// Returns a snapshot copy of the ring buffer, oldest first. Safe to call any
// time; does not affect future logging.
export function getNetworkLogSnapshot() {
  return ring.slice();
}


// Runtime helper for clearing the network ring buffer without uninstalling.
// Used by window.__resetAppDiagnostics so the next reload starts with a fully
// empty network trace.
export function clearNetworkLog() {
  ring.length = 0;
}

if (typeof window !== 'undefined') {
  // Combined dev/test reset. Clears the dual-write queues + test seam flags
  // (via the queue module's helper), wipes the console buffer + network ring,
  // then reloads the page. One paste, everything goes back to a clean slate.
  window.__resetAppDiagnostics = () => {
    try { window.__clearDualWriteQueue?.(); } catch {}
    try { if (Array.isArray(window.__consoleLogBuffer)) window.__consoleLogBuffer.length = 0; } catch {}
    clearNetworkLog();
    console.warn('[Diag] Reset console buffer + network log + dual-write queues + test flags. Reloading...');
    setTimeout(() => { try { window.location.reload(); } catch {} }, 80);
  };
}
