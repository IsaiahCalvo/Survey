/**
 * loadTrace.js — always-on, copy-pasteable trace of the document-open lifecycle.
 *
 * Added to diagnose the "stuck on Loading…" hang: when the viewer freezes, the LAST
 * line in this trace is the step that stalled. Unlike the perf logger (gated behind a
 * debug flag), this is ALWAYS on and prints a clear, timestamped line per step. It also
 * persists the trace to localStorage so it survives a reload — after a hang you can
 * reload and still recover where it stalled.
 *
 * Share it: in the dev-tools console run
 *   __loadTrace()        → this load's trace (also auto-copies)
 *   __lastLoadTrace()    → the PREVIOUS session's trace (use after reloading a hung app)
 */

const PERSIST_KEY = 'surveyLoadTrace';
const PREV_KEY = 'surveyLoadTracePrev';
const MAX_LINES = 300;

const buffer = [];
let t0 = null;

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const persist = () => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PERSIST_KEY, JSON.stringify(buffer.slice(-MAX_LINES)));
  } catch { /* quota / unavailable — non-fatal */ }
};

/** Begin a fresh trace for a new document open. Rolls the prior trace into "previous". */
export const loadTraceReset = (label) => {
  try {
    if (typeof localStorage !== 'undefined' && buffer.length) {
      localStorage.setItem(PREV_KEY, JSON.stringify(buffer.slice(-MAX_LINES)));
    }
  } catch { /* non-fatal */ }
  buffer.length = 0;
  t0 = nowMs();
  loadTrace(`════ OPEN START ${label ? '— ' + label : ''}`);
};

/** Record one lifecycle step. Mirrors to the console immediately and persists. */
export const loadTrace = (stage, extra) => {
  const ms = t0 == null ? 0 : Math.round(nowMs() - t0);
  let line = `[LOAD-TRACE +${ms}ms] ${stage}`;
  if (extra !== undefined) {
    try { line += ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)); } catch { /* ignore */ }
  }
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  persist();
  try { console.log('%c' + line, 'color:#2196F3;font-weight:bold'); } catch { /* ignore */ }
  return line;
};


if (typeof window !== 'undefined') {
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); console.log('[LOAD-TRACE] copied to clipboard ✓'); }
    catch { /* clipboard may be unavailable; the text is already printed */ }
  };
  window.__loadTrace = () => { const t = buffer.join('\n'); console.log(t); copy(t); return t; };
  window.__lastLoadTrace = () => {
    let prev = '[]';
    try { prev = (typeof localStorage !== 'undefined' && localStorage.getItem(PREV_KEY)) || localStorage.getItem(PERSIST_KEY) || '[]'; } catch { /* ignore */ }
    let arr = [];
    try { arr = JSON.parse(prev); } catch { /* ignore */ }
    const t = arr.join('\n');
    console.log(t || '(no previous load trace)');
    copy(t);
    return t;
  };
  window.__clearLoadTrace = () => { buffer.length = 0; try { localStorage.removeItem(PERSIST_KEY); localStorage.removeItem(PREV_KEY); } catch { /* ignore */ } console.log('[LOAD-TRACE] cleared'); };
}
