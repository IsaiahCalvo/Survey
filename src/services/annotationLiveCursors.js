// src/services/annotationLiveCursors.js
//
// KAL-399 (2026-10-13): live cursors — see where the other people in the same
// document are pointing, the way Figma and Drawboard show it.
//
// Transport: the document's private live channel (annotationLiveBus.js,
// `anno-live:<documentId>`), the same one that carries live strokes (v3) and
// live edits. No new table, no new channel, no database write. The Yjs
// awareness lane (useRemoteEditors) was never given an Awareness instance, so
// it carries nothing today; the live channel is the one that works and is
// private to the document's people.
//
// Message (v5), small on purpose (~100 bytes of JSON; ~150 with u / n, which
// ride on the first message and every LIVE_CURSOR_IDENTITY_MS after):
//   { v: 5, w: writerId, p: page, x, y [, u: userId, n: name] }  pointing here
//   { v: 5, w: writerId, g: 1 }                                   gone
// x / y are PDF page units (the same units as every mark and as the SVG
// layer's viewBox), rounded to 0.1. A page unit lands on the same spot of the
// page at any zoom on any device; nothing about the sender's screen is sent.
//
// Sender: at most one message every LIVE_CURSOR_INTERVAL_MS (10 a second),
// only when the point moved at least LIVE_CURSOR_MIN_MOVE page units, nothing
// when the pointer is still, off the pages or the tab is hidden, and nothing
// at all while this person is alone on the document (the people list's
// presence, document_presence: someone else joins -> it starts, the last one
// leaves -> it stops).
//
// Receiver: a cursor fades out LIVE_CURSOR_IDLE_MS after its last message (a
// still pointer, a lost "gone", a closed laptop) and at once on "gone".
//
// Pure JS (timers only), no React, no network: the doc handle registers the
// sink (annotationDocSync.js), useLiveCursorBroadcast sends, and
// RemoteCursorLayer shows.

export const LIVE_CURSOR_VERSION = 5;
// 100 ms = 10 messages a second (owner: keep Realtime traffic small; the
// pen's live strokes are held to 8 a second for the project's message cap,
// w34 review). Nothing goes out while the pointer is still, or while nobody
// else is on the document (hasOtherPeoplePresent). The receiver glides
// between points (RemoteCursorLayer, 90 ms), so 10 a second still moves on
// nearly every frame (measured in the E2E).
export const LIVE_CURSOR_INTERVAL_MS = 100;
export const LIVE_CURSOR_IDENTITY_MS = 2_000; // who-this-is is repeated this often, not on every message
export const LIVE_CURSOR_MIN_MOVE = 0.5;      // page units (~0.2 mm): below this, no message
export const LIVE_CURSOR_IDLE_MS = 5_000;     // a cursor that stopped talking fades out
export const LIVE_CURSOR_FADE_MS = 400;       // the fade itself (matches the CSS)
export const LIVE_CURSOR_TOUCH_LINGER_MS = 1_500; // a finger's point stays this long after it lifts
export const LIVE_CURSOR_MAX = 20;            // shown at once, all documents together
export const LIVE_CURSOR_RECEIVE_PER_SEC = 30; // per writer; a flood is dropped
const NAME_MAX = 40;
const ID_MAX = 128;

const round = (value) => Math.round(value * 10) / 10;

const REGISTRY = (globalThis.__annotationLiveCursors__ ??= {
  sinks: new Map(),     // documentId -> { documentId, writerId, send(payload) -> boolean }
  cursors: new Map(),   // `${documentId}\0${writerId}` -> cursor
  listeners: new Set(),
  version: 0,
  snapshots: new Map(), // `${documentId}\0${page}` -> { version, list }
  receiveCounts: new Map(),
  sweepTimer: null,
});

function emit() {
  REGISTRY.version += 1;
  for (const listener of [...REGISTRY.listeners]) {
    try { listener(); } catch { /* a view's problem, not ours */ }
  }
}

// ---------------------------------------------------------------------------
// Transport registration (one per document, like the live-stroke sink).
// ---------------------------------------------------------------------------

export function setLiveCursorSink(sink) {
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

/**
 * Is anyone else on this document? `presence` is the people list's roster
 * (useDocumentPresenceList: document_presence rows, stale ones already aged
 * out). Another device of the same person does not count: the cursor is for
 * other people.
 */
export function hasOtherPeoplePresent(presence, selfId) {
  if (!Array.isArray(presence)) return false;
  return presence.some((row) => row && typeof row.user_id === 'string' && row.user_id && row.user_id !== selfId);
}

export function hasLiveCursorSink(documentId) {
  return REGISTRY.sinks.has(documentId);
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

/**
 * Screen point -> page point. `pages` is the pages on screen:
 * [{ page, rect: { left, top, width, height }, size: { width, height } }]
 * (rect = the page's box on screen now, size = the page in PDF units).
 * Returns { page, x, y } in page units, or null when the point is on no page.
 * Container-measured (rect / size), never zoom x page size, so it is right at
 * any zoom and through any browser / Electron zoom factor.
 */
export function clientPointToPagePoint(clientX, clientY, pages) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !Array.isArray(pages)) return null;
  for (const entry of pages) {
    const rect = entry?.rect;
    const size = entry?.size;
    if (!rect || !size || !(rect.width > 0) || !(rect.height > 0) || !(size.width > 0) || !(size.height > 0)) continue;
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) continue;
    const page = Number(entry.page);
    if (!Number.isInteger(page) || page < 1) continue;
    return { page, x: round(fx * size.width), y: round(fy * size.height) };
  }
  return null;
}

/** Page point -> where it sits inside the page box, in percent (CSS left/top). */
export function pagePointToPercent(x, y, size) {
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    left: Math.max(0, Math.min(100, (x / size.width) * 100)),
    top: Math.max(0, Math.min(100, (y / size.height) * 100)),
  };
}

/** The short label on a cursor: the first name, else the email's name part. */
export function cursorLabel(name) {
  const text = String(name || '').trim();
  if (!text) return 'Someone';
  const base = text.includes('@') ? text.slice(0, text.indexOf('@')) : text.split(/\s+/)[0];
  const clean = base || text;
  return clean.length > 16 ? `${clean.slice(0, 15)}…` : clean;
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

/**
 * One sender per open document view. `resolve()` returns where this screen is
 * pointing now ({ page, x, y } in page units) or null (off the pages / gone);
 * it is only called when a message may go out, so the screen is measured at
 * most 10 times a second, not on every pointer event.
 *
 * Returns { poke(), flushNow(), dispose(), sent() }:
 *   poke     — something moved; a message goes out within the interval
 *              (leading + trailing edge, so the last position always lands).
 *   flushNow — send now (the tab is being hidden: timers may not run).
 *   dispose  — this view is going: "gone" if a cursor is showing elsewhere.
 */
export function createLiveCursorSender({
  documentId,
  resolve,
  identity = () => ({}),
  // Is anyone else here to see it? false = no message and no timer.
  isWanted = () => true,
  intervalMs = LIVE_CURSOR_INTERVAL_MS,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let timer = null;
  let lastSent = null;      // { page, x, y } while a cursor is showing elsewhere
  let lastSentAt = -Infinity;
  let identitySentAt = -Infinity;
  let disposed = false;
  let messages = 0;

  const sinkFor = () => (documentId ? REGISTRY.sinks.get(documentId) : null);
  const wanted = () => { try { return Boolean(isWanted()); } catch { return false; } };

  const send = (sink, payload) => {
    let ok = false;
    try { ok = Boolean(sink.send(payload)); } catch { ok = false; }
    if (ok) {
      messages += 1;
      lastSentAt = now();
    }
    return ok;
  };

  const flush = () => {
    timer = null;
    if (disposed) return;
    const sink = sinkFor();
    if (!sink) { lastSent = null; return; }
    // Alone now: nobody to tell, not even "gone".
    if (!wanted()) { lastSent = null; return; }
    let point = null;
    try { point = resolve?.() || null; } catch { point = null; }
    if (!point) {
      if (lastSent && send(sink, { v: LIVE_CURSOR_VERSION, w: sink.writerId, g: 1 })) lastSent = null;
      return;
    }
    const page = Number(point.page);
    const x = round(Number(point.x));
    const y = round(Number(point.y));
    if (!Number.isInteger(page) || page < 1 || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (lastSent && lastSent.page === page
      && Math.abs(lastSent.x - x) < LIVE_CURSOR_MIN_MOVE
      && Math.abs(lastSent.y - y) < LIVE_CURSOR_MIN_MOVE) return;
    const payload = { v: LIVE_CURSOR_VERSION, w: sink.writerId, p: page, x, y };
    // Who this is rides on the first message and then every
    // LIVE_CURSOR_IDENTITY_MS (for people who join later), not on each one:
    // that halves the message size.
    const withIdentity = !lastSent || now() - identitySentAt >= LIVE_CURSOR_IDENTITY_MS;
    if (withIdentity) {
      const who = identity() || {};
      if (typeof who.userId === 'string' && who.userId) payload.u = who.userId.slice(0, ID_MAX);
      if (typeof who.name === 'string' && who.name.trim()) payload.n = who.name.trim().slice(0, NAME_MAX);
    }
    if (send(sink, payload)) {
      lastSent = { page, x, y };
      if (withIdentity) identitySentAt = now();
    }
  };

  return {
    poke() {
      if (disposed || timer) return;
      if (!sinkFor()) { lastSent = null; return; } // no live channel: no timers either
      if (!wanted()) { lastSent = null; return; }  // alone on the document: same
      const wait = Math.max(0, intervalMs - (now() - lastSentAt));
      timer = setTimer(flush, wait);
    },
    flushNow() {
      if (disposed) return;
      if (timer) { clearTimer(timer); timer = null; }
      flush();
    },
    dispose() {
      if (disposed) return;
      if (timer) { clearTimer(timer); timer = null; }
      const sink = sinkFor();
      if (sink && lastSent && wanted()) send(sink, { v: LIVE_CURSOR_VERSION, w: sink.writerId, g: 1 });
      lastSent = null;
      disposed = true;
    },
    sent: () => messages,
  };
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

function cursorKey(documentId, writerId) {
  return `${documentId}\u0000${writerId}`;
}

function receiveAllowed(writerId, nowMs) {
  const second = Math.floor(nowMs / 1000);
  const entry = REGISTRY.receiveCounts.get(writerId);
  if (!entry || entry.second !== second) {
    REGISTRY.receiveCounts.set(writerId, { second, count: 1 });
    if (REGISTRY.receiveCounts.size > 64) {
      REGISTRY.receiveCounts.delete(REGISTRY.receiveCounts.keys().next().value);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= LIVE_CURSOR_RECEIVE_PER_SEC;
}

function scheduleSweep() {
  if (REGISTRY.sweepTimer || REGISTRY.cursors.size === 0) return;
  REGISTRY.sweepTimer = setTimeout(() => {
    REGISTRY.sweepTimer = null;
    sweepLiveCursors();
    scheduleSweep();
  }, 250);
  REGISTRY.sweepTimer.unref?.();
}

/** Fade out idle cursors, then drop faded ones. Returns true when anything changed. */
export function sweepLiveCursors(nowMs = Date.now()) {
  let changed = false;
  for (const [key, cursor] of REGISTRY.cursors) {
    if (cursor.leavingAt != null) {
      if (nowMs - cursor.leavingAt >= LIVE_CURSOR_FADE_MS) {
        REGISTRY.cursors.delete(key);
        changed = true;
      }
    } else if (nowMs - cursor.updatedAt >= LIVE_CURSOR_IDLE_MS) {
      cursor.leavingAt = nowMs;
      changed = true;
    }
  }
  if (changed) emit();
  return changed;
}

/**
 * Another screen's cursor message (already known to come from this
 * document's private channel). Returns true when it changed what is shown.
 */
export function applyRemoteLiveCursor(documentId, payload, { ownWriterId = null, nowMs = Date.now() } = {}) {
  if (!documentId || !payload || typeof payload !== 'object' || payload.v !== LIVE_CURSOR_VERSION) return false;
  const writerId = typeof payload.w === 'string' ? payload.w : '';
  if (!writerId || writerId.length > 256 || writerId === ownWriterId) return false;
  if (!receiveAllowed(writerId, nowMs)) return false;
  const key = cursorKey(documentId, writerId);
  const existing = REGISTRY.cursors.get(key);
  if (payload.g === 1) {
    if (!existing || existing.leavingAt != null) return false;
    existing.leavingAt = nowMs;
    emit();
    scheduleSweep();
    return true;
  }
  const page = Number(payload.p);
  const x = Number(payload.x);
  const y = Number(payload.y);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) return false;
  if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return false;
  const userId = typeof payload.u === 'string' && payload.u.length <= ID_MAX ? payload.u : null;
  const name = typeof payload.n === 'string' ? payload.n.slice(0, NAME_MAX) : null;
  let cursor = existing;
  if (!cursor) {
    if (REGISTRY.cursors.size >= LIVE_CURSOR_MAX) return false;
    cursor = { key, documentId, writerId, userId: null, name: null, page, x, y, updatedAt: nowMs, leavingAt: null };
    REGISTRY.cursors.set(key, cursor);
  }
  cursor.page = page;
  cursor.x = x;
  cursor.y = y;
  if (userId) cursor.userId = userId;
  if (name) cursor.name = name;
  cursor.updatedAt = nowMs;
  cursor.leavingAt = null;
  emit();
  scheduleSweep();
  return true;
}

/** The document closed on this screen (or its live channel went): its cursors go. */
export function clearLiveCursors(documentId) {
  let removed = false;
  for (const [key, cursor] of REGISTRY.cursors) {
    if (!documentId || cursor.documentId === documentId) {
      REGISTRY.cursors.delete(key);
      removed = true;
    }
  }
  if (removed) emit();
}

// For useSyncExternalStore: a stable list per page until something changes.
export function subscribeLiveCursors(listener) {
  REGISTRY.listeners.add(listener);
  return () => REGISTRY.listeners.delete(listener);
}

export function getLiveCursorsForPage(page, documentId) {
  const pageKey = Number(page);
  const cacheKey = `${documentId}\u0000${pageKey}`;
  const cached = REGISTRY.snapshots.get(cacheKey);
  if (cached && cached.version === REGISTRY.version) return cached.list;
  const list = [];
  for (const cursor of REGISTRY.cursors.values()) {
    if (cursor.documentId === documentId && cursor.page === pageKey) {
      list.push({
        key: cursor.key,
        writerId: cursor.writerId,
        userId: cursor.userId,
        name: cursor.name,
        x: cursor.x,
        y: cursor.y,
        leaving: cursor.leavingAt != null,
      });
    }
  }
  const previous = cached?.list;
  const same = previous && previous.length === list.length
    && previous.every((entry, index) => {
      const next = list[index];
      return entry.key === next.key && entry.x === next.x && entry.y === next.y
        && entry.leaving === next.leaving && entry.name === next.name && entry.userId === next.userId;
    });
  const result = same ? previous : list;
  REGISTRY.snapshots.set(cacheKey, { version: REGISTRY.version, list: result });
  if (REGISTRY.snapshots.size > 400) REGISTRY.snapshots.delete(REGISTRY.snapshots.keys().next().value);
  return result;
}

/** Every user id with a cursor on this document (for colour assignment). */
export function getLiveCursorUserIds(documentId) {
  const ids = [];
  for (const cursor of REGISTRY.cursors.values()) {
    if (cursor.documentId === documentId && cursor.userId) ids.push(cursor.userId);
  }
  return ids;
}

export const __liveCursorsTest = {
  reset() {
    REGISTRY.sinks.clear();
    REGISTRY.cursors.clear();
    REGISTRY.listeners.clear();
    REGISTRY.snapshots.clear();
    REGISTRY.receiveCounts.clear();
    if (REGISTRY.sweepTimer) clearTimeout(REGISTRY.sweepTimer);
    REGISTRY.sweepTimer = null;
  },
  cursors: () => [...REGISTRY.cursors.values()],
};
