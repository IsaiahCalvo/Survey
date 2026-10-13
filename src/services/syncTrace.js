// src/services/syncTrace.js
//
// Opt-in latency trace for live annotation sync (w30, 2026-09-24). Off unless
// something sets `globalThis.__SURVEY_SYNC_TRACE__` to an array (a test
// harness does it before the app loads). Each call then records one hop of a
// mark's trip from pointer-up in one tab to paint in another, on the shared
// wall clock (performance.timeOrigin + now), so two tabs' traces line up.
// When off it costs one global lookup.

const MAX_EVENTS = 5000;

export function syncTraceEnabled() {
  return Array.isArray(globalThis.__SURVEY_SYNC_TRACE__);
}

export function syncTrace(event, fields = null) {
  const sink = globalThis.__SURVEY_SYNC_TRACE__;
  if (!Array.isArray(sink)) return;
  const now = typeof performance !== 'undefined'
    ? performance.timeOrigin + performance.now()
    : Date.now();
  if (sink.length >= MAX_EVENTS) sink.splice(0, sink.length - MAX_EVENTS + 1);
  sink.push(fields ? { t: now, event, ...fields } : { t: now, event });
}
