// src/services/annotationLiveMarkers.js
//
// w53 (2026-09-28): Survey Marker and space changes LIVE on other screens,
// display only — the w32 live-overlay pattern (annotationLiveOverlay.js) for
// the two stores it did not cover.
//
// Before w53 a moved / restacked / new / deleted Survey Marker, and a
// created / renamed / redrawn space, reached other screens only when its WAL
// row landed (~0.3-0.7 s, more under load). Now the sender also broadcasts,
// on the SAME per-document channel as w30/w32 (`anno-live:<doc>`, one message
// per local edit, the same token bucket), what the edit wrote:
//
//   { v: 4, w: writerId, s: clientSeq,
//     m: [ { k: markerId, r: <marker record> } | { k: markerId, d: 1 } ],
//     sp: <the spaces list> }            (sp only when spaces changed)
//
// keyed by the edit's WAL row (writer id + client_seq) like a v1/v2 message.
// The receiver keeps it as an OVERLAY — never written to its store, never in
// its React state that the capture reads: the screen DRAWS the overlay's
// markers / spaces until the row with that key is applied (the document then
// holds the change), a later row from the same screen is applied, the
// overlay is 12 s old, or the channel closes.
//
// Survey Marker records are small (a few hundred bytes); a message carries
// at most LIVE_MARKER_MAX_ENTRIES of them and LIVE_MARKER_MAX_JSON_BYTES in
// all. A bigger batch (an Excel import, a bulk paste) rides the WAL only.
//
// Pure module (no Yjs, no network): build, parse and the display merges.

export const LIVE_MARKER_VERSION = 4;
export const LIVE_MARKER_MAX_ENTRIES = 64;
export const LIVE_MARKER_MAX_JSON_BYTES = 32 * 1024;
export const LIVE_SPACES_MAX_JSON_BYTES = 32 * 1024;

const MAX_KEY_LENGTH = 512;

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jsonLength(value) {
  try { return JSON.stringify(value)?.length || 0; } catch { return Infinity; }
}

/**
 * Sender: the v4 message for one local edit, or null when there is nothing
 * to send or it is too big to be worth it.
 * @param {{ writerId: string, clientSeq: number,
 *           markers?: Map<string, object|null>, spaces?: Array|undefined }} input
 *   markers: the changed markers as the store now holds them (null = deleted);
 *   spaces: the spaces list when this edit changed it.
 */
export function buildLiveMarkerPayload({ writerId, clientSeq, markers = null, spaces } = {}) {
  const entries = [];
  if (markers && markers.size > 0) {
    if (markers.size > LIVE_MARKER_MAX_ENTRIES) return null;
    for (const [key, record] of markers) {
      if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
      if (record == null) entries.push({ k: key, d: 1 });
      else if (isPlainObject(record)) entries.push({ k: key, r: record });
      else return null;
    }
    if (jsonLength(entries) > LIVE_MARKER_MAX_JSON_BYTES) return null;
  }
  const hasSpaces = Array.isArray(spaces);
  if (hasSpaces && jsonLength(spaces) > LIVE_SPACES_MAX_JSON_BYTES) {
    if (entries.length === 0) return null;
  }
  const sendSpaces = hasSpaces && jsonLength(spaces) <= LIVE_SPACES_MAX_JSON_BYTES;
  if (entries.length === 0 && !sendSpaces) return null;
  return {
    v: LIVE_MARKER_VERSION,
    w: writerId,
    s: clientSeq,
    ...(entries.length ? { m: entries } : {}),
    ...(sendSpaces ? { sp: spaces } : {}),
  };
}

// A space the screen can draw without throwing: the render code walks
// assignedPages[].regions[] (review 2026-09-28: a forged `assignedPages: {}`
// must never reach it).
function isDrawableSpace(space) {
  if (!isPlainObject(space) || typeof space.id !== 'string') return false;
  if (space.name !== undefined && typeof space.name !== 'string') return false;
  if (space.assignedPages === undefined) return true;
  if (!Array.isArray(space.assignedPages)) return false;
  return space.assignedPages.every((page) => isPlainObject(page)
    && (page.regions === undefined || (Array.isArray(page.regions) && page.regions.every(isPlainObject))));
}

/**
 * Receiver: validate a v4 message (a forged sender is bound by nothing).
 * Returns { writerId, clientSeq, markers: Map<id, record|null>, spaces } or null.
 */
export function parseLiveMarkerPayload(payload, { ownWriterId = null } = {}) {
  if (!isPlainObject(payload) || payload.v !== LIVE_MARKER_VERSION) return null;
  const writerId = typeof payload.w === 'string' ? payload.w : '';
  const clientSeq = Number(payload.s);
  if (!writerId || writerId.length > 256 || writerId === ownWriterId) return null;
  if (!Number.isSafeInteger(clientSeq) || clientSeq <= 0) return null;
  const markers = new Map();
  if (payload.m !== undefined) {
    if (!Array.isArray(payload.m) || payload.m.length === 0 || payload.m.length > LIVE_MARKER_MAX_ENTRIES) return null;
    if (jsonLength(payload.m) > LIVE_MARKER_MAX_JSON_BYTES * 2) return null;
    for (const entry of payload.m) {
      if (!isPlainObject(entry)) return null;
      const key = entry.k;
      if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
      if (markers.has(key)) return null;
      if (entry.d === 1) { markers.set(key, null); continue; }
      if (!isPlainObject(entry.r)) return null;
      markers.set(key, entry.r);
    }
  }
  let spaces = null;
  if (payload.sp !== undefined) {
    if (!Array.isArray(payload.sp) || jsonLength(payload.sp) > LIVE_SPACES_MAX_JSON_BYTES * 2) return null;
    if (!payload.sp.every(isDrawableSpace)) return null;
    spaces = payload.sp;
  }
  if (markers.size === 0 && !spaces) return null;
  return { writerId, clientSeq, markers, spaces };
}

/**
 * The overlay to draw from the held messages (oldest first): each marker's
 * newest entry, and the newest spaces list. { markers: Map, spaces: Array|null }.
 */
export function collectLiveMarkerOverlay(edits) {
  const markers = new Map();
  let spaces = null;
  let spacesAt = -Infinity;
  const list = [...(edits || [])].sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
  for (const edit of list) {
    for (const [key, record] of edit.markers || []) {
      markers.delete(key);
      markers.set(key, record);
    }
    if (Array.isArray(edit.spaces) && (edit.receivedAt || 0) >= spacesAt) {
      spaces = edit.spaces;
      spacesAt = edit.receivedAt || 0;
    }
  }
  return { markers, spaces };
}

/**
 * The Survey Markers a screen DRAWS: its store's markers with the overlay's
 * newest records laid over (null = hidden). The store itself is never
 * changed; the same object comes back when there is nothing to lay over.
 */
export function overlayLiveSurveyMarkers(markers, overlayMarkers) {
  if (!overlayMarkers || overlayMarkers.size === 0) return markers;
  const next = { ...(markers || {}) };
  for (const [key, record] of overlayMarkers) {
    if (record == null) delete next[key];
    else next[key] = record;
  }
  return next;
}
