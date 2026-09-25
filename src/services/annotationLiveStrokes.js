// src/services/annotationLiveStrokes.js
//
// w32 (2026-09-25): a pen or highlighter stroke shows on other screens WHILE
// it is being drawn, not only once the pen lifts.
//
// Before, another screen saw a stroke only after pointer-up (the v1 preview
// of the finished mark, w30). Drawboard/Figma-level feel means the ink grows
// on the other screen as it is drawn. The drawing screen now sends the new
// points of its in-progress stroke at most every LIVE_STROKE_INTERVAL_MS
// (at most 8 messages a second while the pen moves, nothing when it is still
// or idle, nothing at all when no other screen has the document open) on the
// same private live channel (v3 message):
//
//   { v: 3, w: writerId, g: strokeId, p: page, t: tool, c: colour, sw: width,
//     i: index of the first point, pts: [x0, y0, x1, y1, ...], f?: 1, x?: 1 }
//
// f = the pen lifted (these are the last points), x = the stroke was
// cancelled. strokeId is the id the finished mark will have.
//
// A receiving screen draws it as a GHOST: a plain polyline in the page's SVG
// (LiveStrokeGhosts), never an annotation — nothing can select, save, export
// or undo it. It leaves when the finished mark is on that screen (its
// preview or its row: `markLanded`), on cancel, 20 s after the pen lifted, or
// 10 s after the last points (a sender that vanished). A later preview/row
// is what makes the stroke real; the ghost only fills the time before it.
//
// Pure JS (timers only), no React, no network: the doc handle is the
// transport (annotationDocSync.js), SVGAnnotationLayer the sender and view.

export const LIVE_STROKE_VERSION = 3;
export const LIVE_STROKE_INTERVAL_MS = 125;    // ≤ 8 messages / s per drawing screen (w34 review: project Realtime cap)
export const LIVE_STROKE_MAX_POINTS = 4_000;   // per ghost (a long stroke keeps its start)
export const LIVE_STROKE_MAX_BATCH = 600;      // points per message
export const LIVE_STROKE_MAX_GHOSTS = 24;      // shown at once, all screens together
export const LIVE_STROKE_ENDED_TTL_MS = 20_000; // = the v1 preview expiry: the row may be slow (review B)
export const LIVE_STROKE_IDLE_TTL_MS = 10_000;
export const LIVE_STROKE_LANDED_DELAY_MS = 120; // let the real mark paint first
const TOOLS = new Set(['pen', 'highlighter']);
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]{1,40}\)|[a-zA-Z]{1,20})$/;

const round = (value) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Transport registration: the open, writable doc handle with a live channel.
// ---------------------------------------------------------------------------

const REGISTRY = (globalThis.__annotationLiveStrokes__ ??= {
  sinks: new Map(),    // documentId → { documentId, writerId, send(payload) → boolean }
  ghosts: new Map(),   // `${documentId}\0${writerId}\0${strokeId}` → ghost
  listeners: new Set(),
  version: 0,
  snapshots: new Map(), // page → { version, list }
  sweepTimer: null,
});

/**
 * The doc handle registers how to send for ITS document; returns an
 * unregister function. One per document: a stroke drawn in one document can
 * never go out on another document's channel (review A).
 */
export function setLiveStrokeSink(sink) {
  if (!sink?.documentId) return () => {};
  REGISTRY.sinks.set(sink.documentId, sink);
  emit();
  return () => {
    if (REGISTRY.sinks.get(sink.documentId) === sink) {
      REGISTRY.sinks.delete(sink.documentId);
      emit();
    }
  };
}

export function hasLiveStrokeSink(documentId) {
  return REGISTRY.sinks.has(documentId);
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

/**
 * Start streaming one in-progress stroke. Returns { push(points), end(committed) }.
 * `points` is the gesture's whole point array (page units, { x, y }); only the
 * points not sent yet go out. Safe to call when no channel is open (no-op).
 */
export function beginLiveStroke({ documentId, id, page, tool, color, width }, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const sink = documentId ? REGISTRY.sinks.get(documentId) : null;
  if (!sink || !id || !TOOLS.has(tool) || !Number.isInteger(Number(page))) {
    return { push() {}, end() {}, sent: () => 0 };
  }
  let latest = [];
  let sentCount = 0;
  let lastSentAt = 0;
  let timer = null;
  let finished = false;
  let messages = 0;
  const base = {
    v: LIVE_STROKE_VERSION,
    w: sink.writerId,
    g: String(id),
    p: Number(page),
    t: tool,
    c: typeof color === 'string' && COLOR_RE.test(color) ? color : '#000000',
    sw: Number.isFinite(Number(width)) ? Math.max(0.1, Math.min(200, Number(width))) : 3,
  };
  const flush = (extra = null) => {
    timer = null;
    if (REGISTRY.sinks.get(sink.documentId) !== sink) return;
    const end = Math.min(latest.length, sentCount + LIVE_STROKE_MAX_BATCH);
    if (end <= sentCount && !extra) return;
    const pts = [];
    for (let index = sentCount; index < end; index += 1) {
      const point = latest[index];
      pts.push(round(Number(point?.x) || 0), round(Number(point?.y) || 0));
    }
    const payload = { ...base, i: sentCount, pts, ...(extra || {}) };
    if (sink.send(payload)) messages += 1;
    sentCount = end;
    lastSentAt = now();
    // More than one batch behind (a very fast long stroke): keep going.
    if (!extra && sentCount < latest.length) schedule();
  };
  const schedule = () => {
    if (timer || finished) return;
    const wait = Math.max(0, LIVE_STROKE_INTERVAL_MS - (now() - lastSentAt));
    timer = setTimer(() => flush(), wait);
  };
  return {
    push(points) {
      if (finished || !Array.isArray(points)) return;
      latest = points;
      if (latest.length > sentCount && sentCount < LIVE_STROKE_MAX_POINTS) schedule();
    },
    end(committed, points = null) {
      if (finished) return;
      finished = true;
      if (Array.isArray(points)) latest = points;
      if (timer) { clearTimer(timer); timer = null; }
      // Nothing went out yet (a quick stroke): the finished mark's preview
      // is on its way anyway, so no extra message.
      if (sentCount === 0) return;
      flush(committed ? { f: 1 } : { x: 1 });
    },
    sent: () => messages,
  };
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

function ghostKey(documentId, writerId, strokeId) {
  return `${documentId}\u0000${writerId}\u0000${strokeId}`;
}

function emit() {
  REGISTRY.version += 1;
  for (const listener of [...REGISTRY.listeners]) {
    try { listener(); } catch { /* a view's problem, not ours */ }
  }
}

function scheduleSweep() {
  if (REGISTRY.sweepTimer || REGISTRY.ghosts.size === 0) return;
  REGISTRY.sweepTimer = setTimeout(() => {
    REGISTRY.sweepTimer = null;
    sweepLiveStrokes();
    scheduleSweep();
  }, 500);
  REGISTRY.sweepTimer.unref?.();
}

export function sweepLiveStrokes(nowMs = Date.now()) {
  let removed = false;
  for (const [key, ghost] of REGISTRY.ghosts) {
    const expired = ghost.removeAt != null
      ? nowMs >= ghost.removeAt
      : nowMs - ghost.updatedAt >= (ghost.ended ? LIVE_STROKE_ENDED_TTL_MS : LIVE_STROKE_IDLE_TTL_MS);
    if (expired) {
      REGISTRY.ghosts.delete(key);
      removed = true;
    }
  }
  if (removed) emit();
  return removed;
}

/**
 * Another screen's stroke message (already known to come from a document
 * editor on this document's private channel). Returns true when shown.
 */
export function applyRemoteLiveStroke(documentId, payload, { ownWriterId = null, nowMs = Date.now() } = {}) {
  if (!documentId || !payload || typeof payload !== 'object' || payload.v !== LIVE_STROKE_VERSION) return false;
  const writerId = typeof payload.w === 'string' ? payload.w : '';
  const strokeId = typeof payload.g === 'string' ? payload.g : '';
  if (!writerId || writerId.length > 256 || writerId === ownWriterId) return false;
  if (!strokeId || strokeId.length > 256) return false;
  const key = ghostKey(documentId, writerId, strokeId);
  const existing = REGISTRY.ghosts.get(key);
  if (payload.x === 1) {
    if (existing) {
      REGISTRY.ghosts.delete(key);
      emit();
    }
    return false;
  }
  const page = Number(payload.p);
  const start = Number(payload.i);
  const pts = payload.pts;
  if (!Number.isInteger(page) || page < 1 || page > 100_000) return false;
  if (!TOOLS.has(payload.t)) return false;
  if (!Number.isSafeInteger(start) || start < 0) return false;
  if (!Array.isArray(pts) || pts.length % 2 !== 0 || pts.length > LIVE_STROKE_MAX_BATCH * 2) return false;
  for (const value of pts) if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) return false;
  const color = typeof payload.c === 'string' && COLOR_RE.test(payload.c) ? payload.c : '#000000';
  const width = Number.isFinite(Number(payload.sw)) ? Math.max(0.1, Math.min(200, Number(payload.sw))) : 3;
  let ghost = existing;
  if (!ghost) {
    if (REGISTRY.ghosts.size >= LIVE_STROKE_MAX_GHOSTS) return false;
    if (REGISTRY.landed?.has(key)) return false; // its mark already came
    ghost = { key, documentId, writerId, strokeId, page, tool: payload.t, color, width, points: [], nextIndex: 0, updatedAt: nowMs, ended: false, removeAt: null };
    REGISTRY.ghosts.set(key, ghost);
  }
  if (ghost.removeAt != null) return false; // its mark is on screen already
  // A lost message leaves a gap: joined straight, which reads as ink.
  if (start >= ghost.nextIndex) {
    const room = Math.max(0, LIVE_STROKE_MAX_POINTS - ghost.points.length);
    const points = [];
    for (let index = 0; index + 1 < pts.length && points.length < room; index += 2) {
      points.push(pts[index], pts[index + 1]);
    }
    ghost.points = [...ghost.points, ...points];
    ghost.nextIndex = start + pts.length / 2;
  }
  ghost.page = page;
  ghost.color = color;
  ghost.width = width;
  ghost.updatedAt = nowMs;
  if (payload.f === 1) ghost.ended = true;
  emit();
  scheduleSweep();
  return true;
}

/**
 * The finished marks with these ids are on this screen now (a preview or a
 * row brought them): their ghosts leave a moment later, after the real mark
 * has painted, so the stroke never blinks.
 */
export function markLiveStrokesLanded(documentId, isLanded, { nowMs = Date.now() } = {}) {
  let changed = false;
  for (const ghost of REGISTRY.ghosts.values()) {
    if (ghost.documentId !== documentId || ghost.removeAt != null) continue;
    if (isLanded(ghost.strokeId)) {
      ghost.removeAt = nowMs + LIVE_STROKE_LANDED_DELAY_MS;
      REGISTRY.landed ??= new Set();
      REGISTRY.landed.add(ghost.key);
      if (REGISTRY.landed.size > 500) REGISTRY.landed.delete(REGISTRY.landed.values().next().value);
      changed = true;
    }
  }
  if (changed) {
    const timer = setTimeout(() => sweepLiveStrokes(), LIVE_STROKE_LANDED_DELAY_MS + 5);
    timer.unref?.();
  }
  return changed;
}

export function hasLiveStrokeGhosts(documentId) {
  for (const ghost of REGISTRY.ghosts.values()) if (ghost.documentId === documentId) return true;
  return false;
}

/** The document closed on this screen: its ghosts go. */
export function clearLiveStrokes(documentId) {
  let removed = false;
  for (const [key, ghost] of REGISTRY.ghosts) {
    if (!documentId || ghost.documentId === documentId) {
      REGISTRY.ghosts.delete(key);
      removed = true;
    }
  }
  if (removed) emit();
}

// For useSyncExternalStore: a stable list per page until something changes.
export function subscribeLiveStrokes(listener) {
  REGISTRY.listeners.add(listener);
  return () => REGISTRY.listeners.delete(listener);
}

// Only that document's ghosts (reviews A/B: never draw one document's ink on
// another).
export function getLiveStrokesForPage(page, documentId) {
  const pageKey = Number(page);
  const cacheKey = `${documentId}\u0000${pageKey}`;
  const cached = REGISTRY.snapshots.get(cacheKey);
  if (cached && cached.version === REGISTRY.version && cached.documentId === documentId) return cached.list;
  const list = [];
  for (const ghost of REGISTRY.ghosts.values()) {
    if (ghost.documentId === documentId && ghost.page === pageKey && ghost.points.length >= 2) {
      list.push({
        key: ghost.key,
        tool: ghost.tool,
        color: ghost.color,
        width: ghost.width,
        points: ghost.points,
        count: ghost.points.length / 2,
      });
    }
  }
  const previous = cached?.list;
  const same = previous && previous.length === list.length
    && previous.every((entry, index) => entry.key === list[index].key && entry.count === list[index].count);
  const result = same ? previous : list;
  REGISTRY.snapshots.set(cacheKey, { version: REGISTRY.version, documentId, list: result });
  return result;
}

export const __liveStrokesTest = {
  reset() {
    REGISTRY.sinks.clear();
    REGISTRY.ghosts.clear();
    REGISTRY.listeners.clear();
    REGISTRY.snapshots.clear();
    REGISTRY.landed?.clear();
    if (REGISTRY.sweepTimer) clearTimeout(REGISTRY.sweepTimer);
    REGISTRY.sweepTimer = null;
  },
  ghosts: () => [...REGISTRY.ghosts.values()],
};
