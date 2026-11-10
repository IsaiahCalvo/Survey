// src/services/annotationSpotlight.js
//
// Spotlight (Nightly flag 'spotlight'), copied from Drawboard Projects:
// "Spotlight me" shares your view; the others on the document see
// "Name is presenting · Follow" and, once they follow, their view moves with
// yours: the same document, page and zoom. A follower who pans or zooms stops
// following until they press "Follow again". The presenter sees a green frame
// and "N following · Stop".
//
// Transport: the document's private live channel (annotationLiveBus.js,
// `anno-live:<documentId>`), the same one as live strokes and cursors. No
// table, no new channel, no database write.
//
// Messages (v6), every one carries w (writer) and u (user id):
//   { k: 'p', n, p, r: [x, y, w, h] }  presenting: page p, view box in page units
//   { k: 's' }                         stopped presenting
//   { k: 'go', d }                     the presenter opened document d
//   { k: 'f', t }                      following presenter t (heartbeat)
//   { k: 'uf', t }                     stopped following t
// The view box is the part of the page the presenter can see, in PDF page
// units (the same units as every mark), so it lands on the same spot at any
// zoom on any screen; the follower fits that box into its own view.
//
// Rates: the presenter sends a view at most every SPOTLIGHT_SEND_MS and only
// when it moved, plus a heartbeat every SPOTLIGHT_BEAT_MS; a follower sends a
// heartbeat every SPOTLIGHT_BEAT_MS. Someone silent for SPOTLIGHT_STALE_MS is
// gone. Pure JS (timers only), no React, no network: the doc handle registers
// the sink (annotationDocSync.js), the viewer registers how to read and show
// a view (PdfjsViewerContainer), and SpotlightOverlay shows the rest.

export const SPOTLIGHT_VERSION = 6;
export const SPOTLIGHT_SEND_MS = 200;
export const SPOTLIGHT_BEAT_MS = 2_000;
export const SPOTLIGHT_STALE_MS = 6_000;
export const SPOTLIGHT_RECEIVE_PER_SEC = 20;
const NAME_MAX = 40;
const ID_MAX = 128;

const round = (value) => Math.round(value * 10) / 10;

const REGISTRY = (globalThis.__annotationSpotlight__ ??= {
  sinks: new Map(),      // documentId -> { documentId, writerId, send(payload) -> boolean }
  listeners: new Set(),
  version: 0,
  snapshot: null,
  me: { userId: null, name: '' },
  documentId: null,      // the document on this screen now
  viewer: null,          // { readView() -> {page, rect} | null, showView(page, rect) -> boolean }
  presenting: false,
  lastSent: null,        // key of the last view sent
  lastSentAt: -Infinity,
  presenters: new Map(), // userId -> { userId, name, documentId, page, rect, at }
  followers: new Map(),  // userId -> { at }
  following: null,       // the presenter's userId
  paused: false,         // following, but the view was moved by hand
  lastApplied: null,     // key of the last view shown
  go: null,              // { documentId, seq } for the follower to open
  goSeq: 0,
  receiveCounts: new Map(),
  timer: null,
  now: () => Date.now(),
});

function emit() {
  REGISTRY.version += 1;
  REGISTRY.snapshot = null;
  for (const listener of [...REGISTRY.listeners]) {
    try { listener(); } catch { /* a view's problem, not ours */ }
  }
}

function send(documentId, payload) {
  const sink = documentId ? REGISTRY.sinks.get(documentId) : null;
  if (!sink || !REGISTRY.me.userId) return false;
  try {
    return Boolean(sink.send({ v: SPOTLIGHT_VERSION, w: sink.writerId, u: REGISTRY.me.userId, ...payload }));
  } catch {
    return false;
  }
}

const viewKey = (documentId, page, rect) => `${documentId}\u0000${page}\u0000${rect.join(',')}`;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function setSpotlightSink(sink) {
  if (!sink?.documentId) return () => {};
  REGISTRY.sinks.set(sink.documentId, sink);
  // A presenter's first view goes out as soon as the channel is there.
  REGISTRY.lastSent = null;
  schedule();
  return () => {
    if (REGISTRY.sinks.get(sink.documentId) === sink) REGISTRY.sinks.delete(sink.documentId);
  };
}

/** Who this screen is (AppShell). */
export function setSpotlightIdentity({ userId = null, name = '' } = {}) {
  const id = typeof userId === 'string' && userId ? userId.slice(0, ID_MAX) : null;
  if (REGISTRY.me.userId !== id) {
    if (REGISTRY.presenting) stopPresenting();
    if (REGISTRY.following) stopFollowing();
  }
  REGISTRY.me = { userId: id, name: String(name || '').trim().slice(0, NAME_MAX) };
}

/**
 * The document on screen now (AppShell, from the active tab). A presenter who
 * opens another document tells the followers on the old one first, while its
 * channel is still open.
 */
export function setSpotlightDocument(documentId) {
  const next = documentId ? String(documentId) : null;
  const before = REGISTRY.documentId;
  if (next === before) return;
  if (REGISTRY.presenting && before && next) send(before, { k: 'go', d: next.slice(0, ID_MAX) });
  // Back to Home: presenting and following both end.
  if (!next && REGISTRY.presenting) stopPresenting();
  if (!next && REGISTRY.following) stopFollowing();
  REGISTRY.documentId = next;
  REGISTRY.lastSent = null;
  REGISTRY.lastApplied = null;
  emit();
  schedule();
}

/** The active viewer (PdfjsViewerContainer, while its tab is in front). */
export function registerSpotlightViewer(viewer) {
  if (!viewer) return () => {};
  REGISTRY.viewer = viewer;
  REGISTRY.lastApplied = null;
  applyFollowedView();
  return () => {
    if (REGISTRY.viewer === viewer) REGISTRY.viewer = null;
  };
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export function startPresenting() {
  if (!REGISTRY.me.userId) return false;
  if (REGISTRY.following) stopFollowing();
  REGISTRY.presenting = true;
  REGISTRY.lastSent = null;
  REGISTRY.followers.clear();
  tick();
  emit();
  schedule();
  return true;
}

export function stopPresenting() {
  if (!REGISTRY.presenting) return;
  send(REGISTRY.documentId, { k: 's' });
  REGISTRY.presenting = false;
  REGISTRY.lastSent = null;
  REGISTRY.followers.clear();
  emit();
  schedule();
}

function readView() {
  let view = null;
  try { view = REGISTRY.viewer?.readView?.() || null; } catch { view = null; }
  if (!view) return null;
  const page = Number(view.page);
  const r = view.rect || {};
  const rect = [r.x, r.y, r.width, r.height].map((n) => round(Number(n)));
  if (!Number.isInteger(page) || page < 1 || !rect.every(Number.isFinite) || !(rect[2] > 0) || !(rect[3] > 0)) return null;
  return { page, rect };
}

function presenterTick(now) {
  const documentId = REGISTRY.documentId;
  if (!documentId || !REGISTRY.sinks.has(documentId)) return;
  const view = readView();
  if (!view) return;
  const key = viewKey(documentId, view.page, view.rect);
  if (key === REGISTRY.lastSent && now - REGISTRY.lastSentAt < SPOTLIGHT_BEAT_MS) return;
  const payload = { k: 'p', p: view.page, r: view.rect };
  if (REGISTRY.me.name) payload.n = REGISTRY.me.name;
  if (send(documentId, payload)) {
    REGISTRY.lastSent = key;
    REGISTRY.lastSentAt = now;
  }
}

// ---------------------------------------------------------------------------
// Follower
// ---------------------------------------------------------------------------

export function follow(userId) {
  if (!userId || userId === REGISTRY.me.userId) return false;
  if (REGISTRY.presenting) stopPresenting();
  REGISTRY.following = userId;
  REGISTRY.paused = false;
  REGISTRY.lastApplied = null;
  send(REGISTRY.documentId, { k: 'f', t: userId });
  applyFollowedView();
  emit();
  schedule();
  return true;
}

export function stopFollowing() {
  const was = REGISTRY.following;
  if (!was) return;
  send(REGISTRY.documentId, { k: 'uf', t: was });
  REGISTRY.following = null;
  REGISTRY.paused = false;
  REGISTRY.go = null;
  emit();
  schedule();
}

/** The follower moved the view by hand (viewer): following pauses. */
export function spotlightViewMovedByHand() {
  if (!REGISTRY.following || REGISTRY.paused) return;
  send(REGISTRY.documentId, { k: 'uf', t: REGISTRY.following });
  REGISTRY.paused = true;
  emit();
}

export function followAgain() {
  if (!REGISTRY.following) return;
  REGISTRY.paused = false;
  REGISTRY.lastApplied = null;
  send(REGISTRY.documentId, { k: 'f', t: REGISTRY.following });
  applyFollowedView();
  emit();
}

/** The go-to-document request was handled (or refused) by AppShell. */
export function clearSpotlightGo(seq) {
  if (REGISTRY.go && REGISTRY.go.seq === seq) {
    REGISTRY.go = null;
    emit();
  }
}

function applyFollowedView() {
  const userId = REGISTRY.following;
  if (!userId || REGISTRY.paused || !REGISTRY.viewer) return false;
  const presenter = REGISTRY.presenters.get(userId);
  if (!presenter || presenter.documentId !== REGISTRY.documentId || !presenter.rect) return false;
  const key = viewKey(presenter.documentId, presenter.page, presenter.rect);
  if (key === REGISTRY.lastApplied) return true;
  const [x, y, width, height] = presenter.rect;
  let shown = false;
  try { shown = REGISTRY.viewer.showView(presenter.page, { x, y, width, height }) === true; } catch { shown = false; }
  // Not shown yet (the document is still opening): the next tick tries again.
  if (shown) REGISTRY.lastApplied = key;
  return shown;
}

function followerTick(now) {
  if (!REGISTRY.following) return;
  if (!REGISTRY.paused && now - (REGISTRY.followBeatAt || -Infinity) >= SPOTLIGHT_BEAT_MS) {
    if (send(REGISTRY.documentId, { k: 'f', t: REGISTRY.following })) REGISTRY.followBeatAt = now;
  }
  applyFollowedView();
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------

function receiveAllowed(writerId, now) {
  const second = Math.floor(now / 1000);
  const entry = REGISTRY.receiveCounts.get(writerId);
  if (!entry || entry.second !== second) {
    REGISTRY.receiveCounts.set(writerId, { second, count: 1 });
    if (REGISTRY.receiveCounts.size > 64) REGISTRY.receiveCounts.delete(REGISTRY.receiveCounts.keys().next().value);
    return true;
  }
  entry.count += 1;
  return entry.count <= SPOTLIGHT_RECEIVE_PER_SEC;
}

/**
 * A spotlight message from this document's private channel. Returns true when
 * it changed what this screen shows or does.
 */
export function applyRemoteSpotlight(documentId, payload, { ownWriterId = null } = {}) {
  if (!documentId || !payload || typeof payload !== 'object' || payload.v !== SPOTLIGHT_VERSION) return false;
  const writerId = typeof payload.w === 'string' ? payload.w : '';
  const userId = typeof payload.u === 'string' && payload.u.length <= ID_MAX ? payload.u : '';
  if (!writerId || writerId.length > 256 || writerId === ownWriterId || !userId) return false;
  if (userId === REGISTRY.me.userId) return false; // my other screen
  const now = REGISTRY.now();
  if (!receiveAllowed(writerId, now)) return false;
  const docId = String(documentId);
  const kind = payload.k;

  if (kind === 'p') {
    const page = Number(payload.p);
    const rect = Array.isArray(payload.r) ? payload.r.slice(0, 4).map(Number) : [];
    if (!Number.isInteger(page) || page < 1 || page > 100_000) return false;
    if (rect.length !== 4 || !rect.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6) || !(rect[2] > 0) || !(rect[3] > 0)) return false;
    const before = REGISTRY.presenters.get(userId);
    const name = typeof payload.n === 'string' ? payload.n.slice(0, NAME_MAX) : (before?.name || '');
    REGISTRY.presenters.set(userId, { userId, name, documentId: docId, page, rect, at: now });
    const changed = !before || before.name !== name || before.documentId !== docId;
    if (REGISTRY.following === userId) applyFollowedView();
    if (changed) emit();
    schedule();
    return true;
  }
  if (kind === 's') {
    const had = REGISTRY.presenters.delete(userId);
    if (REGISTRY.following === userId) {
      REGISTRY.following = null;
      REGISTRY.paused = false;
      REGISTRY.go = null;
    }
    if (had) emit();
    schedule();
    return had;
  }
  if (kind === 'go') {
    const target = typeof payload.d === 'string' && payload.d.length <= ID_MAX ? payload.d : '';
    if (!target) return false;
    const before = REGISTRY.presenters.get(userId);
    if (before) REGISTRY.presenters.set(userId, { ...before, documentId: target, at: now });
    if (REGISTRY.following === userId && !REGISTRY.paused && target !== REGISTRY.documentId) {
      REGISTRY.goSeq += 1;
      REGISTRY.go = { documentId: target, seq: REGISTRY.goSeq };
    }
    emit();
    return true;
  }
  if (kind === 'f' || kind === 'uf') {
    if (!REGISTRY.presenting || payload.t !== REGISTRY.me.userId) return false;
    const had = REGISTRY.followers.has(userId);
    if (kind === 'f') REGISTRY.followers.set(userId, { at: now });
    else REGISTRY.followers.delete(userId);
    if (had !== REGISTRY.followers.has(userId)) emit();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Timers: one, only while presenting, following or someone is presenting.
// ---------------------------------------------------------------------------

function prune(now) {
  let changed = false;
  for (const [userId, presenter] of REGISTRY.presenters) {
    if (now - presenter.at >= SPOTLIGHT_STALE_MS) {
      REGISTRY.presenters.delete(userId);
      if (REGISTRY.following === userId) {
        REGISTRY.following = null;
        REGISTRY.paused = false;
        REGISTRY.go = null;
      }
      changed = true;
    }
  }
  for (const [userId, follower] of REGISTRY.followers) {
    if (now - follower.at >= SPOTLIGHT_STALE_MS) {
      REGISTRY.followers.delete(userId);
      changed = true;
    }
  }
  if (changed) emit();
}

function tick() {
  const now = REGISTRY.now();
  prune(now);
  if (REGISTRY.presenting) presenterTick(now);
  followerTick(now);
}

function schedule() {
  const busy = REGISTRY.presenting || REGISTRY.following || REGISTRY.presenters.size > 0 || REGISTRY.followers.size > 0;
  if (busy && !REGISTRY.timer) {
    REGISTRY.timer = setInterval(tick, SPOTLIGHT_SEND_MS);
    REGISTRY.timer.unref?.();
  } else if (!busy && REGISTRY.timer) {
    clearInterval(REGISTRY.timer);
    REGISTRY.timer = null;
  }
}

// ---------------------------------------------------------------------------
// For useSyncExternalStore
// ---------------------------------------------------------------------------

export function subscribeSpotlight(listener) {
  REGISTRY.listeners.add(listener);
  return () => REGISTRY.listeners.delete(listener);
}

/**
 * What this screen shows: { presenting, followerCount, presenter (someone
 * else presenting on this document, or the one followed), following, paused,
 * go }. Stable until something changes.
 */
export function getSpotlightSnapshot() {
  if (REGISTRY.snapshot) return REGISTRY.snapshot;
  const documentId = REGISTRY.documentId;
  let presenter = REGISTRY.following ? REGISTRY.presenters.get(REGISTRY.following) || null : null;
  if (!presenter && documentId) {
    for (const entry of REGISTRY.presenters.values()) {
      if (entry.documentId === documentId) { presenter = entry; break; }
    }
  }
  REGISTRY.snapshot = Object.freeze({
    presenting: REGISTRY.presenting,
    followerCount: REGISTRY.followers.size,
    presenter: presenter ? { userId: presenter.userId, name: presenter.name || '', documentId: presenter.documentId } : null,
    following: REGISTRY.following,
    paused: REGISTRY.paused,
    go: REGISTRY.go,
    documentId,
  });
  return REGISTRY.snapshot;
}

export const __spotlightTest = {
  reset() {
    if (REGISTRY.timer) clearInterval(REGISTRY.timer);
    Object.assign(REGISTRY, {
      sinks: new Map(), listeners: new Set(), version: 0, snapshot: null,
      me: { userId: null, name: '' }, documentId: null, viewer: null,
      presenting: false, lastSent: null, lastSentAt: -Infinity,
      presenters: new Map(), followers: new Map(), following: null, paused: false,
      lastApplied: null, go: null, goSeq: 0, receiveCounts: new Map(), timer: null,
      followBeatAt: -Infinity, now: () => Date.now(),
    });
  },
  setNow(fn) { REGISTRY.now = fn; },
  tick,
};
