/**
 * crashLog.js — a short, local record of every crash, for the owner to copy.
 *
 * Owner 2026-10-07: "the app keeps crashing ... I don't know if you're
 * detecting any of that". Nothing was kept. This keeps the last
 * CRASH_LOG_MAX crashes in this browser's localStorage (never sent anywhere —
 * a later "send to us" step can subscribe with onCrashRecorded; see
 * PROPOSED-CRASH-TABLE.md in the crash hunt notes) and Settings → Crash
 * reports shows them with a Copy button.
 *
 * What counts as a crash:
 *   react          the "Something went wrong" screen (ErrorBoundary)
 *   error          an uncaught error
 *   rejection      an unhandled promise rejection (network noise left out)
 *   freeze         the page did not respond for FREEZE_MS or more while on screen
 *   closed         the page vanished while on screen without closing (iOS
 *                  kills a page that uses too much memory; seen at next start)
 *   shell-reload   the phone app (Expo shell) saw the page's process die and
 *                  reloaded it (the shell's own note, merged into "closed")
 *
 * Each record: when, what (message + top of the stack), where (route without
 * query secrets), the last few things the person pressed (button names and
 * shortcut keys only, never typed text), memory figures and the build.
 */

export const CRASH_LOG_KEY = 'survey.crashReports.v1';
export const CRASH_LIVE_KEY = 'survey.crashReports.live.v1';
export const CRASH_LOG_MAX = 20;
export const BREADCRUMB_MAX = 12;
export const FREEZE_MS = 8000;
const LIVE_BEAT_MS = 4000;
// A live-session note older than this with no clean exit is a page that died.
const LIVE_DEAD_AFTER_MS = 12000;
// ...but not one from long ago (a laptop asleep for a week).
const LIVE_FORGET_AFTER_MS = 6 * 60 * 60 * 1000;
const DEDUPE_MS = 30000;
const ROUTE_KEYS = ['mobileNav', 'nativeShell', 'tab', 'view'];

const listeners = new Set();
const state = {
  installed: false,
  sessionId: null,
  breadcrumbs: [],
  build: 'unknown',
  storage: null,
  lastBeatWrite: 0,
};

function defaultStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
function store() { return state.storage || defaultStorage(); }

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

const clip = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The top lines of a stack, without the long URLs' query strings. */
export function stackTop(stack, lines = 6) {
  if (!stack) return '';
  return String(stack)
    .split('\n')
    .slice(0, lines)
    .map((line) => line.replace(/\?[^):\s]*/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

/** Pathname plus a few harmless query keys (never tokens, ids or names). */
export function safeRoute(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (!loc) return '';
  try {
    const url = new URL(loc.href);
    const kept = ROUTE_KEYS.filter((key) => url.searchParams.has(key))
      .map((key) => `${key}=${clip(url.searchParams.get(key), 20)}`);
    if (url.searchParams.has('testPdf')) kept.push('testPdf');
    return `${url.pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
  } catch {
    return '';
  }
}

/** Memory figures the browser will tell us (Chromium: JS heap; all: canvases). */
export function memoryFigures(win = (typeof window !== 'undefined' ? window : null)) {
  const out = {};
  try {
    const mem = win?.performance?.memory;
    if (mem && mem.usedJSHeapSize) {
      out.jsHeapMB = Math.round(mem.usedJSHeapSize / 1048576);
      out.jsHeapLimitMB = Math.round(mem.jsHeapSizeLimit / 1048576);
    }
    if (win?.navigator?.deviceMemory) out.deviceMemoryGB = win.navigator.deviceMemory;
    const canvases = win?.document ? win.document.getElementsByTagName('canvas') : [];
    let pixels = 0;
    for (const canvas of canvases) pixels += (canvas.width || 0) * (canvas.height || 0);
    out.canvases = canvases.length;
    out.canvasMB = Math.round((pixels * 4) / 1048576);
    if (win?.document) out.domNodes = win.document.getElementsByTagName('*').length;
  } catch { /* figures are best effort */ }
  return out;
}

export function readCrashReports(storage = store()) {
  const list = readJson(storage, CRASH_LOG_KEY, []);
  return Array.isArray(list) ? list.filter((r) => r && typeof r === 'object') : [];
}

export function clearCrashReports(storage = store()) {
  try { storage?.removeItem(CRASH_LOG_KEY); } catch { /* private mode */ }
  listeners.forEach((fn) => { try { fn(null); } catch { /* listener */ } });
}

/** Subscribe to new records (the hook a later "send to us" step would use). */
export function onCrashRecorded(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteAction(label) {
  const text = clip(label, 48);
  if (!text) return;
  const crumbs = state.breadcrumbs;
  const t = new Date().toISOString().slice(11, 19);
  if (crumbs.length && crumbs[crumbs.length - 1].a === text) crumbs[crumbs.length - 1].n = (crumbs[crumbs.length - 1].n || 1) + 1;
  else crumbs.push({ t, a: text });
  if (crumbs.length > BREADCRUMB_MAX) crumbs.splice(0, crumbs.length - BREADCRUMB_MAX);
  // Keep the "alive" note's actions current: a page killed right after a
  // pinch should still say so.
  if (state.installed && Date.now() - state.lastBeatWrite > 800) {
    state.lastBeatWrite = Date.now();
    writeLive(store());
  }
}

/** Name the build once the release marker has loaded. */
export function setCrashLogBuild(build) {
  if (build) state.build = clip(build, 80);
}

export function recentActions() {
  return state.breadcrumbs.map((c) => `${c.t} ${c.a}${c.n > 1 ? ` x${c.n}` : ''}`);
}

/**
 * Add one crash record. Returns the record (or the earlier one it was folded
 * into: the same crash again within DEDUPE_MS only bumps its count).
 */
export function recordCrash(input = {}, { storage = store(), now = Date.now() } = {}) {
  const error = input.error;
  const message = clip(input.message || error?.message || (typeof error === 'string' ? error : '') || 'Unknown error', 300);
  const kind = input.kind || 'error';
  const list = readCrashReports(storage);
  const last = list[list.length - 1];
  if (last && last.kind === kind && last.message === message && now - Date.parse(last.at) < DEDUPE_MS) {
    last.count = (last.count || 1) + 1;
    writeJson(storage, CRASH_LOG_KEY, list);
    return last;
  }
  const record = {
    v: 1,
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date(now).toISOString(),
    kind,
    message,
    stack: stackTop(input.stack || error?.stack || ''),
    ...(input.componentStack ? { componentStack: stackTop(input.componentStack, 5) } : {}),
    route: input.route ?? safeRoute(),
    actions: input.actions || recentActions(),
    memory: input.memory || memoryFigures(),
    build: input.build || state.build,
    agent: clip(input.agent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''), 160),
    ...(input.viewport ? { viewport: input.viewport } : (typeof window !== 'undefined' ? { viewport: `${window.innerWidth}x${window.innerHeight}` } : {})),
    ...(input.detail ? { detail: input.detail } : {}),
    count: 1,
    sentAt: null,
  };
  list.push(record);
  while (list.length > CRASH_LOG_MAX) list.shift();
  if (!writeJson(storage, CRASH_LOG_KEY, list)) {
    // Storage full: keep the newest half.
    writeJson(storage, CRASH_LOG_KEY, list.slice(-Math.ceil(CRASH_LOG_MAX / 2)));
  }
  listeners.forEach((fn) => { try { fn(record); } catch { /* listener */ } });
  return record;
}

const KIND_LABEL = {
  react: 'Error screen',
  error: 'Error',
  rejection: 'Error (async)',
  freeze: 'Froze',
  closed: 'Page closed by itself',
  'shell-reload': 'Phone app reloaded the page',
};
export const crashKindLabel = (kind) => KIND_LABEL[kind] || kind;

/** Plain text for the Copy button. */
export function formatCrashReports(records) {
  if (!records?.length) return 'No crash reports.';
  return records.slice().reverse().map((r, i) => {
    const mem = r.memory || {};
    const memLine = [
      mem.jsHeapMB != null ? `JS heap ${mem.jsHeapMB}/${mem.jsHeapLimitMB} MB` : null,
      mem.canvasMB != null ? `canvases ${mem.canvases} (${mem.canvasMB} MB)` : null,
      mem.domNodes != null ? `${mem.domNodes} DOM nodes` : null,
      mem.deviceMemoryGB ? `device ${mem.deviceMemoryGB} GB` : null,
    ].filter(Boolean).join(', ');
    return [
      `#${i + 1} ${r.at} ${crashKindLabel(r.kind)}${r.count > 1 ? ` (x${r.count})` : ''}`,
      `What: ${r.message}`,
      r.stack ? `Stack:\n  ${r.stack.split('\n').join('\n  ')}` : null,
      r.componentStack ? `Component:\n  ${r.componentStack.split('\n').join('\n  ')}` : null,
      `Where: ${r.route || '-'}  Build: ${r.build || '-'}  Screen: ${r.viewport || '-'}`,
      memLine ? `Memory: ${memLine}` : null,
      r.actions?.length ? `Last actions: ${r.actions.join(' | ')}` : null,
      r.detail ? `Detail: ${JSON.stringify(r.detail).slice(0, 400)}` : null,
      `Browser: ${r.agent || '-'}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

// ---------------------------------------------------------------- live notes
// Each open page keeps a small "I am alive" note. A page that closes
// normally removes it; one that iOS killed leaves it behind, and the next
// start records it as a crash with the actions it had noted.

function writeLive(storage, extra = {}) {
  if (!state.sessionId) return;
  const live = readJson(storage, CRASH_LIVE_KEY, {});
  const map = live && typeof live === 'object' && !Array.isArray(live) ? live : {};
  map[state.sessionId] = {
    beat: Date.now(),
    visible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
    route: safeRoute(),
    actions: recentActions(),
    memory: memoryFigures(),
    build: state.build,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
    ...extra,
  };
  writeJson(storage, CRASH_LIVE_KEY, map);
}

function removeLive(storage) {
  const map = readJson(storage, CRASH_LIVE_KEY, {});
  if (map && typeof map === 'object' && state.sessionId in map) {
    delete map[state.sessionId];
    writeJson(storage, CRASH_LIVE_KEY, map);
  }
}

/** Turn notes left by pages that died into crash records. Returns how many. */
export function collectDeadSessions({ storage = store(), now = Date.now(), selfId = state.sessionId } = {}) {
  const map = readJson(storage, CRASH_LIVE_KEY, {});
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 0;
  let found = 0;
  let changed = false;
  for (const [id, note] of Object.entries(map)) {
    if (id === selfId) continue;
    const age = now - Number(note?.beat || 0);
    if (age < LIVE_DEAD_AFTER_MS) continue; // another tab, still alive
    delete map[id];
    changed = true;
    // Hidden when it died: the system tidying up a page in the background,
    // not a crash in front of the person.
    if (age > LIVE_FORGET_AFTER_MS || note?.visible === false) continue;
    recordCrash({
      kind: 'closed',
      message: 'The page closed by itself while in use (most likely it ran out of memory).',
      route: note.route,
      actions: Array.isArray(note.actions) ? note.actions : [],
      memory: note.memory || {},
      build: note.build,
      viewport: note.viewport || '-',
      detail: { lastSeen: new Date(Number(note.beat)).toISOString() },
    }, { storage, now });
    found += 1;
  }
  if (changed) writeJson(storage, CRASH_LIVE_KEY, map);
  return found;
}

/** The phone app's own note that it reloaded a page whose process died. */
export function recordShellNote(detail, { storage = store(), now = Date.now() } = {}) {
  if (!detail || typeof detail !== 'object') return null;
  const list = readCrashReports(storage);
  // The same death was already found from the page's own note: add to it.
  for (let i = list.length - 1; i >= 0 && i >= list.length - 3; i -= 1) {
    const r = list[i];
    if (r.kind === 'closed' && now - Date.parse(r.at) < 120000 && !r.shell) {
      r.shell = { source: clip(detail.source, 40), at: detail.at || null, recoveries: detail.recoveriesInLastMinute ?? null };
      writeJson(storage, CRASH_LOG_KEY, list);
      return r;
    }
  }
  return recordCrash({
    kind: 'shell-reload',
    message: 'The phone app saw the page stop and reloaded it (most likely out of memory).',
    route: typeof detail.url === 'string' ? safeRoute({ href: detail.url }) : undefined,
    actions: [],
    memory: {},
    detail: { source: clip(detail.source, 40), at: detail.at || null, recoveries: detail.recoveriesInLastMinute ?? null },
  }, { storage, now });
}

const NETWORK_NOISE = /Failed to fetch|NetworkError|Load failed|AbortError|aborted|ERR_|timeout|timed out|offline|Network request failed|ResizeObserver loop|cancelled|canceled|RenderingCancelled/i;

function labelForTarget(target) {
  const el = target?.closest?.('button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], a, input[type="checkbox"], select');
  if (!el) return null;
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.tagName;
  return clip(label, 40);
}

/**
 * Install once, as early as possible (main.jsx). `build` names the build.
 */
export function installCrashLog({ build = 'unknown', storage = null } = {}) {
  if (state.installed || typeof window === 'undefined') return;
  state.installed = true;
  state.build = build;
  state.storage = storage;
  state.sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const s = () => store();

  try { collectDeadSessions({ storage: s() }); } catch { /* best effort */ }
  writeLive(s());

  window.addEventListener('error', (event) => {
    if (!(event instanceof ErrorEvent)) return; // a failed image / script load
    if (!event.error && /^Script error\.?$/.test(event.message || '')) return;
    recordCrash({ kind: 'error', error: event.error, message: event.message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || (typeof reason === 'string' ? reason : '');
    if (!message || NETWORK_NOISE.test(message) || NETWORK_NOISE.test(reason?.name || '')) return;
    recordCrash({ kind: 'rejection', error: reason instanceof Error ? reason : null, message, stack: reason?.stack });
  });

  // What the person pressed (labels only; never what they typed).
  document.addEventListener('pointerdown', (event) => {
    const label = labelForTarget(event.target);
    if (label) noteAction(label);
    else if (event.target?.closest?.('.survey-pdfjs-page-div')) noteAction(event.pointerType === 'touch' ? 'touch on page' : 'press on page');
  }, { capture: true, passive: true });
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey || event.altKey) && !['Escape', 'Delete', 'Backspace', 'Enter'].includes(event.key)) return;
    if (['Backspace', 'Enter'].includes(event.key) && event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const combo = `${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Cmd+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.key.length === 1 ? event.key.toUpperCase() : event.key}`;
    noteAction(`key ${combo}`);
  }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    noteAction(document.visibilityState === 'hidden' ? 'app hidden' : 'app shown');
    writeLive(s());
  });
  window.addEventListener('pagehide', () => removeLive(s()));
  window.addEventListener('pageshow', (event) => { if (event.persisted) writeLive(s()); });

  // Freeze watch + "alive" note.
  let last = Date.now();
  let lastVisible = document.visibilityState !== 'hidden';
  let lastHref = '';
  window.setInterval(() => {
    const now = Date.now();
    const visible = document.visibilityState !== 'hidden';
    const gap = now - last;
    if (gap >= FREEZE_MS && visible && lastVisible) {
      recordCrash({ kind: 'freeze', message: `The page did not respond for ${(gap / 1000).toFixed(1)} s.` });
    }
    last = now;
    lastVisible = visible;
    // Tell the phone app where the page is, so a reload after a crash comes
    // back to the same place (mobile-expo/App.tsx).
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      try {
        window.ReactNativeWebView?.postMessage?.(JSON.stringify({ type: 'survey:location', url: lastHref }));
      } catch { /* not in the phone app */ }
    }
    if (now - state.lastBeatWrite >= LIVE_BEAT_MS) {
      state.lastBeatWrite = now;
      writeLive(s());
    }
  }, 1000);

  // The phone app's note (mobile-expo/App.tsx), queued or live.
  const takeShellNotes = () => {
    const queued = Array.isArray(window.__surveyNativeCrashNotes) ? window.__surveyNativeCrashNotes.splice(0) : [];
    queued.forEach((note) => recordShellNote(note, { storage: s() }));
  };
  // The shell queues its notes on window.__surveyNativeCrashNotes and then
  // fires this event (an event with a detail is taken too).
  window.addEventListener('survey-native-crash-note', (event) => {
    if (event.detail && typeof event.detail === 'object') recordShellNote(event.detail, { storage: s() });
    takeShellNotes();
  });
  takeShellNotes();
}

/** For the ErrorBoundary. */
export function recordReactCrash(error, componentStack) {
  return recordCrash({ kind: 'react', error, componentStack });
}

// Test seam.
export function __resetCrashLogForTests() {
  state.installed = false;
  state.sessionId = null;
  state.breadcrumbs = [];
  state.storage = null;
  listeners.clear();
}
